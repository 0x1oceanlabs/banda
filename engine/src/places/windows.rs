//! The places on Windows (ADR 0090, decision 3). A folder takes the access
//! list of the folder it is made in. In the Person's profile that list
//! keeps it to the Person, SYSTEM and the admins, and it is what keeps the
//! owner's secret in `engine.json` to the Person, as Banda sets no list of
//! its own. Elsewhere, as in `C:\banda`, the Users group could read it. So
//! a variable moves the data, the state, the config or the cache only
//! within the profile. The root may be anywhere: it only says where a new
//! Project's folder goes, and a Project's folder may be anywhere.

use super::Places;
use crate::Failure;
use banda_kernel::{Reach, host};
use std::path::{Path, PathBuf};

/// The data, state, config and cache places when no variable moves them:
/// a folder of each in Banda's `folder` in `local`, `%LOCALAPPDATA%`, and
/// none in Roaming, which a company's roaming profile copies to other
/// machines. The window finds the same (`engine/tests/windows-places.json`
/// holds both).
pub fn defaults_in(local: &Path, folder: &str) -> [PathBuf; 4] {
    ["data", "state", "config", "cache"].map(|name| local.join(folder).join(name))
}

/// Refuses `places` when a variable moved one of them out of the Person's
/// profile, as `moved` says of each variable, and says which, and why.
pub fn in_the_profile(places: &Places, moved: impl Fn(&str) -> bool) -> Result<(), Failure> {
    let profile =
        dirs::home_dir().ok_or_else(|| Failure::broken("This user has no profile folder."))?;
    let profile = real(&profile);
    // The root is the first, and may be anywhere.
    let mut kept = places.variables().into_iter().skip(1);
    let outside = |(variable, place): &(&str, &Path)| {
        moved(variable) && !host::within(&real(place), &profile)
    };
    match kept.find(outside) {
        Some((variable, place)) => Err(Failure::broken(said(variable, place, &profile))),
        None => Ok(()),
    }
}

/// Why `variable` cannot move its place to `place`, outside `profile`.
fn said(variable: &str, place: &Path, profile: &Path) -> String {
    format!(
        "{variable} names {}, which is outside your profile {}. Banda keeps its things only in \
         your profile, whose access list keeps them to you: choose a folder in it.",
        place.display(),
        profile.display()
    )
}

/// `path` as the system reads it: whole, its `..` read by the names before
/// it, as Windows reads them, there or not; then through its links and
/// short names as far as it is there, as the path guard reads one
/// ([`Reach`]).
fn real(path: &Path) -> PathBuf {
    let whole = std::path::absolute(path).unwrap_or_else(|_| path.to_owned());
    let here = std::env::current_dir().unwrap_or_default();
    Reach::resolve(&here, &whole, false).map_or(whole, Reach::into_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn places(under: &Path) -> Places {
        Places::under(under)
    }

    fn refused(places: &Places) -> String {
        in_the_profile(places, |_| true)
            .err()
            .map(Failure::words)
            .unwrap_or_default()
    }

    #[test]
    fn the_places_are_in_banda_s_folder_in_local_app_data_as_the_window_finds_them() {
        let text = include_str!("../../tests/windows-places.json");
        let fixture: serde_json::Value = serde_json::from_str(text).unwrap();
        let text = |at: &str| {
            fixture
                .pointer(at)
                .and_then(|v| v.as_str())
                .unwrap()
                .to_owned()
        };
        let found = defaults_in(Path::new(&text("/local")), &text("/folder"));
        let named = ["data", "state", "config", "cache"]
            .map(|name| PathBuf::from(text(&format!("/places/{name}"))));
        assert_eq!(found, named);
        let local = dirs::data_local_dir().unwrap();
        let ours = defaults_in(&local, super::super::FOLDER).map(Some);
        assert_eq!(super::super::defaults(), ours);
    }

    #[test]
    fn places_in_the_profile_are_taken() {
        let profile = dirs::home_dir().unwrap();
        let folder = tempfile::tempdir_in(&profile).unwrap();
        assert!(in_the_profile(&places(folder.path()), |_| true).is_ok());
        // Named in another case, or not made yet.
        let shouted = PathBuf::from(folder.path().display().to_string().to_uppercase());
        let not_yet = places(&shouted.join("not").join("yet"));
        assert!(in_the_profile(&not_yet, |_| true).is_ok());
        // Through a short name, as a runner's TEMP names its profile.
        let temporary = tempfile::tempdir().unwrap();
        assert!(in_the_profile(&places(temporary.path()), |_| true).is_ok());
    }

    #[test]
    fn a_place_a_variable_moves_outside_the_profile_is_refused_and_says_why() {
        let profile = dirs::home_dir().unwrap();
        let drive = profile.ancestors().last().unwrap().to_owned();
        let mut moved = places(&profile.join("banda-test"));
        moved.state = drive.join("banda");
        let said = refused(&moved);
        assert!(said.starts_with("BANDA_STATE names"), "{said}");
        assert!(said.contains("outside your profile"), "{said}");
        // Where no variable moved it, it is the system's to say.
        let unmoved = |variable: &str| variable != "BANDA_STATE";
        assert!(in_the_profile(&moved, unmoved).is_ok());
        // `..` leads out of it as well.
        let mut moved = places(&profile.join("banda-test"));
        moved.cache = profile.join("..").join("..").join("banda");
        let said = refused(&moved);
        assert!(said.starts_with("BANDA_CACHE names"), "{said}");
        // The root may be anywhere.
        let mut moved = places(&profile.join("banda-test"));
        moved.root = drive.join("Projects");
        assert!(in_the_profile(&moved, |_| true).is_ok());
    }
}
