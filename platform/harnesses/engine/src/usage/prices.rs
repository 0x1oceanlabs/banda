//! Standard text-token API estimates, from the price table shipped with
//! this build. Service tiers and server tool charges are not inferred.
use super::journal::Record;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::LazyLock;

#[derive(Deserialize)]
struct Prices {
    revision: String,
    models: BTreeMap<String, BTreeMap<String, f64>>,
}
static PRICES: LazyLock<Prices> = LazyLock::new(|| {
    serde_json::from_str(include_str!("prices.json")).expect("the shipped price table")
});

pub(super) fn revision() -> String {
    PRICES.revision.clone()
}

pub(super) fn cost(record: &Record) -> Option<f64> {
    if record.prompt {
        return Some(0.0);
    }
    if let Some(cost) = record.recorded_cost {
        return Some(cost);
    }
    let rates = PRICES.models.get(&record.model)?;
    let tokens = &record.tokens;
    let context = tokens
        .input
        .saturating_add(tokens.cache_read)
        .saturating_add(tokens.cache_write);
    // LiteLLM names long-context tiers explicitly. Prefer the largest
    // matching threshold, falling back to the ordinary rate per category.
    let suffix = if context > 272_000
        && rates.contains_key("input_cost_per_token_above_272k_tokens")
    {
        "_above_272k_tokens"
    } else if context > 200_000 && rates.contains_key("input_cost_per_token_above_200k_tokens") {
        "_above_200k_tokens"
    } else {
        ""
    };
    let rate = |name: &str| {
        rates
            .get(&format!("{name}{suffix}"))
            .or_else(|| rates.get(name))
            .copied()
    };
    let charge = |n: u64, name: &str| {
        if n == 0 {
            Some(0.0)
        } else {
            rate(name).map(|r| r * n as f64)
        }
    };
    let long = record.cache_write_long.min(tokens.cache_write);
    let cost = charge(tokens.input, "input_cost_per_token")?
        + charge(tokens.cache_read, "cache_read_input_token_cost")?
        + charge(tokens.cache_write - long, "cache_creation_input_token_cost")?
        + charge(long, "cache_creation_input_token_cost_above_1hr")?
        + charge(tokens.output, "output_cost_per_token")?;
    cost.is_finite().then_some(cost)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usage::model::UsageTokens;
    #[test]
    fn unknown_is_not_free_and_a_recorded_cost_wins() {
        let mut record = Record {
            key: "x".into(),
            timestamp: "".into(),
            model: "not-a-model".into(),
            tokens: UsageTokens {
                input: 100,
                ..Default::default()
            },
            session: "s".into(),
            prompt: false,
            recorded_cost: None,
            cache_write_long: 0,
        };
        assert_eq!(cost(&record), None);
        record.recorded_cost = Some(0.25);
        assert_eq!(cost(&record), Some(0.25));
        record.recorded_cost = None;
        record.model = "gpt-5".into();
        record.tokens = UsageTokens {
            input: 1_000_000,
            cache_read: 1_000_000,
            output: 1_000_000,
            cache_write: 0,
        };
        assert!((cost(&record).unwrap() - 11.375).abs() < 0.000001);
    }
}
