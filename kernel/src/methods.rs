//! A module's methods, declared once (ADR 0014, decision 1).
//!
//! [`methods!`](crate::methods) takes one line per method: its kind, its
//! name, its params, its answer and the right it needs. It makes the
//! method's right, the dispatch that decodes the params, runs the handler
//! and encodes its answer, and the module's methods as TypeScript, so the
//! window's client takes only what the engine has.
//!
//! - `call`: a read, or an act that keeps no receipt; `engine.call`.
//! - `command`: runs once per command ID, and is refused without one;
//!   `engine.command`. See [`Kernel::answer`](crate::Kernel::answer) for
//!   its receipt.
//! - `stream`: pieces until it ends (`Module::stream`); its "answer" is
//!   the piece; `engine.stream`.
//!
//! Each method reads or acts ([`Does`], ADR 0106, law 4): a client
//! may send a read late and again, and sends an act now, at most once, or
//! says why not. A command acts. A call or a stream reads when its right
//! is `Read`; one with another right acts, unless its line ends `, read`,
//! as one that only reads or listens says: a right is authority, not
//! effect, and some reads need more than `Read`, as browsing the folders
//! does. A line that leaves the mark out by mistake is refused sooner
//! while its machine is away, and a stream so left ends with
//! `may_have_run` at each reconnect instead of being heard again: a
//! terminal's `watch` would show it gone after each engine restart, and
//! main would stop hearing `window.requests`. One that takes the mark in
//! error would let an act wait and run later by itself.
//!
//! A line that ends `, tool "<name>"` is also a tool an Agent calls
//! through `banda mcp` (ADR 0019, decision 3): its description is the
//! method's `///`, and its input the JSON Schema of its params. A tool's
//! answer that holds `pictures` shows them to the Agent as images, beside
//! the rest of it as text (ADR 0037, decision 3).

use crate::{CommandId, Refusal};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::Serialize;
use serde::de::{Deserialize, Deserializer, IgnoredAny};
use std::borrow::Cow;
use ts_rs::TS;

/// Who asks for a method, as far as the dispatch needs: the command ID a
/// `command` runs under.
pub trait Asks {
    fn command_id(&self) -> Result<CommandId, Refusal>;
}

/// The params of a method that takes none. Any JSON reads as it, so the
/// CLI may send `null` and a window `{}`.
#[derive(Debug, Clone, Copy, Default, TS)]
#[ts(export)]
pub struct Nothing {}

impl<'de> Deserialize<'de> for Nothing {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        IgnoredAny::deserialize(deserializer).map(|_| Nothing {})
    }
}

/// An Agent sends an object with nothing in it.
impl JsonSchema for Nothing {
    fn schema_name() -> Cow<'static, str> {
        "Nothing".into()
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({ "type": "object", "properties": {} })
    }
}

/// A picture a tool's answer shows its Agent, in a field `pictures`:
/// `banda mcp` passes each on as an MCP image. A window or `banda call`
/// reads it as it is.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, serde::Deserialize, TS)]
#[ts(export)]
pub struct Picture {
    /// Its kind, as `image/png`.
    pub mime: String,
    /// Its bytes in base64.
    pub data: String,
}

/// A method an Agent may call as a tool, as `banda mcp` lists it.
#[derive(Clone, Debug, PartialEq, Serialize, serde::Deserialize, TS)]
#[ts(export)]
pub struct Tool {
    /// Its name for the Agent: `read`.
    pub name: String,
    /// The method it calls: `<module>.<method>`.
    pub method: String,
    /// Its method's kind. After a broken connection, `banda mcp` sends a
    /// tool call again only when it is a command, whose receipt keeps it
    /// from running twice (ADR 0082, decision 4). An older engine lists no
    /// kind: its tools count as `call`s.
    #[serde(default = "unsaid")]
    pub kind: Kind,
    /// What it does, from the method's `///`.
    pub description: String,
    /// The JSON Schema of its params.
    pub schema: serde_json::Value,
}

impl Tool {
    /// A tool from a `methods!` line, its doc lines joined into words.
    pub fn new(name: &str, method: String, kind: Kind, doc: &[&str], mut schema: Schema) -> Tool {
        // What a reader of the schema needs, without the generator's notes.
        schema.remove("$schema");
        schema.remove("title");
        Tool {
            name: name.to_owned(),
            method,
            kind,
            description: words(doc),
            schema: schema.to_value(),
        }
    }
}

/// A method's `///` lines, joined into words.
pub fn words(doc: &[&str]) -> String {
    let lines: Vec<&str> = doc
        .iter()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();
    lines.join(" ")
}

