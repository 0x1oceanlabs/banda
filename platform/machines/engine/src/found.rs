//! What Banda finds this machine is, once, as the engine starts: a name
//! from its hostname, an icon from what it is (ADR 0095, decision 3).
//! `machine.toml` says otherwise where the Person wants. Each fact is read
//! cheaply from the system's own files and programs; what they make is a
//! plain function, which the tests run on fixtures.
//!
//! | The machine | Its icon |
//! |---|---|
//! | a virtual machine or a container | `vm` |
//! | one with a battery of its own | `laptop` |
//! | a Mac with none, as a Mac mini or an iMac | `desktop` |
//! | Linux with none, as `banda serve` on a server | `server` |
//! | any other | `desktop` |
//!
//! Its name is the hostname without `.local` or any domain. A Mac's that
//! macOS made of its owner and its model, `Romas-MacBook-Pro`, gives way to
//! the model, "MacBook Pro". A hostname the system made up gives way to a
//! word: `ip-10-0-1-5` to "Cloud"; Windows' `DESKTOP-…`, `LAPTOP-…` and
//! `WIN-…`, a container's hex ID, a UUID, `localhost` or none to the
//! system's own: "Windows PC", "Mac", or Linux's name in its os-release,
//! "Arch Linux". A longer name is cut to 16 characters at the end of its
//! last word that fits, or at 16 when its first word is longer.

use banda_kernel::{MachineIcon, NAME_MOST, Named};

/// The system a machine runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum System {
    Linux,
    Mac,
    Windows,
    Other,
}

/// What a machine says of itself, as Banda reads it.
#[derive(Debug)]
pub(crate) struct Facts {
    pub hostname: String,
    pub system: System,
    /// The system's own name, as Linux's os-release says it.
    pub system_name: Option<String>,
    /// A battery of its own: a laptop's, not a mouse's.
    pub battery: bool,
    /// It is a virtual machine, or a container.
    pub boxed: bool,
}

/// What Banda finds this machine is: what it is called and drawn by when
/// its `machine.toml` says nothing. It reads the system, and may run a
/// program or two of the host's, so the engine runs it once, as it starts.
pub async fn found() -> Named {
    of(&here().await)
}

/// The name and icon `facts` make.
pub(crate) fn of(facts: &Facts) -> Named {
    Named {
        name: name_of(facts),
        icon: icon_of(facts),
    }
}

fn icon_of(facts: &Facts) -> MachineIcon {
    if facts.boxed {
        MachineIcon::Vm
    } else if facts.battery {
        MachineIcon::Laptop
    } else if facts.system == System::Linux {
        MachineIcon::Server
    } else {
        MachineIcon::Desktop
    }
}

fn name_of(facts: &Facts) -> String {
    let host = facts.hostname.trim().trim_end_matches('.');
    // Before its domain: `m1pro.local`, `ip-10-0-1-5.ec2.internal`.
    let host = host.split('.').next().unwrap_or_default();
    if let Some(model) = model(host) {
        return model.to_owned();
    }
    match made_up(host) {
        None => cut(host),
        Some(Word::Cloud) => "Cloud".to_owned(),
        Some(Word::System) => word_for(facts),
    }
}

/// The Macs whose model macOS names a Mac's hostname by, the longer first.
const MODELS: [&str; 7] = [
    "MacBook Pro",
    "MacBook Air",
    "MacBook",
    "Mac mini",
    "Mac Studio",
    "Mac Pro",
    "iMac",
];

/// The model in a hostname macOS made of a Mac's owner and its model:
/// `Romas-MacBook-Pro`, or `Romas-iMac-2` where another had the name.
pub(crate) fn model(host: &str) -> Option<&'static str> {
    let lower = host.to_ascii_lowercase();
    let lower = match lower.rsplit_once('-') {
        Some((before, number))
            if !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()) =>
        {
            before
        }
        _ => &lower,
    };
    MODELS.into_iter().find(|model| {
        let model = model.to_ascii_lowercase().replace(' ', "-");
        lower
            .strip_suffix(&model)
            .and_then(|owner| owner.strip_suffix("s-"))
            .is_some_and(|owner| !owner.is_empty())
    })
}

/// The word a made-up hostname gives way to.
enum Word {
    Cloud,
    System,
}

