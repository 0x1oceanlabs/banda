//! Where a Project's programs run: the adapters of the kernel's
//! environment port ([`banda_kernel::Environment`], ADR 0084). This crate
//! is the one place a program Banda runs for a Project starts; an
//! architecture test keeps every other crate from starting one
//! (`tests/architecture.rs`).
//!
//! - [`Local`] runs it on the host, as the Person's own programs run:
//!   their environment, their files, their network.
//! - [`Recorded`] writes down what it is asked to start, and whose program
//!   it is, before another adapter starts it, so a test sees that a program
//!   went through its Project's environment, and whose.
//!
//! The fence around a Harness's programs (ADR 0083, decision 1) and the
//! `container` and `sandbox` adapters (ADR 0084) come here too. The
//! architecture test names each place a program is made, and whose it is.

mod local;
mod recorded;

pub use local::Local;
pub use recorded::{Asked, Asks, How, Recorded};
