//! The agents module's decisions and state machines. Pure: no database,
//! clock, randomness or Harness protocol. IDs come in from the caller.

use crate::model::{
    Body, Can, Fact, Failure, Image, ImageId, ItemId, Opener, ThreadId, ToolContent, TurnId,
    TurnState, TurnView,
};
use banda_kernel::{Participant, Refusal};
use std::collections::{HashMap, HashSet};

mod moves;
pub use moves::{Event, Step, Then, TurnFacts, next};

/// How freely an Agent acts is a Person's choice: an Agent sends a message
/// with the settings its Thread has, and changes none.
pub fn may_choose(author: Participant) -> Result<(), Refusal> {
    match author {
        Participant::Person(_) => Ok(()),
        Participant::Agent(_) => Err(Refusal::forbidden(
            "Only a Person chooses how freely an Agent acts.",
        )),
    }
}

/// Whether a turn has yet to end.
pub fn ongoing(state: TurnState) -> bool {
    matches!(state, TurnState::Queued | TurnState::Running)
}

/// Whether a Person may still change a message, take it back or send it
/// now: only while its turn waits.
pub fn waits(state: TurnState) -> Result<(), Refusal> {
    next(&TurnFacts::of(state), Event::Withdraw).map(drop)
}

/// Whether a waiting message can be changed: one tried again cannot,
/// since a turn already ran it.
pub fn may_change(first: bool) -> Result<(), Refusal> {
    let waiting = TurnFacts {
        first,
        ..TurnFacts::of(TurnState::Queued)
    };
    next(&waiting, Event::Change).map(drop)
}

/// How a turn ended: its state, in plain words why, and what kind of
/// failure it was.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ending {
    pub state: TurnState,
    pub reason: Option<String>,
    pub failure: Option<Failure>,
}

impl Ending {
    pub fn new(state: TurnState, reason: Option<&str>) -> Ending {
        Ending {
            state,
            reason: reason.map(str::to_owned),
            failure: None,
        }
    }

    /// A turn a restart cut short.
    pub fn cut_short() -> Ending {
        Ending::new(
            TurnState::Interrupted,
            Some("Banda stopped while the Agent worked."),
        )
    }

    pub fn failed(reason: impl Into<String>, failure: Option<Failure>) -> Ending {
        Ending {
            state: TurnState::Failed,
            reason: Some(reason.into()),
            failure,
        }
    }

    /// A usage limit learns when it resets, `at`, if it does not know.
    pub fn resets(mut self, at: Option<i64>) -> Ending {
        if let Some(Failure::UsageLimit {
            until: until @ None,
        }) = &mut self.failure
        {
            *until = at;
        }
        self
    }
}

/// Whether a Thread may be forked at the end of a turn: the turn ran and
/// ended, and no turn of the Thread runs now (ADR 0027).
pub fn may_fork(state: TurnState, works: bool) -> Result<(), Refusal> {
    let turn = TurnFacts {
        works,
        ..TurnFacts::of(state)
    };
    next(&turn, Event::Fork).map(drop)
}

/// Whether a Thread may go back to before `turn`'s message, one of its
/// `turns` (ADR 0027).
pub fn may_rewind(
    turn: TurnId,
    turns: &[TurnView],
    openers: &HashMap<TurnId, Opener>,
) -> Result<(), Refusal> {
    let (_, found) = facts(turns, openers, false)
        .find(|(one, _)| one.id == turn)
        .ok_or_else(|| Refusal::not_found("There is no such turn."))?;
    next(&found, Event::Rewind).map(drop)
}

/// Whether a turn may be tried again: a Person asked for it, it failed or
/// was cut short, and nothing came after it in its Thread.
pub fn retry(state: TurnState, latest: bool, by_itself: bool) -> Result<(), Refusal> {
    let turn = TurnFacts {
        latest,
        by_itself,
        ..TurnFacts::of(state)
    };
    next(&turn, Event::Retry).map(drop)
}

