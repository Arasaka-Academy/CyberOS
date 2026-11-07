use crate::error::{Error, Result};
use crate::protocol::{NvrDiscovery, NvrProfile};
use base64::{Engine, engine::general_purpose::STANDARD};
use quick_xml::{Reader, events::Event};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;
use url::Url;
use uuid::Uuid;

const SOAP: &str = "http://www.w3.org/2003/05/soap-envelope";
const DEVICE: &str = "http://www.onvif.org/ver10/device/wsdl";
pub const MEDIA: &str = "http://www.onvif.org/ver10/media/wsdl";
pub const PTZ: &str = "http://www.onvif.org/ver20/ptz/wsdl";
pub const EVENTS: &str = "http://www.onvif.org/ver10/events/wsdl";
pub const NOTIFICATION: &str = "http://docs.oasis-open.org/wsn/b-2";

fn wsse_timestamp(seconds: i64) -> Result<String> {
    // Some Python 3.6 camera implementations accept at most microseconds.
    // Authentication needs whole seconds; event persistence keeps nanoseconds.
    time::OffsetDateTime::from_unix_timestamp(seconds)
        .map_err(|_| Error::unavailable("Invalid camera clock"))?
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|_| Error::unavailable("Invalid camera clock"))
}

pub fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[derive(Debug, Clone, Default)]
pub struct Node {
    pub name: String,
    pub text: String,
    pub attributes: Vec<(String, String)>,
    pub children: Vec<Node>,
}
impl Node {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > 262144 {
            return Err(Error::unavailable("Camera XML response too large"));
        }
        let mut reader = Reader::from_reader(bytes);
        reader.config_mut().trim_text(true);
        let mut stack = vec![Node::default()];
        loop {
            match reader
                .read_event()
                .map_err(|_| Error::unavailable("Invalid camera XML"))?
            {
                Event::Start(tag) | Event::Empty(tag) => {
                    let empty = bytes.get(reader.buffer_position().saturating_sub(2) as usize)
                        == Some(&b'/');
                    let mut node = Node {
                        name: String::from_utf8_lossy(tag.local_name().as_ref()).into_owned(),
                        ..Node::default()
                    };
                    for attr in tag.attributes() {
                        let attr = attr.map_err(|_| Error::unavailable("Invalid XML attribute"))?;
                        let value = attr
                            .decode_and_unescape_value(reader.decoder())
                            .map_err(|_| Error::unavailable("Invalid XML attribute"))?
                            .into_owned();
                        node.attributes.push((
                            String::from_utf8_lossy(attr.key.local_name().as_ref()).into_owned(),
                            value,
                        ));
                    }
                    if empty {
                        stack
                            .last_mut()
                            .ok_or_else(Error::not_found)?
                            .children
                            .push(node);
                    } else {
                        if stack.len() > 48 {
                            return Err(Error::unavailable("Camera XML nesting too deep"));
                        }
                        stack.push(node);
                    }
                }
                Event::End(_) => {
                    if stack.len() < 2 {
                        return Err(Error::unavailable("Invalid camera XML tree"));
                    }
                    let node = stack.pop().ok_or_else(Error::not_found)?;
                    stack
                        .last_mut()
                        .ok_or_else(Error::not_found)?
                        .children
                        .push(node);
                }
                Event::Text(text) => {
                    let decoded = text
                        .decode()
                        .map_err(|_| Error::unavailable("Invalid XML text"))?;
                    stack
                        .last_mut()
                        .ok_or_else(Error::not_found)?
                        .text
                        .push_str(
                            &quick_xml::escape::unescape(&decoded)
                                .map_err(|_| Error::unavailable("Invalid XML text entity"))?,
                        );
                }
                Event::GeneralRef(reference) => {
                    let value = reference
                        .decode()
                        .map_err(|_| Error::unavailable("Invalid XML entity"))?;
                    let entity = quick_xml::escape::unescape(&format!("&{value};"))
                        .map_err(|_| Error::unavailable("Unsupported XML entity"))?
                        .into_owned();
                    stack
                        .last_mut()
                        .ok_or_else(Error::not_found)?
                        .text
                        .push_str(&entity);
                }
                Event::DocType(_) => {
                    return Err(Error::unavailable("XML document types are not accepted"));
                }
                Event::Eof => break,
                _ => {}
            }
        }
        if stack.len() != 1 {
            return Err(Error::unavailable("Incomplete camera XML"));
        }
        stack.pop().ok_or_else(Error::not_found)
    }
    pub fn find(&self, name: &str) -> Option<&Self> {
        if self.name == name {
            Some(self)
        } else {
            self.children.iter().find_map(|c| c.find(name))
        }
    }
    pub fn all<'a>(&'a self, name: &str) -> Vec<&'a Self> {
        let mut out = Vec::new();
        self.collect(name, &mut out);
        out
    }
    fn collect<'a>(&'a self, name: &str, out: &mut Vec<&'a Self>) {
        if self.name == name {
            out.push(self);
        }
        for c in &self.children {
            c.collect(name, out);
        }
    }
    pub fn text_of(&self, name: &str) -> Option<&str> {
        self.find(name).map(|n| n.text.as_str())
    }
    pub fn attr(&self, key: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
}

