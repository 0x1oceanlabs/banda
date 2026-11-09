//! Linux holds a machine awake with logind's locks, on the system bus, as
//! `systemd-inhibit --what=idle:sleep` takes them: `idle` in `block`
//! mode, which logind's own idle action and an idle daemon that reads it
//! wait on, and `sleep` in `block-weak` mode, so the Person's own Suspend
//! still goes through (ADR 0097, decision 3). A systemd older than 257
//! knows no `block-weak`, and its `block` already lets the Person through.
//!
//! A lock is a file descriptor: kept, it holds; closed, it is let go, as
//! it is when the engine ends. It comes close-on-exec, so no program the
//! engine starts meanwhile, a Harness or a Terminal, keeps it: zbus's own
//! reader takes the descriptors it is sent without that, so the bus here
//! is read by [`Closing`], which takes them with it.
//!
//! Banda never asks for interactive authorization, so no password prompt
//! shows. Outside any session logind's policy may refuse `sleep`, and
//! where there is no logind both are refused: each refusal is said once
//! in the log, and the engine goes on with what it was granted. A bus
//! that is not reached, that went, as when its daemon restarts, or that
//! did not answer in time is no refusal: the hold is short, and its locks
//! are asked for again in a while, on a bus reached again. Whether the
//! machine is on power UPower says, else the kernel's power supplies do.

use super::{System, Taken, Why};
use std::collections::HashSet;
use std::io;
use std::os::fd::{AsFd, BorrowedFd, OwnedFd};
use std::path::Path;
use std::time::Duration;
use zbus::connection::socket::{BoxedSplit, ReadHalf, Split, WriteHalf};

/// How long the bus has to answer: never asking for authorization, logind
/// answers at once.
const ASKING: Duration = Duration::from_secs(5);

/// The most descriptors one read takes, as zbus's own reader.
const FDS_MOST: usize = 1024;

/// The system's own: logind's locks, on a system bus reached when first
/// needed, and again after it went or failed.
#[derive(Default)]
pub(super) struct Logind {
    bus: Option<zbus::Connection>,
    /// What was said in the log already, so each is said once.
    told: HashSet<&'static str>,
}

impl Logind {
    /// Says `what` once in this run of the engine.
    fn tell(&mut self, what: &'static str, error: &dyn std::fmt::Display) {
        if self.told.insert(what) {
            tracing::warn!(%error, "{what}");
        }
    }

    /// The system bus, reached now if it is not yet, or if the one reached
    /// before went, as when its daemon restarted.
    async fn bus(&mut self) -> Option<zbus::Connection> {
        if self.bus.as_ref().is_some_and(zbus::Connection::is_closed) {
            self.bus = None;
        }
        if self.bus.is_none() {
            match tokio::time::timeout(ASKING, system_bus()).await {
                Ok(Ok(bus)) => {
                    self.bus = Some(bus);
                    // Reached: when it is not, that is said again.
                    self.told.remove(NO_BUS);
                }
                Ok(Err(error)) => self.tell(NO_BUS, &error),
                Err(_) => self.tell(NO_BUS, &"it did not answer in time"),
            }
        }
        self.bus.clone()
    }

    /// One lock of `what`, in `mode`, as logind grants it; `block-weak` is
    /// `block` where logind knows no `block-weak`.
    async fn lock(
        bus: &zbus::Connection,
        what: &str,
        why: Why,
        mode: &str,
    ) -> zbus::Result<OwnedFd> {
        match Logind::inhibit(bus, what, why, mode).await {
            Err(error) if mode == "block-weak" && unknown_mode(&error) => {
                Logind::inhibit(bus, what, why, "block").await
            }
            lock => lock,
        }
    }

    /// One lock, `what` in `mode`, as logind grants it.
    async fn inhibit(
        bus: &zbus::Connection,
        what: &str,
        why: Why,
        mode: &str,
    ) -> zbus::Result<OwnedFd> {
        let reply = bus
            .call_method(
                Some("org.freedesktop.login1"),
                "/org/freedesktop/login1",
                Some("org.freedesktop.login1.Manager"),
                "Inhibit",
                &(what, "Banda", why.words(), mode),
            )
            .await?;
        let lock: zbus::zvariant::OwnedFd = reply.body().deserialize()?;
        Ok(lock.into())
    }
}