/// Where a turn stands among its Thread's turns, as its rules need it.
pub struct Position {
    /// No turn ran its message before it: one tried again has a turn
    /// before it.
    pub first: bool,
    /// It is the latest that began, and its message waits for no other.
    pub latest: bool,
}

/// Where `turn` stands among `turns`, in the order they were made. A turn
/// taken back counts for nothing.
pub fn position(turns: &[TurnView], turn: TurnId) -> Position {
    let counted = || turns.iter().filter(|t| t.state != TurnState::Withdrawn);
    let Some(found) = counted().find(|t| t.id == turn) else {
        return Position {
            first: false,
            latest: false,
        };
    };
    let mut its = counted().filter(|t| t.message == found.message);
    let first = its.next().map(|t| t.id) == Some(turn);
    let last = its.next_back().map_or(first, |t| t.id == turn);
    let begun = counted().rfind(|t| t.state != TurnState::Queued);
    Position {
        first,
        latest: last && begun.map(|t| t.id) == Some(turn),
    }
}

/// What the rules know of each of a Thread's `turns`, in the order they
/// were made, who opened each in `openers`.
fn facts<'a>(
    turns: &'a [TurnView],
    openers: &'a HashMap<TurnId, Opener>,
    held: bool,
) -> impl Iterator<Item = (&'a TurnView, TurnFacts)> {
    let works = Works::of(turns, openers, held);
    turns.iter().map(move |turn| {
        let opener = opener_of(openers, turn.id);
        (
            turn,
            works.facts(turn.state, opener, position(turns, turn.id)),
        )
    })
}

/// What the rules know of `turn`, opened by `opener` and asked to stop if
/// `stopping`, among its Thread's `turns`, who opened each in `openers`. A
/// turn not among them yet is new: it waits.
pub fn known(
    turns: &[TurnView],
    openers: &HashMap<TurnId, Opener>,
    held: bool,
    turn: TurnId,
    opener: Opener,
    stopping: bool,
) -> TurnFacts {
    let found = turns.iter().find(|one| one.id == turn);
    let state = found.map_or(TurnState::Queued, |one| one.state);
    TurnFacts {
        stopping,
        ..Works::of(turns, openers, held).facts(state, opener, position(turns, turn))
    }
}

fn opener_of(openers: &HashMap<TurnId, Opener>, turn: TurnId) -> Opener {
    openers.get(&turn).copied().unwrap_or(Opener::Person)
}

/// What the rules know of a Thread, whichever of its turns they look at:
/// whether its queue is held, whether a turn runs, whose, and whether one
/// waits.
#[derive(Clone, Copy)]
struct Works {
    held: bool,
    works: bool,
    own_works: bool,
    waits: bool,
}

impl Works {
    fn of(turns: &[TurnView], openers: &HashMap<TurnId, Opener>, held: bool) -> Works {
        let running = turns.iter().find(|turn| turn.state == TurnState::Running);
        Works {
            held,
            works: running.is_some(),
            own_works: running.is_some_and(|turn| opener_of(openers, turn.id).by_itself()),
            waits: turns.iter().any(|turn| turn.state == TurnState::Queued),
        }
    }

    /// What the rules know of one of its turns, in `state`, opened by
    /// `opener`, standing at `position`.
    fn facts(self, state: TurnState, opener: Opener, position: Position) -> TurnFacts {
        TurnFacts {
            by_itself: opener.by_itself(),
            by_person: opener.by_person(),
            first: position.first,
            latest: position.latest,
            held: self.held,
            works: self.works,
            own_works: self.own_works,
            waits: self.waits,
            ..TurnFacts::of(state)
        }
    }
}

