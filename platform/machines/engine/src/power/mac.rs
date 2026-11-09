//! A Mac's battery, as `pmset -g batt` says it: on its first line where
//! the Mac draws from, then a line for its own battery, a tab (`\t`)
//! after its name.
//!
//! ```text
//! Now drawing from 'Battery Power'
//!  -InternalBattery-0 (id=4653155)\t42%; discharging; 2:02 remaining present: true
//! ```
//!
//! Its state is `discharging`, `charging`, `finishing charge`, `charged`,
//! or `AC attached; not charging`, as Optimized Battery Charging holds it
//! at 80%. Its time is `H:MM remaining`, or `(no estimate)` while macOS
//! does not know it yet.

use super::{Battery, left};

/// Reads the Mac's battery with `pmset`, as Banda reads it to find one.
#[cfg(target_os = "macos")]
pub(crate) struct Pmset;

#[cfg(target_os = "macos")]
#[async_trait::async_trait]
impl super::Source for Pmset {
    async fn read(&mut self) -> Option<Battery> {
        let said = crate::found::said("pmset", &["-g", "batt"]).await?;
        battery(&said)
    }
}

/// Whether a Mac is on power, as `pmset -g batt` says on its first line:
/// `Now drawing from 'AC Power'`, or `'Battery Power'`. A Mac with no
/// battery draws from AC; what does not read so is on power.
pub(crate) fn on_power(power: &str) -> bool {
    let first = power.lines().next().unwrap_or_default();
    !first.contains("'Battery Power'")
}

/// The Mac's own battery, as `pmset -g batt` says it; none where it names
/// none, as a Mac mini, or only a UPS.
pub(crate) fn battery(power: &str) -> Option<Battery> {
    let line = power
        .lines()
        .find(|line| line.contains("InternalBattery"))?;
    if line.contains("present: false") {
        return None;
    }
    let (before, after) = line.split_once('%')?;
    let digits = before.rsplit(|c: char| !c.is_ascii_digit()).next()?;
    let percent = digits.parse::<u8>().ok()?.min(100);
    let mut said = after
        .split(';')
        .map(str::trim)
        .filter(|said| !said.is_empty());
    let state = said.next()?;
    let charging = matches!(state, "charging" | "finishing charge");
    let on_power = on_power(power);
    let time = said.find_map(remaining);
    Some(Battery {
        percent,
        charging,
        on_power,
        left: left(charging, on_power, time, time),
    })
}

/// The minutes in `H:MM remaining`; none for `(no estimate)`, or for
/// `0:00`, as pmset says of a charged battery.
fn remaining(said: &str) -> Option<u32> {
    let (time, _) = said.split_once(" remaining")?;
    let (hours, minutes) = time.trim().rsplit(' ').next()?.split_once(':')?;
    let minutes = hours.parse::<u32>().ok()? * 60 + minutes.parse::<u32>().ok()?;
    (minutes > 0).then_some(minutes)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What `pmset -g batt` said on m1pro, a MacBookPro18,3, and others.
    const DISCHARGING: &str = "Now drawing from 'Battery Power'
 -InternalBattery-0 (id=4653155)\t42%; discharging; 2:02 remaining present: true";
    const CHARGING: &str = "Now drawing from 'AC Power'
 -InternalBattery-0 (id=4653155)\t67%; charging; 0:48 remaining present: true";
    const FINISHING: &str = "Now drawing from 'AC Power'
 -InternalBattery-0 (id=4653155)\t98%; finishing charge; 0:07 remaining present: true";
    const CHARGED: &str = "Now drawing from 'AC Power'
 -InternalBattery-0 (id=4653155)\t100%; charged; 0:00 remaining present: true";
    const HELD_AT_80: &str = "Now drawing from 'AC Power'
 -InternalBattery-0 (id=4653155)\t80%; AC attached; not charging present: true";
    const NO_ESTIMATE: &str = "Now drawing from 'Battery Power'
 -InternalBattery-0 (id=4653155)\t98%; discharging; (no estimate) present: true";
    const CHARGING_NO_ESTIMATE: &str = "Now drawing from 'AC Power'
 -InternalBattery-0 (id=4653155)\t23%; charging; (no estimate) present: true";
    /// A Mac mini.
    const DESKTOP: &str = "Now drawing from 'AC Power'";
    /// A Mac mini on a UPS, which is no battery of its own.
    const ON_A_UPS: &str = "Now drawing from 'AC Power'
 -Back-UPS ES 700G FW:871.O2 .I USB FW:O2  (id=7864320)\t100%; AC attached; not charging present: true";

    fn battery_of(percent: u8, charging: bool, on_power: bool, left: Option<u32>) -> Battery {
        Battery {
            percent,
            charging,
            on_power,
            left,
        }
    }

    #[test]
    fn pmset_says_the_charge_the_state_and_the_time_left() {
        assert_eq!(
            battery(DISCHARGING),
            Some(battery_of(42, false, false, Some(122)))
        );
        assert_eq!(
            battery(CHARGING),
            Some(battery_of(67, true, true, Some(48))),
            "to full"
        );
        assert_eq!(
            battery(FINISHING),
            Some(battery_of(98, true, true, Some(7)))
        );
        assert_eq!(battery(CHARGED), Some(battery_of(100, false, true, None)));
    }

    #[test]
    fn ac_attached_and_not_charging_is_on_power_and_not_charging() {
        assert_eq!(battery(HELD_AT_80), Some(battery_of(80, false, true, None)));
    }

    #[test]
    fn a_time_macos_does_not_know_yet_is_left_out() {
        assert_eq!(
            battery(NO_ESTIMATE),
            Some(battery_of(98, false, false, None))
        );
        assert_eq!(
            battery(CHARGING_NO_ESTIMATE),
            Some(battery_of(23, true, true, None))
        );
    }

    #[test]
    fn a_mac_with_no_battery_of_its_own_says_none() {
        assert_eq!(battery(DESKTOP), None);
        assert_eq!(battery(ON_A_UPS), None, "a UPS is not the Mac's");
        assert_eq!(battery(""), None, "pmset said nothing");
        let gone = DISCHARGING.replace("present: true", "present: false");
        assert_eq!(battery(&gone), None, "its battery taken out");
        assert_eq!(
            battery("Now drawing from 'AC Power'\n -InternalBattery-0"),
            None
        );
    }

    #[test]
    fn a_mac_is_on_power_unless_pmset_says_it_draws_from_its_battery() {
        assert!(on_power(HELD_AT_80));
        assert!(on_power(CHARGED));
        assert!(!on_power(DISCHARGING));
        assert!(!on_power(NO_ESTIMATE));
        assert!(on_power(DESKTOP), "a Mac mini");
        assert!(on_power(""), "pmset said nothing");
    }
}
