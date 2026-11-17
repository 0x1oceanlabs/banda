//! The Tiling's model as a client loads it (ADR 0088, decision 11; ADR
//! 0135): `banda-tiling` built for `wasm32-unknown-unknown`, with one
//! door. A client writes what it asks as JSON into memory it asked for
//! (`alloc`), calls `ask`, and reads the answer as JSON where `ask`
//! says it is. Nothing is imported: the file runs wherever WebAssembly
//! does.
//!
//! The two exports are the crate's only `unsafe`: a pointer and a length
//! are how bytes cross to WebAssembly's host. The model's own code, and
//! `run` below, have none.

use banda_base::Refusal;
use banda_tiling::commands;
use banda_tiling::model::{Arrangement, PaneId, Seed, WorkspaceId};
use banda_tiling::placing::{self, Facts, Refused};
use banda_tiling::view::{self, Shape, View};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

/// What a client asks the model, each with the arrangement it has and
/// the engine's facts as it knows them.
#[derive(Deserialize, TS)]
#[serde(tag = "ask", rename_all = "snake_case", deny_unknown_fields)]
#[ts(export, export_to = "workspaces/", rename = "ModelAsked")]
enum Asked {
    /// Run a command (`method` as in `commands::METHODS`, with its
    /// `params`) under its ID `seed`, from which what it makes takes its
    /// IDs.
    Apply {
        list: Arrangement,
        method: String,
        #[serde(default)]
        params: Value,
        #[serde(default)]
        facts: Facts,
        seed: String,
    },
    /// The row's refusal of a command, with what it is of
    /// (`commands::refused`).
    Refused {
        list: Arrangement,
        method: String,
        #[serde(default)]
        params: Value,
        facts: Facts,
    },
    /// The workspaces the row lets a Pane move to no more
    /// (`placing::refused_to`).
    RefusedTo {
        list: Arrangement,
        facts: Facts,
        pane: PaneId,
        whole: bool,
    },
    /// A new column's width for a Pane of a kind, where the command names
    /// none (`Facts::width`).
    Width { facts: Facts, kind: String },
    /// A device's view over the arrangement as it stands, with the
    /// Person's act aimed at a Pane, if one aims (`view::look`).
    Look {
        list: Shape,
        view: View,
        #[serde(default)]
        #[ts(optional)]
        aim: Option<String>,
    },
}

/// What the model answers. `apply`: the command's answer and the
/// arrangement after it, `{"answer", "list"}`, or why it is refused, in
/// the engine's words, `{"refused": {"code", "message"}}`. The rest: what their function gives, none as
/// null.
#[derive(Serialize)]
#[serde(untagged)]
enum Said {
    Done {
        answer: Value,
        list: Arrangement,
    },
    No {
        refused: Refusal,
    },
    /// What was asked is no question of `Asked`'s: the client's fault,
    /// which it throws.
    Unread {
        unread: String,
    },
    Refused(Option<Refused>),
    RefusedTo(Vec<WorkspaceId>),
    Width(Option<String>),
    Looked(View),
}

fn run(asked: &[u8]) -> Said {
    let asked = match serde_json::from_slice(asked) {
        Ok(asked) => asked,
        Err(e) => {
            return Said::Unread {
                unread: e.to_string(),
            };
        }
    };
    match asked {
        Asked::Apply {
            mut list,
            method,
            params,
            facts,
            seed,
        } => match commands::apply(&mut list, &method, params, &facts, &Seed::of(&seed)) {
            Ok(answer) => Said::Done { answer, list },
            Err(refused) => Said::No { refused },
        },
        Asked::Refused {
            list,
            method,
            params,
            facts,
        } => Said::Refused(commands::refused(&list, &method, params, &facts)),
        Asked::RefusedTo {
            list,
            facts,
            pane,
            whole,
        } => Said::RefusedTo(placing::refused_to(&list, &facts, pane, whole)),
        Asked::Width { facts, kind } => Said::Width(facts.width(&kind)),
        Asked::Look { list, view, aim } => Said::Looked(view::look(&list, &view, aim.as_deref())),
    }
}

/// `len` bytes of the model's memory for the client to write what it
/// asks into. `ask` takes them back.
#[unsafe(no_mangle)]
#[allow(unsafe_code)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()).cast()
}

/// Answers what is asked at `ptr`, `len` bytes that `alloc(len)` gave,
/// and says where its answer is: the pointer in the high half, the length
/// in the low one. The answer stays until the next `ask`.
#[unsafe(no_mangle)]
#[allow(unsafe_code)]
pub extern "C" fn ask(ptr: *mut u8, len: usize) -> u64 {
    use std::cell::RefCell;
    thread_local! {
        static ANSWER: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    }
    // SAFETY: the client gives back what `alloc(len)` gave it, once: a
    // boxed slice of `len` bytes, which it has written.
    let asked = unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) };
    let answer = serde_json::to_vec(&run(&asked)).unwrap_or_default();
    ANSWER.with(|kept| {
        let mut kept = kept.borrow_mut();
        *kept = answer;
        // A pointer is 32 bits wide where this runs, in WebAssembly.
        ((kept.as_ptr() as usize as u64) << 32) | kept.len() as u64
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn said(asked: &Value) -> Value {
        serde_json::to_value(run(asked.to_string().as_bytes())).unwrap()
    }

    #[test]
    fn a_command_comes_back_with_its_answer_and_the_arrangement_after() {
        let start = banda_tiling::model::start_from(&Seed::of("start"));
        let asked = json!({
            "ask": "apply",
            "list": start,
            "method": "open",
            "params": { "project": "a0000000-0000-4000-8000-000000000002", "kind": "t.t", "args": {} },
            "seed": "a0000000-0000-4000-8000-000000000001",
        });
        let said = said(&asked);
        assert!(said["answer"]["pane"].is_string(), "{said}");
        assert_eq!(said["list"][0]["columns"].as_array().map(Vec::len), Some(1));
    }

    #[test]
    fn a_refusal_comes_back_in_the_engines_words() {
        let asked = json!({ "ask": "apply", "list": [], "method": "none", "seed": "s" });
        let said = said(&asked);
        assert_eq!(said["refused"]["code"], "invalid", "{said}");
    }

    #[test]
    fn what_is_no_question_is_said_so_not_a_panic() {
        let said = serde_json::to_value(run(b"{")).unwrap();
        assert!(said["unread"].is_string(), "{said}");
    }

    #[test]
    fn the_rows_say_and_a_kinds_width_come_as_their_functions_give_them() {
        let facts = json!({ "flow": "row", "narrow": ["a.list"], "narrowest": "1/4" });
        let width = |kind: &str| said(&json!({ "ask": "width", "facts": facts, "kind": kind }));
        assert_eq!(width("a.list"), "1/4");
        assert_eq!(width("a.other"), Value::Null);
        let pane = "a0000000-0000-4000-8000-000000000003";
        let to = said(&json!({
            "ask": "refused_to", "list": [], "facts": facts, "pane": pane, "whole": false,
        }));
        assert_eq!(to, json!([]));
        let refused = said(&json!({
            "ask": "refused", "list": [], "facts": facts, "method": "close",
            "params": { "pane": pane },
        }));
        assert_eq!(refused, Value::Null);
    }
}
