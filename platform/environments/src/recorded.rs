//! An environment that writes down each program it is asked to start,
//! then has another start it: for a test, to see that a module started a
//! program through its Project's environment, and which.

use banda_kernel::{Environment, Input, Program};
use std::io;
use std::sync::{Arc, Mutex};
use tokio::process::Child;

/// How a program was asked to start.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum How {
    /// [`Environment::spawn`], on pipes.
    Spawn,
    /// [`Environment::pty`], on a terminal.
    Pty,
}

/// One program an environment was asked to start.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Asked {
    pub how: How,
    pub program: Program,
}

/// What a [`Recorded`] was asked, in order, as it goes on being asked.
#[derive(Clone, Default)]
pub struct Asks(Arc<Mutex<Vec<Asked>>>);

impl Asks {
    /// Each program asked so far.
    pub fn all(&self) -> Vec<Asked> {
        self.0.lock().unwrap().clone()
    }

    /// Each program asked so far that runs `program`, as its path ends.
    pub fn of(&self, program: &str) -> Vec<Asked> {
        let runs = |asked: &Asked| {
            let path = std::path::Path::new(&asked.program.program);
            path.file_name().is_some_and(|name| name == program)
        };
        self.all().into_iter().filter(runs).collect()
    }
}

/// Writes down what it is asked to start, then has `E` start it.
pub struct Recorded<E> {
    starts: E,
    asks: Asks,
}

impl<E: Environment> Recorded<E> {
    pub fn new(starts: E) -> Self {
        Recorded {
            starts,
            asks: Asks::default(),
        }
    }

    /// What it was asked, now and later.
    pub fn asks(&self) -> Asks {
        self.asks.clone()
    }

    fn write(&self, how: How, program: &Program) {
        let program = program.clone();
        self.asks.0.lock().unwrap().push(Asked { how, program });
    }
}

impl<E: Environment> Environment for Recorded<E> {
    fn spawn(&self, program: &Program, input: Input) -> io::Result<Child> {
        self.write(How::Spawn, program);
        self.starts.spawn(program, input)
    }

    fn pty(&self, program: &Program, pts: pty_process::Pts) -> io::Result<Child> {
        self.write(How::Pty, program);
        self.starts.pty(program, pts)
    }
}
