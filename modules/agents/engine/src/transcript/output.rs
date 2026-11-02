//! What a Thread keeps of what a Harness says: a tool's content within
//! bounds, what a command prints, and a reply's pieces gathered into items.

use crate::model::{Body, Fact, ItemId, ToolContent, TurnId};

/// The most of one command's output, one text or one diff (its texts
/// before and after together) a Thread keeps, in bytes. The Thread keeps
/// everything the Harness says; only a runaway command reaches this.
const KEPT: usize = 4 * 1024 * 1024;

/// The start of `text` that fits in `room` bytes, ending where a character
/// ends.
fn fit(text: &str, room: usize) -> &str {
    if text.len() <= room {
        return text;
    }
    let mut end = room;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// A tool call's content as a Thread keeps it: a long text is cut, and a
/// diff too large to keep says so instead.
pub fn bound(content: Vec<ToolContent>) -> Vec<ToolContent> {
    content
        .into_iter()
        .map(|shown| match shown {
            ToolContent::Text { text } if text.len() > KEPT => ToolContent::Text {
                text: format!("{}…", fit(&text, KEPT)),
            },
            ToolContent::Diff { path, old, new }
                if old.as_ref().map_or(0, String::len) + new.len() > KEPT =>
            {
                ToolContent::Text {
                    text: format!("{path} changed too much to show here."),
                }
            }
            shown => shown,
        })
        .collect()
}

/// One command's output on its way into the Thread: what it printed that
/// is not written yet, within what the Thread keeps.
#[derive(Debug, Default)]
pub struct Printed {
    /// What the Thread holds of it already.
    kept: usize,
    waiting: String,
    /// It printed more than the Thread keeps; `told` once the Thread knows.
    cut: bool,
    told: bool,
}

impl Printed {
    /// Adds what the command printed since.
    pub fn add(&mut self, text: &str) {
        let fits = fit(text, KEPT - self.kept - self.waiting.len());
        self.waiting.push_str(fits);
        self.cut |= fits.len() < text.len();
    }

    /// What to write now, and whether the Thread keeps no more after it;
    /// none when there is nothing new.
    pub fn take(&mut self) -> Option<(String, bool)> {
        if self.waiting.is_empty() && self.cut == self.told {
            return None;
        }
        let text = std::mem::take(&mut self.waiting);
        self.kept += text.len();
        self.told = self.cut;
        Some((text, self.cut))
    }
}

/// The two kinds of text an Agent sends in pieces.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Text {
    Reply,
    Thought,
}

impl Text {
    pub fn body(self, text: String) -> Body {
        match self {
            Text::Reply => Body::Message {
                text,
                images: Vec::new(),
                answers: false,
            },
            Text::Thought => Body::Thought { text },
        }
    }

    pub fn grew(self, item: ItemId, turn: TurnId, text: String) -> Fact {
        match self {
            Text::Reply => Fact::ReplyGrew { item, turn, text },
            Text::Thought => Fact::ThoughtGrew { item, turn, text },
        }
    }
}

/// Text that arrives in pieces: pieces of one kind in a row make one item,
/// and they are written in batches.
#[derive(Default)]
pub struct Pieces {
    open: Option<Piece>,
}

/// Text of one item not yet written.
#[derive(Debug, PartialEq)]
pub struct Piece {
    pub item: ItemId,
    pub kind: Text,
    pub text: String,
}

impl Pieces {
    /// Adds text. Text of another kind ends the open item, which comes back
    /// with whatever of it is not yet written. `fresh` names the item that
    /// text of a new kind starts.
    pub fn add(&mut self, kind: Text, text: &str, fresh: ItemId) -> Option<Piece> {
        if let Some(open) = &mut self.open
            && open.kind == kind
        {
            open.text.push_str(text);
            return None;
        }
        let ended = self.close();
        self.open = Some(Piece {
            item: fresh,
            kind,
            text: text.to_owned(),
        });
        ended
    }

    /// The text not yet written. The item stays open for more.
    pub fn take(&mut self) -> Option<Piece> {
        let open = self.open.as_mut()?;
        if open.text.is_empty() {
            return None;
        }
        Some(Piece {
            item: open.item,
            kind: open.kind,
            text: std::mem::take(&mut open.text),
        })
    }

    /// Ends the open item.
    pub fn close(&mut self) -> Option<Piece> {
        let piece = self.take();
        self.open = None;
        piece
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_thread_keeps_tool_content_within_bounds() {
        assert_eq!(fit("héllo", 2), "h", "never half a character");
        assert_eq!(fit("hello", 9), "hello");
        let big = "x".repeat(KEPT);
        let content = bound(vec![
            ToolContent::Diff {
                path: "a.rs".into(),
                old: Some("a".into()),
                new: big,
            },
            ToolContent::Text { text: "ok".into() },
        ]);
        assert_eq!(
            content,
            [
                ToolContent::Text {
                    text: "a.rs changed too much to show here.".into()
                },
                ToolContent::Text { text: "ok".into() },
            ]
        );
    }

    #[test]
    fn a_thread_keeps_a_commands_output_up_to_a_runaway() {
        let mut printed = Printed::default();
        assert_eq!(printed.take(), None);
        printed.add("one\n");
        printed.add("two\n");
        assert_eq!(printed.take(), Some(("one\ntwo\n".into(), false)));
        assert_eq!(printed.take(), None, "written once");

        printed.add(&"x".repeat(KEPT));
        let (text, cut) = printed.take().expect("the rest that fits");
        assert_eq!((text.len(), cut), (KEPT - 8, true));
        printed.add("more");
        assert_eq!(printed.take(), None, "nothing past the limit");

        let mut exact = Printed::default();
        exact.add(&"x".repeat(KEPT));
        assert_eq!(exact.take().map(|(_, cut)| cut), Some(false));
        exact.add("more");
        assert_eq!(exact.take(), Some((String::new(), true)), "told it is cut");
    }

    #[test]
    fn pieces_of_one_kind_make_one_item_and_another_kind_ends_it() {
        let (reply, thought) = (ItemId::new(), ItemId::new());
        let mut pieces = Pieces::default();
        assert_eq!(pieces.add(Text::Reply, "Hel", reply), None);
        assert_eq!(pieces.add(Text::Reply, "lo", ItemId::new()), None);
        assert_eq!(pieces.take().unwrap().text, "Hello");
        assert_eq!(pieces.take(), None, "nothing new to write");
        pieces.add(Text::Reply, "!", ItemId::new());
        assert_eq!(
            pieces.take().unwrap().item,
            reply,
            "the reply goes on in the same item"
        );

        pieces.add(Text::Reply, " Bye", ItemId::new());
        let ended = pieces.add(Text::Thought, "hmm", thought).unwrap();
        assert_eq!((ended.item, ended.text.as_str()), (reply, " Bye"));
        assert_eq!(pieces.close().unwrap().item, thought);
        assert_eq!(pieces.close(), None);
    }
}
