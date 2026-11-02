//! How a turn ended, and a failure's class: from ACP's stop reasons and
//! error codes, and the data the adapters attach to an error (`errorKind`
//! from Claude Code's, `codexErrorInfo` from Codex's); a usage limit's
//! reset from Claude Code's rate limit updates.

use super::*;

/// When a rejected account may be used again, from Claude Code's rate
/// limit update: `{status, resetsAt}` in seconds.
pub(super) fn resets(meta: Option<&acp::Meta>) -> Option<i64> {
    let limit = meta?.get("_claude/rateLimit")?;
    let rejected = limit.get("status")?.as_str()? == "rejected";
    let at = limit.get("resetsAt")?.as_i64()?;
    rejected.then_some(at.saturating_mul(1000))
}

/// Whether the request failed because the Harness's process went away.
pub(super) fn gone(error: &acp::Error) -> bool {
    agent_client_protocol::is_connection_terminated(error)
        || agent_client_protocol::is_incoming_transport_closed(error)
}

/// How a turn ends on an error from its Harness: the class from ACP's code
/// and the data the adapter attached, in the Harness's own words when it
/// gave some.
pub(super) fn failed(name: &str, error: &acp::Error) -> Ending {
    let data = error.data.as_ref();
    let said = |key: &str| data.and_then(|d| d.get(key)).and_then(|v| v.as_str());
    let failure = if error.code == acp::ErrorCode::AuthRequired {
        Failure::SignIn
    } else {
        match said("errorKind").or_else(|| said("codexErrorInfo")) {
            Some("authentication_failed" | "oauth_org_not_allowed" | "unauthorized") => {
                Failure::SignIn
            }
            Some(
                "rate_limit" | "billing_error" | "account_on_hold" | "usageLimitExceeded"
                | "rateLimitExceeded",
            ) => Failure::UsageLimit { until: None },
            _ => Failure::Provider,
        }
    };
    let words = said("message").map(str::to_owned).or_else(|| {
        let message = error.message.trim();
        let message = message.strip_prefix("Internal error").unwrap_or(message);
        let message = message.trim_start_matches(':').trim();
        (!message.is_empty()).then(|| message.to_owned())
    });
    let reason = match (failure, words) {
        (Failure::SignIn, _) => format!("{name} needs you to sign in."),
        (_, Some(words)) => words,
        (Failure::UsageLimit { .. }, None) => format!("{name} has reached its usage limit."),
        (_, None) => format!("{name} reported an error."),
    };
    Ending::failed(reason, Some(failure))
}

pub(super) fn ending(reason: &acp::StopReason) -> Ending {
    let (state, reason) = match reason {
        acp::StopReason::EndTurn => (TurnState::Done, None),
        acp::StopReason::Cancelled => (TurnState::Stopped, None),
        acp::StopReason::MaxTokens => (
            TurnState::Done,
            Some("The Agent reached the most it may write in one turn."),
        ),
        acp::StopReason::MaxTurnRequests => (
            TurnState::Done,
            Some("The Agent reached the most steps it may take in one turn."),
        ),
        acp::StopReason::Refusal => (TurnState::Done, Some("The Agent declined to go on.")),
        _ => (TurnState::Done, None),
    };
    Ending::new(state, reason)
}
