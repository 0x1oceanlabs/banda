//! Banda's sounds, as the look sets them (ADR 0009, decision 5): `[sound]`
//! in `look.toml` and in a theme's `banda.toml`, layered as every other
//! key of the look. The window plays them; here they are only chosen.

use schemars::JsonSchema;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use ts_rs::TS;

/// A family of Banda's sounds; each plays every call its own way.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "look/")]
pub enum Family {
    Banda,
    Glass,
    Wood,
    Pop,
    Pluck,
}

impl Family {
    pub const ALL: [(&'static str, Family); 5] = [
        ("banda", Family::Banda),
        ("glass", Family::Glass),
        ("wood", Family::Wood),
        ("pop", Family::Pop),
        ("pluck", Family::Pluck),
    ];

    fn named(name: &str) -> Option<Family> {
        Family::ALL
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, family)| *family)
    }

    fn names() -> String {
        Family::ALL
            .iter()
            .map(|(name, _)| format!("\"{name}\""))
            .collect::<Vec<_>>()
            .join(", ")
    }
}

/// The family every call comes from, or `off` for silence.
#[derive(Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(
    export,
    export_to = "look/",
    type = "\"banda\" | \"glass\" | \"wood\" | \"pop\" | \"pluck\" | \"off\""
)]
pub enum Families {
    Off,
    One(Family),
}

/// One call: on, off, or a family to borrow this one sound from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS, JsonSchema)]
#[serde(untagged)]
#[ts(export, export_to = "look/")]
pub enum Call {
    On(bool),
    From(Family),
}

impl JsonSchema for Families {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        "Families".into()
    }

    fn json_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
        let names: Vec<&str> = Family::ALL.iter().map(|(name, _)| *name).collect();
        let names = [names, vec!["off"]].concat();
        schemars::json_schema!({
            "description": "The family every call comes from, or `off` for silence.",
            "enum": names,
        })
    }
}

impl TryFrom<toml::Value> for Families {
    type Error = String;

    fn try_from(value: toml::Value) -> Result<Families, String> {
        let wrong = || format!("a family is one of {}, or \"off\"", Family::names());
        match value {
            toml::Value::String(name) if name == "off" => Ok(Families::Off),
            toml::Value::String(name) => Family::named(&name)
                .map(Families::One)
                .ok_or_else(|| format!("\"{name}\" is no family; {}", wrong())),
            _ => Err(wrong()),
        }
    }
}

impl Serialize for Families {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Families::Off => serializer.serialize_str("off"),
            Families::One(family) => family.serialize(serializer),
        }
    }
}

/// Reads a value as TOML gave it, then as `T` says, so a wrong one is
/// named with what is right.
pub(crate) fn from_toml<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: TryFrom<toml::Value, Error = String>,
{
    let value = toml::Value::deserialize(deserializer)?;
    T::try_from(value).map_err(serde::de::Error::custom)
}

impl<'de> Deserialize<'de> for Families {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Families, D::Error> {
        from_toml(deserializer)
    }
}

impl<'de> Deserialize<'de> for Call {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Call, D::Error> {
        from_toml(deserializer)
    }
}

impl TryFrom<toml::Value> for Call {
    type Error = String;

    fn try_from(value: toml::Value) -> Result<Call, String> {
        let wrong = || {
            format!(
                "a call is true, false, or a family to borrow its sound from: {}",
                Family::names()
            )
        };
        match value {
            toml::Value::Boolean(on) => Ok(Call::On(on)),
            toml::Value::String(name) => Family::named(&name)
                .map(Call::From)
                .ok_or_else(|| format!("\"{name}\" is no family; {}", wrong())),
            _ => Err(wrong()),
        }
    }
}

/// `[sound]` as one layer says it: every key optional.
#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct SoundSettings {
    pub family: Option<Families>,
    /// 0 to 1, for every sound.
    #[schemars(range(min = 0, max = 1))]
    pub volume: Option<f64>,
    /// A soft room around each sound.
    pub room: Option<bool>,
    pub done: Option<Call>,
    pub asking: Option<Call>,
    pub failed: Option<Call>,
}

/// The sounds the window plays, every key resolved.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, TS)]
#[ts(export, export_to = "look/")]
pub struct Sound {
    pub family: Families,
    pub volume: f64,
    pub room: bool,
    /// A Thread finished while the Person was away.
    pub done: Call,
    /// A Question waits.
    pub asking: Call,
    /// A turn failed.
    pub failed: Call,
}