/// Whether the system made `host` up, and the word it gives way to.
fn made_up(host: &str) -> Option<Word> {
    let lower = host.to_ascii_lowercase();
    // Its last four parts an IPv4 address: `ip-10-0-1-5`, `192-168-1-23`.
    let parts: Vec<&str> = lower.split('-').collect();
    let address = parts.len() >= 4
        && (parts[parts.len() - 4..].iter()).all(|part| part.parse::<u8>().is_ok());
    if address && parts.len() == 5 && parts[0] == "ip" {
        return Some(Word::Cloud);
    }
    // Windows' own: `DESKTOP-4F2K9XX`, `LAPTOP-…`, a server's `WIN-…`.
    let windows = [("desktop-", 7), ("laptop-", 7), ("win-", 11)]
        .iter()
        .any(|(prefix, len)| {
            lower.strip_prefix(prefix).is_some_and(|rest| {
                rest.len() == *len && rest.bytes().all(|b| b.is_ascii_alphanumeric())
            })
        });
    // A container's ID, or a UUID: hex, a digit in it, twelve or more.
    let hex: Vec<u8> = lower.bytes().filter(|b| *b != b'-').collect();
    let id = hex.len() >= 12
        && hex.iter().all(u8::is_ascii_hexdigit)
        && hex.iter().any(u8::is_ascii_digit);
    let nothing = matches!(lower.as_str(), "" | "localhost");
    (address || windows || id || nothing).then_some(Word::System)
}

/// The system's own word, for a machine whose hostname says nothing.
fn word_for(facts: &Facts) -> String {
    match facts.system {
        System::Windows => "Windows PC".to_owned(),
        System::Mac => "Mac".to_owned(),
        System::Linux | System::Other => (facts.system_name.as_deref())
            .map(str::trim)
            .filter(|name| !name.is_empty() && name.chars().count() <= NAME_MOST)
            .unwrap_or(if facts.system == System::Linux {
                "Linux"
            } else {
                "Computer"
            })
            .to_owned(),
    }
}

/// `name` in 16 characters: cut at the end of its last word that fits (a
/// space, `-` or `.` ends one), or at 16 when its first word is longer.
fn cut(name: &str) -> String {
    if name.chars().count() <= NAME_MOST {
        return name.to_owned();
    }
    // One more: a word that ends on the 16th character fits.
    let most: String = name.chars().take(NAME_MOST + 1).collect();
    let words = most.trim_end_matches(|c: char| !matches!(c, ' ' | '-' | '.'));
    let words = words.trim_end_matches([' ', '-', '.']);
    if words.is_empty() {
        name.chars().take(NAME_MOST).collect()
    } else {
        words.to_owned()
    }
}

impl System {
    /// The system this runs on.
    fn here() -> System {
        if cfg!(target_os = "linux") {
            System::Linux
        } else if cfg!(target_os = "macos") {
            System::Mac
        } else if cfg!(windows) {
            System::Windows
        } else {
            System::Other
        }
    }
}

/// The facts of the machine this runs on.
async fn here() -> Facts {
    let hostname = sysinfo::System::host_name().unwrap_or_default();
    match System::here() {
        #[cfg(target_os = "linux")]
        System::Linux => linux::here(hostname).await,
        #[cfg(target_os = "macos")]
        System::Mac => mac::here(hostname).await,
        system => Facts {
            hostname,
            system,
            system_name: sysinfo::System::name().ok(),
            battery: battery(),
            boxed: false,
        },
    }
}

/// How long a program of the host's has to say what it says: the engine
/// waits for it as it starts, before it opens or hears it should stop.
#[cfg(any(target_os = "linux", target_os = "macos"))]
const ASKING: std::time::Duration = std::time::Duration::from_secs(1);

/// What a program of the host's said on stdout, when it ran, as the engine
/// runs one for itself; none when it is not there, or said nothing within
/// [`ASKING`], and then it is killed. Its exit status is not asked:
/// `systemd-detect-virt` says `none` and fails.
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(crate) async fn said(program: &str, args: &[&str]) -> Option<String> {
    let mut command = banda_kernel::host::own(program).ok()?;
    let output = (command.args(args))
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output();
    let Ok(output) = tokio::time::timeout(ASKING, output).await else {
        tracing::warn!(
            program,
            "said nothing in time: Banda finds this machine without it"
        );
        return None;
    };
    Some(
        String::from_utf8_lossy(&output.ok()?.stdout)
            .trim()
            .to_owned(),
    )
}

