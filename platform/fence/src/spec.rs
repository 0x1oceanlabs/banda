//! What the fence does around one program: the spec an environment hands
//! the launcher. It goes on a sealed memfd, never on the command line,
//! where any process of the Person's could read it.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// What the fence hides, keeps read-only and opens holes in, around one
/// program, and the folder that program starts in.
///
/// Every path is absolute. What it hides or keeps read-only is resolved by
/// whoever writes the spec, its links followed, but for the last part:
/// the launcher refuses a folder to cover that is itself a link.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Spec {
    /// The build of `banda` that wrote it, its build id: the launcher
    /// refuses a spec another build wrote, whose format it may read
    /// otherwise.
    pub build: String,
    /// What the fence covers with an empty folder of its own: Banda's own
    /// state and data, the runtime folder. Each is there already; the
    /// launcher refuses to start when one is not.
    pub hidden: Vec<PathBuf>,
    /// What the fence covers only when it is there: sockets and folders
    /// outside Banda's own, a folder with an empty one, a file or a socket
    /// with an empty file no one may write. One that is a link is followed
    /// only when root made it, and passed over otherwise. One in a folder
    /// this user neither enters nor owns, as a socket in a service's own
    /// folder, is passed over too; one in a folder of its own that it
    /// cannot enter is refused. No hole opens in one.
    #[serde(default)]
    pub hidden_if_there: Vec<PathBuf>,
    /// What the fence covers as it does what it hides only when it is
    /// there, found as it starts: each entry of a folder whose name starts
    /// with the last part of one of these, as `/tmp/kitty-` names every
    /// kitty's socket of remote control, each with its own process's
    /// number after it.
    #[serde(default)]
    pub hidden_starting: Vec<PathBuf>,
    /// Folders the program sees and cannot change, as Banda's config.
    #[serde(default)]
    pub read_only: Vec<PathBuf>,
    /// Folders of root's whose files a program takes only from root or
    /// from its own user, as ssh takes the drop-ins in
    /// `/etc/ssh/ssh_config.d`. The fence's user namespace maps no root,
    /// so inside it root's files are no one's: the program finds each of
    /// these folders' files as a copy of its own user's, `0644`, its links
    /// followed, in a folder it cannot change. One not there is passed
    /// over, and so is a file the user cannot read.
    #[serde(default)]
    pub owned: Vec<PathBuf>,
    /// The holes in what it hides.
    #[serde(default)]
    pub holes: Holes,
    /// The folder the program starts in; the launcher's own when none.
    #[serde(default)]
    pub cwd: Option<PathBuf>,
}

/// Where a program reaches into what the fence hides, each a folder (or a
/// socket) inside a hidden one, shown at its own place, none inside
/// another. One outside every hidden folder is in sight already, and needs
/// none.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Holes {
    /// What it reads and writes, as Claude Code's sessions of its Project.
    #[serde(default)]
    pub writes: Vec<PathBuf>,
    /// What it only reads, and runs nothing from, as the files its Project
    /// keeps for messages.
    #[serde(default)]
    pub reads: Vec<PathBuf>,
    /// What it reads and runs, and cannot change, as the engine's own copy.
    #[serde(default)]
    pub runs: Vec<PathBuf>,
}

#[cfg(target_os = "linux")]
pub use sealed::Sealed;

#[cfg(target_os = "linux")]
mod sealed {
    use super::Spec;
    use rustix::fd::{AsRawFd, OwnedFd};
    use rustix::fs::{MemfdFlags, SealFlags};
    use std::fs::File;
    use std::io::{self, Write};
    use std::os::unix::fs::FileExt;

    /// The most a spec may be: far more than one holds.
    const MOST: u64 = 1 << 20;

    /// The seals that make a memfd's bytes fixed: none may be added, taken
    /// away, written or sealed otherwise.
    fn fixed() -> SealFlags {
        SealFlags::SEAL | SealFlags::SHRINK | SealFlags::GROW | SealFlags::WRITE
    }

    /// A spec on a memfd whose bytes are fixed, to hand the launcher.
    #[derive(Debug)]
    pub struct Sealed(pub(crate) OwnedFd);