/// A method's name as its line writes it, a keyword's as `r#move`: as
/// the window calls it, `move`.
pub fn bare(name: &'static str) -> &'static str {
    name.strip_prefix("r#").unwrap_or(name)
}

/// A method's kind, as its line in `methods!` says: `call`, `command` or
/// `stream`, each as this module's doc says (ADR 0082, decision 3). A
/// `view` is an App's read that answers a Tree, its screen as data (ADR
/// 0062, decision 7): it goes as a call does. An App from a folder
/// declares one in its `methods.json`; `methods!` has no such line yet.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, serde::Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename = "MethodKind")]
pub enum Kind {
    Call,
    Command,
    Stream,
    View,
}

/// The kind of a tool its engine did not say: a `call`, which keeps no
/// receipt, so nothing sends it again.
fn unsaid() -> Kind {
    Kind::Call
}

/// The refusal for a command sent with no command ID.
pub(crate) fn needs_command_id(method: &str) -> Refusal {
    Refusal::invalid(format!("{method} is a command and needs a command ID."))
}

/// What a method does, as a client sends it (ADR 0106, law 4): it
/// only reads, so it may wait for the link and go again; or it acts, so
/// it goes now, at most once, or fails at once while its machine is
/// away. The module's doc says which a line is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename = "MethodDoes")]
pub enum Does {
    Read,
    Act,
}

/// One line of a module's `methods!` table, as `banda modules` prints it
/// (ADR 0022, decision 1).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct Method {
    /// Without the module's prefix: `send`.
    pub name: &'static str,
    pub kind: Kind,
    /// The right it needs.
    pub right: crate::Right,
    /// Whether it reads or acts.
    pub does: Does,
    /// Its tool's name, when an Agent may call it as one.
    pub tool: Option<&'static str>,
    /// Whether a pass reaches it on the machine though it is no tool: its
    /// line's `pass`.
    pub pass: bool,
    /// What it does, from its `///`.
    pub about: String,
}

/// A type with a `methods!` table, which implements this for it: the
/// list of Apps reads each engine part's lines through it, by the type its
/// builder makes (ADR 0062, decision 11).
pub trait MethodTable {
    /// The TypeScript type its table writes, after `as`.
    const TS: &'static str;
    /// The folder of the contract's `generated/` it writes it in, after
    /// `in`.
    const DIR: &'static str;

    /// Every line of its table (ADR 0022, decision 1).
    fn method_list() -> Vec<Method>;
}

