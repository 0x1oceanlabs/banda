//! macOS holds a machine awake with one IOKit power assertion of type
//! `PreventUserIdleSystemSleep`, as `caffeinate -i` makes. Any process may
//! hold one, started by launchd or over ssh, with no entitlement. It is
//! named "Banda: " and why, as `pmset -g assertions` and Activity
//! Monitor's "Preventing Sleep" show it, and macOS lets it go as the
//! engine ends, however it ends. Whether the Mac is on power `pmset -g
//! batt` says, as Banda reads it to find a battery.
//!
//! The bindings are objc2's, which sysinfo builds already: the one call
//! that needs unsafe code is [`Assertion::take`].

use super::{System, Taken, Why};
use objc2_core_foundation::CFString;
use objc2_io_kit::{
    IOPMAssertionCreateWithName, IOPMAssertionID, IOPMAssertionRelease, IOReturn,
    kIOPMAssertionLevelOn, kIOReturnSuccess,
};

/// The system's own: one assertion at a time.
#[derive(Default)]
pub(super) struct Assertions {
    /// Whether a refusal was said in the log already, so it is said once.
    told: bool,
}

#[async_trait::async_trait]
impl System for Assertions {
    /// The assertion, unless macOS refused it.
    type Held = Option<Assertion>;

    /// macOS answers at once, in this process: what it does not grant it
    /// refused, so no hold is short.
    async fn take(&mut self, why: Why) -> Taken<Option<Assertion>> {
        let name = format!("Banda: {}", why.words());
        let held = match Assertion::take(&name) {
            Ok(assertion) => Some(assertion),
            Err(refused) => {
                if !std::mem::replace(&mut self.told, true) {
                    tracing::warn!(
                        refused,
                        "macOS refused a power assertion: the Mac may idle-sleep while Agents work"
                    );
                }
                None
            }
        };
        Taken { held, short: false }
    }

    async fn on_power(&mut self) -> bool {
        let said = crate::found::said("pmset", &["-g", "batt"]).await;
        said.is_none_or(|said| crate::found::mac::on_power(&said))
    }
}

/// One power assertion that keeps the Mac from idle sleep, released as it
/// drops.
#[derive(Debug)]
pub(super) struct Assertion(IOPMAssertionID);

impl Assertion {
    /// Takes one, named `name`; what IOKit returned, when it refused.
    #[allow(unsafe_code)]
    fn take(name: &str) -> Result<Assertion, IOReturn> {
        let kind = CFString::from_static_str("PreventUserIdleSystemSleep");
        let name = CFString::from_str(name);
        let mut id: IOPMAssertionID = 0;
        // SAFETY: both strings are CFStrings that outlive the call, and
        // `id` is a place of the assertion ID's own type, which it writes.
        let done = unsafe {
            IOPMAssertionCreateWithName(Some(&*kind), kIOPMAssertionLevelOn, Some(&*name), &mut id)
        };
        if done == kIOReturnSuccess {
            Ok(Assertion(id))
        } else {
            Err(done)
        }
    }
}

impl Drop for Assertion {
    fn drop(&mut self) {
        let done = IOPMAssertionRelease(self.0);
        if done != kIOReturnSuccess {
            tracing::warn!(done, "a power assertion was not released");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What `pmset -g assertions` says of this process's assertions
    /// named `name`.
    async fn listed(name: &str) -> Vec<String> {
        let said = tokio::process::Command::new("pmset")
            .args(["-g", "assertions"])
            .output()
            .await
            .unwrap();
        let ours = format!("pid {}(", std::process::id());
        let named = format!("named: \"{name}\"");
        (String::from_utf8_lossy(&said.stdout).lines())
            .filter(|line| line.contains(&ours) && line.contains(&named))
            .map(str::to_owned)
            .collect()
    }

    #[tokio::test]
    async fn pmset_lists_banda_s_assertion_while_it_is_held_and_not_after() {
        let mut assertions = Assertions::default();
        let taken = assertions.take(Why::Working).await;
        assert!(!taken.short);
        let held = taken.held;
        assert!(held.is_some(), "macOS grants any process one");
        let listed_now = listed("Banda: Agents work").await;
        assert_eq!(listed_now.len(), 1, "{listed_now:?}");
        assert!(
            listed_now[0].contains("PreventUserIdleSystemSleep"),
            "{listed_now:?}"
        );

        drop(held);
        for _ in 0..200 {
            if listed("Banda: Agents work").await.is_empty() {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        panic!(
            "pmset still lists it: {:?}",
            listed("Banda: Agents work").await
        );
    }
}
