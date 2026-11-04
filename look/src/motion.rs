//! Motion, as niri says it (ADR 0007, decision 9): each event that moves
//! something is a spring or an easing, and `[motion]` can slow them all or
//! turn them off.
//!
//! `banda look` resolves it into numbers: `slowdown` and `off` are
//! already applied, curves are Bézier points. The window runs the springs
//! itself, so a move that is interrupted carries its speed on.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use toml::Spanned;
use ts_rs::TS;

/// `[motion]` in a `look.toml` or a theme's `banda.toml`.
#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct MotionSettings {
    /// Turns every event off, as the system's reduced motion does.
    pub off: Option<bool>,
    /// 2 is twice as slow; 0.5 twice as fast.
    pub slowdown: Option<f64>,
    /// Moving to another workspace.
    #[serde(default)]
    pub workspace: Event,
    /// Scrolling the Strip to a column.
    #[serde(default)]
    pub strip: Event,
    /// Columns going to their new places, when one opens, closes, moves or
    /// changes its width.
    #[serde(default, rename = "move")]
    pub moves: Event,
    /// A column changing its width.
    #[serde(default)]
    pub resize: Event,
    /// A tile coming in: it fades in, growing from half its size.
    #[serde(default)]
    pub open: Event,
    /// A tile going: it fades out, shrinking to four fifths, as the rest close in.
    #[serde(default)]
    pub close: Event,
    /// The workspaces zooming out into the overview, and back.
    #[serde(default)]
    pub overview: Event,
}

/// One event's table: `off`, and a `spring` or an `easing`.
#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Event {
    pub off: Option<bool>,
    #[schemars(with = "Option<SpringSettings>")]
    pub spring: Option<Spanned<SpringSettings>>,
    #[schemars(with = "Option<EasingSettings>")]
    pub easing: Option<Spanned<EasingSettings>>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct SpringSettings {
    /// 1 comes to rest without overshooting; less bounces.
    pub damping_ratio: Option<f64>,
    /// How hard it pulls: more is faster.
    pub stiffness: Option<f64>,
    /// How close, as a share of the way, counts as there.
    pub epsilon: Option<f64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct EasingSettings {
    pub duration_ms: Option<f64>,
    /// A named curve or `cubic-bezier(x1, y1, x2, y2)`.
    #[schemars(with = "Option<String>")]
    pub curve: Option<Spanned<String>>,
}

/// niri's springs for the window's moves.
const SPRING: Spring = Spring {
    damping_ratio: 1.0,
    stiffness: 800.0,
    epsilon: 0.0001,
};
const DURATION_MS: f64 = 250.0;
const CURVE: &str = "easeOutCubic";

/// The curves by name, as Hyprland and Omarchy write them.
pub const CURVES: [(&str, [f64; 4]); 7] = [
    ("linear", [0.0, 0.0, 1.0, 1.0]),
    ("easeOutQuad", [0.5, 1.0, 0.89, 1.0]),
    ("easeOutCubic", [0.33, 1.0, 0.68, 1.0]),
    ("easeOutQuint", [0.22, 1.0, 0.36, 1.0]),
    ("easeOutExpo", [0.16, 1.0, 0.3, 1.0]),
    ("easeInOutCubic", [0.65, 0.0, 0.35, 1.0]),
    ("easeInOutQuint", [0.83, 0.0, 0.17, 1.0]),
];

/// What the window runs for each event.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Motion {
    pub workspace: Move,
    pub strip: Move,
    #[serde(rename = "move")]
    pub moves: Move,
    pub resize: Move,
    pub open: Move,
    pub close: Move,
    pub overview: Move,
}

/// One event's move, resolved: no move, a spring or an easing.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[ts(export, export_to = "look/")]
pub enum Move {
    Off,
    Spring(Spring),
    Easing(Easing),
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "look/")]
pub struct Spring {
    pub damping_ratio: f64,
    pub stiffness: f64,
    pub epsilon: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "look/")]
pub struct Easing {
    pub duration_ms: f64,
    /// `cubic-bezier(x1, y1, x2, y2)`'s four numbers.
    pub bezier: [f64; 4],
}

