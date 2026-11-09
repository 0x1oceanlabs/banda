//! Hex colours, and mixing two of them as Omarchy's templates do
//! (`{{ mix a b 6% }}`): each channel moves `amount` of the way, rounded.

/// `#rgb`, `#rrggbb` or `#rrggbbaa`: red, green, blue and alpha.
pub fn parse_hex(text: &str) -> Option<(u8, u8, u8, u8)> {
    let hex = text.strip_prefix('#')?;
    if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let pair = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    match hex.len() {
        3 => {
            let one = |i: usize| u8::from_str_radix(&hex[i..=i], 16).ok().map(|v| v * 17);
            Some((one(0)?, one(1)?, one(2)?, 255))
        }
        6 => Some((pair(0)?, pair(2)?, pair(4)?, 255)),
        8 => Some((pair(0)?, pair(2)?, pair(4)?, pair(6)?)),
        _ => None,
    }
}

pub fn is_hex(text: &str) -> bool {
    parse_hex(text).is_some()
}

/// `from` moved `amount` (0 to 1) of the way to `to`, as `#rrggbb`. Alpha
/// is dropped, as Omarchy drops it.
pub fn mix(from: &str, to: &str, amount: f64) -> Option<String> {
    let (r1, g1, b1, _) = parse_hex(from)?;
    let (r2, g2, b2, _) = parse_hex(to)?;
    let amount = amount.clamp(0.0, 1.0);
    let channel = |a: u8, b: u8| {
        let value = f64::from(a) * (1.0 - amount) + f64::from(b) * amount + 0.5;
        value.floor().clamp(0.0, 255.0) as u8
    };
    Some(format!(
        "#{:02x}{:02x}{:02x}",
        channel(r1, r2),
        channel(g1, g2),
        channel(b1, b2)
    ))
}

/// Whether a value can stand in CSS as a colour as it is: hex, a colour
/// function, or a word such as `transparent`. The window's CSS decides the
/// rest; this only keeps out what could break the declaration.
pub fn is_css_color(text: &str) -> bool {
    let text = text.trim();
    if text.is_empty() || text.len() > 200 {
        return false;
    }
    if text.starts_with('#') {
        return is_hex(text);
    }
    text.bytes().all(|b| {
        b.is_ascii_alphanumeric()
            || matches!(
                b,
                b'(' | b')' | b' ' | b',' | b'.' | b'%' | b'/' | b'-' | b'+'
            )
    }) && text.bytes().filter(|&b| b == b'(').count() == text.bytes().filter(|&b| b == b')').count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixes_as_omarchy_rounds() {
        // forest-dusk's sidebarRowHover in t3code.json: mix dark_background foreground 6%.
        assert_eq!(mix("#131d18", "#dac49d", 0.06).as_deref(), Some("#1f2720"));
        // forest-dusk's sidebarRowActive: mix dark_background accent 18%.
        assert_eq!(mix("#131d18", "#a3b88c", 0.18).as_deref(), Some("#2d392d"));
        assert_eq!(mix("#fff", "#000", 0.5).as_deref(), Some("#808080"));
        assert_eq!(mix("oklch(1 0 0)", "#000", 0.5), None);
    }

    #[test]
    fn css_colours_pass_and_injections_do_not() {
        for ok in [
            "#a3b88c",
            "oklch(0.68 0.21 41)",
            "rgb(1 2 3 / 50%)",
            "transparent",
        ] {
            assert!(is_css_color(ok), "{ok}");
        }
        for bad in ["", "#zzz", "red; --x: 1", "url(x)}", "a{b}", "#12"] {
            assert!(!is_css_color(bad), "{bad}");
        }
    }
}
