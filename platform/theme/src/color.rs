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

/// The functions a colour may be written with: CSS's own colour
/// functions, nothing that refers to another value or works one out.
const COLOUR_FUNCTIONS: [&str; 10] = [
    "rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color",
];

/// Whether a value is a colour as it is, a value every client can draw
/// (ADR 0080, decision 7): hex, a colour function of numbers, such as
/// `oklch(0.6 0.2 250 / 50%)`, or one word, such as `transparent` or a
/// palette's name such as `dark_background`, which a token names. Never
/// `var()`, `color-mix()` or any other function, and nothing that could
/// break the declaration it goes into.
pub fn is_css_color(text: &str) -> bool {
    let text = text.trim();
    if text.is_empty() || text.len() > 200 {
        return false;
    }
    if text.starts_with('#') {
        return is_hex(text);
    }
    let word = |text: &str| {
        !text.is_empty()
            && text
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    };
    let Some((function, rest)) = text.split_once('(') else {
        return word(text);
    };
    let inside = rest.strip_suffix(')').unwrap_or("(");
    COLOUR_FUNCTIONS.contains(&function.to_ascii_lowercase().as_str())
        && inside.bytes().all(|b| {
            b.is_ascii_alphanumeric() || matches!(b, b' ' | b',' | b'.' | b'%' | b'/' | b'-' | b'+')
        })
}

/// A colour in Oklab, with its alpha: the space CSS's `color-mix(in
/// oklab, …)` works in, so a colour worked out here draws as the page's
/// own mix of it did (ADR 0080, decision 8).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Oklab {
    pub l: f64,
    pub a: f64,
    pub b: f64,
    pub alpha: f64,
}

impl Oklab {
    /// A CSS colour as it is: hex, `rgb()`, `hsl()`, `oklab()`,
    /// `oklch()`, or `transparent`, `white` or `black`; none for any other
    /// (a named colour, `lab()`, `color()`).
    pub fn parse(text: &str) -> Option<Oklab> {
        let text = text.trim().to_ascii_lowercase();
        match text.as_str() {
            "transparent" => return Some(Oklab::srgb(0.0, 0.0, 0.0, 0.0)),
            "white" => return Some(Oklab::srgb(1.0, 1.0, 1.0, 1.0)),
            "black" => return Some(Oklab::srgb(0.0, 0.0, 0.0, 1.0)),
            _ => {}
        }
        if let Some((r, g, b, a)) = parse_hex(&text) {
            let unit = |v: u8| f64::from(v) / 255.0;
            return Some(Oklab::srgb(unit(r), unit(g), unit(b), unit(a)));
        }
        let (function, channels, alpha) = written(&text)?;
        let [x, y, z] = channels[..] else {
            return None;
        };
        match function {
            "rgb" => Some(Oklab::srgb(
                number(x, 255.0)? / 255.0,
                number(y, 255.0)? / 255.0,
                number(z, 255.0)? / 255.0,
                alpha,
            )),
            "oklab" => Some(Oklab {
                l: number(x, 1.0)?,
                a: number(y, 0.4)?,
                b: number(z, 0.4)?,
                alpha,
            }),
            "hsl" => {
                let h = number(x.trim_end_matches("deg"), 1.0)?.rem_euclid(360.0);
                let (s, l) = (number(y, 100.0)? / 100.0, number(z, 100.0)? / 100.0);
                let channel = |n: f64| {
                    let k = (n + h / 30.0) % 12.0;
                    l - s * l.min(1.0 - l) * (k - 3.0).min(9.0 - k).clamp(-1.0, 1.0)
                };
                Some(Oklab::srgb(channel(0.0), channel(8.0), channel(4.0), alpha))
            }
            "oklch" => {
                let (c, h) = (number(y, 0.4)?, number(z.trim_end_matches("deg"), 1.0)?);
                let h = h.to_radians();
                Some(Oklab {
                    l: number(x, 1.0)?,
                    a: c * h.cos(),
                    b: c * h.sin(),
                    alpha,
                })
            }
            _ => None,
        }
    }

    /// From sRGB's channels, 0 to 1, as CSS has them.
    fn srgb(r: f64, g: f64, b: f64, alpha: f64) -> Oklab {
        let linear = |c: f64| {
            if c <= 0.04045 {
                c / 12.92
            } else {
                ((c + 0.055) / 1.055).powf(2.4)
            }
        };
        let (r, g, b) = (linear(r), linear(g), linear(b));
        let l = (0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b).cbrt();
        let m = (0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b).cbrt();
        let s = (0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b).cbrt();
        Oklab {
            l: 0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
            a: 1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
            b: 0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
            alpha,
        }
    }

