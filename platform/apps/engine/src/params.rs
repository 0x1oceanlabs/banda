//! A method's params, held to the JSON Schema its App declares for them
//! before the method runs, so an App's code is handed what it said it
//! takes. The engine reads the words an App's Form is made from too:
//! `type`, `enum`, `required`, `properties`, `additionalProperties:
//! false` and `items`. The rest of JSON Schema (a pattern, a range, a
//! format, `oneOf`) it lets through: the App checks that itself.

use serde_json::Value;

/// What goes wrong first in `value` by `schema`, with where: `params.name
/// is required`. `Ok` for one that fits what the engine reads.
pub(crate) fn check(schema: &Value, value: &Value) -> Result<(), String> {
    fits(schema, value, "params")
}

fn fits(schema: &Value, value: &Value, at: &str) -> Result<(), String> {
    if let Some(wanted) = schema.get("type") {
        let one = std::slice::from_ref(wanted);
        let wanted = wanted.as_array().map_or(one, Vec::as_slice);
        if !wanted
            .iter()
            .filter_map(Value::as_str)
            .any(|kind| is(kind, value))
        {
            let kinds: Vec<&str> = wanted.iter().filter_map(Value::as_str).collect();
            return Err(format!(
                "{at} is {}, not {}",
                named(value),
                kinds.join(" or ")
            ));
        }
    }
    if let Some(among) = schema.get("enum").and_then(Value::as_array)
        && !among.contains(value)
    {
        let among: Vec<String> = among.iter().map(Value::to_string).collect();
        return Err(format!("{at} is {value}, not one of {}", among.join(", ")));
    }
    if let Some(fields) = value.as_object() {
        let required = schema.get("required").and_then(Value::as_array);
        let required = required.into_iter().flatten().filter_map(Value::as_str);
        if let Some(name) = required
            .into_iter()
            .find(|name| !fields.contains_key(*name))
        {
            return Err(format!("{at}.{name} is required"));
        }
        let declared = schema.get("properties").and_then(Value::as_object);
        let closed = schema.get("additionalProperties") == Some(&Value::Bool(false));
        for (name, field) in fields {
            match declared.and_then(|declared| declared.get(name)) {
                Some(schema) => fits(schema, field, &format!("{at}.{name}"))?,
                None if closed => return Err(format!("{at}.{name} is not a param it takes")),
                None => {}
            }
        }
    }
    if let (Some(items), Some(each)) = (value.as_array(), schema.get("items")) {
        for (index, item) in items.iter().enumerate() {
            fits(each, item, &format!("{at}[{index}]"))?;
        }
    }
    Ok(())
}

/// Whether `value` is of the JSON Schema type `kind`; one the engine does
/// not know fits.
fn is(kind: &str, value: &Value) -> bool {
    match kind {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "boolean" => value.is_boolean(),
        "null" => value.is_null(),
        "number" => value.is_number(),
        // 2.0 is an integer, as JSON Schema says.
        "integer" => value.as_f64().is_some_and(|number| number.fract() == 0.0),
        _ => true,
    }
}

/// What `value` is, in JSON Schema's words.
fn named(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "an array",
        Value::Object(_) => "an object",
    }
}

#[cfg(test)]
mod tests {
    use super::check;
    use serde_json::json;

    #[test]
    fn params_are_held_to_the_words_of_the_schema_the_engine_reads() {
        let schema = json!({
            "type": "object",
            "required": ["name"],
            "additionalProperties": false,
            "properties": {
                "name": { "type": "string" },
                "stage": { "enum": ["lead", "won"] },
                "worth": { "type": ["integer", "null"] },
                "tags": { "type": "array", "items": { "type": "string" } },
                "site": { "type": "string", "format": "uri", "pattern": "^https" },
            },
        });
        let fits =
            json!({ "name": "Ada", "stage": "won", "worth": 2.0, "tags": ["a"], "site": "x" });
        assert_eq!(check(&schema, &fits), Ok(()));
        for (params, why) in [
            (json!({}), "params.name is required"),
            (json!([]), "params is an array, not object"),
            (json!({ "name": 1 }), "params.name is a number, not string"),
            (
                json!({ "name": "Ada", "stage": "lost" }),
                "params.stage is \"lost\", not one of \"lead\", \"won\"",
            ),
            (
                json!({ "name": "Ada", "worth": 1.5 }),
                "params.worth is a number, not integer or null",
            ),
            (
                json!({ "name": "Ada", "tags": ["a", 2] }),
                "params.tags[1] is a number, not string",
            ),
            (
                json!({ "name": "Ada", "more": 1 }),
                "params.more is not a param it takes",
            ),
        ] {
            assert_eq!(check(&schema, &params), Err(why.to_owned()), "{params}");
        }
        // An object that does not close itself takes what it does not name.
        let open = json!({ "type": "object", "properties": {} });
        assert_eq!(check(&open, &json!({ "more": 1 })), Ok(()));
    }
}
