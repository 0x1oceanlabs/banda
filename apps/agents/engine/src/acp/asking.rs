//! What a Harness asks a Person: its permission options, the plan it
//! asks to carry out, and its forms.

use super::*;

/// A form Question's answers: submit it, or skip it.
pub(super) const SUBMIT: &str = "accept";
pub(super) const SKIP: &str = "decline";

/// A form's fields, from the JSON Schema the Harness asks with. A field of
/// a kind Banda cannot show is left out.
pub(super) fn form_fields(schema: &acp::ElicitationSchema) -> Option<Vec<Field>> {
    let required = schema.required.as_deref().unwrap_or_default();
    let choices = |options: &[acp::EnumOption]| {
        options
            .iter()
            .map(|o| OptionChoice {
                value: o.value.clone(),
                name: o.title.clone(),
                description: o.description.clone(),
            })
            .collect::<Vec<_>>()
    };
    let named = |values: &[String]| {
        values
            .iter()
            .map(|v| OptionChoice {
                value: v.clone(),
                name: v.clone(),
                description: None,
            })
            .collect::<Vec<_>>()
    };
    let number = |n: Option<f64>| n.and_then(serde_json::Number::from_f64);
    let count = |n: Option<u64>| n.map(|n| u32::try_from(n).unwrap_or(u32::MAX));
    let mut fields = Vec::new();
    for (id, property) in &schema.properties {
        use acp::ElicitationPropertySchema as Property;
        let mut secret = false;
        let shown = match property {
            Property::String(text) => {
                // Codex marks a question whose answer is a secret.
                secret = text
                    .meta
                    .as_ref()
                    .and_then(|m| m.get("codex")?.get("isSecret")?.as_bool())
                    .unwrap_or(false);
                let input = match (&text.one_of, &text.enum_values) {
                    (Some(options), _) => Input::Choice {
                        choices: choices(options),
                        default: text.default.clone(),
                    },
                    (None, Some(values)) => Input::Choice {
                        choices: named(values),
                        default: text.default.clone(),
                    },
                    (None, None) => Input::Text {
                        default: text.default.clone(),
                        shortest: text.min_length,
                        longest: text.max_length,
                        format: text.format.and_then(|f| match f {
                            acp::StringFormat::Email => Some(TextFormat::Email),
                            acp::StringFormat::Uri => Some(TextFormat::Uri),
                            acp::StringFormat::Date => Some(TextFormat::Date),
                            acp::StringFormat::DateTime => Some(TextFormat::DateTime),
                            _ => None,
                        }),
                    },
                };
                Some((&text.title, &text.description, input))
            }
            Property::Number(n) => Some((
                &n.title,
                &n.description,
                Input::Number {
                    integer: false,
                    minimum: number(n.minimum),
                    maximum: number(n.maximum),
                    default: number(n.default),
                },
            )),
            Property::Integer(n) => Some((
                &n.title,
                &n.description,
                Input::Number {
                    integer: true,
                    minimum: n.minimum.map(Into::into),
                    maximum: n.maximum.map(Into::into),
                    default: n.default.map(Into::into),
                },
            )),
            Property::Boolean(toggle) => Some((
                &toggle.title,
                &toggle.description,
                Input::Toggle {
                    default: toggle.default,
                },
            )),
            Property::Array(many) => {
                let options = match &many.items {
                    acp::MultiSelectItems::String(items) => Some(named(&items.values)),
                    acp::MultiSelectItems::Titled(items) => Some(choices(&items.options)),
                    _ => None,
                };
                options.map(|options| {
                    let input = Input::Choices {
                        choices: options,
                        default: many.default.clone().unwrap_or_default(),
                        fewest: count(many.min_items),
                        most: count(many.max_items),
                    };
                    (&many.title, &many.description, input)
                })
            }
            _ => None,
        };
        let required = required.contains(id);
        match shown {
            Some((title, description, input)) => fields.push(Field {
                id: id.clone(),
                title: title.clone().unwrap_or_else(|| id.clone()),
                description: description.clone(),
                required,
                secret,
                input,
                other: None,
            }),
            // A field the Person cannot fill in: the form cannot be
            // submitted without it.
            None if required => return None,
            None => {}
        }
    }
    // The schema keeps no order; Claude Code's and Codex's IDs number
    // their questions, so `question_2` comes before `question_10`.
    fields.sort_by_cached_key(|f| natural(&f.id));
    pair_own_answers(&mut fields);
    Some(fields)
}

