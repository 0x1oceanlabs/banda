//! A Linux machine's battery, as UPower says it on the system bus: its
//! display device, which UPower makes of the machine's own batteries, a
//! laptop's two as one, and its own `OnBattery`, which signals as the
//! machine is plugged in or out. Where UPower is not, the kernel's power
//! supplies say it, in `/sys/class/power_supply`, with no time left.
//!
//! A wireless mouse's battery, or a headset's, is a device's: UPower
//! leaves it out of its display device, and the kernel marks it so. A UPS
//! is no battery of the machine's own either.

use super::{Battery, left, minutes};
use std::path::Path;

/// UPower's display device, and its `OnBattery`, as UPower says them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Device {
    /// UPower's kind of it: a battery is 2, a UPS 3, none at all 0.
    pub kind: u32,
    pub present: bool,
    /// UPower's state: charging is 1, discharging 2, full 4, and on power
    /// but not charging 5, as a charge threshold holds it.
    pub state: u32,
    pub percentage: f64,
    /// Seconds to empty, none known as 0.
    pub to_empty: i64,
    /// Seconds to full, none known as 0.
    pub to_full: i64,
    pub on_battery: bool,
}

/// UPower's kind of a battery.
const BATTERY: u32 = 2;

/// UPower's state of one that charges.
const CHARGING: u32 = 1;

/// The machine's own battery, as UPower's display device says it; none
/// where it has none.
pub(crate) fn upower(device: &Device) -> Option<Battery> {
    if device.kind != BATTERY || !device.present {
        return None;
    }
    let charging = device.state == CHARGING;
    let on_power = !device.on_battery || charging;
    Some(Battery {
        percent: percent(device.percentage),
        charging,
        on_power,
        left: left(
            charging,
            on_power,
            minutes(device.to_full),
            minutes(device.to_empty),
        ),
    })
}

/// A charge in whole percent, the nearest.
fn percent(percentage: f64) -> u8 {
    percentage.round().clamp(0.0, 100.0) as u8
}

/// One of the machine's power supplies, as the kernel lists it.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Supply {
    /// `Battery`, `Mains`, `USB`, …
    pub kind: String,
    /// The machine's own, not a device's, as a mouse's battery is.
    pub own: bool,
    pub online: bool,
    /// Its charge in percent, for a battery.
    pub capacity: Option<u8>,
    /// A battery's: `Charging`, `Discharging`, `Full`, `Not charging`.
    pub status: String,
}

impl Supply {
    fn battery(&self) -> bool {
        self.own && self.kind == "Battery"
    }
}

/// The power supplies in `supplies`, as `/sys/class/power_supply` lists
/// them; none where it cannot be read.
pub(crate) fn supplies(supplies: &Path) -> Vec<Supply> {
    let Ok(entries) = std::fs::read_dir(supplies) else {
        return Vec::new();
    };
    (entries.flatten())
        .map(|entry| {
            let read = |file: &str| {
                std::fs::read_to_string(entry.path().join(file))
                    .map(|said| said.trim().to_owned())
                    .unwrap_or_default()
            };
            Supply {
                kind: read("type"),
                own: read("scope") != "Device",
                online: read("online") == "1",
                capacity: read("capacity").parse().ok(),
                status: read("status"),
            }
        })
        .collect()
}

/// Whether one of `supplies` is the machine's own battery.
pub(crate) fn battery(supplies: &[Supply]) -> bool {
    supplies.iter().any(Supply::battery)
}

/// Whether the machine is on power, as its `supplies` say: one of its own
/// that is no battery, its charger or a USB-C port, is online, or it has
/// no battery at all. The hold reads it where UPower is not.
pub(crate) fn on_power(supplies: &[Supply]) -> bool {
    !battery(supplies)
        || (supplies.iter()).any(|supply| supply.own && supply.kind != "Battery" && supply.online)
}

/// The machine's own battery, as its `supplies` say it, with no time
/// left: two batteries as one, their charge the mean. None where it has
/// none, or none says its charge.
pub(crate) fn sysfs(supplies: &[Supply]) -> Option<Battery> {
    let batteries: Vec<_> = supplies.iter().filter(|supply| supply.battery()).collect();
    let charges: Vec<u32> = (batteries.iter())
        .filter_map(|battery| battery.capacity)
        .map(u32::from)
        .collect();
    let count = u32::try_from(charges.len())
        .ok()
        .filter(|count| *count > 0)?;
    let mean = (charges.iter().sum::<u32>() + count / 2) / count;
    let charging = batteries.iter().any(|battery| battery.status == "Charging");
    Some(Battery {
        percent: u8::try_from(mean.min(100)).unwrap_or(100),
        charging,
        on_power: on_power(supplies) || charging,
        left: None,
    })
}

