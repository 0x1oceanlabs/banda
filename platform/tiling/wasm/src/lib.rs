//! The Tiling's model as a client loads it (ADR 0088, decision 11; ADR
//! 0135): `banda-tiling` built for `wasm32-unknown-unknown`, with one
//! door. A client writes a command as JSON into memory it asked for
//! (`alloc`), calls `apply`, and reads the answer as JSON where `apply`
//! says it is. Nothing is imported: the file runs wherever WebAssembly
//! does.
//!
//! The two exports are the crate's only `unsafe`: a pointer and a length
//! are how bytes cross to WebAssembly's host. The model's own code, and
//! `run` below, have none.

use banda_base::Refusal;
use banda_tiling::commands;
use banda_tiling::model::{Arrangement, Seed};
use banda_tiling::placing::Facts;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A command as a client sends it: the arrangement it has, the command
/// (`method` as in `commands::METHODS`, with its `params`), the engine's
/// facts as the client knows them, and the command's ID, from which what
/// the command makes takes its IDs.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Asked {
    list: Arrangement,
    method: String,
    #[serde(default)]
    params: Value,
    #[serde(default)]
    facts: Facts,
    seed: String,
}

/// The command's answer and the arrangement after it, or why it is
/// refused, in the engine's words: `{"answer", "list"}` or `{"refused":
/// {"code", "message"}}`.
#[derive(Serialize)]
#[serde(untagged)]
enum Said {
    Done { answer: Value, list: Arrangement },
    Refused { refused: Refusal },
}

fn run(asked: &[u8]) -> Said {
    let Asked {
        mut list,
        method,
        params,
        facts,
        seed,
    } = match serde_json::from_slice(asked) {
        Ok(asked) => asked,
        Err(e) => {
            return Said::Refused {
                refused: Refusal::invalid(format!("The model cannot read the command: {e}.")),
            };
        }
    };
    match commands::apply(&mut list, &method, params, &facts, &Seed::of(&seed)) {
        Ok(answer) => Said::Done { answer, list },
        Err(refused) => Said::Refused { refused },
    }
}

/// `len` bytes of the model's memory for the client to write a command
/// into. `apply` takes them back.
#[unsafe(no_mangle)]
#[allow(unsafe_code)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()).cast()
}

/// Runs the command written at `ptr`, `len` bytes that `alloc(len)` gave,
/// and says where its answer is: the pointer in the high half, the length
/// in the low one. The answer stays until the next `apply`.
#[unsafe(no_mangle)]
#[allow(unsafe_code)]
pub extern "C" fn apply(ptr: *mut u8, len: usize) -> u64 {
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
        let asked = json!({ "list": [], "method": "none", "seed": "s" });
        let said = said(&asked);
        assert_eq!(said["refused"]["code"], "invalid", "{said}");
    }

    #[test]
    fn what_is_no_command_is_refused_not_a_panic() {
        let said = serde_json::to_value(run(b"{")).unwrap();
        assert_eq!(said["refused"]["code"], "invalid");
    }
}