const NO_BUS: &str = "the system bus is not reached: nothing keeps this machine awake until it is";
const NO_ANSWER: &str = "logind did not answer for its locks: they are asked for again in a while";
const NO_IDLE: &str = "logind refused its idle lock: the machine may idle-sleep while Agents work";
const NO_SLEEP: &str = "logind refused its sleep lock: only its idle lock keeps the machine awake";

#[async_trait::async_trait]
impl System for Logind {
    /// The locks logind granted.
    type Held = Vec<OwnedFd>;

    async fn take(&mut self, why: Why) -> Taken<Vec<OwnedFd>> {
        let mut held = Vec::new();
        let Some(bus) = self.bus().await else {
            return Taken { held, short: true };
        };
        for (what, mode, refused) in [
            ("idle", "block", NO_IDLE),
            ("sleep", "block-weak", NO_SLEEP),
        ] {
            match Logind::lock(&bus, what, why, mode).await {
                Ok(lock) => held.push(lock),
                Err(error) if unanswered(&error) => {
                    // Not on this bus again: the rest waits for the next
                    // take, on a bus reached again.
                    self.bus = None;
                    self.tell(NO_ANSWER, &error);
                    return Taken { held, short: true };
                }
                Err(error) => self.tell(refused, &error),
            }
        }
        // Answered: when logind next does not, that is said again.
        self.told.remove(NO_ANSWER);
        Taken { held, short: false }
    }

    async fn on_power(&mut self) -> bool {
        use crate::power::linux;
        if let Some(bus) = self.bus().await {
            match linux::on_power_said(&bus).await {
                Ok(on_power) => return on_power,
                Err(error) => self.lost(&error),
            }
        }
        linux::on_power(&linux::supplies(Path::new(linux::SUPPLIES)))
    }
}

impl Logind {
    /// Reaches the bus again next time, when `error` says this one went.
    fn lost(&mut self, error: &zbus::Error) {
        if unanswered(error) {
            self.bus = None;
        }
    }
}

/// Whether `error` says the bus went or did not answer in time, as zbus
/// says both, rather than that the one asked refused.
fn unanswered(error: &zbus::Error) -> bool {
    matches!(
        error,
        zbus::Error::InputOutput(_) | zbus::Error::InvalidReply
    )
}

/// Whether logind refused a mode it does not know, as before systemd 257
/// it does `block-weak`.
fn unknown_mode(error: &zbus::Error) -> bool {
    matches!(error, zbus::Error::MethodError(name, ..)
        if name.as_str() == "org.freedesktop.DBus.Error.InvalidArgs")
}

/// The system bus, as zbus reaches it but read by [`Closing`].
async fn system_bus() -> zbus::Result<zbus::Connection> {
    use zbus::address::transport::{Transport, UnixSocket};
    let address = zbus::Address::system()?;
    let Transport::Unix(unix) = address.transport() else {
        return Err(zbus::Error::Address(address.to_string()));
    };
    let UnixSocket::File(path) = unix.path() else {
        return Err(zbus::Error::Address(address.to_string()));
    };
    let (read, write) = tokio::net::UnixStream::connect(path).await?.into_split();
    let socket: BoxedSplit = Split::new(
        Box::new(Closing(read)) as Box<dyn ReadHalf>,
        Box::new(write) as Box<dyn WriteHalf>,
    );
    zbus::connection::Builder::socket(socket)
        .method_timeout(ASKING)
        .build()
        .await
}

/// The bus's read half, which takes each file descriptor it is sent
/// close-on-exec, as it comes (`MSG_CMSG_CLOEXEC`).
#[derive(Debug)]
struct Closing(tokio::net::unix::OwnedReadHalf);