#[cfg(target_os = "linux")]
pub(crate) use bus::{SUPPLIES, UPower, on_power_said};

#[cfg(target_os = "linux")]
mod bus {
    use super::{Device, supplies, sysfs, upower};
    use crate::power::{Battery, Source};
    use futures::StreamExt;
    use std::collections::HashMap;
    use std::path::Path;
    use std::time::Duration;
    use zbus::zvariant::OwnedValue;

    /// Where the kernel lists the machine's power supplies.
    pub(crate) const SUPPLIES: &str = "/sys/class/power_supply";

    const UPOWER: &str = "org.freedesktop.UPower";
    const UPOWER_PATH: &str = "/org/freedesktop/UPower";
    const DISPLAY: &str = "/org/freedesktop/UPower/devices/DisplayDevice";
    const PROPERTIES: &str = "org.freedesktop.DBus.Properties";

    /// How long the bus, and UPower on it, have to answer.
    const ASKING: Duration = Duration::from_secs(5);

    /// Reads the battery from UPower, on a system bus reached as a window
    /// first hears it and let go as the last stops; else from the kernel's
    /// power supplies.
    #[derive(Default)]
    pub(crate) struct UPower {
        bus: Option<zbus::Connection>,
        /// UPower's own properties as they change: its `OnBattery`.
        plugged: Option<zbus::MessageStream>,
    }

    impl UPower {
        /// The system bus, reached now if it is not yet, or if the one
        /// reached before went, with UPower's changes heard on it.
        async fn bus(&mut self) -> Option<zbus::Connection> {
            if self.bus.as_ref().is_some_and(zbus::Connection::is_closed) {
                self.rest();
            }
            if self.bus.is_none() {
                let reaching = async {
                    (zbus::connection::Builder::system()?.method_timeout(ASKING))
                        .build()
                        .await
                };
                match tokio::time::timeout(ASKING, reaching).await {
                    Ok(Ok(bus)) => {
                        self.plugged = plugged(&bus).await.ok();
                        self.bus = Some(bus);
                    }
                    Ok(Err(error)) => {
                        tracing::debug!(%error, "no system bus: the battery is read from sysfs");
                    }
                    Err(_) => tracing::debug!("the system bus did not answer in time"),
                }
            }
            self.bus.clone()
        }
    }

    #[async_trait::async_trait]
    impl Source for UPower {
        async fn read(&mut self) -> Option<Battery> {
            if let Some(bus) = self.bus().await {
                match device(&bus).await {
                    Ok(device) => return upower(&device),
                    // A bus that went is reached again at the next read.
                    Err(error) => {
                        tracing::debug!(%error, "no UPower: the battery is read from sysfs")
                    }
                }
            }
            sysfs(&supplies(Path::new(SUPPLIES)))
        }

        async fn changed(&mut self) {
            let Some(plugged) = &mut self.plugged else {
                return std::future::pending().await;
            };
            if plugged.next().await.is_none() {
                self.plugged = None;
                std::future::pending().await
            }
        }

        fn rest(&mut self) {
            self.plugged = None;
            self.bus = None;
        }
    }

    /// UPower's own properties as they change on `bus`: its `OnBattery` as
    /// the machine is plugged in or out.
    async fn plugged(bus: &zbus::Connection) -> zbus::Result<zbus::MessageStream> {
        let rule = zbus::MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .sender(UPOWER)?
            .path(UPOWER_PATH)?
            .interface(PROPERTIES)?
            .member("PropertiesChanged")?
            .build();
        zbus::MessageStream::for_match_rule(rule, bus, Some(4)).await
    }

    /// UPower's display device, and its `OnBattery`, as it says them now.
    pub(super) async fn device(bus: &zbus::Connection) -> zbus::Result<Device> {
        let reply = bus
            .call_method(
                Some(UPOWER),
                DISPLAY,
                Some(PROPERTIES),
                "GetAll",
                &("org.freedesktop.UPower.Device",),
            )
            .await?;
        let mut said: HashMap<String, OwnedValue> = reply.body().deserialize()?;
        Ok(Device {
            kind: take(&mut said, "Type")?,
            present: take(&mut said, "IsPresent")?,
            state: take(&mut said, "State")?,
            percentage: take(&mut said, "Percentage")?,
            to_empty: take(&mut said, "TimeToEmpty")?,
            to_full: take(&mut said, "TimeToFull")?,
            on_battery: !on_power_said(bus).await?,
        })
    }