pub fn validate_endpoint(value: &str, production: bool) -> Result<Url> {
    let url = Url::parse(value).map_err(|_| Error::invalid("Invalid camera address"))?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.host_str().is_none()
    {
        return Err(Error::invalid(
            "Camera address must be HTTP(S), without credentials, query or fragment",
        ));
    }
    if let Ok(ip) = url
        .host_str()
        .unwrap_or_default()
        .trim_matches(['[', ']'])
        .parse::<IpAddr>()
    {
        validate_ip(ip, production)?;
    }
    Ok(url)
}
fn validate_ip(ip: IpAddr, production: bool) -> Result<()> {
    let valid = match ip {
        IpAddr::V4(ip) => {
            !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_broadcast()
                && !ip.is_link_local()
                && (!production
                    || ip.is_private()
                    || ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1]))
        }
        IpAddr::V6(ip) => {
            !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_unicast_link_local()
                && (!production || ip.is_unique_local())
        }
    };
    if !valid {
        return Err(Error::invalid(
            "Camera must use a unicast LAN or Tailscale address",
        ));
    }
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Credentials {
    pub username: String,
    pub password: String,
}

#[derive(Clone)]
pub struct Camera {
    pub client: reqwest::Client,
    pub base: Url,
    credentials: Credentials,
    pub time_offset: i64,
    pub media: String,
    pub events: String,
    pub ptz: Option<String>,
    pub address: IpAddr,
}
pub struct CameraInfo {
    pub id: String,
    pub profiles: Vec<NvrProfile>,
    pub camera: Camera,
}
impl Camera {
    pub async fn snapshot(&self, uri: &str) -> Result<Vec<u8>> {
        let url = self.check_url(uri, false)?;
        let challenge = self.client.get(url.clone()).send().await?;
        if challenge.status().is_success() {
            return image_body(challenge).await;
        }
        if challenge.status() != reqwest::StatusCode::UNAUTHORIZED {
            return Err(Error::unavailable("Camera snapshot unavailable"));
        }
        let header = challenge
            .headers()
            .get("www-authenticate")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");
        let mut fields = std::collections::HashMap::new();
        for part in header.strip_prefix("Digest ").unwrap_or("").split(',') {
            if let Some((key, value)) = part.trim().split_once('=') {
                fields.insert(key.trim(), value.trim_matches('"'));
            }
        }
        let realm = fields.get("realm").copied().unwrap_or_default();
        let nonce = fields.get("nonce").copied().unwrap_or_default();
        if realm != "CyberVisual"
            || nonce.is_empty()
            || nonce.len() > 1024
            || fields.get("qop") != Some(&"auth")
            || fields.get("algorithm").is_some_and(|v| *v != "MD5")
        {
            return Err(Error::unavailable("Unsupported snapshot authentication"));
        }
        use md5::Md5;
        let hash = |text: &str| format!("{:x}", Md5::digest(text.as_bytes()));
        let cnonce = Uuid::new_v4().simple().to_string();
        let uri = url.path();
        let ha1 = hash(&format!(
            "{}:{realm}:{}",
            self.credentials.username, self.credentials.password
        ));
        let ha2 = hash(&format!("GET:{uri}"));
        let response = hash(&format!("{ha1}:{nonce}:00000001:{cnonce}:auth:{ha2}"));
        if self.credentials.username.contains(['"', '\\', '\r', '\n']) {
            return Err(Error::invalid(
                "Camera username cannot be used for digest authentication",
            ));
        }
        let authorization = format!(
            "Digest username=\"{}\",realm=\"{realm}\",nonce=\"{nonce}\",uri=\"{uri}\",algorithm=MD5,qop=auth,nc=00000001,cnonce=\"{cnonce}\",response=\"{response}\"",
            self.credentials.username
        );
        let response = self
            .client
            .get(url)
            .header("authorization", authorization)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(Error::unavailable("Camera snapshot authentication failed"));
        }
        image_body(response).await
    }
    pub async fn ptz_command(&self, command: &crate::protocol::NvrPtzCommand) -> Result<()> {
        use crate::protocol::NvrPtzCommand::*;
        command.validate()?;
        let address = self
            .ptz
            .as_deref()
            .ok_or_else(|| Error::conflict("Camera PTZ is disabled"))?;
        let profile = "<x:ProfileToken>annotated</x:ProfileToken>";
        let (operation, arguments) = match command {
            AbsoluteMove { pan, tilt } => (
                "AbsoluteMove",
                format!("{profile}<x:Position><tt:PanTilt x=\"{pan}\" y=\"{tilt}\"/></x:Position>"),
            ),
            RelativeMove { pan, tilt } => (
                "RelativeMove",
                format!(
                    "{profile}<x:Translation><tt:PanTilt x=\"{pan}\" y=\"{tilt}\"/></x:Translation>"
                ),
            ),
            ContinuousMove { pan, tilt } => (
                "ContinuousMove",
                format!(
                    "{profile}<x:Velocity><tt:PanTilt x=\"{pan}\" y=\"{tilt}\"/></x:Velocity><x:Timeout>PT2S</x:Timeout>"
                ),
            ),
            Stop => ("Stop", format!("{profile}<x:PanTilt>true</x:PanTilt>")),
            Home => ("GotoHomePosition", profile.into()),
            SetPreset { name, token } => (
                "SetPreset",
                format!(
                    "{profile}<x:PresetName>{}</x:PresetName>{}",
                    escape(name),
                    token
                        .as_ref()
                        .map(|t| format!("<x:PresetToken>{}</x:PresetToken>", escape(t)))
                        .unwrap_or_default()
                ),
            ),
            GotoPreset { token } => (
                "GotoPreset",
                format!("{profile}<x:PresetToken>{}</x:PresetToken>", escape(token)),
            ),
            RemovePreset { token } => (
                "RemovePreset",
                format!("{profile}<x:PresetToken>{}</x:PresetToken>", escape(token)),
            ),
        };
        self.soap(address, PTZ, operation, &arguments, true).await?;
        Ok(())
    }
    pub async fn ptz_status(&self) -> Result<crate::protocol::NvrPtzStatus> {
        let response = self
            .client
            .get(self.management_url("/api/ptz"))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(Error::unavailable("PTZ status unavailable"));
        }
        let data: serde_json::Value = serde_json::from_slice(&limited_body(response).await?)
            .map_err(|_| Error::unavailable("Invalid PTZ status"))?;
        let position = data
            .get("position")
            .and_then(|p| serde_json::from_value::<crate::protocol::PtzPosition>(p.clone()).ok());
        let presets = data
            .get("presets")
            .and_then(|p| serde_json::from_value(p.clone()).ok())
            .unwrap_or_default();
        let capability = |name: &str| data["capabilities"][name].as_bool().unwrap_or(false);
        Ok(crate::protocol::NvrPtzStatus {
            enabled: data["enabled"].as_bool().unwrap_or(false),
            driver: data["driver"].as_str().unwrap_or("disabled").into(),
            state: data["state"].as_str().unwrap_or("unavailable").into(),
            simulated: data["simulated"].as_bool().unwrap_or(false),
            position,
            presets,
            calibration_required: data["calibration_required"].as_bool().unwrap_or(false),
            absolute_move: capability("absolute_move"),
            relative_move: capability("relative_move"),
            continuous_move: capability("continuous_move"),
            last_error: if data["last_error"].is_null() {
                None
            } else {
                Some(
                    "PTZ driver is not ready; inspect device calibration and serial connection"
                        .into(),
                )
            },
        })
    }
    pub async fn connect(
        endpoint: &str,
        credentials: Credentials,
        production: bool,
    ) -> Result<CameraInfo> {
        let base = validate_endpoint(endpoint, production)?;
        let host = base
            .host_str()
            .ok_or_else(|| Error::invalid("Camera host is required"))?
            .trim_matches(['[', ']']);
        let addresses: Vec<_> =
            tokio::net::lookup_host((host, base.port_or_known_default().unwrap_or(80)))
                .await?
                .collect();
        if addresses.is_empty() {
            return Err(Error::unavailable("Camera address cannot be resolved"));
        }
        for address in &addresses {
            validate_ip(address.ip(), production)?;
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(5))
            .resolve_to_addrs(host, &addresses)
            .build()?;
        let mut camera = Self {
            client,
            base: base.clone(),
            credentials,
            time_offset: 0,
            media: String::new(),
            events: String::new(),
            ptz: None,
            address: addresses[0].ip(),
        };
        let clock = camera
            .soap(endpoint, DEVICE, "GetSystemDateAndTime", "", false)
            .await?;
        if let (Some(date), Some(time)) = (clock.find("Date"), clock.find("Time")) {
            let raw = format!(
                "{}-{:0>2}-{:0>2}T{:0>2}:{:0>2}:{:0>2}Z",
                date.text_of("Year").unwrap_or(""),
                date.text_of("Month").unwrap_or(""),
                date.text_of("Day").unwrap_or(""),
                time.text_of("Hour").unwrap_or(""),
                time.text_of("Minute").unwrap_or(""),
                time.text_of("Second").unwrap_or("")
            );
            if let Ok(seconds) = crate::protocol::parse_time(&raw) {
                camera.time_offset = seconds - time::OffsetDateTime::now_utc().unix_timestamp();
            }
        }
        let info = camera
            .soap(endpoint, DEVICE, "GetDeviceInformation", "", true)
            .await?;
        if info.text_of("Manufacturer") != Some("CyberVisual") {
            return Err(Error::invalid(
                "This NVR adapter requires a CyberVisual camera",
            ));
        }
        let serial = info
            .text_of("SerialNumber")
            .unwrap_or_default()
            .trim_start_matches("urn:uuid:");
        let id = Uuid::parse_str(serial)
            .map_err(|_| Error::invalid("Camera did not provide a stable UUID"))?
            .to_string();
        let services = camera
            .soap(
                endpoint,
                DEVICE,
                "GetServices",
                "<x:IncludeCapability>true</x:IncludeCapability>",
                true,
            )
            .await?;
        for service in services.all("Service") {
            let address = service.text_of("XAddr").unwrap_or_default();
            camera.check_url(address, false)?;
            match service.text_of("Namespace") {
                Some(MEDIA) => camera.media = address.into(),
                Some(EVENTS) => camera.events = address.into(),
                Some(PTZ) => camera.ptz = Some(address.into()),
                _ => {}
            }
        }
        if camera.media.is_empty() {
            return Err(Error::unavailable("Camera did not publish a media service"));
        }
        let profiles = camera
            .soap(&camera.media, MEDIA, "GetProfiles", "", true)
            .await?;
        let mut result = Vec::new();
        for profile in profiles.all("Profiles") {
            let token = profile.attr("token").unwrap_or_default();
            if !matches!(token, "raw" | "annotated") {
                continue;
            }
            let argument = format!("<x:ProfileToken>{}</x:ProfileToken>", escape(token));
            let stream = camera.soap(&camera.media, MEDIA, "GetStreamUri", &format!("<x:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></x:StreamSetup>{argument}"), true).await?;
            let rtsp = stream
                .text_of("Uri")
                .ok_or_else(|| Error::unavailable("Camera stream address missing"))?;
            camera.check_url(rtsp, true)?;
            let snapshot = camera
                .soap(&camera.media, MEDIA, "GetSnapshotUri", &argument, true)
                .await?;
            let snapshot_uri = snapshot.text_of("Uri").unwrap_or_default();
            camera.check_url(snapshot_uri, false)?;
            result.push(NvrProfile {
                token: token.into(),
                name: profile.text_of("Name").unwrap_or(token).into(),
                rtsp_uri: rtsp.into(),
                snapshot_uri: snapshot_uri.into(),
            });
        }
        if result.is_empty() {
            return Err(Error::unavailable("Camera has no supported H.264 profile"));
        }
        Ok(CameraInfo {
            id,
            profiles: result,
            camera,
        })
    }
    pub fn check_url(&self, address: &str, rtsp: bool) -> Result<Url> {
        let candidate = Url::parse(address)
            .map_err(|_| Error::unavailable("Camera returned an invalid service address"))?;
        // RTSP is a non-special URL scheme: url::Host represents numeric hosts
        // as Domain there, while HTTP represents the same host as Ipv4/Ipv6.
        if !candidate
            .host_str()
            .zip(self.base.host_str())
            .is_some_and(|(a, b)| a.eq_ignore_ascii_case(b))
            || !candidate.username().is_empty()
            || candidate.password().is_some()
            || candidate.fragment().is_some()
            || candidate.query().is_some()
            || if rtsp {
                candidate.scheme() != "rtsp"
            } else {
                !matches!(candidate.scheme(), "http" | "https")
            }
        {
            return Err(Error::unavailable(
                "Camera service address is outside the approved device",
            ));
        }
        Ok(candidate)
    }
    pub fn management_url(&self, path: &str) -> Url {
        let mut url = self.base.clone();
        url.set_path(path);
        url
    }
    pub fn rtsp_input(&self, uri: &str) -> Result<String> {
        let mut url = self.check_url(uri, true)?;
        url.set_ip_host(self.address)
            .map_err(|_| Error::invalid("Invalid camera address"))?;
        url.set_username(&self.credentials.username)
            .map_err(|_| Error::invalid("Invalid camera username"))?;
        url.set_password(Some(&self.credentials.password))
            .map_err(|_| Error::invalid("Invalid camera password"))?;
        Ok(url.to_string())
    }
    pub async fn soap(
        &self,
        address: &str,
        namespace: &str,
        operation: &str,
        arguments: &str,
        authenticated: bool,
    ) -> Result<Node> {
        self.check_url(address, false)?;
        let created =
            wsse_timestamp(time::OffsetDateTime::now_utc().unix_timestamp() + self.time_offset)?;
        let nonce = *Uuid::new_v4().as_bytes();
        let mut digest = Sha1::new();
        digest.update(nonce);
        digest.update(created.as_bytes());
        digest.update(self.credentials.password.as_bytes());
        let header = if authenticated {
            format!(
                r#"<s:Header><wsse:Security s:mustUnderstand="true" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><wsse:UsernameToken><wsse:Username>{}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">{}</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">{}</wsse:Nonce><wsu:Created>{created}</wsu:Created></wsse:UsernameToken></wsse:Security></s:Header>"#,
                escape(&self.credentials.username),
                STANDARD.encode(digest.finalize()),
                STANDARD.encode(nonce)
            )
        } else {
            String::new()
        };
        let body = format!(
            r#"<s:Envelope xmlns:s="{SOAP}" xmlns:x="{namespace}" xmlns:tt="http://www.onvif.org/ver10/schema">{header}<s:Body><x:{operation}>{arguments}</x:{operation}></s:Body></s:Envelope>"#
        );
        let response = self
            .client
            .post(address)
            .header("content-type", "application/soap+xml; charset=utf-8")
            .body(body)
            .send()
            .await?;
        if matches!(response.status().as_u16(), 401 | 403) {
            return Err(Error {
                status: axum::http::StatusCode::UNAUTHORIZED,
                message: "Camera authentication failed".into(),
            });
        }
        let status = response.status();
        let bytes = limited_body(response).await?;
        let document = Node::parse(&bytes)?;
        if !status.is_success() || document.find("Fault").is_some() {
            return Err(Error::unavailable("Camera rejected the ONVIF operation"));
        }
        Ok(document)
    }
}