/// What a Person may do with each of a Thread's turns now (ADR 0014,
/// decision 2): what [`next`] accepts of a Person.
pub fn can(turns: &mut [TurnView], openers: &HashMap<TurnId, Opener>, held: bool) {
    let can: Vec<Can> = facts(turns, openers, held)
        .map(|(_, facts)| {
            let takes = |event| next(&facts, event).is_ok();
            Can {
                stop: takes(Event::Stop),
                retry: takes(Event::Retry),
                edit: takes(Event::Change),
                withdraw: takes(Event::Withdraw),
                steer: takes(Event::Steer),
                fork: takes(Event::Fork),
                rewind: takes(Event::Rewind),
            }
        })
        .collect();
    for (turn, can) in turns.iter_mut().zip(can) {
        turn.can = can;
    }
}

/// A Thread's title: the start of its first message, on one line.
pub fn title(text: &str, images: &[Image]) -> String {
    const LONGEST: usize = 60;
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.is_empty() {
        return match images {
            [one] => one.name.clone().unwrap_or_else(|| "An image".to_owned()),
            _ => format!("{} images", images.len()),
        };
    }
    if line.chars().count() <= LONGEST {
        return line;
    }
    let mut short: String = line.chars().take(LONGEST - 1).collect();
    short.push('…');
    short
}

/// The kinds of image a message can carry, as T3 Code takes them, and the
/// first bytes each kind's file starts with.
const IMAGE_KINDS: [(&str, &[u8]); 4] = [
    ("image/png", b"\x89PNG\r\n\x1a\n"),
    ("image/jpeg", b"\xff\xd8\xff"),
    ("image/gif", b"GIF8"),
    ("image/webp", b"RIFF"),
];
const MB: usize = 1024 * 1024;
/// The largest image, the most images and the most of their bytes one
/// message carries, as in T3 Code.
pub const LARGEST_IMAGE: usize = 10 * MB;
pub const MOST_IMAGES: usize = 100;
const MOST_IMAGE_BYTES: usize = 80 * MB;

/// The largest file Banda keeps for a message to point at.
pub const LARGEST_FILE: usize = 20 * MB;

/// The name a file Banda keeps for a message is given, from the name it
/// came with: its last part, its spaces dashes, so `@` reads its path
/// back whole; refused if it is too large, or has no name left.
pub fn kept_name(name: &str, bytes: &[u8]) -> Result<String, Refusal> {
    if bytes.len() > LARGEST_FILE {
        return Err(Refusal::invalid(format!(
            "A file can be at most {} MB.",
            LARGEST_FILE / MB
        )));
    }
    let last = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let kept: String = last
        .chars()
        .filter(|c| !c.is_control() && *c != '@')
        .map(|c| if c.is_whitespace() { '-' } else { c })
        .take(120)
        .collect();
    if kept.trim_matches('.').is_empty() {
        return Err(Refusal::invalid("A file needs a name."));
    }
    Ok(kept)
}

/// Whether `bytes` can go with a message as an image of kind `mime`.
pub fn may_attach(mime: &str, bytes: &[u8]) -> Result<(), Refusal> {
    let Some((_, starts)) = IMAGE_KINDS.iter().find(|(kind, _)| *kind == mime) else {
        return Err(Refusal::invalid(
            "A message can carry PNG, JPEG, GIF and WebP images.",
        ));
    };
    if bytes.len() > LARGEST_IMAGE {
        return Err(Refusal::invalid(format!(
            "An image can be at most {} MB.",
            LARGEST_IMAGE / MB
        )));
    }
    let webp = mime != "image/webp" || bytes.get(8..12) == Some(b"WEBP");
    if !bytes.starts_with(starts) || !webp {
        return Err(Refusal::invalid(format!(
            "This file is not a {mime} image."
        )));
    }
    Ok(())
}

/// Whether a message of `text` can carry the images it names.
pub fn may_send(text: &str, images: &[ImageId]) -> Result<(), Refusal> {
    if text.trim().is_empty() && images.is_empty() {
        return Err(Refusal::invalid("A message needs some text or an image."));
    }
    if images.len() > MOST_IMAGES {
        return Err(Refusal::invalid(format!(
            "A message can carry at most {MOST_IMAGES} images."
        )));
    }
    let named: HashSet<_> = images.iter().collect();
    if named.len() < images.len() {
        return Err(Refusal::invalid("A message carries each image once."));
    }
    Ok(())
}

