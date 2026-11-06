//! CyberOS tracker transport policy. Validate the addresses used by the
//! connector, including subsequent announcements and every HTTP redirect.
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;

use anyhow::{Context, bail};
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use url::{Host, Url};

pub(crate) fn http_client(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    builder
        .user_agent("CyberOS Downloader")
        .no_proxy()
        .dns_resolver(PublicResolver)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("tracker redirect limit exceeded");
            }
            if let Err(error) = validate_url(attempt.url()) {
                return attempt.error(error.to_string());
            }
            if attempt
                .previous()
                .last()
                .is_some_and(|url| url.scheme() == "https")
                && attempt.url().scheme() != "https"
            {
                return attempt.error("tracker HTTPS downgrade blocked");
            }
            attempt.follow()
        }))
}

struct PublicResolver;

impl Resolve for PublicResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let addresses = tokio::time::timeout(
                Duration::from_secs(5),
                tokio::net::lookup_host((name.as_str(), 0)),
            )
            .await??
            .collect::<Vec<SocketAddr>>();
            if addresses.is_empty() {
                return Err("tracker DNS returned no addresses".into());
            }
            for address in &addresses {
                require_public(address.ip()).map_err(|error| error.to_string())?;
            }
            // reqwest connects to these validated addresses without another lookup.
            Ok(Box::new(addresses.into_iter()) as Addrs)
        })
    }
}

pub(crate) fn validate_url(url: &Url) -> anyhow::Result<()> {
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        bail!("tracker URL must use HTTP(S) without credentials");
    }
    match url.host().context("tracker URL has no host")? {
        Host::Ipv4(address) => require_public(address.into()),
        Host::Ipv6(address) => require_public(address.into()),
        Host::Domain(_) => Ok(()),
    }
}

pub(crate) fn require_public(address: IpAddr) -> anyhow::Result<()> {
    let allowed = match address {
        IpAddr::V4(address) => public_ipv4(address),
        IpAddr::V6(address) => public_ipv6(address),
    };
    if !allowed {
        bail!("tracker connection to non-public address is blocked");
    }
    Ok(())
}

fn public_ipv4(address: Ipv4Addr) -> bool {
    let value = u32::from(address);
    let denied = [
        (0x0000_0000, 0x00ff_ffff),
        (0x0a00_0000, 0x0aff_ffff),
        (0x6440_0000, 0x647f_ffff),
        (0x7f00_0000, 0x7fff_ffff),
        (0xa9fe_0000, 0xa9fe_ffff),
        (0xac10_0000, 0xac1f_ffff),
        (0xc000_0000, 0xc000_00ff),
        (0xc000_0200, 0xc000_02ff),
        (0xc0a8_0000, 0xc0a8_ffff),
        (0xc612_0000, 0xc613_ffff),
        (0xc633_6400, 0xc633_64ff),
        (0xcb00_7100, 0xcb00_71ff),
        (0xe000_0000, 0xffff_ffff),
    ];
    !denied
        .iter()
        .any(|(start, end)| (*start..=*end).contains(&value))
}

fn public_ipv6(address: Ipv6Addr) -> bool {
    let value = u128::from(address);
    let in_prefix = |network: Ipv6Addr, prefix: u32| {
        let mask = u128::MAX << (128 - prefix);
        value & mask == u128::from(network) & mask
    };
    in_prefix(Ipv6Addr::new(0x2000, 0, 0, 0, 0, 0, 0, 0), 3)
        && !in_prefix(Ipv6Addr::new(0x2001, 0x0002, 0, 0, 0, 0, 0, 0), 48)
        && !in_prefix(Ipv6Addr::new(0x2001, 0x0010, 0, 0, 0, 0, 0, 0), 28)
        && !in_prefix(Ipv6Addr::new(0x2001, 0x0db8, 0, 0, 0, 0, 0, 0), 32)
        && !in_prefix(Ipv6Addr::new(0x3fff, 0, 0, 0, 0, 0, 0, 0), 20)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_literals_and_schemes() {
        for url in [
            "http://127.1/",
            "http://10.1.2.3/",
            "http://169.254.169.254/",
            "http://[::1]/",
            "http://[::ffff:127.0.0.1]/",
            "http://[fc00::1]/",
            "ftp://example.com/",
            "https://user:secret@example.com/",
        ] {
            assert!(validate_url(&Url::parse(url).unwrap()).is_err(), "{url}");
        }
        for url in [
            "https://example.com/",
            "https://1.1.1.1/",
            "https://[2606:4700:4700::1111]/",
        ] {
            assert!(validate_url(&Url::parse(url).unwrap()).is_ok(), "{url}");
        }
    }

    #[tokio::test]
    async fn rejects_private_dns_results_in_the_http_connector() {
        assert!(
            PublicResolver
                .resolve("localhost".parse().unwrap())
                .await
                .is_err()
        );
    }
}