    impl Sealed {
        /// The number the memfd has in this process, which the launcher
        /// has it by too ([`attach`](crate::attach) keeps it open there).
        pub fn number(&self) -> i32 {
            self.0.as_raw_fd()
        }
    }

    impl Spec {
        /// The spec, on a memfd sealed so that no one changes it once it
        /// is written, and closed on exec but in the launcher.
        pub fn seal(&self) -> io::Result<Sealed> {
            let memfd = rustix::fs::memfd_create(
                "banda-fence-spec",
                MemfdFlags::CLOEXEC | MemfdFlags::ALLOW_SEALING,
            )?;
            let mut file = File::from(memfd);
            file.write_all(&serde_json::to_vec(self)?)?;
            let memfd = OwnedFd::from(file);
            rustix::fs::fcntl_add_seals(&memfd, fixed())?;
            Ok(Sealed(memfd))
        }

        /// The spec on `memfd`, which must be sealed as [`Spec::seal`]
        /// seals one; it is closed once read.
        pub(crate) fn read(memfd: OwnedFd) -> Result<Spec, String> {
            let seals = rustix::fs::fcntl_get_seals(&memfd)
                .map_err(|error| format!("the spec is on no memfd ({error})"))?;
            if !seals.contains(fixed()) {
                return Err("the spec's memfd is not sealed".to_owned());
            }
            let file = File::from(memfd);
            let size = file.metadata().map_err(|error| error.to_string())?.len();
            if size > MOST {
                return Err(format!("the spec is {size} bytes, more than a spec is"));
            }
            let mut bytes = vec![0; usize::try_from(size).unwrap_or(0)];
            file.read_exact_at(&mut bytes, 0)
                .map_err(|error| format!("the spec could not be read ({error})"))?;
            serde_json::from_slice(&bytes)
                .map_err(|error| format!("the spec does not parse ({error})"))
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    fn spec() -> Spec {
        Spec {
            build: "abc".to_owned(),
            hidden: vec![PathBuf::from("/home/p/.local/state/banda")],
            hidden_if_there: vec![PathBuf::from("/tmp/.X11-unix")],
            hidden_starting: vec![PathBuf::from("/tmp/kitty-")],
            read_only: vec![PathBuf::from("/home/p/.config/banda")],
            owned: vec![PathBuf::from("/etc/ssh/ssh_config.d")],
            holes: Holes {
                writes: vec![PathBuf::from("/d/projects/a/sessions/claude")],
                reads: vec![PathBuf::from("/d/projects/a/files")],
                runs: vec![PathBuf::from("/d/engine/1.0.0")],
            },
            cwd: Some(PathBuf::from("/home/p/Banda/a")),
        }
    }

    #[test]
    fn a_sealed_spec_reads_back_as_it_was_written() {
        let sealed = spec().seal().unwrap();
        assert_eq!(Spec::read(sealed.0).unwrap(), spec());
    }

    #[test]
    fn a_sealed_spec_cannot_be_written_again() {
        let sealed = spec().seal().unwrap();
        let file = std::fs::File::from(sealed.0);
        use std::os::unix::fs::FileExt;
        let error = file.write_at(b"{}", 0).unwrap_err();
        assert_eq!(
            error.raw_os_error(),
            Some(rustix::io::Errno::PERM.raw_os_error())
        );
    }

    #[test]
    fn a_spec_on_an_unsealed_memfd_is_refused() {
        let memfd = rustix::fs::memfd_create(
            "unsealed",
            rustix::fs::MemfdFlags::CLOEXEC | rustix::fs::MemfdFlags::ALLOW_SEALING,
        )
        .unwrap();
        let mut file = std::fs::File::from(memfd);
        use std::io::Write;
        file.write_all(&serde_json::to_vec(&spec()).unwrap())
            .unwrap();
        let refused = Spec::read(file.into()).unwrap_err();
        assert!(refused.contains("not sealed"), "{refused}");
    }

    #[test]
    fn a_spec_names_each_field_it_has_and_no_other() {
        let mut said = serde_json::to_value(spec()).unwrap();
        said["holes"]["opens"] = serde_json::json!([]);
        assert!(serde_json::from_value::<Spec>(said).is_err());
    }
}