impl SoundSettings {
    /// `self` laid over `under`: what `self` says wins, key by key.
    pub fn over(self, under: SoundSettings) -> SoundSettings {
        SoundSettings {
            family: self.family.or(under.family),
            volume: self.volume.or(under.volume),
            room: self.room.or(under.room),
            done: self.done.or(under.done),
            asking: self.asking.or(under.asking),
            failed: self.failed.or(under.failed),
        }
    }

    /// Banda's own: the `banda` family, every call on, a soft room.
    pub fn defaults() -> SoundSettings {
        SoundSettings {
            family: Some(Families::One(Family::Banda)),
            volume: Some(0.6),
            room: Some(true),
            done: Some(Call::On(true)),
            asking: Some(Call::On(true)),
            failed: Some(Call::On(true)),
        }
    }

    /// A volume TOML takes, but no speaker does.
    pub fn volume_wrong(&self) -> bool {
        self.volume
            .is_some_and(|v| !(v.is_finite() && (0.0..=1.0).contains(&v)))
    }

    /// The sounds, from layers laid over the defaults; a key still missing
    /// takes the default's.
    pub fn resolved(&self) -> Sound {
        let all = self.clone().over(SoundSettings::defaults());
        let on = Call::On(true);
        Sound {
            family: all.family.unwrap_or(Families::One(Family::Banda)),
            volume: all
                .volume
                .filter(|v| (0.0..=1.0).contains(v))
                .unwrap_or(0.6),
            room: all.room.unwrap_or(true),
            done: all.done.unwrap_or(on),
            asking: all.asking.unwrap_or(on),
            failed: all.failed.unwrap_or(on),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sound(text: &str) -> Result<SoundSettings, toml::de::Error> {
        toml::from_str(text)
    }

    #[test]
    fn the_defaults_play_bandas_own() {
        let sound = SoundSettings::default().resolved();
        assert_eq!(sound.family, Families::One(Family::Banda));
        assert_eq!(sound.volume, 0.6);
        assert!(sound.room);
        assert_eq!(sound.asking, Call::On(true));
    }

    #[test]
    fn a_layer_changes_only_what_it_says() {
        let mine = sound("volume = 0.3\nasking = \"wood\"\n").unwrap();
        let theirs = sound("family = \"glass\"\nvolume = 0.9\n").unwrap();
        let sound = mine.over(theirs).resolved();
        assert_eq!(sound.family, Families::One(Family::Glass));
        assert_eq!(sound.volume, 0.3);
        assert_eq!(sound.asking, Call::From(Family::Wood));
        assert_eq!(sound.done, Call::On(true));
    }

    #[test]
    fn off_silences_and_false_silences_one_call() {
        let off = sound("family = \"off\"\nfailed = false\n").unwrap();
        let sound = off.resolved();
        assert_eq!(sound.family, Families::Off);
        assert_eq!(sound.failed, Call::On(false));
    }

    #[test]
    fn a_wrong_family_names_the_right_ones() {
        let wrong = sound("family = \"bell\"\n").unwrap_err();
        assert!(wrong.message().contains("\"bell\" is no family"), "{wrong}");
        assert!(wrong.message().contains("\"pluck\""), "{wrong}");
        let wrong = sound("done = 3\n").unwrap_err();
        assert!(
            wrong.message().contains("true, false, or a family"),
            "{wrong}"
        );
        let typo = sound("volumes = 1\n").unwrap_err();
        assert!(typo.message().contains("volumes"), "{typo}");
    }

    #[test]
    fn a_volume_is_from_0_to_1() {
        assert!(sound("volume = 1.5\n").unwrap().volume_wrong());
        assert!(!sound("volume = 0\n").unwrap().volume_wrong());
        assert_eq!(sound("volume = 1.5\n").unwrap().resolved().volume, 0.6);
    }

    #[test]
    fn the_window_reads_it_as_the_ui_names_it() {
        let sound = sound("family = \"pop\"\ndone = false\nasking = \"wood\"\n")
            .unwrap()
            .resolved();
        let json = serde_json::to_value(sound).unwrap();
        assert_eq!(json["family"], "pop");
        assert_eq!(json["done"], false);
        assert_eq!(json["asking"], "wood");
        assert_eq!(json["failed"], true);
    }
}
