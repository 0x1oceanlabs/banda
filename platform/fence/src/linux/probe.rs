//! `banda fence --probe`: the fence set up for real over a spec, checked
//! from inside, and a program run behind it.

use super::launch::{self, Exec, Failed, UNSET};
use super::sys::{self, Forked};
use crate::{Layer, Probe, Spec, Why};
use rustix::fd::OwnedFd;
use rustix::pipe::PipeFlags;
use rustix::process::WaitOptions;
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs::File;
use std::io::{BufRead, BufReader};

/// What the probe's child, or a launcher, says on its pipe, one JSON
/// object a line.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Said {
    /// The fence is set up, with these layers.
    Held(Vec<Layer>),
    /// A step failed.
    Failed { why: Why, words: String },
}

/// Says `failed` on `report`.
pub(crate) fn said(report: &OwnedFd, failed: &Failed) {
    say(
        report,
        &Said::Failed {
            why: failed.why,
            words: failed.words.clone(),
        },
    );
}

fn say(report: &OwnedFd, said: &Said) {
    let Ok(mut line) = serde_json::to_vec(said) else {
        return;
    };
    line.push(b'\n');
    // One write, shorter than a pipe's atomic size, so lines never mix.
    let _ = rustix::io::write(report, &line);
}

/// Sets the fence up over `spec` in a child of this process, checks it
/// from inside and runs `program` behind it, and says what held.
pub(crate) fn probe(spec: &Spec, program: &[OsString]) -> Probe {
    let (hear, report) = match rustix::pipe::pipe_with(PipeFlags::CLOEXEC) {
        Ok(pipe) => pipe,
        Err(error) => return missing(Why::SetupFailed, format!("no pipe for the probe: {error}")),
    };
    let child = match sys::fork() {
        Err(error) => {
            return missing(
                Why::SetupFailed,
                format!("the probe could not fork: {error}"),
            );
        }
        Ok(Forked::Child) => {
            drop(hear);
            probing(spec, program, report)
        }
        Ok(Forked::Parent(child)) => child,
    };
    drop(report);
    let mut held = None;
    let mut failed = None;
    for line in BufReader::new(File::from(hear)).lines() {
        let Ok(line) = line else { break };
        match serde_json::from_str(&line) {
            Ok(Said::Held(layers)) => held = Some(layers),
            Ok(Said::Failed { why, words }) => {
                failed.get_or_insert((why, words));
            }
            Err(_) => {}
        }
    }
    let status = rustix::process::waitpid(Some(child), WaitOptions::empty());
    if let Some((why, words)) = failed {
        return missing(why, words);
    }
    let ended = status.ok().flatten().map(|(_, status)| status);
    match (held, ended) {
        (Some(layers), Some(status)) if status.exit_status() == Some(0) => Probe::Holds { layers },
        (_, ended) => missing(
            Why::SetupFailed,
            format!("the program behind the probe's fence ended so: {ended:?}"),
        ),
    }
}

fn missing(why: Why, words: String) -> Probe {
    Probe::Missing { why, words }
}

/// The probe's child: the launcher's steps over `spec`, with `program`,
/// each step's end said on `report`.
fn probing(spec: &Spec, program: &[OsString], report: OwnedFd) -> ! {
    let ready = sys::close_all_but(Some(&report))
        .map_err(|error| Failed::setup(format!("closing what the probe is not given: {error}")))
        .and_then(|()| {
            launch::quiet();
            let exec = Exec::new(program, None)?;
            let fenced = launch::setup(spec)?;
            launch::verify(&fenced)?;
            Ok((exec, fenced.layers, fenced.starter))
        });
    let (exec, layers, starter) = match ready {
        Ok(ready) => ready,
        Err(failed) => {
            said(&report, &failed);
            std::process::exit(UNSET)
        }
    };
    say(&report, &Said::Held(layers));
    let mut report = Some(report);
    let failed = launch::start(exec, starter, &mut report);
    launch::tell(report.as_ref(), &failed);
    std::process::exit(UNSET)
}