    /// `share` of this colour, the rest `other`: what `color-mix(in
    /// oklab, it share, other)` draws, each weighed by its alpha.
    pub fn mix(self, other: Oklab, share: f64) -> Oklab {
        let share = share.clamp(0.0, 1.0);
        let (w1, w2) = (self.alpha * share, other.alpha * (1.0 - share));
        let alpha = w1 + w2;
        if alpha <= 0.0 {
            return Oklab { alpha: 0.0, ..self };
        }
        let channel = |a: f64, b: f64| (a * w1 + b * w2) / alpha;
        Oklab {
            l: channel(self.l, other.l),
            a: channel(self.a, other.a),
            b: channel(self.b, other.b),
            alpha,
        }
    }

    /// As CSS: `oklab(L a b)`, with `/ alpha` when it is not solid.
    pub fn css(self) -> String {
        let (l, a, b) = (decimal(self.l), decimal(self.a), decimal(self.b));
        format!("oklab({l} {a} {b}{})", alpha_of(self.alpha))
    }
}

/// `text` as solid as `share` (0 to 1): what `color-mix(in oklab, text
/// share, transparent)` draws. Only the alpha changes, so it is written as
/// it was with the alpha, in no other space, and draws exactly as the mix
/// did (hex as `rgb()`). None for a colour it cannot read: a named one
/// but `transparent`, `white` and `black`.
pub fn thinned(text: &str, share: f64) -> Option<String> {
    let share = share.clamp(0.0, 1.0);
    let text = text.trim().to_ascii_lowercase();
    let text = match text.as_str() {
        "transparent" => return Some(text),
        "white" => "#ffffff".to_owned(),
        "black" => "#000000".to_owned(),
        _ => text,
    };
    if let Some((r, g, b, a)) = parse_hex(&text) {
        let alpha = alpha_of(f64::from(a) / 255.0 * share);
        return Some(format!("rgb({r} {g} {b}{alpha})"));
    }
    let (function, channels, alpha) = written(&text)?;
    let channels = channels.join(" ");
    Some(format!("{function}({channels}{})", alpha_of(alpha * share)))
}

/// A colour function as it is written: its name, `rgba` and `hsla` as
/// `rgb` and `hsl`; its channels; and its alpha, 1 unless it says one.
fn written(text: &str) -> Option<(&str, Vec<&str>, f64)> {
    let (function, rest) = text.split_once('(')?;
    let function = match function {
        "rgba" => "rgb",
        "hsla" => "hsl",
        _ => function,
    };
    if !COLOUR_FUNCTIONS.contains(&function) {
        return None;
    }
    let inside = rest.strip_suffix(')')?;
    let (channels, slash) = match inside.split_once('/') {
        Some((channels, alpha)) => (channels, Some(alpha)),
        None => (inside, None),
    };
    let mut channels: Vec<&str> = channels
        .split(|c: char| c == ',' || c.is_whitespace())
        .filter(|part| !part.is_empty())
        .collect();
    // The old `rgba(r, g, b, a)`: the alpha after a comma.
    let legacy = matches!(function, "rgb" | "hsl") && slash.is_none() && channels.len() == 4;
    let comma = legacy.then(|| channels.pop()).flatten();
    let alpha = match slash.or(comma) {
        Some(alpha) => number(alpha, 1.0)?.clamp(0.0, 1.0),
        None => 1.0,
    };
    Some((function, channels, alpha))
}

/// ` / alpha` as CSS writes it after a colour's channels; nothing when it
/// is solid.
fn alpha_of(alpha: f64) -> String {
    if alpha >= 1.0 {
        String::new()
    } else {
        format!(" / {}", decimal(alpha))
    }
}

/// `v` to six decimals at most, as CSS gets it.
fn decimal(v: f64) -> String {
    let text = format!("{v:.6}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if text == "-0" {
        "0".to_owned()
    } else {
        text.to_owned()
    }
}

