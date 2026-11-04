use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Token categories do not overlap: cache reads are not included in input.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct UsageTokens {
    #[ts(type = "number")]
    pub input: u64,
    #[ts(type = "number")]
    pub cache_read: u64,
    #[ts(type = "number")]
    pub cache_write: u64,
    #[ts(type = "number")]
    pub output: u64,
}

/// Costs are USD API estimates using the shipped price snapshot. A
/// journal's explicit cost takes precedence. Unpriced requests are counted
/// separately; zero known cost never means that unknown usage was free.
#[derive(Clone, Debug, Default, Serialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct UsageTotal {
    pub tokens: UsageTokens,
    #[ts(type = "number")]
    pub sessions: u64,
    #[ts(type = "number")]
    pub prompts: u64,
    #[ts(type = "number")]
    pub requests: u64,
    pub cost_usd: f64,
    #[ts(type = "number")]
    pub unpriced: u64,
}

/// One UTC day's usage by Harness entry and model. Session counts across
/// rows overlap: use the overall total for a distinct session count.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct UsageRow {
    /// UTC midnight, in milliseconds since 1970.
    #[ts(type = "number")]
    pub day: i64,
    pub harness: String,
    pub model: String,
    pub total: UsageTotal,
}

#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct UsageRead {
    pub harness: String,
    pub name: String,
    #[ts(type = "number | null")]
    pub read_at: Option<i64>,
    /// A partial scan or inaccessible journal is visible, not a zero total.
    pub problems: Vec<String>,
}

/// The machine's local journal usage, including sessions outside Banda.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct UsageNow {
    #[ts(type = "number")]
    pub at: i64,
    pub reading: bool,
    #[ts(type = "number")]
    pub since: i64,
    #[ts(type = "number")]
    pub until: i64,
    pub price_revision: String,
    pub total: UsageTotal,
    pub rows: Vec<UsageRow>,
    pub reads: Vec<UsageRead>,
}