    /// The property `name` of those UPower `said`, as a `T`.
    fn take<T>(said: &mut HashMap<String, OwnedValue>, name: &str) -> zbus::Result<T>
    where
        T: TryFrom<OwnedValue>,
        zbus::Error: From<T::Error>,
    {
        let value = (said.remove(name))
            .ok_or_else(|| zbus::Error::Failure(format!("UPower said no {name}")))?;
        Ok(T::try_from(value)?)
    }

    /// Whether UPower says the machine is on power, as the hold reads it
    /// too.
    pub(crate) async fn on_power_said(bus: &zbus::Connection) -> zbus::Result<bool> {
        let reply = bus
            .call_method(
                Some(UPOWER),
                UPOWER_PATH,
                Some(PROPERTIES),
                "Get",
                &(UPOWER, "OnBattery"),
            )
            .await?;
        let on_battery: OwnedValue = reply.body().deserialize()?;
        Ok(!bool::try_from(on_battery)?)
    }

    #[cfg(test)]
    mod tests {
        use super::super::{battery, on_power};
        use super::*;

        /// The real UPower, where this runs with one; it says why it skips
        /// where not, as on CI's runners.
        #[tokio::test]
        async fn upower_says_this_machine_s_battery_as_its_power_supplies_do() {
            let Ok(bus) = zbus::Connection::system().await else {
                eprintln!("skipped: no system bus here");
                return;
            };
            let device = match device(&bus).await {
                Ok(device) => device,
                Err(error) => {
                    eprintln!("skipped: no UPower here: {error}");
                    return;
                }
            };
            let said = upower(&device);
            let supplies = supplies(Path::new(SUPPLIES));
            assert_eq!(
                said.is_some(),
                battery(&supplies),
                "{device:?} {supplies:?}"
            );
            if let Some(said) = said {
                assert!(said.percent <= 100, "{said:?}");
                assert_eq!(
                    said.on_power,
                    on_power(&supplies),
                    "{device:?} {supplies:?}"
                );
            }
            // And the source reads the same, then rests.
            let mut source = UPower::default();
            assert_eq!(source.read().await.is_some(), said.is_some());
            assert!(source.plugged.is_some(), "UPower's changes are heard");
            source.rest();
            assert!(source.bus.is_none() && source.plugged.is_none());
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// What UPower said on arc, on battery, on 2026-11-09.
    pub(crate) const DISCHARGING: Device = Device {
        kind: 2,
        present: true,
        state: 2,
        percentage: 96.0,
        to_empty: 13176,
        to_full: 0,
        on_battery: true,
    };

    fn battery_of(percent: u8, charging: bool, on_power: bool, left: Option<u32>) -> Battery {
        Battery {
            percent,
            charging,
            on_power,
            left,
        }
    }

    #[test]
    fn upower_says_the_charge_the_state_and_the_time_left() {
        assert_eq!(
            upower(&DISCHARGING),
            Some(battery_of(96, false, false, Some(220)))
        );
        let charging = Device {
            state: 1,
            percentage: 67.0,
            to_empty: 0,
            to_full: 2880,
            on_battery: false,
            ..DISCHARGING
        };
        assert_eq!(
            upower(&charging),
            Some(battery_of(67, true, true, Some(48))),
            "to full"
        );
        let full = Device {
            state: 4,
            percentage: 100.0,
            to_empty: 0,
            on_battery: false,
            ..DISCHARGING
        };
        assert_eq!(upower(&full), Some(battery_of(100, false, true, None)));
        // A charge threshold holds it at 80%.
        let held = Device {
            state: 5,
            percentage: 80.0,
            on_battery: false,
            ..DISCHARGING
        };
        assert_eq!(upower(&held), Some(battery_of(80, false, true, None)));
    }

    #[test]
    fn a_time_upower_does_not_know_yet_is_left_out() {
        let unknown = Device {
            to_empty: 0,
            ..DISCHARGING
        };
        assert_eq!(upower(&unknown), Some(battery_of(96, false, false, None)));
        let charging = Device {
            state: 1,
            on_battery: false,
            to_full: 0,
            ..DISCHARGING
        };
        assert_eq!(upower(&charging), Some(battery_of(96, true, true, None)));
    }

    #[test]
    fn a_machine_upower_names_no_battery_of_has_none() {
        // A desktop, its mouse's battery left out of the display device.
        let none = Device {
            kind: 0,
            present: false,
            state: 0,
            percentage: 0.0,
            to_empty: 0,
            to_full: 0,
            on_battery: false,
        };
        assert_eq!(upower(&none), None);
        let ups = Device {
            kind: 3,
            ..DISCHARGING
        };
        assert_eq!(upower(&ups), None, "a UPS is not the machine's own");
        let gone = Device {
            present: false,
            ..DISCHARGING
        };
        assert_eq!(upower(&gone), None, "its battery taken out");
    }

    fn supply(kind: &str, own: bool, online: bool) -> Supply {
        Supply {
            kind: kind.to_owned(),
            own,
            online,
            ..Supply::default()
        }
    }

    fn battery_at(capacity: u8, status: &str) -> Supply {
        Supply {
            capacity: Some(capacity),
            status: status.to_owned(),
            ..supply("Battery", true, false)
        }
    }

    #[test]
    fn linux_s_power_supplies_say_the_charge_and_whether_it_charges_with_no_time_left() {
        let ac = |online| supply("Mains", true, online);
        let on_battery = [ac(false), battery_at(42, "Discharging")];
        assert_eq!(sysfs(&on_battery), Some(battery_of(42, false, false, None)));
        let charging = [ac(true), battery_at(67, "Charging")];
        assert_eq!(sysfs(&charging), Some(battery_of(67, true, true, None)));
        let held = [ac(true), battery_at(80, "Not charging")];
        assert_eq!(sysfs(&held), Some(battery_of(80, false, true, None)));
        // One that charges is on power, though no charger is listed.
        let bare = [battery_at(30, "Charging")];
        assert_eq!(sysfs(&bare), Some(battery_of(30, true, true, None)));
        // Two batteries, as some ThinkPads have: one charge.
        let two = [
            ac(false),
            battery_at(91, "Discharging"),
            battery_at(40, "Discharging"),
        ];
        assert_eq!(sysfs(&two), Some(battery_of(66, false, false, None)));
    }

    #[test]
    fn a_mouse_s_battery_is_no_machine_s_and_one_that_says_no_charge_says_nothing() {
        let mouse = Supply {
            own: false,
            ..battery_at(55, "Discharging")
        };
        let mouse = [mouse];
        assert_eq!(sysfs(&mouse), None);
        assert!(!battery(&mouse));
        assert_eq!(sysfs(&[]), None);
        let unread = Supply {
            capacity: None,
            ..battery_at(0, "Unknown")
        };
        assert_eq!(sysfs(&[unread]), None);
    }

    /// A machine's power supplies, in a folder of the test's.
    struct Supplies(tempfile::TempDir);

    impl Supplies {
        fn new() -> Supplies {
            Supplies(tempfile::tempdir().unwrap())
        }

        fn write(&self, path: &str, text: &str) -> &Supplies {
            let path = self.0.path().join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
            self
        }

        fn on_power(&self) -> bool {
            on_power(&supplies(self.0.path()))
        }
    }

    #[test]
    fn linux_s_power_supplies_are_read_as_sysfs_lists_them() {
        let laptop = Supplies::new();
        laptop
            .write("AC/type", "Mains\n")
            .write("AC/online", "0\n")
            .write("BAT0/type", "Battery\n")
            .write("BAT0/scope", "System\n")
            .write("BAT0/capacity", "42\n")
            .write("BAT0/status", "Discharging\n")
            .write("hidpp_battery_0/type", "Battery\n")
            .write("hidpp_battery_0/scope", "Device\n")
            .write("hidpp_battery_0/capacity", "100\n");
        let read = supplies(laptop.0.path());
        assert_eq!(sysfs(&read), Some(battery_of(42, false, false, None)));
        assert!(supplies(&laptop.0.path().join("none")).is_empty());
    }

    #[test]
    fn a_linux_is_on_power_by_its_charger_or_with_no_battery() {
        let laptop = Supplies::new();
        laptop
            .write("AC/type", "Mains\n")
            .write("AC/online", "1\n")
            .write("BAT0/type", "Battery\n")
            .write("BAT0/online", "1\n")
            .write("BAT0/scope", "System\n");
        assert!(laptop.on_power(), "its charger is in");
        laptop.write("AC/online", "0\n");
        assert!(!laptop.on_power(), "on battery");
        laptop
            .write("ucsi-source-psy-USBC000-001/type", "USB\n")
            .write("ucsi-source-psy-USBC000-001/online", "1\n");
        assert!(laptop.on_power(), "charged through USB-C");

        // A mouse's charger is not the machine's.
        let unplugged = Supplies::new();
        unplugged
            .write("BAT0/type", "Battery\n")
            .write("hidpp_battery_0/type", "Battery\n")
            .write("hidpp_battery_0/scope", "Device\n")
            .write("dock/type", "Mains\n")
            .write("dock/scope", "Device\n")
            .write("dock/online", "1\n");
        assert!(!unplugged.on_power());

        let desktop = Supplies::new();
        desktop
            .write("hidpp_battery_0/type", "Battery\n")
            .write("hidpp_battery_0/scope", "Device\n");
        assert!(desktop.on_power(), "no battery of its own");
        assert!(on_power(&[]), "no power_supply at all");
    }
}
