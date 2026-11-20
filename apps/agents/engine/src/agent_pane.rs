//! A Thread's Pane as an Agent may open it, which the engine hands the
//! workspaces (`banda_tiling::agent::AgentPane`).

use banda_kernel::Refusal;
use banda_tiling::agent::{AgentPane, shows_only};
use serde_json::Value;

/// The kinds of Pane of this App an Agent may open: a Thread's.
pub const AGENT_PANES: [AgentPane; 1] = [AgentPane {
    opens: one_thread,
    ..AgentPane::shows("agents.thread")
}];

/// What an Agent does instead of giving a Thread's Pane words to send.
const SEND: &str = "To start a Task or write to one, call `send`, as yourself.";

/// Refuses a Thread's Pane an Agent opens on anything but one Thread, by
/// its ID as `threads` lists it, so one Thread is one Pane. The rest of its
/// args are the Person's: `ask`, the words a Thread not yet started sends
/// first, the Project and Harness it starts in, and the title its header
/// keeps. An Agent starts a Thread, or writes to one, with `send`, as
/// itself, and the message says so (ADR 0019, decision 4). The Pane opens
/// in the Agent's Project, which answers for its own Threads alone.
fn one_thread(args: &Value) -> Result<(), Refusal> {
    shows_only(args, &["thread"]).map_err(|refused| Refusal {
        message: format!("{} {SEND}", refused.message),
        ..refused
    })?;
    let id = args.get("thread").and_then(Value::as_str);
    if id.is_some_and(|id| uuid::Uuid::parse_str(id).is_ok_and(|read| read.to_string() == id)) {
        return Ok(());
    }
    Err(Refusal::invalid(format!(
        "A Thread's Pane shows one of your Project's Threads: args \
         {{\"thread\": \"<id>\"}}, an ID as `threads` lists it. {SEND}"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_kernel::Code;
    use serde_json::json;

    #[test]
    fn an_agent_opens_a_threads_pane_on_one_thread_by_its_id_alone() {
        let thread = uuid::Uuid::now_v7().to_string();
        assert!(one_thread(&json!({ "thread": thread })).is_ok());
        // The words it would send, and where and how it would start, are
        // the Person's to give: the refusal points the Agent to `send`.
        for args in [
            json!({ "thread": null, "ask": "Commit and push" }),
            json!({ "thread": thread, "ask": "Commit and push" }),
            json!({ "thread": null, "harness": "fake" }),
            json!({ "thread": thread, "harness": "fake", "title": "Fix the build" }),
        ] {
            let refused = one_thread(&args).unwrap_err();
            assert_eq!(refused.code, Code::Forbidden, "{args}");
            assert!(refused.message.contains("`send`"), "{}", refused.message);
        }
        // One Thread, by its ID as `threads` lists it.
        for args in [
            json!({}),
            json!({ "thread": null }),
            json!({ "thread": "t" }),
            json!({ "thread": thread.to_uppercase() }),
            json!({ "thread": thread.replace('-', "") }),
            json!({ "thread": format!("urn:uuid:{thread}") }),
            json!("t"),
        ] {
            let refused = one_thread(&args).unwrap_err();
            assert_eq!(refused.code, Code::Invalid, "{args}");
            assert!(refused.message.contains("`send`"), "{}", refused.message);
        }
    }
}
