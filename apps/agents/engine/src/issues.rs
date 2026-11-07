//! An issue about a Problem of Banda's, which a Thread's Agent drafts and
//! only its Person sends (ADR 0039, decision 3). The draft is a Thread
//! item the window draws as a card. The problems module sends it
//! (`problems.send_issue`); this keeps how the Person answered, with a
//! command that needs `Decide`, so the yes is in Banda's code, not in the
//! Agent's words.

use crate::emit;
use crate::model::{Body, Fact, IssueState, ItemId};
use crate::store;
use banda_kernel::{AgentId, Error, Participant, Refusal, Tx};
use schemars::JsonSchema;
use serde::Deserialize;
use ts_rs::TS;

/// What `draft_issue` tells the Agent.
pub const DRAFTED: &str = "Shown to your Person as a card with Send, Edit and Cancel. \
Only they send it: don't send it yourself, and don't repeat it in your reply.";

/// An issue for your Person to send to Banda.
#[derive(Deserialize, TS, JsonSchema)]
#[ts(export_to = "agents/")]
pub struct DraftIssue {
    /// The Problem's fingerprint, as `problem` says it.
    pub fingerprint: String,
    /// What the Person saw, in a few words.
    pub title: String,
    /// Markdown: what you found, then the report's `text`.
    pub body: String,
    /// The issue that has the fingerprint already, to comment on instead.
    #[serde(default)]
    #[ts(optional)]
    pub comment_on: Option<u32>,
}

/// How the Person answered a drafted issue: sent as they last wrote it,
/// to `url`, or not.
#[derive(Deserialize, TS)]
#[ts(export_to = "agents/")]
pub struct AnswerIssue {
    pub item: ItemId,
    pub state: IssueState,
    #[serde(default)]
    #[ts(optional)]
    pub title: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub body: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub url: Option<String>,
}

/// Writes the draft into the Agent's own Thread, in its turn that runs.
pub fn draft(tx: &mut Tx<'_>, agent: AgentId, draft: DraftIssue) -> Result<(), Error> {
    if draft.title.trim().is_empty() || draft.body.trim().is_empty() {
        return Err(Refusal::invalid("An issue needs its title and its body.").into());
    }
    let DraftIssue {
        fingerprint,
        title,
        body,
        comment_on,
    } = draft;
    let body = Body::Issue {
        fingerprint,
        title,
        body,
        comment_on,
        state: IssueState::Drafted,
        url: None,
    };
    let refused = "An issue is drafted in a turn that runs.";
    let (thread, item, turn) = crate::agent_item(tx, agent, refused, body)?;
    let Body::Issue {
        fingerprint,
        title,
        body,
        comment_on,
        ..
    } = item.body
    else {
        unreachable!("an issue was written")
    };
    let fact = Fact::IssueDrafted {
        item: item.id,
        turn,
        fingerprint,
        title,
        body,
        comment_on,
    };
    emit(tx, Participant::Agent(agent), thread, &fact)
}

/// Keeps how the Person answered the draft, and says it: the title and
/// the body only where they changed.
pub fn answer(tx: &mut Tx<'_>, author: Participant, answer: AnswerIssue) -> Result<(), Error> {
    let AnswerIssue {
        item,
        state,
        title,
        body,
        url,
    } = answer;
    let went = matches!(state, IssueState::Sent | IssueState::Opened);
    if state == IssueState::Drafted || went != url.is_some() {
        return Err(Refusal::invalid(
            "An issue is answered sent or opened at its address, or cancelled.",
        )
        .into());
    }
    let (thread, mut found) = store::item(tx.sql(), item)?
        .ok_or_else(|| Refusal::not_found("There is no such issue."))?;
    let Body::Issue {
        title: was_title,
        body: was_body,
        state: was,
        url: at,
        ..
    } = &mut found.body
    else {
        return Err(Refusal::not_found("There is no such issue.").into());
    };
    if *was != IssueState::Drafted {
        return Err(Refusal::conflict("The Person answered this issue already.").into());
    }
    let title = title.filter(|new| new != was_title);
    let body = body.filter(|new| new != was_body);
    if let Some(new) = &title {
        new.clone_into(was_title);
    }
    if let Some(new) = &body {
        new.clone_into(was_body);
    }
    *was = state;
    at.clone_from(&url);
    store::set_body(tx.sql(), item, &found.body)?;
    let fact = Fact::IssueAnswered {
        item,
        state,
        title,
        body,
        url,
    };
    emit(tx, author, thread, &fact)
}