/// Whether the images a message carries fit in it together.
pub fn may_carry(images: &[Image]) -> Result<(), Refusal> {
    let bytes: usize = images.iter().map(|image| image.size as usize).sum();
    if bytes > MOST_IMAGE_BYTES {
        return Err(Refusal::invalid(format!(
            "A message's images can be at most {} MB together.",
            MOST_IMAGE_BYTES / MB
        )));
    }
    Ok(())
}

/// The Thread an Agent writes from: its own. An Agent of no Thread, as
/// one a test makes up, writes nowhere.
pub fn own_thread(thread: Option<ThreadId>) -> Result<ThreadId, Refusal> {
    thread.ok_or_else(|| Refusal::forbidden("An Agent writes from its own Thread."))
}

/// Whether the Agent of Thread `from` may write to Thread `to`, titled
/// `title` (ADR 0019, decision 4). `asks`: its Agent waits for its Person
/// to answer a Question. `waiting`: the Threads that wait for `from`'s
/// answer, up the chain of those that asked.
pub fn may_write(
    from: ThreadId,
    to: ThreadId,
    title: &str,
    asks: bool,
    waiting: &[ThreadId],
) -> Result<(), Refusal> {
    if to == from {
        return Err(Refusal::invalid(
            "This is your own Thread: say it in your reply instead.",
        ));
    }
    if waiting.contains(&to) {
        return Err(Refusal::conflict(format!(
            "Thread \"{title}\" waits for your answer; finish your turn to answer it."
        )));
    }
    if asks {
        return Err(Refusal::conflict(format!(
            "Thread \"{title}\" waits for its Person to answer a Question; \
             write to it once they have."
        )));
    }
    Ok(())
}

/// What the Harness reads before a message the Agent of Thread `from`
/// wrote, or `answers` with, so it knows the words are not its Person's.
pub fn from_agent(answers: bool, from: ThreadId, title: &str, text: &str) -> String {
    let (does, then) = match answers {
        true => ("answers what you wrote to it", ""),
        false => (
            "writes to you",
            " Your last reply goes back to it when your turn ends.",
        ),
    };
    format!(
        "The Agent of Thread \"{title}\" ({from}), another Agent of this Space, {does}; \
         this is not your Person's word.{then}\n\n{text}"
    )
}

/// What goes back to the Thread that asked when the turn it opened ends:
/// the turn's last reply, or how it ended and why.
pub fn answer_of(state: TurnState, reason: Option<&str>, reply: Option<String>) -> String {
    if state == TurnState::Done {
        return reply.unwrap_or_else(|| "It ended its turn without a reply.".to_owned());
    }
    let state = format!("{state:?}").to_lowercase();
    match reason {
        Some(reason) => format!("Its turn ended {state}: {reason}"),
        None => format!("Its turn ended {state}."),
    }
}

/// What becomes of a message's images when `harness` takes none: it gets
/// the text alone, which a notice says; a message of images alone cannot
/// go, which the error says.
pub fn without_images(harness: &str, text: &str) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err(format!(
            "{harness} does not take images, and this message holds nothing else."
        ));
    }
    Ok(format!(
        "{harness} does not take images, so it got the text alone."
    ))
}

/// The most of one command's output, one text or one diff (its texts
/// before and after together) a Thread keeps, in bytes. The Thread keeps
/// everything the Harness says; only a runaway command reaches this.
pub const KEPT: usize = 4 * 1024 * 1024;