impl MotionSettings {
    /// `self` laid over `under`, key by key.
    pub fn over(self, under: MotionSettings) -> MotionSettings {
        MotionSettings {
            off: self.off.or(under.off),
            slowdown: self.slowdown.or(under.slowdown),
            workspace: self.workspace.over(under.workspace),
            strip: self.strip.over(under.strip),
            moves: self.moves.over(under.moves),
            resize: self.resize.over(under.resize),
            open: self.open.over(under.open),
            close: self.close.over(under.close),
            overview: self.overview.over(under.overview),
        }
    }

    /// Banda's own: niri's springs, at its speed.
    pub fn defaults() -> MotionSettings {
        let spring = || Event {
            off: Some(false),
            spring: Some(Spanned::new(
                0..0,
                SpringSettings {
                    damping_ratio: Some(SPRING.damping_ratio),
                    stiffness: Some(SPRING.stiffness),
                    epsilon: Some(SPRING.epsilon),
                },
            )),
            easing: None,
        };
        let easing = |duration: f64, curve: &str| Event {
            off: Some(false),
            spring: None,
            easing: Some(Spanned::new(
                0..0,
                EasingSettings {
                    duration_ms: Some(duration),
                    curve: Some(Spanned::new(0..0, curve.to_owned())),
                },
            )),
        };
        MotionSettings {
            off: Some(false),
            slowdown: Some(1.0),
            workspace: spring(),
            strip: spring(),
            moves: spring(),
            resize: spring(),
            // niri's window-open and window-close.
            open: easing(150.0, "easeOutExpo"),
            close: easing(150.0, "easeOutQuad"),
            overview: spring(),
        }
    }

