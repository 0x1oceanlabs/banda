//! The words a Later's time is said in (ADR 0074, decisions 5 and 9), as
//! `sidebar.toml`'s `[later] presets` write them. The window reads them
//! against its clock (`client/web/src/sidebar/later-time.ts`); this checks
//! that it can, so `banda look check` names a preset it cannot, and says
//! how long a while lasts, for an Agent's Later and the CLI's.

/// Banda's presets: T3 Code's defaults, in the field's own words.
pub const PRESETS: [&str; 5] = ["1h", "3h", "18:00", "tomorrow 9:00", "mon 9:00"];

/// How many presets the picker lists at most.
pub const MOST: usize = 8;

/// A minute, an hour and a day, in milliseconds: `UNITS`' order.
const UNIT_MS: [i64; 3] = [60_000, 3_600_000, 86_400_000];

/// The longest a Later lasts, in milliseconds: a year. The field reads
/// no longer while, and the engine takes no later moment.
pub const LONGEST: i64 = 365 * 86_400_000;

const UNITS: [&[&str]; 3] = [
    &[
        "m",
        "min",
        "mins",
        "minute",
        "minutes",
        "м",
        "мин",
        "минут",
        "минута",
        "минуты",
    ],
    &[
        "h",
        "hr",
        "hrs",
        "hour",
        "hours",
        "ч",
        "час",
        "часа",
        "часов",
    ],
    &["d", "day", "days", "д", "дн", "дня", "дней", "день"],
];

/// Today, tomorrow, and the weekdays, in English and Russian.
const DAYS: [&str; 36] = [
    "today",
    "сегодня",
    "tomorrow",
    "tmr",
    "завтра",
    "sun",
    "sunday",
    "вс",
    "воскресенье",
    "mon",
    "monday",
    "пн",
    "понедельник",
    "tue",
    "tuesday",
    "вт",
    "вторник",
    "wed",
    "wednesday",
    "ср",
    "среда",
    "среду",
    "thu",
    "thursday",
    "чт",
    "четверг",
    "fri",
    "friday",
    "пт",
    "пятница",
    "пятницу",
    "sat",
    "saturday",
    "сб",
    "суббота",
    "субботу",
];

/// Next week: Monday at nine.
const WEEK: [&str; 5] = ["next week", "week", "через неделю", "неделя", "неделю"];

/// Whether `text` says a time as the picker's field reads it: a while
/// (`45m`, `2 h`, `1.5d`), a time alone (`18`, `18:30`), or a day and its
/// time (`tomorrow 10`, `fri`, `пт в 14`, `next week`).
pub fn reads(text: &str) -> bool {
    let lower = text.trim().to_lowercase();
    let all: Vec<&str> = lower.split_whitespace().collect();
    let words = said(&all);
    if WEEK.contains(&words.join(" ").as_str()) || while_of(text).is_some() {
        return true;
    }
    match words {
        [one] => time_of(one) || DAYS.contains(one),
        [day, time] => DAYS.contains(day) && time_of(time),
        [day, "at" | "в", time] => DAYS.contains(day) && time_of(time),
        _ => false,
    }
}

/// How long a while in the field's words lasts, in milliseconds: `45m`,
/// `2 h`, `1.5d`, `in 2 hours`, `через 3 часа`, up to a year. Nothing
/// for what is no while, as `fri` or `18:00`, whose moment needs the
/// Person's clock, nor for a while longer than [`LONGEST`].
pub fn while_of(text: &str) -> Option<i64> {
    let lower = text.trim().to_lowercase();
    let all: Vec<&str> = lower.split_whitespace().collect();
    let (number, word) = match said(&all) {
        [one] => one.split_at(one.find(|c: char| !(c.is_ascii_digit() || c == '.' || c == ','))?),
        [number, word] => (*number, *word),
        _ => return None,
    };
    let unit = UNITS.iter().position(|unit| unit.contains(&word))?;
    let ms = number_of(number)? * UNIT_MS[unit] as f64;
    (ms > 0.0 && ms <= LONGEST as f64).then(|| ms.round() as i64)
}

/// `2`, `1.5`, `1,5`: digits, then a point or a comma and digits, as the
/// field reads a number. Never `inf`, `1e9`, `.5` or `5.`.
fn number_of(text: &str) -> Option<f64> {
    let (whole, part) = text.split_once(['.', ',']).unwrap_or((text, "0"));
    let digits = |text: &str| !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit());
    if !(digits(whole) && digits(part)) {
        return None;
    }
    // Digits alone, so only too many of them make it endless.
    format!("{whole}.{part}")
        .parse::<f64>()
        .ok()
        .filter(|n| n.is_finite())
}

/// The words without the one that leads into a time: `in`, `через`.
fn said<'a>(all: &'a [&'a str]) -> &'a [&'a str] {
    match all {
        ["in" | "через" | "в" | "до", rest @ ..] if !rest.is_empty() => rest,
        all => all,
    }
}

/// `9`, `9:30`, `18.30`: an hour of the day, and its minute in two digits.
fn time_of(word: &str) -> bool {
    let below = |text: &str, most: u32| {
        (1..=2).contains(&text.len()) && text.parse::<u32>().is_ok_and(|n| n <= most)
    };
    match word.split_once([':', '.']) {
        None => below(word, 23),
        Some((hour, minute)) => below(hour, 23) && minute.len() == 2 && below(minute, 59),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The words the window's field tests too: `platform/look/later-words.json`.
    #[derive(serde::Deserialize)]
    struct Words {
        reads: Vec<String>,
        unread: Vec<String>,
    }

    #[test]
    fn it_reads_what_the_field_reads_and_no_more() {
        let words: Words = serde_json::from_str(include_str!("../later-words.json")).unwrap();
        for text in &words.reads {
            assert!(reads(text), "{text}");
        }
        for text in &words.unread {
            assert!(!reads(text), "{text}");
        }
        for preset in PRESETS {
            assert!(reads(preset), "{preset}");
        }
    }

    #[test]
    fn a_while_is_how_long_and_a_day_is_none() {
        assert_eq!(while_of("45m"), Some(45 * 60_000));
        assert_eq!(while_of("in 2 hours"), Some(7_200_000));
        assert_eq!(while_of("1.5d"), Some(129_600_000));
        assert_eq!(while_of("через 3 часа"), Some(10_800_000));
        assert_eq!(while_of("365d"), Some(LONGEST));
        for text in ["fri", "18:00", "soon", "0h", "2 weeks"] {
            assert_eq!(while_of(text), None, "{text}");
        }
        // Only the field's numbers, and never past a year: none of these
        // may overflow the moment it ends at.
        for text in [
            "inf h",
            "infd",
            "NaN m",
            "1e300 d",
            "1e3m",
            ".5h",
            "5.h",
            "1.2.3h",
            "-1h",
            "+1h",
            "366d",
            "99999999999999999999d",
        ] {
            assert_eq!(while_of(text), None, "{text}");
        }
        let endless = format!("{}d", "9".repeat(400));
        assert_eq!(while_of(&endless), None);
    }
}
