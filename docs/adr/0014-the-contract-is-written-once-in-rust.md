---
status: accepted
date: 2026-11-01
---

# The contract is written once, in Rust

ADR 0001 makes the Rust the one source of the contract, and ts-rs makes
the window's types from it. On 2026-11-01 a read of the code showed two
places where that stops.

- **Methods are strings.** A Pane calls
  `engine.command("agents.steer", { turn }, space)`. The method's name, its
  params and its answer are not checked: the params' Rust structs are not
  exported, and the caller names the answer's type itself. A wrong name or
  field shows only when the engine refuses it, or in an end-to-end test.
- **A Thread is projected twice.** The engine writes each fact into its
  tables (`store.rs`), and the Pane applies the same facts to the view it
  read (`thread.ts`). The rules of what a Person may do come twice too:
  retry, steer, change or take back a waiting message. Of the 26 changes to
  the agents module's facts so far, 16 changed `thread.ts` as well. Nothing
  checks that the two agree.

Roma chose to fix both first ("давай начнем с b a"), before the MCP module
brings Agents that call these methods too.

**Decision.**

1. **A module declares each method once.**
   - One `methods!` table in the module, from the kernel, gives each method
     its name, the right it needs, whether it is a read or a command, its
     params and its answer. The module writes one handler per method, which
     takes the params and returns the answer, both typed.
   - The table makes the rest: the method's right (`Module::right`), the
     dispatch, decoding the params and encoding the answer, and a command
     that refuses to run without a command ID. A method missing from the
     table does not exist; a handler that takes or gives another type does
     not compile.
   - The kernel's own methods use the same table.
   - The table also writes the module's methods as TypeScript, with ts-rs.
     The window's `engine.call` takes only reads and `engine.command` only
     commands, each with its params and answer typed. A wrong name or field
     fails `tsc`.
   - The CLI stays untyped: `banda call <method>` takes any JSON, and the
     engine checks it as it checks every call.

2. **The engine says what a Person may do with each turn.**
   - A turn in a Thread's view carries `can`: whether it can be stopped,
     tried again, changed, taken back or sent now. One function in the
     module's rules decides it, the same one the commands ask before they
     act, so the view and a refusal never disagree.
   - The Pane shows what `can` says and keeps no rule of its own about it.

3. **The window's projection is checked against the engine's.**
   - The Pane still applies facts to the view it read (ADR 0002,
     decision 5): reading the whole view again on every piece of a reply
     would cost too much.
   - So the engine's tests record checkpoints from real scenarios: a
     Thread's view, the facts after it, and the view the engine reads
     then. The Pane's tests apply those facts to the first view and must
     get the last one, `can` included.
   - The fact kinds the window knows come from the Rust enum, not a list
     kept by hand.

**Consequences.**

- A change to a fact or a method that the window does not follow fails
  `scripts/check.sh`, before any end-to-end test runs.
- `lib.rs` of a module loses its large `match`: each method is a function.
- The Pane's copy of the rules shrinks to the one function that computes
  `can` after a fact, and the checkpoints keep it equal to the engine's.
- Two steps, one PR each: the methods table and the typed client; then
  `can` and the checkpoints.
- Later, if the two projections keep drifting: the module's projection in
  Rust, compiled to WebAssembly for the Pane, so it is written once too.
