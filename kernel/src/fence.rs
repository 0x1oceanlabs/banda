//! Whether the fence around a Harness's programs holds where they run
//! (ADR 0083, decision 1), as the environment found it when the engine
//! started ([`Environment::fence`](crate::Environment::fence)). The engine
//! says it in its `welcome`, and its modules read it from their Project's
//! environment.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Whether the fence holds, with which layers, or why not. An engine that
/// says none has none.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "fence", rename_all = "snake_case")]
#[ts(export)]
pub enum Fence {
    /// It holds, with these layers: the namespaces always, and Landlock's
    /// scopes where the kernel has them; without them it holds partly.
    Holds {
        layers: Vec<FenceLayer>,
        /// This user is in the `docker` group, whose members run
        /// containers as root, and so reach past the fence.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        docker_group: bool,
        /// Links in what the fence keeps read-only, Banda's config and
        /// gh's, that lead through a link this user can move, or into a
        /// folder not there yet: the fence keeps what they lead to now
        /// read-only, and an Agent could lead them elsewhere, so it holds
        /// partly.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<String>>")]
        movable: Vec<String>,
    },
    /// It does not hold here: why, and in words.
    Missing { why: FenceWhy, words: String },
}

/// A layer of the fence.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum FenceLayer {
    /// The user, mount and PID namespaces, and the mounts in them.
    Namespaces,
    /// Landlock's scopes: no signal out, no abstract socket out.
    Landlock,
}

/// Why the fence does not hold.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum FenceWhy {
    /// An environment with no fence: a test's, the kernel's own, and an
    /// engine's from before the fence.
    NotBuilt,
    /// The system gives this user no namespaces of its own.
    NoUserNamespaces,
    /// Ubuntu's AppArmor keeps them from apps it has no profile for: a
    /// profile that allows them lets the fence hold.
    #[serde(rename = "apparmor")]
    AppArmor,
    /// The system refuses a step the fence takes.
    Refused,
    /// A step of its setup failed, as the words say.
    SetupFailed,
    /// Banda has no fence on this system.
    UnsupportedOs,
    /// Off until it is designed whole, unless `BANDA_FENCE=on` (ADR 0115).
    Off,
}

impl Fence {
    /// The fence of an environment that has none.
    pub fn not_built() -> Fence {
        Fence::missing(
            FenceWhy::NotBuilt,
            "This engine starts its programs with no fence.",
        )
    }

    pub fn missing(why: FenceWhy, words: impl Into<String>) -> Fence {
        Fence::Missing {
            why,
            words: words.into(),
        }
    }

    /// The fence of an environment whose probe found that it holds with
    /// `layers`, for a user in the `docker` group or not, and no link left
    /// that an Agent could lead elsewhere.
    pub fn holds(layers: Vec<FenceLayer>, docker_group: bool) -> Fence {
        Fence::Holds {
            layers,
            docker_group,
            movable: Vec::new(),
        }
    }

    /// This fence, with `links` it keeps read-only that an Agent could
    /// lead elsewhere ([`Fence::Holds`]'s `movable`); one that does not
    /// hold, as it is.
    pub fn with_movable(mut self, links: Vec<String>) -> Fence {
        if let Fence::Holds { movable, .. } = &mut self {
            *movable = links;
        }
        self
    }

    /// Whether it holds whole: with Landlock's scopes too, for a user
    /// outside the `docker` group, and with no link it keeps read-only
    /// that an Agent could lead elsewhere.
    pub fn holds_whole(&self) -> bool {
        matches!(
            self,
            Fence::Holds { layers, docker_group: false, movable }
                if layers.contains(&FenceLayer::Landlock) && movable.is_empty()
        )
    }
}
