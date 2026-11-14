//! Where this machine's door is served beyond loopback (ADR 0124,
//! decision 4): on the tailnet, where `tailscale serve` hands a name of
//! the machine's to the door's port, with TLS ending in `tailscaled` on
//! the same machine. A browser or a phone reaches the door there, so a
//! window that lets one in on every machine reads each machine's address
//! here to hand it on. The machine itself asks Tailscale: no other machine
//! says where this one is.

use serde::Deserialize;
use std::collections::BTreeMap;
use std::time::Duration;

/// How long Tailscale has to answer.
const WAIT: Duration = Duration::from_secs(3);

/// Where the `tailscale` program may be: on the host's `PATH`, and in
/// its app on a Mac, which puts none there by itself.
const PROGRAMS: [&str; 2] = [
    "tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
];

/// What `tailscale serve status --json` says, of which only the web
/// handlers count.
#[derive(Deserialize)]
struct Serving {
    #[serde(rename = "Web", default)]
    web: BTreeMap<String, Site>,
}

#[derive(Deserialize)]
struct Site {
    #[serde(rename = "Handlers", default)]
    handlers: BTreeMap<String, Handler>,
}

#[derive(Deserialize)]
struct Handler {
    #[serde(rename = "Proxy", default)]
    proxy: Option<String>,
}

/// The addresses `said`, the answer of `tailscale serve status --json`,
/// hands to the door on loopback `port`: each site whose root goes there,
/// as `https://name`, with its port where it is not 443.
pub fn doors_in(said: &str, port: u16) -> Vec<String> {
    let Ok(serving) = serde_json::from_str::<Serving>(said) else {
        return Vec::new();
    };
    let to_door = |proxy: &str| {
        let at = proxy.strip_prefix("http://").unwrap_or(proxy);
        let at = at.strip_suffix('/').unwrap_or(at);
        [format!("127.0.0.1:{port}"), format!("localhost:{port}")].contains(&at.to_owned())
    };
    (serving.web.iter())
        .filter(|(_, site)| {
            (site.handlers.get("/")).is_some_and(|root| root.proxy.as_deref().is_some_and(to_door))
        })
        .map(|(site, _)| match site.strip_suffix(":443") {
            Some(name) => format!("https://{name}"),
            None => format!("https://{site}"),
        })
        .collect()
}

/// Where the door on loopback `port` is served now; none where Tailscale
/// is not installed, does not answer in time, or serves no door.
pub async fn doors(port: u16) -> Vec<String> {
    for program in PROGRAMS {
        // Not on this host: the next place it may be.
        let Ok(mut command) = banda_kernel::host::command(program) else {
            continue;
        };
        let asked = command
            .args(["serve", "status", "--json"])
            .stdin(std::process::Stdio::null())
            .output();
        return match tokio::time::timeout(WAIT, asked).await {
            Ok(Ok(said)) if said.status.success() => {
                doors_in(&String::from_utf8_lossy(&said.stdout), port)
            }
            _ => Vec::new(),
        };
    }
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SERVING: &str = r#"{
      "TCP": { "443": { "HTTPS": true }, "8443": { "HTTPS": true } },
      "Web": {
        "arc.example.ts.net:443": {
          "Handlers": { "/": { "Proxy": "http://127.0.0.1:22633" } }
        },
        "arc.example.ts.net:8443": {
          "Handlers": { "/": { "Proxy": "http://localhost:22633/" } }
        },
        "arc.example.ts.net:10000": {
          "Handlers": { "/": { "Proxy": "http://127.0.0.1:3000" } }
        },
        "arc.example.ts.net:10001": {
          "Handlers": { "/docs": { "Proxy": "http://127.0.0.1:22633" } }
        }
      }
    }"#;

    #[test]
    fn a_door_is_served_where_a_sites_root_goes_to_its_port() {
        assert_eq!(
            doors_in(SERVING, 22633),
            [
                "https://arc.example.ts.net",
                "https://arc.example.ts.net:8443"
            ]
        );
        // Another port's door is not this one's.
        assert_eq!(doors_in(SERVING, 22632), Vec::<String>::new());
    }

    #[test]
    fn nothing_served_and_words_that_do_not_read_are_no_door() {
        assert_eq!(doors_in("{}", 22633), Vec::<String>::new());
        assert_eq!(doors_in("", 22633), Vec::<String>::new());
        assert_eq!(
            doors_in("Tailscale is stopped.", 22633),
            Vec::<String>::new()
        );
    }
}