/// Gives each field of choices the text field that answers it in the
/// Person's own words: Claude Code's AskUserQuestion follows `question_0`
/// with `question_0_custom`, an optional text titled "Other" that it marks
/// for no client but JetBrains AIR. Paired by that ID, not by the title.
fn pair_own_answers(fields: &mut [Field]) {
    let texts: Vec<String> = fields
        .iter()
        .filter(|f| matches!(f.input, Input::Text { .. }) && !f.required && !f.secret)
        .map(|f| f.id.clone())
        .collect();
    for field in fields.iter_mut() {
        if !matches!(field.input, Input::Choice { .. } | Input::Choices { .. }) {
            continue;
        }
        let own = format!("{}_custom", field.id);
        if texts.contains(&own) {
            field.other = Some(own);
        }
    }
}

/// An ID's words and numbers, so numbers sort as numbers.
fn natural(id: &str) -> Vec<(String, u64)> {
    let mut parts = Vec::new();
    let mut rest = id;
    while !rest.is_empty() {
        let digits = rest
            .find(|c: char| c.is_ascii_digit())
            .unwrap_or(rest.len());
        let (word, after) = rest.split_at(digits);
        let end = after
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(after.len());
        let (number, after) = after.split_at(end);
        parts.push((word.to_owned(), number.parse().unwrap_or(0)));
        rest = after;
    }
    parts
}

/// What a Person filled in, as the Harness takes it.
pub(super) fn content(
    fields: &[Field],
    values: Values,
) -> BTreeMap<String, acp::ElicitationContentValue> {
    use acp::ElicitationContentValue as Content;
    values
        .into_iter()
        .filter_map(|(id, value)| {
            let integer = fields
                .iter()
                .any(|f| f.id == id && matches!(f.input, Input::Number { integer: true, .. }));
            let value = match value {
                FieldValue::Text(text) => Content::String(text),
                FieldValue::Toggle(on) => Content::Boolean(on),
                FieldValue::Number(n) if integer => Content::Integer(n.as_i64()?),
                FieldValue::Number(n) => Content::Number(n.as_f64()?),
                FieldValue::Choices(values) => Content::StringArray(values),
            };
            Some((id, value))
        })
        .collect()
}

pub(super) fn offered(option: &acp::PermissionOption) -> Choice {
    use acp::PermissionOptionKind as Kind;
    Choice {
        id: option.option_id.0.to_string(),
        name: option.name.clone(),
        allows: matches!(option.kind, Kind::AllowOnce | Kind::AllowAlways),
        always: matches!(option.kind, Kind::AllowAlways | Kind::RejectAlways),
    }
}