/// Whether Windows says it has a battery, through WinRT's aggregate of
/// them: no battery at all reads as `NotPresent`.
#[cfg(windows)]
fn battery() -> bool {
    use windows::Devices::Power::Battery;
    use windows::System::Power::BatteryStatus;
    Battery::AggregateBattery()
        .and_then(|battery| battery.GetReport())
        .and_then(|report| report.Status())
        .is_ok_and(|status| status != BatteryStatus::NotPresent)
}

/// Elsewhere, Linux and the Mac say it in their facts.
#[cfg(not(windows))]
fn battery() -> bool {
    false
}

#[cfg(any(target_os = "linux", test))]
pub(crate) mod linux {
    use super::{Facts, System};
    use std::path::Path;

    /// This Linux's facts, from its files under `/` and what
    /// `systemd-detect-virt` says.
    #[cfg(target_os = "linux")]
    pub(super) async fn here(hostname: String) -> Facts {
        let virt = super::said("systemd-detect-virt", &[]).await;
        at(Path::new("/"), hostname, virt.as_deref())
    }

    /// The facts of a Linux whose files are under `root`, with what
    /// `systemd-detect-virt` said; none when it is not there, as on a
    /// system with no systemd, and then the CPU's flags say.
    pub(super) fn at(root: &Path, hostname: String, virt: Option<&str>) -> Facts {
        let read = |path: &str| std::fs::read_to_string(root.join(path)).ok();
        let container = [".dockerenv", "run/.containerenv"]
            .iter()
            .any(|file| root.join(file).exists());
        let boxed = container
            || match virt {
                Some(said) => !matches!(said.trim(), "" | "none"),
                None => read("proc/cpuinfo").is_some_and(|cpus| hypervisor(&cpus)),
            };
        let release = read("etc/os-release").or_else(|| read("usr/lib/os-release"));
        Facts {
            hostname,
            system: System::Linux,
            system_name: (release.as_deref())
                .and_then(|release| crate::about::value_in(release, "NAME")),
            battery: battery(&root.join("sys/class/power_supply")),
            boxed,
        }
    }

    /// Whether a power supply in `supplies` is the machine's own battery:
    /// a wireless mouse's or a headset's says it is a device's.
    fn battery(supplies: &Path) -> bool {
        supplied(supplies, |kind, _| kind == "Battery")
    }

    /// Whether the machine whose power supplies are in `supplies`, as
    /// `/sys/class/power_supply`, is on power: one of its own supplies
    /// that is no battery, as its charger or a USB-C port, is online, or
    /// it has no battery at all.
    pub(crate) fn on_power(supplies: &Path) -> bool {
        !battery(supplies) || supplied(supplies, |kind, online| kind != "Battery" && online)
    }

    /// Whether one of the machine's own supplies in `supplies`, not a
    /// device's, is as `such` says by its type and whether it is online.
    fn supplied(supplies: &Path, such: impl Fn(&str, bool) -> bool) -> bool {
        let Ok(entries) = std::fs::read_dir(supplies) else {
            return false;
        };
        entries.flatten().any(|entry| {
            let read = |file: &str| std::fs::read_to_string(entry.path().join(file));
            let kind = read("type").unwrap_or_default();
            let scope = read("scope").unwrap_or_default();
            let online = read("online").is_ok_and(|online| online.trim() == "1");
            scope.trim() != "Device" && such(kind.trim(), online)
        })
    }

    /// Whether the CPU's flags say it runs under a hypervisor.
    fn hypervisor(cpuinfo: &str) -> bool {
        (cpuinfo.lines())
            .filter(|line| line.starts_with("flags"))
            .any(|line| line.split_whitespace().any(|flag| flag == "hypervisor"))
    }
}

#[cfg(any(target_os = "macos", test))]
pub(crate) mod mac {
    use super::{Facts, System};

    /// This Mac's facts: its local name, as Sharing sets it and Bonjour
    /// says it, which stays as the networks it joins change its hostname;
    /// whether `pmset` names a battery; and whether the kernel runs under
    /// a hypervisor.
    #[cfg(target_os = "macos")]
    pub(super) async fn here(hostname: String) -> Facts {
        let (local, power, vmm) = tokio::join!(
            super::said("scutil", &["--get", "LocalHostName"]),
            super::said("pmset", &["-g", "batt"]),
            super::said("sysctl", &["-n", "kern.hv_vmm_present"]),
        );
        of(hostname, local, power.as_deref(), vmm.as_deref())
    }

