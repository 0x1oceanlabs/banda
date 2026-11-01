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
//!   `engine.command`.
//! - `stream`: pieces until it ends (`Module::stream`); its "answer" is
//!   the piece; `engine.stream`.

use crate::{CommandId, Refusal};
use serde::de::{Deserialize, Deserializer, IgnoredAny};
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
///         stream watch(One) -> Piece, Run;
///     }
/// }
/// ```
///
/// Each method needs a handler on the type, `async fn open(&self, ask:
/// Call, params: Open) -> Result<(), Refusal>`, and a stream's returns a
/// [`Stream`](crate::Stream). It makes, on the type:
///
/// - `fn method_right(name) -> Option<Right>`, for [`Module::right`](crate::Module::right);
/// - `async fn dispatch(&self, ask, name, params) -> Result<Value, Refusal>`,
///   for [`Module::call`](crate::Module::call);
/// - `async fn dispatch_stream(&self, ask, name, params) -> Result<Stream, Refusal>`,
///   for [`Module::stream`](crate::Module::stream);
///
/// and the TypeScript type named after `as`, written in the folder after
/// `in` when the crate's tests run. A stream's piece is typed for the
/// window only: the handler returns an untyped [`Stream`](crate::Stream).
#[macro_export]
macro_rules! methods {
    (
        $ty:ident($ask:ty) as $ts:literal in $dir:literal {
            $( $(#[$doc:meta])* $kind:ident $name:ident($params:ty) -> $answer:ty, $right:ident; )*
        }
    ) => {
        impl $ty {
            fn method_right(name: &str) -> Option<$crate::Right> {
                match name {
                    $( stringify!($name) => Some($crate::Right::$right), )*
                    _ => None,
                }
            }

            async fn dispatch(
                &self,
                ask: $ask,
                name: &str,
                params: serde_json::Value,
            ) -> Result<serde_json::Value, $crate::Refusal> {
                match name {
                    $( stringify!($name) => $crate::methods!(@call $kind self ask params $name $params, $answer), )*
                    _ => Err($crate::Refusal::invalid(format!("There is no method \"{name}\"."))),
                }
            }

            #[allow(dead_code, unused_variables)]
            async fn dispatch_stream(
                &self,
                ask: $ask,
                name: &str,
                params: serde_json::Value,
            ) -> Result<$crate::Stream, $crate::Refusal> {
                match name {
                    $( stringify!($name) => $crate::methods!(@stream $kind self ask params $name $params), )*
                    _ => Err($crate::Refusal::invalid(format!("There is no stream \"{name}\"."))),
                }
            }
        }

        #[allow(dead_code)]
        #[derive(ts_rs::TS)]
        #[ts(export, export_to = $dir, rename = $ts)]
        struct __Methods {
            $( $(#[$doc])* $name: $crate::methods::$kind<$params, $answer>, )*
        }
    };

    (@call stream $self:ident $ask:ident $params:ident $name:ident $p:ty, $a:ty) => {
        Err($crate::Refusal::invalid(concat!(stringify!($name), " is a stream.")))
    };

    (@call $kind:ident $self:ident $ask:ident $params:ident $name:ident $p:ty, $a:ty) => {{
        // A command may act before it writes, so it needs its ID first.
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
        Err($crate::Refusal::invalid(concat!(stringify!($name), " is not a stream.")))
    };
}
