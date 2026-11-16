pub use banda_base::{Code, Refusal};

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