    /// A Mac's facts from what its programs said.
    pub(super) fn of(
        hostname: String,
        local: Option<String>,
        power: Option<&str>,
        vmm: Option<&str>,
    ) -> Facts {
        Facts {
            hostname: local.filter(|name| !name.is_empty()).unwrap_or(hostname),
            system: System::Mac,
            system_name: None,
            battery: power.is_some_and(|said| said.contains("InternalBattery")),
            boxed: vmm.is_some_and(|said| said.trim() == "1"),
        }
    }

    /// Whether a Mac is on power, as `pmset -g batt` says on its first
    /// line: `Now drawing from 'AC Power'`, or `'Battery Power'`. A Mac
    /// with no battery draws from AC; what does not read so is on power.
    pub(crate) fn on_power(power: &str) -> bool {
        let first = power.lines().next().unwrap_or_default();
        !first.contains("'Battery Power'")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn facts(hostname: &str, system: System) -> Facts {
        Facts {
            hostname: hostname.to_owned(),
            system,
            system_name: Some("Arch Linux".to_owned()),
            battery: false,
            boxed: false,
        }
    }

    fn name(hostname: &str, system: System) -> String {
        of(&facts(hostname, system)).name
    }

    #[test]
    fn the_name_is_the_hostname_without_its_domain() {
        assert_eq!(name("m1pro.local", System::Mac), "m1pro");
        assert_eq!(name("arc", System::Linux), "arc");
        assert_eq!(name(" devbox.tail4f2c.ts.net. ", System::Linux), "devbox");
        assert_eq!(
            name("averyveryverylonghostname", System::Linux),
            "averyveryverylon"
        );
        assert_eq!(
            name("build-server-frankfurt-01", System::Linux),
            "build-server"
        );
        assert_eq!(name("sixteen-letters-x", System::Linux), "sixteen-letters");
        assert_eq!(name("build-vm", System::Linux), "build-vm");
        assert_eq!(name("pi4", System::Linux), "pi4");
    }

    #[test]
    fn a_mac_named_by_its_owner_and_model_is_its_model() {
        assert_eq!(name("Romas-MacBook-Pro", System::Mac), "MacBook Pro");
        assert_eq!(name("Romas-MacBook-Air.local", System::Mac), "MacBook Air");
        assert_eq!(name("Romas-Mac-mini", System::Mac), "Mac mini");
        assert_eq!(name("romas-imac-2", System::Mac), "iMac");
        assert_eq!(name("James-MacBook", System::Mac), "MacBook");
        // A name of the Person's own stays.
        assert_eq!(name("MacBook-Pro", System::Mac), "MacBook-Pro");
        assert_eq!(name("studio-iMac", System::Mac), "studio-iMac");
    }

    #[test]
    fn a_hostname_the_system_made_up_gives_way_to_a_word() {
        assert_eq!(name("DESKTOP-4F2K9XX", System::Windows), "Windows PC");
        assert_eq!(name("LAPTOP-0A1B2C3", System::Windows), "Windows PC");
        assert_eq!(name("WIN-3N5QK8R0D2M", System::Windows), "Windows PC");
        assert_eq!(name("ip-10-0-1-5", System::Linux), "Cloud");
        assert_eq!(name("ip-172-31-7-9.ec2.internal", System::Linux), "Cloud");
        assert_eq!(name("192-168-1-23", System::Mac), "Mac");
        assert_eq!(name("3f4e5d6c7b8a", System::Linux), "Arch Linux");
        assert_eq!(
            name("8b1f0c2e-5d7a-4e1b-9c3d-2a6f4e8b0d1c", System::Linux),
            "Arch Linux"
        );
        assert_eq!(name("localhost.localdomain", System::Linux), "Arch Linux");
        assert_eq!(name("", System::Mac), "Mac");
        let long = Facts {
            system_name: Some("Red Hat Enterprise Linux".to_owned()),
            ..facts("localhost", System::Linux)
        };
        assert_eq!(of(&long).name, "Linux");
        // Words, not IDs: a name of letters only, or a short hex one.
        assert_eq!(name("deadbeefcafe", System::Linux), "deadbeefcafe");
        assert_eq!(name("cafe01", System::Linux), "cafe01");
        assert_eq!(name("DESKTOP-ROMA", System::Windows), "DESKTOP-ROMA");
    }

    #[test]
    fn the_icon_is_what_the_machine_is() {
        let icon = |system, battery, boxed| {
            let facts = Facts {
                battery,
                boxed,
                ..facts("x", system)
            };
            of(&facts).icon
        };
        assert_eq!(icon(System::Mac, true, false), MachineIcon::Laptop);
        assert_eq!(icon(System::Mac, false, false), MachineIcon::Desktop);
        assert_eq!(icon(System::Linux, true, false), MachineIcon::Laptop);
        assert_eq!(icon(System::Linux, false, false), MachineIcon::Server);
        assert_eq!(icon(System::Windows, true, false), MachineIcon::Laptop);
        assert_eq!(icon(System::Windows, false, false), MachineIcon::Desktop);
        // A virtual battery is no laptop's.
        assert_eq!(icon(System::Linux, true, true), MachineIcon::Vm);
        assert_eq!(icon(System::Other, false, false), MachineIcon::Desktop);
    }

    /// A Linux's files under a folder of the test's.
    struct Root(tempfile::TempDir);

    impl Root {
        fn new() -> Root {
            Root(tempfile::tempdir().unwrap())
        }

        fn write(&self, path: &str, text: &str) -> &Root {
            let path = self.0.path().join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
            self
        }

        fn facts(&self, virt: Option<&str>) -> Facts {
            linux::at(self.0.path(), "arc".to_owned(), virt)
        }

        fn path(&self) -> &Path {
            self.0.path()
        }
    }

    #[test]
    fn a_linux_laptop_has_a_battery_and_a_desktop_s_mouse_is_no_laptop() {
        let laptop = Root::new();
        laptop
            .write("sys/class/power_supply/AC/type", "Mains\n")
            .write("sys/class/power_supply/BAT0/type", "Battery\n")
            .write("sys/class/power_supply/BAT0/scope", "System\n")
            .write("etc/os-release", "NAME=\"Arch Linux\"\nID=arch\n");
        let facts = laptop.facts(Some("none"));
        assert!(facts.battery && !facts.boxed, "{facts:?}");
        assert_eq!(facts.system_name.as_deref(), Some("Arch Linux"));
        assert_eq!(of(&facts).icon, MachineIcon::Laptop);

        let desktop = Root::new();
        desktop
            .write("sys/class/power_supply/hidpp_battery_0/type", "Battery\n")
            .write("sys/class/power_supply/hidpp_battery_0/scope", "Device\n")
            .write("usr/lib/os-release", "NAME=Ubuntu\n");
        let facts = desktop.facts(Some("none"));
        assert!(!facts.battery, "a mouse's battery: {facts:?}");
        assert_eq!(facts.system_name.as_deref(), Some("Ubuntu"));
        assert_eq!(of(&facts).icon, MachineIcon::Server);
        assert!(!Root::new().facts(None).battery, "no power_supply at all");
    }

    #[test]
    fn a_linux_is_on_power_by_its_charger_or_with_no_battery() {
        let supplies = |root: &Root| linux::on_power(&root.path().join("sys/class/power_supply"));
        let laptop = Root::new();
        laptop
            .write("sys/class/power_supply/AC/type", "Mains\n")
            .write("sys/class/power_supply/AC/online", "1\n")
            .write("sys/class/power_supply/BAT0/type", "Battery\n")
            .write("sys/class/power_supply/BAT0/online", "1\n")
            .write("sys/class/power_supply/BAT0/scope", "System\n");
        assert!(supplies(&laptop), "its charger is in");
        laptop.write("sys/class/power_supply/AC/online", "0\n");
        assert!(!supplies(&laptop), "on battery");
        laptop
            .write(
                "sys/class/power_supply/ucsi-source-psy-USBC000:001/type",
                "USB\n",
            )
            .write(
                "sys/class/power_supply/ucsi-source-psy-USBC000:001/online",
                "1\n",
            );
        assert!(supplies(&laptop), "charged through USB-C");

        // A mouse's charger is not the machine's.
        let unplugged = Root::new();
        unplugged
            .write("sys/class/power_supply/BAT0/type", "Battery\n")
            .write("sys/class/power_supply/hidpp_battery_0/type", "Battery\n")
            .write("sys/class/power_supply/hidpp_battery_0/scope", "Device\n")
            .write("sys/class/power_supply/dock/type", "Mains\n")
            .write("sys/class/power_supply/dock/scope", "Device\n")
            .write("sys/class/power_supply/dock/online", "1\n");
        assert!(!supplies(&unplugged));

        let desktop = Root::new();
        desktop
            .write("sys/class/power_supply/hidpp_battery_0/type", "Battery\n")
            .write("sys/class/power_supply/hidpp_battery_0/scope", "Device\n");
        assert!(supplies(&desktop), "no battery of its own");
        assert!(supplies(&Root::new()), "no power_supply at all");
    }

    #[test]
    fn a_mac_is_on_power_unless_pmset_says_it_draws_from_its_battery() {
        assert!(mac::on_power(
            "Now drawing from 'AC Power'\n -InternalBattery-0 (id=4653155)\t80%; AC attached; not charging present: true"
        ));
        assert!(!mac::on_power(
            "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=4653155)\t42%; discharging; 2:02 remaining present: true"
        ));
        assert!(mac::on_power("Now drawing from 'AC Power'"), "a Mac mini");
        assert!(mac::on_power(""), "pmset said nothing");
    }

    #[test]
    fn a_virtual_machine_or_a_container_is_boxed() {
        assert!(Root::new().facts(Some("kvm")).boxed);
        assert!(Root::new().facts(Some("wsl")).boxed);
        assert!(!Root::new().facts(Some("none")).boxed);
        let docker = Root::new();
        docker.write(".dockerenv", "");
        assert!(
            docker.facts(Some("none")).boxed,
            "{}",
            docker.path().display()
        );
        let podman = Root::new();
        podman.write("run/.containerenv", "engine=\"podman\"\n");
        assert!(podman.facts(None).boxed);
        // With no systemd-detect-virt, the CPU's flags say.
        let guest = Root::new();
        guest.write(
            "proc/cpuinfo",
            "processor\t: 0\nflags\t\t: fpu vme hypervisor lahf_lm\n",
        );
        assert!(guest.facts(None).boxed);
        assert!(!guest.facts(Some("none")).boxed, "systemd-detect-virt says");
        let host = Root::new();
        host.write("proc/cpuinfo", "flags\t\t: fpu vme vmx\n");
        assert!(!host.facts(None).boxed);
    }

    #[test]
    fn a_mac_says_its_local_name_its_battery_and_its_hypervisor() {
        let laptop = mac::of(
            "Romas-MacBook-Pro.local".to_owned(),
            Some("m1pro".to_owned()),
            Some(
                "Now drawing from 'AC Power'\n -InternalBattery-0 (id=4653155)\t100%; charged; 0:00 remaining present: true",
            ),
            Some("0"),
        );
        assert_eq!(
            of(&laptop),
            Named {
                name: "m1pro".to_owned(),
                icon: MachineIcon::Laptop
            }
        );
        let studio = mac::of(
            "studio.local".to_owned(),
            None,
            Some("Now drawing from 'AC Power'"),
            None,
        );
        assert_eq!(
            of(&studio),
            Named {
                name: "studio".to_owned(),
                icon: MachineIcon::Desktop
            }
        );
        let guest = mac::of("vm".to_owned(), Some(String::new()), None, Some("1"));
        assert_eq!(of(&guest).icon, MachineIcon::Vm);
        assert_eq!(of(&guest).name, "vm", "an empty local name is none");
    }

    #[tokio::test]
    async fn this_machine_is_found_with_a_name_that_fits() {
        let named = found().await;
        assert!(!named.name.is_empty());
        assert!(named.name.chars().count() <= NAME_MOST, "{named:?}");
    }

    /// A program that hangs, as a stuck `pmset` would, keeps no engine
    /// from opening.
    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn a_program_that_says_nothing_in_time_is_not_waited_for() {
        let began = std::time::Instant::now();
        assert_eq!(said("sleep", &["30"]).await, None);
        assert!(began.elapsed() < ASKING * 5, "{:?}", began.elapsed());
    }
}
