//! The terminal a program runs on, as the environment port hands it back
//! (ADR 0090, decision 3): a module reads what the program prints on it,
//! types into it, resizes it and asks what runs in front, and holds no
//! system's own terminal. The `local` environment's is a PTY on Unix; on
//! Windows a ConPTY comes with ADR 0090's step 7.

use std::fmt;
use std::io;
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncWrite};

/// A terminal's size, in cells.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PtySize {
    pub rows: u16,
    pub cols: u16,
}

/// A program's terminal, in parts a module holds apart: one task reads
/// it, another types, and the terminal itself is shared.
pub struct Pty {
    /// What the program prints, which reads an end or an error once
    /// nothing holds the terminal open.
    pub output: Box<dyn AsyncRead + Send + Unpin>,
    /// What is typed to it.
    pub input: Box<dyn AsyncWrite + Send + Unpin>,
    /// The terminal itself.
    pub control: Arc<dyn PtyControl>,
}

impl fmt::Debug for Pty {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Pty").finish_non_exhaustive()
    }
}

/// A terminal itself: its size, and what runs in front on it.
pub trait PtyControl: Send + Sync {
    /// Gives it `size`, which what runs on it hears.
    fn resize(&self, size: PtySize) -> io::Result<()>;

    /// The process in front, which what is typed reaches: on Unix the
    /// leader of the terminal's foreground process group.
    fn front(&self) -> Option<u32>;
}
