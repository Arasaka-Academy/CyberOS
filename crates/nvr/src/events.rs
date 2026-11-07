use crate::{
    error::{Error, Result},
    onvif::{EVENTS, NOTIFICATION, Node},
    protocol::*,
    runtime::State,
};
use sha1::{Digest, Sha1};
use std::{sync::Arc, time::Duration};
use tokio::sync::watch;
use uuid::Uuid;

pub fn notification(device: &str, node: &Node) -> Result<Option<NvrEvent>> {
    let message = node
        .all("Message")
        .into_iter()
        .find(|n| n.attr("UtcTime").is_some())
        .ok_or_else(|| Error::unavailable("Camera event has no timestamp"))?;
    if message.attr("PropertyOperation") == Some("Initialized") {
        return Ok(None);
    }
    let occurred_at = message
        .attr("UtcTime")
        .ok_or_else(|| Error::unavailable("Camera event timestamp missing"))?;
    let precise_time = canonical_time(occurred_at)?;
    let data = message
        .find("Data")
        .ok_or_else(|| Error::unavailable("Camera event data missing"))?;
    let items = data.all("SimpleItem");
    let category = items
        .iter()
        .find(|n| n.attr("Name") == Some("Category"))
        .and_then(|n| n.attr("Value"))
        .unwrap_or("unknown");
    validate_text(category, 64)?;
    let state = items
        .iter()
        .find(|n| n.attr("Name") == Some("State"))
        .and_then(|n| n.attr("Value"));
    let source_id = items
        .iter()
        .find(|n| n.attr("Name") == Some("EventId"))
        .and_then(|n| n.attr("Value"));
    let gap = items
        .iter()
        .any(|n| n.attr("Name") == Some("Gap") && n.attr("Value") == Some("true"));
    let identity = format!(
        "{device}|{}|{}|{category}|{state:?}|{}",
        source_id.unwrap_or(&precise_time),
        node.text_of("Topic").unwrap_or(""),
        node.text_of("Source").unwrap_or("")
    );
    Ok(Some(NvrEvent {
        id: format!("{:x}", Sha1::digest(identity.as_bytes())),
        device_id: device.into(),
        category: category.into(),
        state: state.map(|s| matches!(s, "true" | "1")),
        occurred_at: precise_time,
        received_at: now(),
        gap,
    }))
}
pub fn event_key(event: &NvrEvent) -> String {
    format!("{}:{}", event.device_id, event.id)
}
pub async fn event_loop(state: Arc<State>, id: String, mut stop: watch::Receiver<bool>) {
    let mut subscription: Option<String> = None;
    let mut renewed = tokio::time::Instant::now();
    // A new process/subscription cannot account for the interval before it
    // started, even when its first subscription request succeeds.
    let mut gap_open = true;
    let gap = NvrEvent {
        id: Uuid::new_v4().to_string(),
        device_id: id.clone(),
        category: "subscription_gap".into(),
        state: None,
        occurred_at: now(),
        received_at: now(),
        gap: true,
    };
    let _ = state.db.event(&gap, &gap.id);
    while !*stop.borrow() {
        let result = async {
            let camera = state.camera(&id).await?;
            if camera.events.is_empty() {
                return Err(Error::unavailable("Camera event service unavailable"));
            }
            if subscription.is_none() {
                let document = camera
                    .soap(
                        &camera.events,
                        EVENTS,
                        "CreatePullPointSubscription",
                        "<x:InitialTerminationTime>PT60S</x:InitialTerminationTime>",
                        true,
                    )
                    .await?;
                let address = document
                    .text_of("Address")
                    .ok_or_else(|| Error::unavailable("Camera subscription address missing"))?;
                camera.check_url(address, false)?;
                subscription = Some(address.into());
                renewed = tokio::time::Instant::now();
            }
            let address = subscription.as_deref().ok_or_else(Error::not_found)?;
            if renewed.elapsed() > Duration::from_secs(30) {
                camera
                    .soap(
                        address,
                        NOTIFICATION,
                        "Renew",
                        "<x:TerminationTime>PT60S</x:TerminationTime>",
                        true,
                    )
                    .await?;
                renewed = tokio::time::Instant::now();
            }
            let document = camera
                .soap(
                    address,
                    EVENTS,
                    "PullMessages",
                    "<x:Timeout>PT5S</x:Timeout><x:MessageLimit>64</x:MessageLimit>",
                    true,
                )
                .await?;
            for node in document.all("NotificationMessage") {
                // Property initialization updates the current indicators, but never
                // inserts an AI alert after a reconnect or resubscription.
                let data = node.find("Data");
                if let Some(data) = data {
                    let items = data.all("SimpleItem");
                    let category = items
                        .iter()
                        .find(|n| n.attr("Name") == Some("Category"))
                        .and_then(|n| n.attr("Value"));
                    let value = items
                        .iter()
                        .find(|n| n.attr("Name") == Some("State"))
                        .and_then(|n| n.attr("Value"))
                        .map(|v| matches!(v, "true" | "1"));
                    state.db.update(&id, |d| match category {
                        Some("analytics") | Some("analytics_available") => d.analytics = value,
                        Some("person") => d.person = value,
                        Some("vehicle") => d.vehicle = value,
                        _ => {}
                    })?;
                }
                if let Some(event) = notification(&id, node)? {
                    state.db.event(&event, &event_key(&event))?;
                }
            }
            if gap_open {
                let event = NvrEvent {
                    id: Uuid::new_v4().to_string(),
                    device_id: id.clone(),
                    category: "subscription_resumed".into(),
                    state: None,
                    occurred_at: now(),
                    received_at: now(),
                    gap: true,
                };
                state.db.event(&event, &event.id)?;
                gap_open = false;
            }
            Ok::<_, Error>(())
        }
        .await;
        if result.is_err() {
            subscription = None;
            let _ = state.db.update(&id, |d| {
                d.analytics = None;
                d.person = None;
                d.vehicle = None;
            });
            if !gap_open {
                let event = NvrEvent {
                    id: Uuid::new_v4().to_string(),
                    device_id: id.clone(),
                    category: "subscription_gap".into(),
                    state: None,
                    occurred_at: now(),
                    received_at: now(),
                    gap: true,
                };
                let _ = state.db.event(&event, &event.id);
                gap_open = true;
            }
            tokio::select! {_=tokio::time::sleep(Duration::from_secs(3))=>{}, _=stop.changed()=>{}}
        }
    }
    if let (Some(address), Ok(camera)) = (subscription, state.camera(&id).await) {
        let _ = camera
            .soap(&address, NOTIFICATION, "Unsubscribe", "", true)
            .await;
    }
}
