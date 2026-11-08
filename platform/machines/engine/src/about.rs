//! What this machine is, in words: the system it runs, "Arch Linux",
//! "Ubuntu 24.04", "macOS 26.1", "Windows 11 Pro", and its model, as its
//! maker names it, "MacBook Pro", "Dell XPS 13 9310". Settings' "This
//! machine" shows them (ADR 0095, decision 9), and another machine's
//! Test says the system, through `banda status`. Each is read cheaply,
//! from the system's files and the kernel's, with no program run, so it
//! is read anew each time it is asked; and is none where the system does
//! not say.

/// What this machine is, in words.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct About {
    /// The system it runs, with its version where it has one.
    pub system: Option<String>,
    /// Its model, as its maker names it.
    pub model: Option<String>,
}

/// What this Linux is, as its files under `/` say.
#[cfg(target_os = "linux")]
pub fn about() -> About {
    linux::at(std::path::Path::new("/"))
}

/// What this Mac is, as its kernel says.
#[cfg(target_os = "macos")]
pub fn about() -> About {
    About {
        system: (sysinfo::System::os_version().ok()).map(|version| format!("macOS {version}")),
        model: mac::model_of(
            sysinfo::Product::name().ok().as_deref(),
            sysinfo::System::host_name().ok().as_deref(),
        ),
    }
}

/// What this machine is, as its system says: Windows' name and edition,
/// and the maker and model its firmware gives.
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub fn about() -> About {
    use sysinfo::{Product, System};
    About {
        system: System::long_os_version().or_else(|_| System::name()).ok(),
        model: model_of(
            Product::vendor_name().ok().as_deref(),
            Product::name().ok().as_deref(),
            Product::version().ok().as_deref(),
        ),
    }
}

/// The model a machine's firmware names, as people say it, from its
/// maker (`vendor`), its `name` and its `version`: its name, after its
/// maker's word where the name does not start with it, "Dell XPS 13
/// 9310", "HP EliteBook 840 G8"; Lenovo's is its version, "Lenovo
/// ThinkPad X1 Carbon Gen 10", as its name is a part number. None for the
/// words a maker leaves unfilled, "To Be Filled By O.E.M.".
#[cfg(any(not(target_os = "macos"), test))]
fn model_of(vendor: Option<&str>, name: Option<&str>, version: Option<&str>) -> Option<String> {
    fn filled(said: Option<&str>) -> Option<&str> {
        said.map(str::trim).filter(|said| !unfilled(said))
    }
    let maker = filled(vendor).and_then(|vendor| vendor.split_whitespace().next());
    let maker = maker.map(|maker| match maker.to_ascii_lowercase().as_str() {
        "lenovo" => "Lenovo",
        "asustek" => "ASUS",
        "micro-star" => "MSI",
        "hewlett-packard" => "HP",
        _ => maker.trim_end_matches([',', '.']),
    });
    let lenovo = maker == Some("Lenovo");
    let name = (lenovo.then(|| filled(version)).flatten()).or_else(|| filled(name))?;
    Some(match maker {
        Some(maker) if !name.to_lowercase().starts_with(&maker.to_lowercase()) => {
            format!("{maker} {name}")
        }
        _ => name.to_owned(),
    })
}

/// Whether `said` is what a maker leaves in its firmware for words it
/// did not fill in.
#[cfg(any(not(target_os = "macos"), test))]
fn unfilled(said: &str) -> bool {
    let said = said.to_ascii_lowercase();
    said.contains("o.e.m")
        || said.contains("filled by")
        || said.starts_with("system ")
        || [
            "",
            "default string",
            "not applicable",
            "not specified",
            "none",
            "unknown",
            "oem",
            "n/a",
            "invalid",
            "x.x",
            "0123456789",
        ]
        .contains(&said.as_str())
}

/// The value an os-release gives `key`: `NAME="Arch Linux"`.
#[cfg(any(target_os = "linux", test))]
pub(crate) fn value_in(release: &str, key: &str) -> Option<String> {
    let value = (release.lines()).find_map(|line| line.strip_prefix(key)?.strip_prefix('='))?;
    let value = value.trim().trim_matches(['"', '\'']).trim();
    (!value.is_empty()).then(|| value.to_owned())
}

#[cfg(any(target_os = "linux", test))]
mod linux {
    use super::{About, value_in};
    use std::path::Path;

    /// What a Linux whose files are under `root` is: its os-release's
    /// name and version, else "Linux"; and its model, as the firmware's
    /// tables say, else its device tree, as a Raspberry Pi's does.
    pub(super) fn at(root: &Path) -> About {
        let read = |path: &str| std::fs::read_to_string(root.join(path)).ok();
        let release = read("etc/os-release").or_else(|| read("usr/lib/os-release"));
        let value = |key| (release.as_deref()).and_then(|release| value_in(release, key));
        let system = match (value("NAME"), value("VERSION_ID")) {
            (Some(name), Some(version)) => format!("{name} {version}"),
            (Some(name), None) => name,
            (None, _) => "Linux".to_owned(),
        };
        let dmi = |file: &str| read(&format!("sys/devices/virtual/dmi/id/{file}"));
        let tree = read("sys/firmware/devicetree/base/model")
            .map(|model| model.trim_end_matches('\0').trim().to_owned())
            .filter(|model| !model.is_empty());
        About {
            system: Some(system),
            model: super::model_of(
                dmi("sys_vendor").as_deref(),
                dmi("product_name").as_deref(),
                dmi("product_version").as_deref(),
            )
            .or(tree),
        }
    }
}