/// One of the kernel's own tables: the prefix a client calls its methods
/// by, the TypeScript type it writes and its folder (`MethodTable`), and
/// its lines.
pub type OwnTable = (&'static str, (&'static str, &'static str), Vec<Method>);

/// The kernel's own tables, as the contract's list of methods has them
/// first.
pub fn own() -> Vec<OwnTable> {
    fn table<T: MethodTable>(prefix: &'static str) -> OwnTable {
        (prefix, (T::TS, T::DIR), T::method_list())
    }
    vec![
        table::<crate::Kernel>("projects"),
        table::<crate::window::Window>("window"),
    ]
}

/// How the window types one kind of method: its params, its answer, and
/// the kind it is.
macro_rules! kind {
    ($(#[$doc:meta])* $name:ident as $ts:literal, $kind:literal) => {
        $(#[$doc])*
        #[allow(dead_code, non_camel_case_types)]
        #[derive(TS)]
        #[ts(export, rename = $ts)]
        pub struct $name<P, A> {
            params: P,
            answer: A,
            #[ts(type = $kind)]
            kind: (),
        }
    };
}

kind!(
    /// A `call` as the window types it.
    call as "CallMethod", "\"call\""
);
kind!(
    /// A `command` as the window types it.
    command as "CommandMethod", "\"command\""
);
kind!(
    /// A `stream` as the window types it: `answer` is each piece.
    stream as "StreamMethod", "\"stream\""
);

/// Encodes a handler's answer.
pub fn answer(answer: impl serde::Serialize) -> Result<serde_json::Value, Refusal> {
    Ok(serde_json::to_value(answer).map_err(crate::Error::from)?)
}

/// Declares a module's methods (ADR 0014, decision 1):
///
/// ```ignore
/// banda_kernel::methods! {
///     Terminals(Call) as "TerminalMethods" in "terminal/" {
///         /// Starts a program on a PTY.
///         call open(Open) -> (), Run;
///         command close(One) -> (), Run;
///         stream watch(One) -> Piece, Run, read;
///         /// What the terminal shows now.
///         call screen(One) -> Screen, Read, tool "screen";
///     }
/// }
/// ```
///
/// After its right, a line takes marks: `read`, for a call or a stream
/// that only reads with a right other than `Read`; `tool "<name>"`, for
/// one an Agent calls; `pass`, for a machine's method a pass reaches
/// though it is no tool, as a Harness process asks for what is its own
/// (ADR 0078, decision 1). A `read` on a command, or on a line whose right
/// is `Read`, does not compile: it would say nothing true.
///
/// Each method needs a handler on the type, `async fn open(&self, ask:
/// Call, params: Open) -> Result<(), Refusal>`, and a stream's returns a
/// [`Stream`](crate::Stream). It makes, on the type:
///
/// - `fn method_right(name) -> Option<Right>`, for [`Module::right`](crate::Module::right);
/// - `fn method_kind(name) -> Option<Kind>`, for [`Module::kind`](crate::Module::kind);
/// - `async fn dispatch(&self, ask, name, params) -> Result<Value, Refusal>`,
///   for [`Module::call`](crate::Module::call);
/// - `async fn dispatch_stream(&self, ask, name, params) -> Result<Stream, Refusal>`,
///   for [`Module::stream`](crate::Module::stream);
/// - `fn method_tools(module) -> Vec<Tool>`, the lines marked `tool`, for
///   [`Module::tools`](crate::Module::tools); a tool's params implement
///   `schemars::JsonSchema`;
/// - `fn method_passes(name) -> bool`, whether the line is marked `pass`,
///   for [`Module::passes_reach`](crate::Module::passes_reach);
/// - [`MethodTable`], every line, and the TypeScript type's name and
///   folder, for `banda modules` and the list of Apps;
///
/// and the TypeScript type named after `as`, written in the folder after
/// `in` when the crate's tests run. A stream's piece is typed for the
/// window only: the handler returns an untyped [`Stream`](crate::Stream).
#[macro_export]
macro_rules! methods {
    (
        $ty:ident($ask:ty) as $ts:literal in $dir:literal {
            $(
                $(#[doc = $doc:literal])*
                $kind:ident $name:ident($params:ty) -> $answer:ty, $right:ident $(, $mark:ident $($tool:literal)?)*;
            )*
        }
    ) => {
        impl $ty {
            fn method_right(name: &str) -> Option<$crate::Right> {
                $( if name == $crate::methods::bare(stringify!($name)) {
                    return Some($crate::Right::$right);
                } )*
                None
            }

            #[allow(dead_code)]
            fn method_kind(name: &str) -> Option<$crate::Kind> {
                $( if name == $crate::methods::bare(stringify!($name)) {
                    return Some($crate::methods!(@kind $kind));
                } )*
                None
            }

            async fn dispatch(
                &self,
                ask: $ask,
                name: &str,
                params: serde_json::Value,
            ) -> Result<serde_json::Value, $crate::Refusal> {
                $( if name == $crate::methods::bare(stringify!($name)) {
                    return $crate::methods!(@call $kind self ask params $name $params, $answer);
                } )*
                Err($crate::Refusal::invalid(format!("There is no method \"{name}\".")))
            }

            #[allow(dead_code, unused_variables)]
            async fn dispatch_stream(
                &self,
                ask: $ask,
                name: &str,
                params: serde_json::Value,
            ) -> Result<$crate::Stream, $crate::Refusal> {
                $( if name == $crate::methods::bare(stringify!($name)) {
                    return $crate::methods!(@stream $kind self ask params $name $params);
                } )*
                Err($crate::Refusal::invalid(format!("There is no stream \"{name}\".")))
            }

            #[allow(dead_code)]
            fn method_passes(name: &str) -> bool {
                $( if name == $crate::methods::bare(stringify!($name)) {
                    return $crate::methods!(@pass $($mark $($tool)?)*);
                } )*
                false
            }

            #[allow(dead_code, unused_mut, unused_variables)]
            fn method_tools(module: &str) -> Vec<$crate::methods::Tool> {
                let mut tools = Vec::new();
                $( $crate::methods!(@tool tools module $kind $name($params) [$($doc)*] $($mark $($tool)?)*); )*
                tools
            }
        }

        impl $crate::methods::MethodTable for $ty {
            const TS: &'static str = $ts;
            const DIR: &'static str = $dir;

            fn method_list() -> Vec<$crate::methods::Method> {
                vec![$(
                    $crate::methods::Method {
                        name: $crate::methods::bare(stringify!($name)),
                        kind: $crate::methods!(@kind $kind),
                        right: $crate::Right::$right,
                        does: $crate::methods!(@does $kind $right [$($mark $($tool)?)*]),
                        tool: $crate::methods!(@tool_name $($mark $($tool)?)*),
                        pass: $crate::methods!(@pass $($mark $($tool)?)*),
                        about: $crate::methods::words(&[$($doc),*]),
                    },
                )*]
            }
        }

        #[allow(dead_code)]
        #[derive(ts_rs::TS)]
        #[ts(export, export_to = $dir, rename = $ts)]
        struct __Methods {
            $( $(#[doc = $doc])* $name: $crate::methods::$kind<$params, $answer>, )*
        }
    };

    (@kind call) => { $crate::Kind::Call };
    (@kind command) => { $crate::Kind::Command };
    (@kind stream) => { $crate::Kind::Stream };
    // A line's marks, after its right: `read`, `tool "<name>"` and `pass`.
    (@tool_name) => { None };
    (@tool_name tool $tool:literal $($marks:tt)*) => { Some($tool) };
    (@tool_name read $($marks:tt)*) => { $crate::methods!(@tool_name $($marks)*) };
    (@tool_name pass $($marks:tt)*) => { $crate::methods!(@tool_name $($marks)*) };
    (@tool_name $mark:tt $($marks:tt)*) => {
        compile_error!(concat!(
            "A method's marks are `read`, `tool \"<name>\"` and `pass`, not ",
            stringify!($mark),
            "."
        ))
    };
    (@pass) => { false };
    (@pass pass $($marks:tt)*) => { true };
    (@pass $mark:tt $($marks:tt)*) => { $crate::methods!(@pass $($marks)*) };
    (@tool $tools:ident $module:ident $kind:ident $name:ident($p:ty) [$($doc:literal)*]) => {};
    (@tool $tools:ident $module:ident $kind:ident $name:ident($p:ty) [$($doc:literal)*] tool $tool:literal $($marks:tt)*) => {
        $tools.push($crate::methods::Tool::new(
            $tool,
            format!("{}.{}", $module, $crate::methods::bare(stringify!($name))),
            $crate::methods!(@kind $kind),
            &[$($doc),*],
            $crate::schemars::schema_for!($p),
        ));
    };
    (@tool $tools:ident $module:ident $kind:ident $name:ident($p:ty) [$($doc:literal)*] $mark:tt $($marks:tt)*) => {
        $crate::methods!(@tool $tools $module $kind $name($p) [$($doc)*] $($marks)*)
    };
    // What a line does: a command acts; a call or a stream reads by its
    // right `Read`, or by `read`, and acts otherwise.
    (@does command $right:ident [$($marks:tt)*]) => { $crate::methods!(@acts $($marks)*) };
    (@does $kind:ident Read [$($marks:tt)*]) => { $crate::methods!(@reads $($marks)*) };
    (@does $kind:ident $right:ident [$($marks:tt)*]) => { $crate::methods!(@marked $($marks)*) };
    (@acts) => { $crate::methods::Does::Act };
    (@acts read $($marks:tt)*) => {
        compile_error!("A command acts: its line takes no `read`.")
    };
    (@acts $mark:tt $($marks:tt)*) => { $crate::methods!(@acts $($marks)*) };
    (@reads) => { $crate::methods::Does::Read };
    (@reads read $($marks:tt)*) => {
        compile_error!("A line whose right is `Read` reads already: it takes no `read`.")
    };
    (@reads $mark:tt $($marks:tt)*) => { $crate::methods!(@reads $($marks)*) };
    (@marked) => { $crate::methods::Does::Act };
    (@marked read $($marks:tt)*) => { $crate::methods::Does::Read };
    (@marked $mark:tt $($marks:tt)*) => { $crate::methods!(@marked $($marks)*) };

    (@call stream $self:ident $ask:ident $params:ident $name:ident $p:ty, $a:ty) => {
        Err($crate::Refusal::invalid(format!("{} is a stream.", $crate::methods::bare(stringify!($name)))))
    };

    (@call $kind:ident $self:ident $ask:ident $params:ident $name:ident $p:ty, $a:ty) => {{
        // The kernel refuses a module's command with no ID before it runs;
        // this guards its own `projects.*`, which keep no receipt yet.
        $crate::methods!(@check $kind $ask);
        let params: $p = $crate::decode($params)?;
        let answer: $a = $self.$name($ask, params).await?;
        $crate::methods::answer(answer)
    }};
    (@check command $ask:ident) => {
        $crate::methods::Asks::command_id(&$ask)?;
    };
    (@check call $ask:ident) => {};
    (@stream stream $self:ident $ask:ident $params:ident $name:ident $p:ty) => {{
        let params: $p = $crate::decode($params)?;
        $self.$name($ask, params).await
    }};
    (@stream $kind:ident $self:ident $ask:ident $params:ident $name:ident $p:ty) => {
        Err($crate::Refusal::invalid(format!("{} is not a stream.", $crate::methods::bare(stringify!($name)))))
    };
}
