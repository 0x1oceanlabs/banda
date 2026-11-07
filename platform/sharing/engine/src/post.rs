//! The one place Banda's events leave the computer (ADR 0039, decisions 4
//! and 8). The courier keeps each event first and decides what goes; this
//! posts one, exactly as kept, to PostHog's US capture and nowhere else.
//! It goes from the host, as no client does the host's work (ADR 0062,
//! decision 3): through the system's proxy, with the system's
//! certificates, following no redirect and keeping no cookie.

use std::sync::OnceLock;
use std::time::Duration;

/// Where an event goes: PostHog's capture, in the US.
pub const CAPTURE: &str = "https://us.i.posthog.com/i/v0/e/";

/// How long PostHog may take to take one event.
const POSTING: Duration = Duration::from_secs(30);

/// What posts one event. A test gives its own.
#[async_trait::async_trait]
pub trait Post: Send + Sync {
    /// Posts `event`, JSON, as it is. Why it did not go, when it did not,
    /// so it waits: it may have gone all the same, and goes again.
    async fn post(&self, event: &str) -> Result<(), String>;
}

/// PostHog's capture, over HTTPS, with one client made at the first post.
pub struct Capture {
    url: String,
    client: OnceLock<reqwest::Client>,
}

impl Capture {
    /// Posts to `url`: [`CAPTURE`], or a test's stand-in.
    pub fn at(url: &str) -> Self {
        Self {
            url: url.to_owned(),
            client: OnceLock::new(),
        }
    }

    fn client(&self) -> Result<reqwest::Client, String> {
        if let Some(client) = self.client.get() {
            return Ok(client.clone());
        }
        let made = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(format!("banda/{}", banda_kernel::version()))
            .build()
            .map_err(|e| format!("Banda's HTTPS did not start: {}", cause(&e)))?;
        Ok(self.client.get_or_init(|| made).clone())
    }
}

#[async_trait::async_trait]
impl Post for Capture {
    async fn post(&self, event: &str) -> Result<(), String> {
        let response = (self.client()?.post(&self.url))
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(event.to_owned())
            .timeout(POSTING)
            .send()
            .await
            .map_err(|e| format!("PostHog was not reached: {}", cause(&e)))?;
        let status = response.status();
        match status.is_success() {
            true => Ok(()),
            false => Err(format!("PostHog answered {}", status.as_u16())),
        }
    }
}

/// What went wrong at the bottom of `error`: "connection refused", not
/// only "error sending request".
fn cause(error: &(dyn std::error::Error + 'static)) -> String {
    let mut at = error;
    while let Some(under) = at.source() {
        at = under;
    }
    at.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// A stand-in for PostHog that answers each post with `status` and
    /// `extra` headers, and hands back what each post said, its head in
    /// lower case and its body as sent.
    async fn stand_in(
        status: u16,
        extra: &'static str,
    ) -> (
        Capture,
        tokio::sync::mpsc::UnboundedReceiver<(String, String)>,
    ) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/i/v0/e/", listener.local_addr().unwrap());
        let (heard, posts) = tokio::sync::mpsc::unbounded_channel();
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let mut head = Vec::new();
                let mut byte = [0; 1];
                while !head.ends_with(b"\r\n\r\n") && socket.read(&mut byte).await.unwrap() == 1 {
                    head.push(byte[0]);
                }
                let head = String::from_utf8_lossy(&head).to_lowercase();
                let length = (head.lines())
                    .find_map(|line| line.strip_prefix("content-length: "))
                    .map_or(0, |n| n.trim().parse().unwrap());
                let mut body = vec![0; length];
                socket.read_exact(&mut body).await.unwrap();
                let _ = heard.send((head, String::from_utf8(body).unwrap()));
                let answer = format!(
                    "HTTP/1.1 {status} Said\r\n{extra}content-length: 0\r\nconnection: close\r\n\r\n"
                );
                socket.write_all(answer.as_bytes()).await.unwrap();
            }
        });
        (Capture::at(&url), posts)
    }

    #[tokio::test]
    async fn an_event_goes_as_it_was_kept_and_counts_as_gone_once_posthog_took_it() {
        let event = r#"{"event":"day","distinct_id":"d","properties":{"turns": 1}}"#;
        let (capture, mut posts) = stand_in(200, "").await;
        capture.post(event).await.unwrap();
        let (head, body) = posts.recv().await.unwrap();
        assert!(head.starts_with("post /i/v0/e/ http/1.1\r\n"), "{head}");
        assert!(
            head.contains("content-type: application/json\r\n"),
            "{head}"
        );
        assert!(!head.contains("cookie"), "{head}");
        assert_eq!(body, event, "byte for byte");

        let (refused, _posts) = stand_in(503, "").await;
        assert_eq!(
            refused.post(event).await,
            Err("PostHog answered 503".into())
        );
    }

    #[tokio::test]
    async fn an_event_goes_nowhere_posthog_redirects_it() {
        let elsewhere = "location: http://127.0.0.1:9/elsewhere\r\n";
        let (capture, mut posts) = stand_in(307, elsewhere).await;
        let said = capture.post("{}").await;
        assert_eq!(said, Err("PostHog answered 307".into()));
        posts.recv().await.unwrap();
        assert!(posts.try_recv().is_err(), "followed nowhere");
    }

    #[tokio::test]
    async fn no_network_says_why_and_the_event_waits() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let gone = format!("http://{}/i/v0/e/", listener.local_addr().unwrap());
        drop(listener);
        let said = Capture::at(&gone).post("{}").await.unwrap_err();
        assert!(said.starts_with("PostHog was not reached: "), "{said}");
    }
}
