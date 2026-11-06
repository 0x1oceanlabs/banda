//! What the window starts as its child watches it through stdin:
//! `banda serve --with-parent` and `banda look --follow --with-parent`
//! (ADR 0086, decision 2). The window holds the pipe's other end, so it
//! closes when the window goes, however it goes, and the child goes with
//! it instead of living on from a place that may be gone.

use std::io::Read;

/// Calls `gone` once stdin closes. A plain thread reads it: a blocking
/// read cannot be cancelled, and an async runtime would wait for it on the
/// way out.
pub fn on_gone(gone: impl FnOnce() + Send + 'static) {
    std::thread::spawn(move || {
        let mut stdin = std::io::stdin();
        let mut sink = [0u8; 256];
        while matches!(stdin.read(&mut sink), Ok(n) if n > 0) {}
        gone();
    });
}