#[cfg(any(target_os = "macos", test))]
mod mac {
    /// The Macs a model identifier names, by its family: `MacBookPro18,3`
    /// is a MacBook Pro.
    const FAMILIES: [(&str, &str); 7] = [
        ("MacBookPro", "MacBook Pro"),
        ("MacBookAir", "MacBook Air"),
        ("MacBook", "MacBook"),
        ("Macmini", "Mac mini"),
        ("MacPro", "Mac Pro"),
        ("iMacPro", "iMac Pro"),
        ("iMac", "iMac"),
    ];

    /// A Mac's model from its identifier, `hw.model`. A newer Mac's says
    /// only "Mac14,2": then its `hostname`'s, as macOS makes it of its
    /// owner and model (`Romas-MacBook-Air`), else "Mac".
    pub(super) fn model_of(id: Option<&str>, hostname: Option<&str>) -> Option<String> {
        let family = id.map(|id| {
            id.trim()
                .trim_end_matches(|c: char| c.is_ascii_digit() || c == ',')
        });
        let known = (FAMILIES.iter())
            .find(|(of, _)| family == Some(of))
            .map(|(_, model)| *model);
        let host = hostname.and_then(|host| host.split('.').next());
        known
            .or_else(|| host.and_then(crate::found::model))
            .or((family == Some("Mac")).then_some("Mac"))
            .map(str::to_owned)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_linux_says_its_system_and_version_and_its_model() {
        let root = tempfile::tempdir().unwrap();
        let write = |path: &str, text: &str| {
            let path = root.path().join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        };
        assert_eq!(
            linux::at(root.path()),
            About {
                system: Some("Linux".to_owned()),
                model: None
            },
            "no os-release, no firmware tables"
        );
        write("etc/os-release", "NAME=\"Arch Linux\"\nBUILD_ID=rolling\n");
        assert_eq!(linux::at(root.path()).system.as_deref(), Some("Arch Linux"));
        write("etc/os-release", "NAME=\"Ubuntu\"\nVERSION_ID=\"24.04\"\n");
        assert_eq!(
            linux::at(root.path()).system.as_deref(),
            Some("Ubuntu 24.04")
        );
        // A Raspberry Pi's device tree names it.
        write(
            "sys/firmware/devicetree/base/model",
            "Raspberry Pi 5 Model B Rev 1.0\0",
        );
        assert_eq!(
            linux::at(root.path()).model.as_deref(),
            Some("Raspberry Pi 5 Model B Rev 1.0")
        );
        // The firmware's tables, where it has them.
        write("sys/devices/virtual/dmi/id/sys_vendor", "Dell Inc.\n");
        write("sys/devices/virtual/dmi/id/product_name", "XPS 13 9310\n");
        assert_eq!(
            linux::at(root.path()).model.as_deref(),
            Some("Dell XPS 13 9310")
        );
    }

    #[test]
    fn the_model_is_the_maker_s_name_without_the_words_it_left_unfilled() {
        let model = |vendor, name, version| model_of(Some(vendor), Some(name), Some(version));
        assert_eq!(
            model("HP", "HP EliteBook 840 G8 Notebook PC", "").as_deref(),
            Some("HP EliteBook 840 G8 Notebook PC")
        );
        assert_eq!(
            model("SLIMBOOK", "EVO14-AI9-STP", "Standard").as_deref(),
            Some("SLIMBOOK EVO14-AI9-STP")
        );
        assert_eq!(
            model("LENOVO", "21CBCTO1WW", "ThinkPad X1 Carbon Gen 10").as_deref(),
            Some("Lenovo ThinkPad X1 Carbon Gen 10")
        );
        assert_eq!(
            model("LENOVO", "21CBCTO1WW", "").as_deref(),
            Some("Lenovo 21CBCTO1WW")
        );
        assert_eq!(
            model("ASUSTeK COMPUTER INC.", "ROG Zephyrus G14", "1.0").as_deref(),
            Some("ASUS ROG Zephyrus G14")
        );
        assert_eq!(
            model(
                "System manufacturer",
                "System Product Name",
                "System Version"
            ),
            None
        );
        assert_eq!(
            model(
                "To Be Filled By O.E.M.",
                "B550 AORUS ELITE",
                "Default string"
            )
            .as_deref(),
            Some("B550 AORUS ELITE")
        );
        assert_eq!(model_of(None, None, None), None);
    }

    #[test]
    fn a_mac_s_model_is_its_identifier_s_family_else_its_hostname_s() {
        let model = |id, host| mac::model_of(id, host);
        assert_eq!(
            model(Some("MacBookPro18,3"), None).as_deref(),
            Some("MacBook Pro")
        );
        assert_eq!(
            model(Some("Macmini9,1"), Some("studio")).as_deref(),
            Some("Mac mini")
        );
        assert_eq!(model(Some("iMac21,1"), None).as_deref(), Some("iMac"));
        // A newer Mac's identifier names no family.
        assert_eq!(
            model(Some("Mac14,2"), Some("Romas-MacBook-Air.local")).as_deref(),
            Some("MacBook Air")
        );
        assert_eq!(
            model(Some("Mac15,3"), Some("m1pro.local")).as_deref(),
            Some("Mac")
        );
        assert_eq!(model(Some("VirtualMac2,1"), Some("vm")), None);
        assert_eq!(model(None, None), None);
    }

    #[test]
    fn this_machine_says_its_system() {
        let about = about();
        let system = about.system.expect("a system");
        assert!(!system.trim().is_empty(), "{system:?}");
    }
}