#[async_trait::async_trait]
impl ReadHalf for Closing {
    async fn recvmsg(&mut self, buf: &mut [u8]) -> io::Result<(usize, Vec<OwnedFd>)> {
        let stream: &tokio::net::UnixStream = self.0.as_ref();
        loop {
            stream.readable().await?;
            match stream.try_io(tokio::io::Interest::READABLE, || {
                received(stream.as_fd(), buf)
            }) {
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                    ) => {}
                read => return read,
            }
        }
    }

    fn can_pass_unix_fd(&self) -> bool {
        true
    }

    async fn peer_credentials(&mut self) -> io::Result<zbus::fdo::ConnectionCredentials> {
        ReadHalf::peer_credentials(&mut self.0).await
    }
}

/// What one read of `socket` gives into `buf`, and the descriptors that
/// came with it, each close-on-exec.
fn received(socket: BorrowedFd<'_>, buf: &mut [u8]) -> io::Result<(usize, Vec<OwnedFd>)> {
    use rustix::net::{RecvAncillaryBuffer, RecvAncillaryMessage, RecvFlags};
    let mut space = [std::mem::MaybeUninit::uninit(); rustix::cmsg_space!(ScmRights(FDS_MOST))];
    let mut ancillary = RecvAncillaryBuffer::new(&mut space);
    let mut parts = [io::IoSliceMut::new(buf)];
    let read = rustix::net::recvmsg(socket, &mut parts, &mut ancillary, RecvFlags::CMSG_CLOEXEC)?;
    if read.bytes == 0 {
        return Err(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "the system bus closed",
        ));
    }
    let mut fds = Vec::new();
    for message in ancillary.drain() {
        if let RecvAncillaryMessage::ScmRights(sent) = message {
            fds.extend(sent);
        }
    }
    Ok((read.bytes, fds))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rustix::io::FdFlags;
    use std::os::fd::AsRawFd;

    /// Whether a program started now would have `fd`: a shell looks for
    /// it among its own.
    fn inherited(fd: &OwnedFd) -> bool {
        let looked = format!("test -e /proc/self/fd/{}", fd.as_raw_fd());
        std::process::Command::new("sh")
            .args(["-c", &looked])
            .status()
            .unwrap()
            .success()
    }

    #[test]
    fn a_descriptor_comes_close_on_exec_and_no_program_started_keeps_it() {
        use rustix::net::{
            AddressFamily, SendAncillaryBuffer, SendAncillaryMessage, SendFlags, SocketFlags,
            SocketType, sendmsg, socketpair,
        };
        let (ours, theirs) = socketpair(
            AddressFamily::UNIX,
            SocketType::STREAM,
            SocketFlags::CLOEXEC,
            None,
        )
        .unwrap();
        // A descriptor sent as logind sends its lock: what comes of it is
        // a new one.
        let (lock, _other_end) = std::io::pipe().unwrap();
        let mut space = [std::mem::MaybeUninit::uninit(); rustix::cmsg_space!(ScmRights(1))];
        let mut ancillary = SendAncillaryBuffer::new(&mut space);
        let sent = [lock.as_fd()];
        assert!(ancillary.push(SendAncillaryMessage::ScmRights(&sent)));
        let parts = [io::IoSlice::new(b"lock")];
        sendmsg(&theirs, &parts, &mut ancillary, SendFlags::empty()).unwrap();

        let mut buf = [0; 16];
        let (read, fds) = received(ours.as_fd(), &mut buf).unwrap();
        assert_eq!(&buf[..read], b"lock");
        let [got] = <[OwnedFd; 1]>::try_from(fds).unwrap();
        let flags = rustix::io::fcntl_getfd(&got).unwrap();
        assert!(flags.contains(FdFlags::CLOEXEC), "{flags:?}");
        assert!(!inherited(&got), "a program started now has it not");
        // As the test shows: one without would be.
        let open = rustix::io::fcntl_dupfd_cloexec(&got, 0).unwrap();
        rustix::io::fcntl_setfd(&open, FdFlags::empty()).unwrap();
        assert!(inherited(&open), "the shell sees what it has");
    }

    /// logind's inhibitors now: what, who, why and mode, by the process
    /// that holds each.
    async fn inhibitors(
        bus: &zbus::Connection,
    ) -> zbus::Result<Vec<(String, String, String, String, u32)>> {
        let reply = bus
            .call_method(
                Some("org.freedesktop.login1"),
                "/org/freedesktop/login1",
                Some("org.freedesktop.login1.Manager"),
                "ListInhibitors",
                &(),
            )
            .await?;
        let listed: Vec<(String, String, String, String, u32, u32)> = reply.body().deserialize()?;
        Ok(listed
            .into_iter()
            .map(|(what, who, why, mode, _, pid)| (what, who, why, mode, pid))
            .collect())
    }

    /// Ours, as logind lists them: what and mode, said by Banda for
    /// "Agents work".
    async fn ours(bus: &zbus::Connection) -> Vec<(String, String)> {
        let pid = std::process::id();
        let mut ours: Vec<_> = (inhibitors(bus).await.unwrap().into_iter())
            .filter(|(_, who, why, _, by)| who == "Banda" && why == "Agents work" && *by == pid)
            .map(|(what, _, _, mode, _)| (what, mode))
            .collect();
        ours.sort();
        ours
    }

    /// Waits up to two seconds for logind to list none of ours.
    async fn none_listed(bus: &zbus::Connection) {
        for _ in 0..200 {
            if ours(bus).await.is_empty() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("logind still lists them: {:?}", ours(bus).await);
    }

    #[test]
    fn a_bus_that_went_or_did_not_answer_in_time_is_no_refusal() {
        // As zbus says a call that timed out, and a socket that closed.
        let late = io::Error::new(io::ErrorKind::TimedOut, "timed out");
        assert!(unanswered(&zbus::Error::from(late)));
        let closed = io::Error::new(io::ErrorKind::BrokenPipe, "the system bus closed");
        assert!(unanswered(&zbus::Error::from(closed)));
        assert!(!unanswered(&zbus::Error::Unsupported));
    }

    /// A real lock of logind's, where this runs with a system bus and a
    /// logind that grants it; it says why it skips where not, as on CI's
    /// runners in a container.
    #[tokio::test]
    async fn logind_lists_banda_s_locks_while_they_are_held_and_not_after() {
        let mut logind = Logind::default();
        let Some(bus) = logind.bus().await else {
            eprintln!("skipped: no system bus here");
            return;
        };
        if let Err(error) = inhibitors(&bus).await {
            eprintln!("skipped: no logind here: {error}");
            return;
        }
        let taken = logind.take(Why::Working).await;
        if taken.held.is_empty() {
            eprintln!("skipped: logind grants this process no lock");
            return;
        }
        assert!(!taken.short, "logind answered");
        let held = taken.held;
        for lock in &held {
            let flags = rustix::io::fcntl_getfd(lock).unwrap();
            assert!(flags.contains(FdFlags::CLOEXEC), "{flags:?}");
            assert!(!inherited(lock), "a program started now has it not");
        }
        let modes = ours(&bus).await;
        assert!(
            modes.contains(&("idle".to_owned(), "block".to_owned())),
            "{modes:?}"
        );
        assert_eq!(modes.len(), held.len(), "{modes:?}");
        if let Some((_, mode)) = modes.iter().find(|(what, _)| what == "sleep") {
            assert!(["block-weak", "block"].contains(&mode.as_str()), "{mode}");
        }

        drop(held);
        none_listed(&bus).await;

        // The bus goes, as when its daemon restarts: the next take reaches
        // it again, and is granted the same.
        bus.close().await.unwrap();
        let again = logind.take(Why::Working).await;
        assert!(!again.short, "logind answered on a bus reached again");
        let bus = logind.bus().await.unwrap();
        assert_eq!(ours(&bus).await, modes);
        drop(again);
        none_listed(&bus).await;
    }
}
