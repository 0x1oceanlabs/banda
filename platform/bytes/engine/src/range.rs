//! The one range of a file's bytes a `Range` header asks for, as the
//! window's byte host read it (`byteRange`, until step 4b relayed it
//! here): a start and an end, a start alone, or the last so many bytes.

/// The inclusive bounds `range` asks of a file of `size` bytes; none for a
/// range that is not one of those, or that the file cannot meet.
pub fn byte_range(range: &str, size: u64) -> Option<(u64, u64)> {
    let (from, to) = range.strip_prefix("bytes=")?.split_once('-')?;
    if size == 0 || !digits(from) || !digits(to) || (from.is_empty() && to.is_empty()) {
        return None;
    }
    let (start, end) = if from.is_empty() {
        (size.saturating_sub(number(to)), size - 1)
    } else if to.is_empty() {
        (number(from), size - 1)
    } else {
        (number(from), number(to).min(size - 1))
    };
    // The end is in the file, so a start past the end is past the file's.
    (start <= end).then_some((start, end))
}

/// Whether `text` is none or more ASCII digits.
fn digits(text: &str) -> bool {
    text.bytes().all(|byte| byte.is_ascii_digit())
}

/// The number ASCII digits say, or the most there is for one too large: a
/// start that large is past any file's end, and an end or a last so many
/// that large is the whole file.
fn number(digits: &str) -> u64 {
    digits.bytes().fold(0u64, |number, digit| {
        number
            .saturating_mul(10)
            .saturating_add(u64::from(digit - b'0'))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_take_suffixes_and_open_ends_and_refuse_ranges_invalid_or_unmet() {
        assert_eq!(byte_range("bytes=2-", 10), Some((2, 9)));
        assert_eq!(byte_range("bytes=-3", 10), Some((7, 9)));
        assert_eq!(byte_range("bytes=2-100", 10), Some((2, 9)));
        assert_eq!(byte_range("bytes=3-6", 10), Some((3, 6)));
        for range in [
            "bytes=10-",
            "bytes=-0",
            "bytes=3-2",
            "bytes=0-1,3-4",
            "bytes=-",
            "bytes=1e3-",
            "bytes= 1-2",
            "items=1-2",
        ] {
            assert_eq!(byte_range(range, 10), None, "{range}");
        }
        assert_eq!(byte_range("bytes=0-", 0), None);
    }

    #[test]
    fn a_number_too_large_is_past_the_end_as_a_start_and_the_whole_file_otherwise() {
        // 2^64 + 3, which would be 3 were it cut to 64 bits.
        let huge = "18446744073709551619";
        assert_eq!(byte_range(&format!("bytes={huge}-"), 10), None);
        assert_eq!(byte_range(&format!("bytes=0-{huge}"), 10), Some((0, 9)));
        assert_eq!(byte_range(&format!("bytes=-{huge}"), 10), Some((0, 9)));
    }
}