    /// The events by their keys, for checks.
    fn events(&self) -> [(&'static str, &Event); 7] {
        [
            ("workspace", &self.workspace),
            ("strip", &self.strip),
            ("move", &self.moves),
            ("resize", &self.resize),
            ("open", &self.open),
            ("close", &self.close),
            ("overview", &self.overview),
        ]
    }

    /// What TOML alone does not refuse, with where it is when known.
    pub fn problems(&self) -> Vec<(Option<std::ops::Range<usize>>, String)> {
        let mut problems = Vec::new();
        if let Some(slowdown) = self.slowdown
            && !(slowdown.is_finite() && slowdown > 0.0)
        {
            problems.push((None, "motion.slowdown is more than 0".to_owned()));
        }
        for (key, event) in self.events() {
            if let (Some(_), Some(easing)) = (&event.spring, &event.easing) {
                problems.push((
                    Some(easing.span()),
                    format!("motion.{key} is a spring or an easing, not both"),
                ));
            }
            if let Some(spring) = &event.spring {
                let s = spring.get_ref();
                let wrong = [
                    ("damping-ratio", s.damping_ratio, "more than 0"),
                    ("stiffness", s.stiffness, "more than 0"),
                    ("epsilon", s.epsilon, "between 0 and 1"),
                ]
                .into_iter()
                .filter(|(name, value, _)| {
                    value.is_some_and(|v| {
                        !v.is_finite() || v <= 0.0 || (*name == "epsilon" && v >= 1.0)
                    })
                });
                for (name, _, words) in wrong {
                    problems.push((
                        Some(spring.span()),
                        format!("motion.{key}.spring's {name} is {words}"),
                    ));
                }
            }
            if let Some(easing) = &event.easing {
                let e = easing.get_ref();
                if e.duration_ms.is_some_and(|d| !(d.is_finite() && d >= 0.0)) {
                    problems.push((
                        Some(easing.span()),
                        format!("motion.{key}.easing's duration-ms cannot be negative"),
                    ));
                }
                if let Some(curve) = &e.curve
                    && bezier(curve.get_ref()).is_none()
                {
                    let names = CURVES
                        .iter()
                        .map(|(name, _)| format!("\"{name}\""))
                        .collect::<Vec<_>>()
                        .join(", ");
                    problems.push((
                        Some(curve.span()),
                        format!(
                            "motion.{key}.easing's curve is one of {names} or \"cubic-bezier(x1, y1, x2, y2)\" with x from 0 to 1"
                        ),
                    ));
                }
            }
        }
        problems
    }

    /// The moves the window runs: `off` and `slowdown` applied.
    pub fn resolve(&self) -> Motion {
        let off = self.off.unwrap_or(false);
        let slowdown = self
            .slowdown
            .filter(|s| s.is_finite() && *s > 0.0)
            .unwrap_or(1.0);
        let event = |event: &Event| {
            if off || event.off.unwrap_or(false) {
                return Move::Off;
            }
            match (&event.spring, &event.easing) {
                (_, Some(easing)) if event.spring.is_none() => {
                    let e = easing.get_ref();
                    Move::Easing(Easing {
                        duration_ms: e
                            .duration_ms
                            .filter(|d| d.is_finite() && *d >= 0.0)
                            .unwrap_or(DURATION_MS)
                            * slowdown,
                        bezier: e
                            .curve
                            .as_ref()
                            .and_then(|c| bezier(c.get_ref()))
                            .or_else(|| bezier(CURVE))
                            .unwrap_or([0.0, 0.0, 1.0, 1.0]),
                    })
                }
                (Some(spring), _) => {
                    let s = spring.get_ref();
                    let positive = |v: Option<f64>, or: f64| {
                        v.filter(|v| v.is_finite() && *v > 0.0).unwrap_or(or)
                    };
                    // A spring slowed down by s is the same spring with
                    // time stretched: its stiffness over s².
                    Move::Spring(Spring {
                        damping_ratio: positive(s.damping_ratio, SPRING.damping_ratio),
                        stiffness: positive(s.stiffness, SPRING.stiffness) / (slowdown * slowdown),
                        epsilon: s
                            .epsilon
                            .filter(|e| e.is_finite() && *e > 0.0 && *e < 1.0)
                            .unwrap_or(SPRING.epsilon),
                    })
                }
                _ => Move::Spring(SPRING),
            }
        };
        Motion {
            workspace: event(&self.workspace),
            strip: event(&self.strip),
            moves: event(&self.moves),
            resize: event(&self.resize),
            open: event(&self.open),
            close: event(&self.close),
            overview: event(&self.overview),
        }
    }
}

impl Event {
    /// A layer that names a spring or an easing replaces the one under
    /// it; one of the same kind fills in what it leaves out from it.
    fn over(self, under: Event) -> Event {
        let off = self.off.or(under.off);
        match (self.spring, self.easing) {
            (None, None) => Event {
                off,
                spring: under.spring,
                easing: under.easing,
            },
            (Some(mine), None) => Event {
                off,
                spring: Some(match under.spring {
                    Some(theirs) => {
                        let span = mine.span();
                        let (mine, theirs) = (mine.into_inner(), theirs.into_inner());
                        Spanned::new(
                            span,
                            SpringSettings {
                                damping_ratio: mine.damping_ratio.or(theirs.damping_ratio),
                                stiffness: mine.stiffness.or(theirs.stiffness),
                                epsilon: mine.epsilon.or(theirs.epsilon),
                            },
                        )
                    }
                    None => mine,
                }),
                easing: None,
            },
            (None, Some(mine)) => Event {
                off,
                spring: None,
                easing: Some(match under.easing {
                    Some(theirs) => {
                        let span = mine.span();
                        let (mine, theirs) = (mine.into_inner(), theirs.into_inner());
                        Spanned::new(
                            span,
                            EasingSettings {
                                duration_ms: mine.duration_ms.or(theirs.duration_ms),
                                curve: mine.curve.or(theirs.curve),
                            },
                        )
                    }
                    None => mine,
                }),
            },
            // Both is a problem the check names; the easing is left out.
            (Some(mine), Some(_)) => Event {
                off,
                spring: Some(mine),
                easing: None,
            },
        }
    }
}

/// A curve's Bézier points: a name, or `cubic-bezier(x1, y1, x2, y2)`
/// with both x from 0 to 1, as CSS takes it.
pub fn bezier(curve: &str) -> Option<[f64; 4]> {
    let curve = curve.trim();
    if let Some((_, points)) = CURVES.iter().find(|(name, _)| *name == curve) {
        return Some(*points);
    }
    let inner = curve.strip_prefix("cubic-bezier(")?.strip_suffix(')')?;
    let numbers: Vec<f64> = inner
        .split(',')
        .map(|n| n.trim().parse::<f64>())
        .collect::<Result<_, _>>()
        .ok()?;
    let [x1, y1, x2, y2] = numbers[..] else {
        return None;
    };
    let fine = [x1, y1, x2, y2].iter().all(|n| n.is_finite())
        && (0.0..=1.0).contains(&x1)
        && (0.0..=1.0).contains(&x2);
    fine.then_some([x1, y1, x2, y2])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(text: &str) -> MotionSettings {
        #[derive(Deserialize)]
        struct File {
            motion: MotionSettings,
        }
        toml::from_str::<File>(text).unwrap().motion
    }

    #[test]
    fn banda_moves_on_niris_springs() {
        let motion = MotionSettings::defaults().resolve();
        assert_eq!(motion.workspace, Move::Spring(SPRING));
        assert_eq!(motion.strip, Move::Spring(SPRING));
        assert_eq!(motion.overview, Move::Spring(SPRING));
        assert_eq!(
            motion.open,
            Move::Easing(Easing {
                duration_ms: 150.0,
                bezier: [0.16, 1.0, 0.3, 1.0]
            })
        );
    }

    #[test]
    fn slowdown_stretches_time() {
        let motion = read(
            "[motion]\nslowdown = 2\n[motion.strip]\neasing = { duration-ms = 200, curve = \"linear\" }\n",
        )
        .over(MotionSettings::defaults())
        .resolve();
        let Move::Spring(spring) = motion.workspace else {
            panic!("{:?}", motion.workspace)
        };
        assert_eq!(spring.stiffness, 200.0);
        assert_eq!(spring.damping_ratio, 1.0);
        assert_eq!(
            motion.strip,
            Move::Easing(Easing {
                duration_ms: 400.0,
                bezier: [0.0, 0.0, 1.0, 1.0]
            })
        );
    }

    #[test]
    fn off_is_off_for_one_or_all() {
        let one = read("[motion.workspace]\noff = true\n")
            .over(MotionSettings::defaults())
            .resolve();
        assert_eq!(one.workspace, Move::Off);
        assert_eq!(one.strip, Move::Spring(SPRING));
        let overview = read("[motion.overview]\noff = true\n")
            .over(MotionSettings::defaults())
            .resolve();
        assert_eq!(overview.overview, Move::Off);
        let all = read("[motion]\noff = true\n")
            .over(MotionSettings::defaults())
            .resolve();
        assert_eq!((all.workspace, all.strip), (Move::Off, Move::Off));
        assert_eq!(all.overview, Move::Off);
    }

    #[test]
    fn a_spring_says_only_what_it_changes() {
        let motion = read("[motion.strip]\nspring = { damping-ratio = 0.6 }\n")
            .over(MotionSettings::defaults())
            .resolve();
        assert_eq!(
            motion.strip,
            Move::Spring(Spring {
                damping_ratio: 0.6,
                ..SPRING
            })
        );
    }

    #[test]
    fn curves_are_named_or_points() {
        assert_eq!(bezier("easeOutQuint"), Some([0.22, 1.0, 0.36, 1.0]));
        assert_eq!(
            bezier("cubic-bezier(0.05, 0.9, 0.1, 1.05)"),
            Some([0.05, 0.9, 0.1, 1.05])
        );
        assert_eq!(bezier("cubic-bezier(1.5, 0, 0, 1)"), None);
        assert_eq!(bezier("bouncy"), None);
        let wrong = read("[motion.strip]\neasing = { curve = \"bouncy\" }\n").problems();
        assert!(wrong[0].1.contains("\"easeOutQuint\""), "{wrong:?}");
        let both =
            read("[motion.strip]\nspring = { stiffness = 1 }\neasing = { duration-ms = 1 }\n")
                .problems();
        assert!(both[0].1.contains("not both"), "{both:?}");
    }
}