/// A channel or alpha as CSS writes it: a number, or a percentage of
/// `whole`.
fn number(text: &str, whole: f64) -> Option<f64> {
    let text = text.trim();
    let value = match text.strip_suffix('%') {
        Some(share) => share.trim().parse::<f64>().ok()? / 100.0 * whole,
        None => text.parse::<f64>().ok()?,
    };
    value.is_finite().then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Oklab, b: Oklab) -> bool {
        [(a.l, b.l), (a.a, b.a), (a.b, b.b), (a.alpha, b.alpha)]
            .iter()
            .all(|(x, y)| (x - y).abs() < 1e-4)
    }

    #[test]
    fn oklab_reads_what_css_writes() {
        let white = Oklab::parse("#ffffff").unwrap();
        assert!((white.l - 1.0).abs() < 1e-4 && white.a.abs() < 1e-4);
        assert!(close(white, Oklab::parse("rgb(255 255 255)").unwrap()));
        assert!(close(white, Oklab::parse("rgb(100%, 100%, 100%)").unwrap()));
        assert!(close(white, Oklab::parse("oklch(1 0 0)").unwrap()));
        assert!(close(white, Oklab::parse("hsl(0 0% 100%)").unwrap()));
        let red = Oklab::parse("#ff0000").unwrap();
        assert!(close(red, Oklab::parse("hsl(0, 100%, 50%)").unwrap()));
        assert!(close(
            red,
            Oklab::parse("hsla(360deg 100% 50% / 1)").unwrap()
        ));
        let ink = Oklab::parse("oklch(0 0 0 / 8%)").unwrap();
        assert!((ink.alpha - 0.08).abs() < 1e-9 && ink.l == 0.0);
        let blue = Oklab::parse("oklch(0.6 0.2 250)").unwrap();
        assert!(close(blue, Oklab::parse(&blue.css()).unwrap()));
        assert_eq!(Oklab::parse("rgba(0, 0, 0, 0.5)").unwrap().alpha, 0.5);
        for bad in ["", "red", "var(--x)", "oklch(1 0)", "lab(50 0 0)"] {
            assert_eq!(Oklab::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_colour_thinned_is_written_as_it_was_with_an_alpha() {
        let thin = |text| thinned(text, 0.1).unwrap();
        assert_eq!(thin("#18181b"), "rgb(24 24 27 / 0.1)");
        assert_eq!(thin("#18181b80"), "rgb(24 24 27 / 0.050196)");
        assert_eq!(thin("White"), "rgb(255 255 255 / 0.1)");
        assert_eq!(thin("transparent"), "transparent");
        assert_eq!(thin("oklch(0.6 0.2 250)"), "oklch(0.6 0.2 250 / 0.1)");
        assert_eq!(thin("oklch(1 0 0 / 10%)"), "oklch(1 0 0 / 0.01)");
        assert_eq!(thin("rgba(1, 2, 3, 0.5)"), "rgb(1 2 3 / 0.05)");
        assert_eq!(thin("hsl(120, 50%, 50%)"), "hsl(120 50% 50% / 0.1)");
        assert_eq!(
            thin("color(display-p3 1 0 0)"),
            "color(display-p3 1 0 0 / 0.1)"
        );
        assert_eq!(thinned("#fff", 1.0).unwrap(), "rgb(255 255 255)");
        assert_eq!(thinned("red", 0.5), None);
        assert_eq!(thinned("var(--x)", 0.5), None);
        // The same colour as Oklab reads it, at that alpha.
        let ink = Oklab::parse("#18181b").unwrap();
        let thin = Oklab::parse(&thin("#18181b")).unwrap();
        assert!(close(Oklab { alpha: 0.1, ..ink }, thin));
    }

    #[test]
    fn a_colour_mixed_as_color_mix_draws_it() {
        let ink = Oklab::parse("#18181b").unwrap();
        let clear = ink.mix(Oklab::parse("transparent").unwrap(), 0.1);
        assert!(close(clear, Oklab { alpha: 0.1, ..ink }));
        let white = Oklab::parse("#fff").unwrap();
        let grey = ink.mix(white, 0.4);
        assert!((grey.l - (0.4 * ink.l + 0.6 * white.l)).abs() < 1e-12);
        let black = Oklab::parse("#000").unwrap();
        assert_eq!(
            Oklab {
                alpha: 0.5,
                ..black
            }
            .css(),
            "oklab(0 0 0 / 0.5)"
        );
    }

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
            "darker_background",
        ] {
            assert!(is_css_color(ok), "{ok}");
        }
        for bad in [
            "",
            "#zzz",
            "red; --x: 1",
            "url(x)}",
            "a{b}",
            "#12",
            "var(--system-accent)",
            "color-mix(in oklab, red 10%, blue)",
            "url(x)",
            "calc(1px)",
            "rgb(var(--x))",
            "light blue",
        ] {
            assert!(!is_css_color(bad), "{bad}");
        }
    }
}
