use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What a caller is told when a call is not done: a stable code to act on
/// and plain words to show. Callers read `code`, never `message`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, thiserror::Error)]
#[error("{code}: {message}")]
#[ts(export)]
pub struct Refusal {
    pub code: String,
    pub message: String,
}

impl Refusal {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    /// The call is malformed: a missing field, a wrong type, an unknown method.
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("not_found", message)
    }

    /// The access decision said no.
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new("forbidden", message)
    }

    /// The state does not allow it now: try again after reading again.
    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new("conflict", message)
    }

    /// Something broke inside the engine. The details are in the engine's log.
    pub fn internal() -> Self {
        Self::new("internal", "Something went wrong inside the engine.")
    }
}

/// A failure inside the engine, as opposed to a refusal of the call. It is
/// logged in full and reaches a caller only as [`Refusal::internal`].
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("database: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("file: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("the Space's writer has stopped")]
    WriterGone,
    #[error(transparent)]
    Refused(#[from] Refusal),
}

impl From<Error> for Refusal {
    fn from(error: Error) -> Self {
        match error {
            Error::Refused(refusal) => refusal,
            other => {
                tracing::error!(error = %other, "engine failure");
                Refusal::internal()
            }
        }
    }
}