/// The start of `text` that fits in `room` bytes, ending where a character
/// ends.
pub fn fit(text: &str, room: usize) -> &str {
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
pub fn kept(content: Vec<ToolContent>) -> Vec<ToolContent> {
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
    fn a_kept_file_is_named_so_its_path_reads_back_whole() {
        let name = |name: &str| kept_name(name, b"x");
        assert_eq!(name("notes.md").unwrap(), "notes.md");
        assert_eq!(name("/home/me/My Notes.txt").unwrap(), "My-Notes.txt");
        assert_eq!(name("C:\\work\\a@b.rs").unwrap(), "ab.rs");
        assert!(name("..").is_err());
        assert!(name("dir/").is_err());
        let large = vec![0; LARGEST_FILE + 1];
        assert!(kept_name("big.bin", &large).is_err());
    }

    fn turn(message: ItemId, state: TurnState) -> TurnView {
        TurnView {
            id: TurnId::new(),
            message,
            state,
            reason: None,
            failure: None,
            started: None,
            ended: None,
            plan: false,
            can: Can::default(),
        }
    }

    #[test]
    fn a_person_may_do_with_each_turn_what_its_commands_allow() {
        let (asked, again) = (ItemId::new(), ItemId::new());
        let mut turns = vec![
            turn(asked, TurnState::Failed),
            turn(again, TurnState::Done),
            turn(again, TurnState::Queued),
            turn(ItemId::new(), TurnState::Running),
        ];
        let own = HashMap::from([(turns[3].id, Opener::ByItself)]);
        can(&mut turns, &own, false);
        let [failed, done, retried, by_itself] = [0, 1, 2, 3].map(|i| turns[i].can);
        assert!(!failed.retry, "a turn began after it");
        assert!(!done.stop && !done.retry);
        assert!(
            retried.stop && retried.withdraw && !retried.edit,
            "a turn ran its message"
        );
        assert!(
            by_itself.stop && !by_itself.steer,
            "the Agent went on by itself"
        );
    }

    #[test]
    fn a_thread_keeps_tool_content_within_bounds() {
        assert_eq!(fit("héllo", 2), "h", "never half a character");
        assert_eq!(fit("hello", 9), "hello");
        let big = "x".repeat(KEPT);
        let content = kept(vec![
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
    fn a_usage_limit_learns_when_it_resets_and_nothing_else_does() {
        let limit = |until| Ending::failed("Limit.", Some(Failure::UsageLimit { until }));
        assert_eq!(
            limit(None).resets(Some(5)).failure,
            Some(Failure::UsageLimit { until: Some(5) })
        );
        assert_eq!(
            limit(Some(3)).resets(Some(5)).failure,
            Some(Failure::UsageLimit { until: Some(3) }),
            "what the failure itself says wins"
        );
        let other = Ending::failed("Down.", Some(Failure::Provider)).resets(Some(5));
        assert_eq!(other.failure, Some(Failure::Provider));
    }

    #[test]
    fn a_title_is_one_short_line() {
        assert_eq!(title("  Fix\nthe   report ", &[]), "Fix the report");
        let long = title(&"word ".repeat(30), &[]);
        assert_eq!(long.chars().count(), 60);
        assert!(long.ends_with('…'));
    }

    #[test]
    fn a_message_of_images_alone_is_named_after_them() {
        let image = |name: Option<&str>| Image {
            id: crate::model::ImageId::new(),
            mime: "image/png".to_owned(),
            size: 1,
            name: name.map(str::to_owned),
        };
        assert_eq!(title(" ", &[image(Some("shot.png"))]), "shot.png");
        assert_eq!(title("", &[image(None)]), "An image");
        assert_eq!(title("", &[image(None), image(None)]), "2 images");
        assert_eq!(title("Look", &[image(None)]), "Look");
    }

    #[test]
    fn an_image_is_one_of_four_kinds_its_bytes_bear_out() {
        let png = b"\x89PNG\r\n\x1a\n....";
        assert_eq!(may_attach("image/png", png), Ok(()));
        assert_eq!(may_attach("image/jpeg", b"\xff\xd8\xff\xe0"), Ok(()));
        assert_eq!(may_attach("image/gif", b"GIF89a"), Ok(()));
        assert_eq!(may_attach("image/webp", b"RIFF\0\0\0\0WEBPVP8 "), Ok(()));
        assert!(may_attach("image/webp", b"RIFF\0\0\0\0WAVEfmt ").is_err());
        assert!(may_attach("image/jpeg", png).is_err(), "a PNG named a JPEG");
        assert!(may_attach("image/svg+xml", b"<svg/>").is_err());
        let large = [png.as_slice(), &vec![0; LARGEST_IMAGE]].concat();
        assert_eq!(
            may_attach("image/png", &large).unwrap_err().message,
            "An image can be at most 10 MB."
        );
    }

    #[test]
    fn a_message_carries_some_text_or_images_each_once_and_not_too_many() {
        let one = ImageId::new();
        assert!(may_send(" ", &[]).is_err());
        assert_eq!(may_send("", &[one]), Ok(()));
        assert!(may_send("look", &[one, one]).is_err());
        let many: Vec<_> = (0..=MOST_IMAGES).map(|_| ImageId::new()).collect();
        assert!(may_send("look", &many).is_err());
        assert_eq!(may_send("look", &many[1..]), Ok(()));

        let image = |size| Image {
            id: ImageId::new(),
            mime: "image/png".to_owned(),
            size,
            name: None,
        };
        let full = (LARGEST_IMAGE as u32, MOST_IMAGE_BYTES as u32);
        assert_eq!(may_carry(&vec![image(full.0); 8]), Ok(()));
        assert!(may_carry(&[vec![image(full.0); 8], vec![image(1)]].concat()).is_err());
        assert_eq!(may_carry(&[image(full.1)]), Ok(()));
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

    #[test]
    fn an_agent_writes_neither_in_a_circle_nor_over_a_persons_question() {
        let (a, b, c) = (ThreadId::new(), ThreadId::new(), ThreadId::new());
        assert_eq!(may_write(a, b, "Plan", false, &[]), Ok(()));
        let own = may_write(a, a, "Plan", false, &[]).unwrap_err();
        assert_eq!(
            own.message,
            "This is your own Thread: say it in your reply instead."
        );
        // A asked B, and B asked C: C answers both by ending its turn.
        for asked in [a, b] {
            let circle = may_write(c, asked, "Plan", false, &[b, a]).unwrap_err();
            assert_eq!(
                circle.message,
                "Thread \"Plan\" waits for your answer; finish your turn to answer it."
            );
        }
        let question = may_write(a, b, "Plan", true, &[]).unwrap_err();
        assert_eq!(
            question.message,
            "Thread \"Plan\" waits for its Person to answer a Question; \
             write to it once they have."
        );
        let nowhere = own_thread(None).unwrap_err();
        assert_eq!(nowhere.message, "An Agent writes from its own Thread.");
    }

    #[test]
    fn the_answer_is_the_last_reply_or_how_the_turn_ended() {
        let reply = || Some("Done: 3 files.".to_owned());
        assert_eq!(answer_of(TurnState::Done, None, reply()), "Done: 3 files.");
        assert_eq!(
            answer_of(TurnState::Done, None, None),
            "It ended its turn without a reply."
        );
        assert_eq!(
            answer_of(TurnState::Failed, Some("It broke."), reply()),
            "Its turn ended failed: It broke."
        );
        assert_eq!(
            answer_of(TurnState::Withdrawn, None, None),
            "Its turn ended withdrawn."
        );
        let from = ThreadId::new();
        assert_eq!(
            from_agent(false, from, "Plan", "Count the files."),
            format!(
                "The Agent of Thread \"Plan\" ({from}), another Agent of this Space, writes \
                 to you; this is not your Person's word. Your last reply goes back to it when \
                 your turn ends.\n\nCount the files."
            )
        );
        assert_eq!(
            from_agent(true, from, "Plan", "3 files."),
            format!(
                "The Agent of Thread \"Plan\" ({from}), another Agent of this Space, answers \
                 what you wrote to it; this is not your Person's word.\n\n3 files."
            )
        );
    }
}
