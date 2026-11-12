//! The elevations (ADR 0113, decision 4): what floats, the Top layer and a
//! Pane's own floating bar, and what the Person carries, a Pane being
//! moved or a Peek. Each is a token, its shadows' shape here and its
//! strength the theme's, so a client that is not a page draws it too (ADR
//! 0062, decision 18). The Window's own three, a tile over glass, the
//! focused tile and the glass sidebar, keep their shape where the page
//! knows the glass; their strengths are tokens already.

use crate::thousandths;

/// What floats: close and soft, a menu's. Each shadow's offset across
/// and down, its blur and its spread, in black at the strength.
pub const FLOAT: &[&str] = &["0 4px 6px -1px", "0 2px 4px -2px"];
/// What the Person carries: far and deep, a Peek's.
pub const LIFT: &[&str] = &["0 30px 80px -12px"];

/// `shapes` at `strength`, from 0 to 1, as CSS's `box-shadow` says them.
/// Never `none`: Tailwind lays an elevation into a list of shadows, rings
/// with it, where `none` is no value.
pub fn css(shapes: &[&str], strength: f64) -> String {
    let alpha = thousandths(strength);
    (shapes.iter())
        .map(|shape| format!("{shape} rgb(0 0 0 / {alpha})"))
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn banda_s_elevations_are_the_menus_and_a_peek_s() {
        assert_eq!(
            css(FLOAT, 0.1),
            "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)"
        );
        assert_eq!(css(LIFT, 0.45), "0 30px 80px -12px rgb(0 0 0 / 0.45)");
    }

    #[test]
    fn none_is_a_clear_shadow_and_never_none() {
        assert_eq!(
            css(FLOAT, 0.0),
            "0 4px 6px -1px rgb(0 0 0 / 0), 0 2px 4px -2px rgb(0 0 0 / 0)"
        );
    }
}
