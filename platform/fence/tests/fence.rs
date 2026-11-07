//! The fence for real: on Linux, `fence/linux.rs`; elsewhere there is no
//! fence yet, and nothing to run.

#[cfg(target_os = "linux")]
#[path = "fence/linux.rs"]
mod linux;

fn main() -> std::process::ExitCode {
    #[cfg(target_os = "linux")]
    return linux::main();
    #[cfg(not(target_os = "linux"))]
    std::process::ExitCode::SUCCESS
}