pub async fn limited_body(mut response: reqwest::Response) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > 262144 {
            return Err(Error::unavailable("Camera response too large"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
async fn image_body(mut response: reqwest::Response) -> Result<Vec<u8>> {
    if !response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("image/jpeg"))
    {
        return Err(Error::unavailable("Camera did not return a JPEG snapshot"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err(Error::unavailable("Snapshot too large"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub async fn discover() -> Result<Vec<NvrDiscovery>> {
    let socket = tokio::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).await?;
    let id = Uuid::new_v4();
    let probe = format!(
        r#"<s:Envelope xmlns:s="{SOAP}" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl"><s:Header><a:MessageID>urn:uuid:{id}</a:MessageID><a:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To><a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action></s:Header><s:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></s:Body></s:Envelope>"#
    );
    socket
        .send_to(
            probe.as_bytes(),
            SocketAddr::from(([239, 255, 255, 250], 3702)),
        )
        .await?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    let mut result = Vec::new();
    let mut buffer = [0; 65536];
    while let Ok(Ok((length, peer))) =
        tokio::time::timeout_at(deadline, socket.recv_from(&mut buffer)).await
    {
        if let Ok(document) = Node::parse(&buffer[..length]) {
            for entry in document.all("ProbeMatch") {
                let id = entry.text_of("Address").unwrap_or_default().to_string();
                for address in entry
                    .text_of("XAddrs")
                    .unwrap_or_default()
                    .split_whitespace()
                {
                    if let Ok(url) = validate_endpoint(address, true) {
                        if url.host_str().and_then(|h| h.parse::<IpAddr>().ok()) != Some(peer.ip())
                        {
                            continue;
                        }
                        if !result.iter().any(|d: &NvrDiscovery| d.id == id) {
                            result.push(NvrDiscovery {
                                id: id.clone(),
                                onvif_url: address.into(),
                            });
                        }
                    }
                }
            }
        }
        if result.len() >= 64 {
            break;
        }
    }
    Ok(result)
}

#[cfg(test)]
mod url_tests {
    use super::*;
    #[test]
    fn authentication_timestamp_works_with_python_microsecond_parsers() {
        assert_eq!(
            wsse_timestamp(1_794_002_400).unwrap(),
            "2026-11-06T22:00:00Z"
        );
        assert!(wsse_timestamp(i64::MAX).is_err());
    }
    #[test]
    fn numeric_http_and_rtsp_hosts_match_and_rtsp_dns_is_pinned() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let camera = Camera {
            client: reqwest::Client::new(),
            base: Url::parse("http://127.0.0.1:8000/onvif/device_service").unwrap(),
            credentials: Credentials {
                username: "user".into(),
                password: "fixture".into(),
            },
            time_offset: 0,
            media: String::new(),
            events: String::new(),
            ptz: None,
            address: "127.0.0.1".parse().unwrap(),
        };
        assert!(camera.check_url("rtsp://127.0.0.1:8554/raw", true).is_ok());
        assert!(camera.check_url("rtsp://127.0.0.2:8554/raw", true).is_err());
        let named = Camera {
            base: Url::parse("http://camera.lan:8000/onvif/device_service").unwrap(),
            ..camera
        };
        assert!(
            named
                .rtsp_input("rtsp://camera.lan:8554/raw")
                .unwrap()
                .contains("@127.0.0.1:8554/raw")
        );
    }
}
