//! The words a snooze's time is said in (ADR 0074, decisions 5 and 9), as
//! `sidebar.toml`'s `[snooze] presets` write them. The window reads them
//! against its clock (`app/web/src/sidebar/snooze-time.ts`); this only
//! checks that it can, so `banda look check` names a preset it cannot.

/// Banda's presets: T3 Code's defaults, in the field's own words.
pub const PRESETS: [&str; 5] = ["1h", "3h", "18:00", "tomorrow 9:00", "mon 9:00"];

/// How many presets the picker lists at most.
pub const MOST: usize = 8;

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
    let words = match &all[..] {
        ["in" | "через" | "в" | "до", rest @ ..] if !rest.is_empty() => rest,
        all => all,
    };
    if WEEK.contains(&words.join(" ").as_str()) {
        return true;
    }
    match words {
        [one] => run_together(one) || time_of(one) || DAYS.contains(one),
        [a, b] => (number_of(a) && unit_of(b)) || (DAYS.contains(a) && time_of(b)),
        [day, "at" | "в", time] => DAYS.contains(day) && time_of(time),
        _ => false,
    }
}

/// `45m`, `2h`, `1.5d`: a while, its number and unit run together.
fn run_together(word: &str) -> bool {
    word.find(|c: char| !(c.is_ascii_digit() || c == '.' || c == ','))
        .is_some_and(|at| {
            let (number, unit) = word.split_at(at);
            number_of(number) && unit_of(unit)
        })
}

/// A number above none: `2`, `1.5`, `1,5`.
fn number_of(text: &str) -> bool {
    text.replace(',', ".").parse::<f64>().is_ok_and(|n| n > 0.0)
}

fn unit_of(word: &str) -> bool {
    UNITS.iter().any(|unit| unit.contains(&word))
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

    /// The words the window's field tests too: `look/snooze-words.json`.
    #[derive(serde::Deserialize)]
    struct Words {
        reads: Vec<String>,
        unread: Vec<String>,
    }

    #[test]
    fn it_reads_what_the_field_reads_and_no_more() {
        let words: Words = serde_json::from_str(include_str!("../snooze-words.json")).unwrap();
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
}
