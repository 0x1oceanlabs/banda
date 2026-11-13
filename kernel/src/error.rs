use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What a caller is told when a call is not done: a stable code to act on
/// and plain words to show. Callers read `code`, never `message`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, thiserror::Error)]
#[error("{code}: {message}")]
#[ts(export)]
pub struct Refusal {
    pub code: Code,
    pub message: String,
}

/// Why a call was not done. A caller decides what to do by this alone.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Code {
    /// The call is malformed: a missing field, a wrong type, an unknown
    /// method. Sending it again changes nothing.
    Invalid,
    NotFound,
    /// The access decision said no.
    Forbidden,
    /// The state does not allow it now: read again, then decide.
    Conflict,
    /// No answer came in time, and what was asked may have been done:
    /// look before asking again, as a second click may click twice.
    MayHaveRun,
    /// A command came past its `not_after`, by this machine's clock, and
    /// did not run (ADR 0105): what waited for this machine was kept too
    /// long. Sending it again changes nothing.
    Expired,
    /// The method's App does not run where it was called, and the message
    /// says why: it is turned off in that Project, its tables there not
    /// having come up to date, or the program that runs its code did not
    /// start. Nothing of the call ran. The other Apps go on (the
    /// architecture vision, D4; ADR 0126, decision 7).
    AppUnavailable,
    /// The window and the engine speak different protocol versions.
    Protocol,
    /// The device was removed from this machine: its sessions end, and it
    /// opens none until it is paired again (ADR 0124, decision 6).
    Revoked,
    /// Something broke inside the engine, and the details are in its log;
    /// or in the code of an App from a folder, and the message says what.
    Internal,
}

impl Code {
    /// Whether a command's receipt keeps a refusal with this code as its
    /// answer, as long as it would keep a value (ADR 0082, decision 4). A
    /// passing one is not kept, so a resend may go through. `may_have_run`
    /// is kept: a resend must not run again what may have run; so is
    /// `expired`, so a resend past its time gets it too. A new code decides
    /// here.
    pub fn is_final(self) -> bool {
        match self {
            Code::Invalid | Code::NotFound | Code::Forbidden | Code::Conflict => true,
            Code::MayHaveRun | Code::Expired => true,
            // The call ran nothing, and an App put right answers the resend.
            Code::AppUnavailable | Code::Protocol | Code::Internal => false,
            // It ends a session, and answers no command.
            Code::Revoked => false,
        }
    }
}

impl std::fmt::Display for Code {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Code::Invalid => "invalid",
            Code::NotFound => "not_found",
            Code::Forbidden => "forbidden",
            Code::Conflict => "conflict",
            Code::MayHaveRun => "may_have_run",
            Code::Expired => "expired",
            Code::AppUnavailable => "app_unavailable",
            Code::Protocol => "protocol",
            Code::Revoked => "revoked",
            Code::Internal => "internal",
        })
    }
}

impl Refusal {
    pub fn new(code: Code, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(Code::Invalid, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(Code::NotFound, message)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(Code::Forbidden, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(Code::Conflict, message)
    }

    pub fn may_have_run(message: impl Into<String>) -> Self {
        Self::new(Code::MayHaveRun, message)
    }

    pub fn expired(message: impl Into<String>) -> Self {
        Self::new(Code::Expired, message)
    }

    pub fn app_unavailable(message: impl Into<String>) -> Self {
        Self::new(Code::AppUnavailable, message)
    }

    pub fn internal() -> Self {
        Self::new(Code::Internal, "Something went wrong inside the engine.")
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
    /// The Project's database closed while a change or a read waited for it.
    #[error("the Project's database has closed")]
    Closed,
    /// The change panicked, and nothing of it was kept: its transaction
    /// rolled back, and the writer went on to the next.
    #[error("the change panicked and was rolled back")]
    Panicked,
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