/// The plan a Harness asks to carry out: Claude Code leaves plan mode by
/// asking, the plan in what it would call the tool with.
pub(super) fn proposed(fields: &acp::ToolCallUpdateFields) -> Option<String> {
    if fields.kind != Some(acp::ToolKind::SwitchMode) {
        return None;
    }
    let plan = fields.raw_input.as_ref()?.get("plan")?.as_str()?.trim();
    (!plan.is_empty()).then(|| plan.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_asking_to_leave_plan_mode_brings_its_plan() {
        let asks = |kind, input: serde_json::Value| {
            proposed(&acp::ToolCallUpdateFields::new().kind(kind).raw_input(input))
        };
        let plan = serde_json::json!({ "plan": "  # Plan\n\n1. Read it.\n" });
        assert_eq!(
            asks(acp::ToolKind::SwitchMode, plan.clone()).as_deref(),
            Some("# Plan\n\n1. Read it.")
        );
        assert_eq!(
            asks(acp::ToolKind::Execute, plan),
            None,
            "only leaving a mode"
        );
        let empty = serde_json::json!({ "plan": " " });
        assert_eq!(asks(acp::ToolKind::SwitchMode, empty), None);
    }

    fn schema(properties: serde_json::Value, required: &[&str]) -> acp::ElicitationSchema {
        let schema = serde_json::json!({
            "type": "object",
            "properties": properties,
            "required": required,
        });
        serde_json::from_value(schema).unwrap()
    }

    #[test]
    fn a_form_keeps_its_questions_in_order_and_its_secrets_marked() {
        let text = serde_json::json!({ "type": "string" });
        let secret = serde_json::json!({
            "type": "string",
            "_meta": { "codex": { "isSecret": true } },
        });
        let form = schema(
            serde_json::json!({
                "question_10": text,
                "question_2": text,
                "question_2_custom": text,
                "key": secret,
            }),
            &[],
        );
        let fields = form_fields(&form).unwrap();
        let ids: Vec<_> = fields.iter().map(|f| (f.id.as_str(), f.secret)).collect();
        assert_eq!(
            ids,
            [
                ("key", true),
                ("question_2", false),
                ("question_2_custom", false),
                ("question_10", false),
            ]
        );
    }

    #[test]
    fn a_question_of_choices_gets_the_field_that_answers_it_in_ones_own_words() {
        let one = serde_json::json!({
            "type": "string",
            "oneOf": [{ "const": "Red", "title": "Red" }],
        });
        let many = serde_json::json!({
            "type": "array",
            "items": { "anyOf": [{ "const": "Tea", "title": "Tea" }] },
        });
        let text = serde_json::json!({ "type": "string", "title": "Other" });
        let form = schema(
            serde_json::json!({
                "question_0": one,
                "question_0_custom": text,
                "question_1": many,
                "question_1_custom": text,
                "name": text,
                "name_custom": text,
                "lone": one,
            }),
            &[],
        );
        let fields = form_fields(&form).unwrap();
        let other = |id: &str| {
            fields
                .iter()
                .find(|f| f.id == id)
                .and_then(|f| f.other.as_deref())
        };
        assert_eq!(other("question_0"), Some("question_0_custom"));
        assert_eq!(other("question_1"), Some("question_1_custom"));
        assert_eq!(other("name"), None, "only a field of choices");
        assert_eq!(other("lone"), None, "only with its text field there");
        assert_eq!(fields.len(), 7, "the text fields stay in the form");
    }

    #[test]
    fn a_form_with_a_required_field_banda_cannot_show_is_not_asked() {
        let future = serde_json::json!({ "type": "colour" });
        let optional = schema(serde_json::json!({ "shade": future }), &[]);
        assert_eq!(form_fields(&optional).unwrap(), []);
        let required = schema(serde_json::json!({ "shade": future }), &["shade"]);
        assert_eq!(form_fields(&required), None);
    }

    #[test]
    fn what_a_person_filled_in_goes_back_as_each_field_takes_it() {
        let form = schema(
            serde_json::json!({
                "count": { "type": "integer" },
                "share": { "type": "number" },
                "tags": { "type": "array", "items": { "type": "string", "enum": ["a", "b"] } },
            }),
            &[],
        );
        let fields = form_fields(&form).unwrap();
        let values: Values = serde_json::from_value(serde_json::json!({
            "count": 3, "share": 0.5, "tags": ["b"],
        }))
        .unwrap();
        let sent = serde_json::to_value(content(&fields, values)).unwrap();
        assert_eq!(
            sent,
            serde_json::json!({ "count": 3, "share": 0.5, "tags": ["b"] })
        );
    }
}
