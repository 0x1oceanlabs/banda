//! A Thread's move to another Project (ADR 0098, decision 14): which
//! Thread may move, where to, and the line the Thread says of it. Pure:
//! the caller brings what the store holds and the Projects' names and
//! folders.

use banda_kernel::Refusal;
use std::path::Path;

/// Where a Thread's work stands, as a move asks it.
#[derive(Clone, Copy, Debug, Default)]
pub struct Stands {
    /// A turn of it runs.
    pub works: bool,
    /// A sub-agent of it has not ended: it works, asks or waits for a
    /// slot (ADR 0103). Its lane goes on in the Project it is in.
    pub lanes: bool,
    /// Its Agent waits for its Person to answer a Question.
    pub asks: bool,
    /// A message waits in it for a turn of its own.
    pub waits: bool,
    /// Another Thread works on what its Agent asked, and answers it here
    /// once that turn ends (ADR 0019, decision 4).
    pub awaited: bool,
    /// Its next session forks the one it names, at the reply it was
    /// forked or rewound to (ADR 0027), and has not opened yet. That
    /// session goes on past the reply, as its source's does, and would go
    /// along whole.
    pub forks: bool,
}

/// Whether a Thread may move: only one at rest, as all its work is in the
/// Project it is in until its turns end. What it asks is answered first,
/// and a message that waits is sent or taken back, as a Person decides.
/// A fork goes once it has run, with a session of its own: until then,
/// the session it names says what came after the fork too, which the
/// other Project's Agents would read.
pub fn may_move(stands: Stands) -> Result<(), Refusal> {
    let why = if stands.asks {
        "This Thread asks its Person: answer it before moving it."
    } else if stands.works {
        "This Thread is at work: move it once its turn ends."
    } else if stands.lanes {
        "A sub-agent of this Thread is at work: move it once its sub-agents end."
    } else if stands.waits {
        "A message waits in this Thread: send it or take it back before moving the Thread."
    } else if stands.awaited {
        "Another Thread works on what this one asked: move it once that answer comes."
    } else if stands.forks {
        "This Thread has not gone on yet from where it was forked or rewound: send it a \
         message before moving it."
    } else {
        return Ok(());
    };
    Err(Refusal::conflict(why))
}

/// Whether a Thread may move into a Project: not into one of No Project,
/// which is one Thread's own (ADR 0046).
pub fn may_go_to(scratch: bool) -> Result<(), Refusal> {
    if scratch {
        return Err(Refusal::invalid(
            "A Thread moves into a Project, not into another Thread's in No project.",
        ));
    }
    Ok(())
}

/// The line a moved Thread shows, which its Agent reads before its next
/// message: where it came from, that it works in its new Project's folder
/// from now on, and that what it changed stays in the old one. It names
/// the folders while the line stays within `most` characters.
pub fn notice(from: &str, from_folder: &Path, to_folder: &Path, most: usize) -> String {
    let from = match from {
        "" => "No project".to_owned(),
        name => format!("“{name}”"),
    };
    let named = format!(
        "Moved here from {from}. Its Agent works in {} from now on; what it changed in {} \
         stays there.",
        to_folder.display(),
        from_folder.display()
    );
    let plain = !named.contains(['\n', '\r']);
    if plain && named.chars().count() <= most {
        return named;
    }
    format!("Moved here from {from}. Its Agent works in this Project's folder from now on.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_thread_at_rest_moves_and_the_refusal_says_what_to_do_first() {
        assert!(may_move(Stands::default()).is_ok());
        let refused = |stands: Stands| may_move(stands).unwrap_err().message;
        let works = Stands {
            works: true,
            ..Stands::default()
        };
        assert!(refused(works).contains("at work"));
        let lanes = Stands {
            lanes: true,
            ..Stands::default()
        };
        assert!(refused(lanes).contains("its sub-agents end"));
        let asks = Stands {
            asks: true,
            ..works
        };
        assert!(refused(asks).contains("answer it"), "what it asks first");
        let waits = Stands {
            waits: true,
            ..Stands::default()
        };
        assert!(refused(waits).contains("take it back"));
        let awaited = Stands {
            awaited: true,
            ..Stands::default()
        };
        assert!(refused(awaited).contains("that answer comes"));
        let forks = Stands {
            forks: true,
            ..Stands::default()
        };
        assert!(refused(forks).contains("send it a message"));
    }

    #[test]
    fn a_thread_moves_into_a_project_and_never_into_another_threads_no_project() {
        assert!(may_go_to(false).is_ok());
        assert!(may_go_to(true).is_err());
    }

    #[test]
    fn the_moved_thread_says_where_it_came_from_and_where_its_agent_works_now() {
        let (work, home) = (Path::new("/code/work"), Path::new("/code/home"));
        assert_eq!(
            notice("Work", work, home, 500),
            "Moved here from “Work”. Its Agent works in /code/home from now on; \
             what it changed in /code/work stays there."
        );
        assert!(notice("", work, home, 500).starts_with("Moved here from No project. "));
        let deep = Path::new("/a").join("b".repeat(600));
        assert_eq!(
            notice("Work", &deep, home, 500),
            "Moved here from “Work”. Its Agent works in this Project's folder from now on."
        );
    }
}
