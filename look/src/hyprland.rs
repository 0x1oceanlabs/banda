//! Hyprland's own window settings, when Banda runs under it (ADR 0007,
//! decision 8): its rounding, border, gaps and dimming become a layer of
//! the look, so the tiles inside Banda look like the windows around it.
//!
//! Banda asks Hyprland over its socket, as `hyprctl getoption` does, so any
//! Hyprland config works, Lua or not, and listens on its event socket for
//! `configreloaded`.

use crate::motion::MotionSettings;
use crate::settings::{Corner, Gaps, Settings, Step, Tile};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::Duration;

/// The settings Banda takes: sizes in pixels, and how much windows
/// without the focus darken when Hyprland dims them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Windows {
    pub rounding: f64,
    pub border: f64,
    pub gaps: f64,
    /// `dim_strength`, when `dim_inactive` is on.
    pub dim: Option<f64>,
    /// `animations:enabled`: off, Banda's tiles hold still too.
    pub animations: bool,
}

impl Windows {
    /// The layer they make. The tile is the `xl` step, so the radius is
    /// the rounding divided by its factor, and every control keeps its
    /// place on the ladder.
    pub fn layer(self) -> Settings {
        Settings {
            radius: Some(self.rounding / Step::Xl.factor()),
            gaps: Gaps {
                inner: Some(self.gaps),
                outer: Some(self.gaps),
            },
            tile: Tile {
                radius: Some(Corner::Step(Step::Xl)),
                border: Some(self.border),
                dim_inactive: self.dim,
            },
            motion: MotionSettings {
                off: (!self.animations).then_some(true),
                ..MotionSettings::default()
            },
            ..Settings::default()
        }
    }
}

/// The Hyprland instance this program runs under.
#[derive(Clone, Debug)]
pub struct Hyprland {
    folder: PathBuf,
}

impl Hyprland {
    /// From `HYPRLAND_INSTANCE_SIGNATURE` and `XDG_RUNTIME_DIR`, as
    /// `hyprctl` finds it; `None` outside Hyprland.
    pub fn from_env() -> Option<Hyprland> {
        let signature = std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE")?;
        let runtime = std::env::var_os("XDG_RUNTIME_DIR")?;
        let folder = PathBuf::from(runtime).join("hypr").join(signature);
        folder
            .join(".socket.sock")
            .exists()
            .then_some(Hyprland { folder })
    }

    pub fn windows(&self) -> std::io::Result<Windows> {
        let number = |option: &str| -> std::io::Result<f64> {
            let answer = self.ask(&format!("j/getoption {option}"))?;
            let value: serde_json::Value = serde_json::from_str(&answer).map_err(|e| {
                std::io::Error::other(format!("Hyprland's answer for {option} is not JSON: {e}"))
            })?;
            let first = |text: &str| text.split_whitespace().next()?.parse::<f64>().ok();
            value["int"]
                .as_f64()
                .or_else(|| value["float"].as_f64())
                .or_else(|| value["css"].as_str().and_then(first))
                .or_else(|| value["custom"].as_str().and_then(first))
                .ok_or_else(|| {
                    std::io::Error::other(format!("Hyprland has no number for {option}"))
                })
        };
        let on = |option: &str| -> std::io::Result<bool> {
            let answer = self.ask(&format!("j/getoption {option}"))?;
            let value: serde_json::Value =
                serde_json::from_str(&answer).unwrap_or(serde_json::Value::Null);
            Ok(value["bool"]
                .as_bool()
                .or_else(|| value["int"].as_i64().map(|n| n != 0))
                .unwrap_or(false))
        };
        Ok(Windows {
            rounding: number("decoration:rounding")?,
            border: number("general:border_size")?,
            gaps: number("general:gaps_in")?,
            dim: if on("decoration:dim_inactive")? {
                Some(number("decoration:dim_strength")?)
            } else {
                None
            },
            animations: on("animations:enabled")?,
        })
    }

    fn ask(&self, request: &str) -> std::io::Result<String> {
        let mut socket = UnixStream::connect(self.folder.join(".socket.sock"))?;
        socket.set_read_timeout(Some(Duration::from_secs(2)))?;
        socket.write_all(request.as_bytes())?;
        let mut answer = String::new();
        socket.read_to_string(&mut answer)?;
        Ok(answer)
    }

    /// Calls `reloaded` each time Hyprland reloads its config, from a
    /// thread of its own, until the event socket closes.
    pub fn on_reload(&self, reloaded: impl Fn() + Send + 'static) {
        let events = self.folder.join(".socket2.sock");
        std::thread::spawn(move || {
            let Ok(socket) = UnixStream::connect(events) else {
                return;
            };
            for line in BufReader::new(socket).lines() {
                let Ok(line) = line else { return };
                if line.starts_with("configreloaded>>") {
                    reloaded();
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounding_twelve_makes_tiles_of_twelve() {
        let layer = Windows {
            rounding: 12.0,
            border: 2.0,
            gaps: 5.0,
            dim: Some(0.3),
            animations: false,
        }
        .layer();
        let radius = layer.radius.unwrap();
        assert!((radius * Step::Xl.factor() - 12.0).abs() < 1e-9);
        assert_eq!(layer.gaps.inner, Some(5.0));
        assert_eq!(layer.tile.border, Some(2.0));
        assert_eq!(layer.tile.dim_inactive, Some(0.3));
        assert_eq!(layer.motion.off, Some(true));
    }
}
