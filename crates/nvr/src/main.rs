use cyberos_nvr::{
    runtime::{Config, State},
    server,
};
use std::{os::unix::fs::PermissionsExt, time::Duration};
#[tokio::main]
async fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    if let Err(error) = run().await {
        tracing::error!(reason=%error.message,"NVR stopped");
        std::process::exit(1);
    }
}
async fn run() -> cyberos_nvr::error::Result<()> {
    let config = Config::load()?;
    let state = loop {
        match State::new(config.clone()) {
            Ok(state) => break state,
            Err(error) => {
                tracing::warn!(reason=%error.message,"Waiting for initialized NVR database");
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
        }
    };
    if let Err(error) = cyberos_nvr::recording::recover(&state, None).await {
        tracing::warn!(reason=%error.message,"Some recordings await storage recovery");
    }
    if let Some(parent) = config.socket.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    if config.socket.exists() {
        if tokio::net::UnixStream::connect(&config.socket)
            .await
            .is_ok()
        {
            return Err(cyberos_nvr::error::Error::conflict(
                "NVR is already running",
            ));
        }
        tokio::fs::remove_file(&config.socket).await?;
    }
    let listener = tokio::net::UnixListener::bind(&config.socket)?;
    tokio::fs::set_permissions(&config.socket, std::fs::Permissions::from_mode(0o660)).await?;
    let (stop, rx) = tokio::sync::watch::channel(false);
    let (closing, mut closed) = tokio::sync::watch::channel(false);
    let supervisor = tokio::spawn(state.clone().supervise(rx));
    let shutdown = async move {
        #[cfg(unix)]
        {
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("signal handler");
            tokio::select! {_=tokio::signal::ctrl_c()=>{},_=term.recv()=>{}}
        }
        let _ = stop.send(true);
        let _ = closing.send(true);
    };
    let server = axum::serve(listener, server::router(state))
        .with_graceful_shutdown(shutdown)
        .into_future();
    tokio::pin!(server);
    tokio::select! {
        result = &mut server => { result?; },
        _ = closed.changed() => {
            // MJPEG responses may remain open indefinitely. Recording workers
            // shut down separately and finalize their current segments.
            let _ = tokio::time::timeout(Duration::from_secs(5), &mut server).await;
        }
    }
    let _ = tokio::time::timeout(Duration::from_secs(35), supervisor).await;
    let _ = tokio::fs::remove_file(&config.socket).await;
    Ok(())
}
