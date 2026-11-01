//! What a terminal printed, kept in memory and bounded, so a window that
//! opens it later, or comes back after a reconnect, starts from the same
//! screen.

use std::collections::VecDeque;

/// How much of what a terminal printed it keeps.
pub const KEEPS: usize = 2 * 1024 * 1024;

/// Pieces of output in order, each with its number; the oldest go first
/// once they take more than [`KEEPS`] bytes.
#[derive(Default)]
pub struct History {
    pieces: VecDeque<(u64, String)>,
    bytes: usize,
    /// The number of the next piece.
    next: u64,
}

/// What a window has not heard yet.
pub enum Since {
    /// The pieces after the one it heard last.
    Pieces(Vec<String>),
    /// What it heard last is gone: it needs everything kept again.
    Gone,
}

impl History {
    pub fn add(&mut self, text: String) {
        self.bytes += text.len();
        self.pieces.push_back((self.next, text));
        self.next += 1;
        while self.bytes > KEEPS && self.pieces.len() > 1 {
            if let Some((_, old)) = self.pieces.pop_front() {
                self.bytes -= old.len();
            }
        }
    }

    /// The number the next piece gets: a window that heard up to here has
    /// heard everything.
    pub fn next(&self) -> u64 {
        self.next
    }

    /// Everything kept, as one text.
    pub fn all(&self) -> String {
        self.pieces.iter().map(|(_, text)| text.as_str()).collect()
    }

    /// What came from `from` on.
    pub fn since(&self, from: u64) -> Since {
        match self.pieces.front() {
            Some((first, _)) if *first > from => Since::Gone,
            _ => Since::Pieces(
                self.pieces
                    .iter()
                    .filter(|(n, _)| *n >= from)
                    .map(|(_, text)| text.clone())
                    .collect(),
            ),
        }
    }
}

/// Turns bytes into text as they come, carrying the start of a character a
/// read split into the next read. Bytes that are no UTF-8 become U+FFFD.
#[derive(Default)]
pub struct Decoder {
    carried: Vec<u8>,
}

impl Decoder {
    pub fn decode(&mut self, bytes: &[u8]) -> String {
        self.carried.extend_from_slice(bytes);
        let mut text = String::new();
        let mut rest = self.carried.as_slice();
        loop {
            match std::str::from_utf8(rest) {
                Ok(whole) => {
                    text.push_str(whole);
                    rest = &[];
                    break;
                }
                Err(error) => {
                    let (good, after) = rest.split_at(error.valid_up_to());
                    text.push_str(std::str::from_utf8(good).unwrap_or_default());
                    match error.error_len() {
                        Some(bad) => {
                            text.push(char::REPLACEMENT_CHARACTER);
                            rest = &after[bad..];
                        }
                        // The character goes on in the next read.
                        None => {
                            rest = after;
                            break;
                        }
                    }
                }
            }
        }
        self.carried = rest.to_vec();
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_character_split_between_reads_comes_out_whole() {
        let mut decoder = Decoder::default();
        let bytes = "ж".as_bytes();
        assert_eq!(decoder.decode(&[b'a', bytes[0]]), "a");
        assert_eq!(decoder.decode(&[bytes[1], b'b']), "жb");
        assert_eq!(decoder.decode(&[0xff, b'c']), "\u{fffd}c");
    }

    #[test]
    fn history_keeps_the_newest_and_says_when_a_window_missed_some() {
        let mut history = History::default();
        history.add("one ".to_owned());
        history.add("two".to_owned());
        assert_eq!(history.all(), "one two");
        let Since::Pieces(after) = history.since(1) else {
            panic!("nothing missed")
        };
        assert_eq!(after, ["two"]);
        history.add("x".repeat(KEEPS));
        assert!(matches!(history.since(1), Since::Gone));
        assert_eq!(history.next(), 3);
    }
}
