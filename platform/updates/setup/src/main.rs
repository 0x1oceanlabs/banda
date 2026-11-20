//! `banda-setup`: Banda's card while its Windows installer works (ADR
//! 0090). The installer, electron-builder's NSIS
//! (`client/desktop/installer.nsh`), starts it and shows nothing of its
//! own: the card says how far the copying is, asks what the installer
//! must ask, and stays until Banda's window is up.
//!
//!   banda-setup --icon banda.svg --name "Banda Dev" --version 0.1.0-dev.900 \
//!     --pid <installer> --size <KB> --extract <7z-out> --dir <install folder>
//!
//! `--png out.png` draws the card into a picture instead, on any system:
//! `--step installing|closing|opening|open|stuck`, `--light`,
//! `--progress 0.6`, `--hover 0`, `--scale 2`.
#![cfg_attr(windows, windows_subsystem = "windows")]

// Some of the card is for the window alone.
#[cfg_attr(not(windows), allow(dead_code))]
mod card;
#[cfg(windows)]
mod window;

use card::{Card, Icon, Painter, Step};
use clap::Parser;
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(about = "Banda's card while its Windows installer works.")]
pub struct Args {
    /// The app's name, as the Person knows it: Banda, Banda Dev.
    #[arg(long, default_value = "Banda")]
    pub name: String,
    /// The version it installs.
    #[arg(long, default_value = "")]
    pub version: String,
    /// The app's icon, one of client/desktop/icons/*.svg.
    #[arg(long)]
    pub icon: PathBuf,
    /// The installer's process: once it ends, so does the card.
    #[arg(long)]
    pub pid: Option<u32>,
    /// What the app takes unpacked, in KB: what the copying goes to.
    #[arg(long, default_value_t = 0)]
    pub size: u64,
    /// The folder the installer unpacks the app into first.
    #[arg(long)]
    pub extract: Option<PathBuf>,
    /// The folder the app is installed in.
    #[arg(long)]
    pub dir: Option<PathBuf>,

    /// Draw the card into this PNG instead of showing it.
    #[arg(long)]
    pub png: Option<PathBuf>,
    #[arg(long, default_value = "installing")]
    pub step: String,
    #[arg(long)]
    pub light: bool,
    #[arg(long, default_value_t = 0.6)]
    pub progress: f32,
    #[arg(long)]
    pub hover: Option<usize>,
    #[arg(long, default_value_t = 2.0)]
    pub scale: f32,
}

fn main() -> ExitCode {
    let args = Args::parse();
    let icon = match std::fs::read_to_string(&args.icon)
        .map_err(|e| e.to_string())
        .and_then(|svg| Icon::parse(&svg))
    {
        Ok(icon) => icon,
        Err(error) => {
            eprintln!("banda-setup: {}: {error}", args.icon.display());
            return ExitCode::from(2);
        }
    };
    if let Some(png) = &args.png {
        return picture(&args, &icon, png);
    }
    #[cfg(windows)]
    {
        window::run(&args, icon)
    }
    #[cfg(not(windows))]
    {
        eprintln!("banda-setup: the card is shown on Windows only; --png draws it");
        ExitCode::from(2)
    }
}

fn picture(args: &Args, icon: &Icon, png: &std::path::Path) -> ExitCode {
    let step = match args.step.as_str() {
        "installing" => Step::Installing,
        "closing" => Step::Closing,
        "opening" => Step::Opening,
        "open" => Step::Open,
        "stuck" => Step::Stuck,
        other => {
            eprintln!("banda-setup: no step {other}");
            return ExitCode::from(2);
        }
    };
    let card = Card {
        name: &args.name,
        version: &args.version,
        icon,
        step,
        light: args.light,
        progress: args.progress,
        hat: icon.hat(),
        hover: args.hover,
    };
    let saved = Painter::default()
        .draw(&card, args.scale)
        .ok_or_else(|| "the card has no size".to_owned())
        .and_then(|drawn| drawn.pixmap.save_png(png).map_err(|e| e.to_string()));
    match saved {
        Ok(()) => {
            println!("{}", png.display());
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("banda-setup: {error}");
            ExitCode::FAILURE
        }
    }
}
