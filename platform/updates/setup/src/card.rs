//! The card, drawn in pixels: the same in the window on Windows and in a
//! picture of it on any system (`banda-setup --png`).
//!
//! It is Banda's Top layer on the desk: the theme's colours
//! (`platform/theme/themes/banda/theme.toml`, read as the binary is
//! built), Inter, a tile's corner and the lift's shadow, as
//! `docs/design/README.md` has them. The installer cannot follow the
//! Person's own theme, which is not there yet: it takes Windows' light or
//! dark.

use ab_glyph::{Font, FontRef, PxScale, ScaleFont, point};
use tiny_skia::{
    Color, FillRule, Paint, Path, PathBuilder, Pixmap, PremultipliedColorU8, Rect, Transform,
};

const REGULAR: &[u8] = include_bytes!("../fonts/Inter-Regular.ttf");
const SEMIBOLD: &[u8] = include_bytes!("../fonts/Inter-SemiBold.ttf");
const THEME: &str = include_str!("../../../theme/themes/banda/theme.toml");

// The look's lengths, in CSS pixels (docs/design/README.md, "Tokens").
/// The card's width.
const WIDTH: f32 = 360.0;
const PAD_X: f32 = 24.0;
const PAD_TOP: f32 = 26.0;
const PAD_BOTTOM: f32 = 20.0;
const GAP: f32 = 12.0;
const ICON: f32 = 56.0;
/// A tile's corner: the window's 30 less the 8 of the gap around it.
const TILE_RADIUS: f32 = 22.0;
/// `--title-size`, `--title-leading`.
const TITLE: (f32, f32) = (16.0, 24.0);
/// `--meta-size`, `--meta-leading`.
const META: (f32, f32) = (12.0, 18.0);
/// `--ui-size` and a control's height, corner and padding (`.b-btn`).
const BUTTON_TEXT: f32 = 14.0;
const BUTTON_HEIGHT: f32 = 28.0;
const BUTTON_RADIUS: f32 = 10.0;
const BUTTON_PAD: f32 = 10.0;
const BUTTON_GAP: f32 = 8.0;
const BAR_HEIGHT: f32 = 3.0;
/// The lift's shadow, `--lift-shadow`: 0 30px 80px -12px.
const SHADOW_Y: f32 = 30.0;
const SHADOW_BLUR: f32 = 80.0;
const SHADOW_SPREAD: f32 = -12.0;

/// The room around the card its shadow takes, left, top, right, bottom.
fn margins() -> (f32, f32, f32, f32) {
    let reach = SHADOW_BLUR + SHADOW_SPREAD;
    (reach, reach - SHADOW_Y, reach, reach + SHADOW_Y)
}

/// What the installer is at, as NSIS tells it (`src/window.rs`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// Copying Banda in. The one step most Persons ever see.
    Installing,
    /// Asking the open Banda to close.
    Closing,
    /// Installed: Banda is starting.
    Opening,
    /// Banda is open: close it, or stop.
    Open,
    /// Something of Banda runs that could not be stopped.
    Stuck,
}

impl Step {
    pub fn asks(self) -> bool {
        matches!(self, Step::Open | Step::Stuck)
    }
}

/// A button's look, as `.b-btn` has them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Primary,
    Ghost,
}

/// What a click on a button answers NSIS: 1 goes on, 2 stops.
pub const GO: u32 = 1;
pub const STOP: u32 = 2;

/// The card at one moment.
pub struct Card<'a> {
    pub name: &'a str,
    pub version: &'a str,
    pub icon: &'a Icon,
    pub step: Step,
    pub light: bool,
    /// How far the copying is, 0 to 1.
    pub progress: f32,
    /// The hat's tilt, in degrees: the icon's tilted tile.
    pub hat: f32,
    /// The button under the pointer.
    pub hover: Option<usize>,
}

impl Card<'_> {
    fn title(&self) -> String {
        match self.step {
            Step::Installing | Step::Closing | Step::Opening => self.name.to_owned(),
            Step::Open => format!("{} is open", self.name),
            Step::Stuck => format!("{} is still running", self.name),
        }
    }

    fn line(&self) -> String {
        match self.step {
            Step::Installing if self.version.is_empty() => "Installing".to_owned(),
            Step::Installing => format!("Installing {}", self.version),
            Step::Closing => format!("Closing {}", self.name),
            Step::Opening => format!("Opening {}", self.name),
            Step::Open => "It closes, and its Agents stop, to install the new one.".to_owned(),
            Step::Stuck => {
                "A part of it could not be stopped, perhaps as it runs as admin. Close it, then try again."
                    .to_owned()
            }
        }
    }

    fn buttons(&self) -> Vec<(&'static str, Kind, u32)> {
        match self.step {
            Step::Open => vec![
                ("Close and install", Kind::Primary, GO),
                ("Cancel", Kind::Ghost, STOP),
            ],
            Step::Stuck => vec![
                ("Try again", Kind::Primary, GO),
                ("Cancel", Kind::Ghost, STOP),
            ],
            _ => Vec::new(),
        }
    }

    fn progress(&self) -> Option<f32> {
        match self.step {
            Step::Installing | Step::Closing => Some(self.progress),
            Step::Opening => Some(1.0),
            _ => None,
        }
    }
}

/// The app's icon: its rounded tiles, as `client/desktop/icons/*.svg`
/// draw them, in the SVG's 512 units.
#[derive(Debug, PartialEq)]
pub struct Icon {
    tiles: Vec<Tile>,
}

#[derive(Debug, PartialEq)]
struct Tile {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    radius: f32,
    fill: Color,
    /// The tilt and its centre: the hat's.
    tilt: Option<(f32, f32, f32)>,
}

impl Icon {
    /// Reads the icon's `<rect>`s. Banda's icon is made of nothing else;
    /// one with no rect, or a rect it cannot read, is no icon.
    pub fn parse(svg: &str) -> Result<Icon, String> {
        let mut tiles = Vec::new();
        for element in svg.split("<rect").skip(1) {
            let element = element.split('>').next().unwrap_or_default();
            let attribute = |name: &str| -> Option<&str> {
                let at = element.find(&format!(" {name}=\""))? + name.len() + 3;
                element[at..].split('"').next()
            };
            let number = |name: &str| -> Result<f32, String> {
                attribute(name)
                    .ok_or_else(|| format!("a rect has no {name}"))?
                    .parse()
                    .map_err(|_| format!("a rect's {name} is no number"))
            };
            let fill = attribute("fill").ok_or("a rect has no fill")?;
            let tilt = match attribute("transform") {
                None => None,
                Some(transform) => {
                    let inner = transform
                        .strip_prefix("rotate(")
                        .and_then(|t| t.strip_suffix(')'))
                        .ok_or_else(|| {
                            format!("a rect's transform is not a rotate: {transform}")
                        })?;
                    let values: Vec<f32> = inner
                        .split([' ', ','])
                        .filter(|v| !v.is_empty())
                        .map(str::parse)
                        .collect::<Result<_, _>>()
                        .map_err(|_| format!("a rect's rotate is no numbers: {transform}"))?;
                    match values[..] {
                        [angle, x, y] => Some((angle, x, y)),
                        _ => return Err(format!("a rect's rotate needs its centre: {transform}")),
                    }
                }
            };
            tiles.push(Tile {
                x: number("x")?,
                y: number("y")?,
                width: number("width")?,
                height: number("height")?,
                radius: number("rx").unwrap_or(0.0),
                fill: hex(fill).ok_or_else(|| format!("a rect's fill is not #rrggbb: {fill}"))?,
                tilt,
            });
        }
        if tiles.is_empty() {
            return Err("the icon has no rect".to_owned());
        }
        Ok(Icon { tiles })
    }

    /// The hat's tilt at rest, in degrees.
    pub fn hat(&self) -> f32 {
        self.tiles
            .iter()
            .find_map(|tile| tile.tilt)
            .map_or(0.0, |(angle, _, _)| angle)
    }

    /// The icon alone, `size` pixels square, for the taskbar.
    pub fn picture(&self, size: u32) -> Option<Pixmap> {
        let mut pixmap = Pixmap::new(size, size)?;
        self.draw(&mut pixmap, 0.0, 0.0, size as f32, self.hat());
        Some(pixmap)
    }

    fn draw(&self, pixmap: &mut Pixmap, x: f32, y: f32, size: f32, hat: f32) {
        let unit = size / 512.0;
        for tile in &self.tiles {
            let Some(path) = rounded(
                x + tile.x * unit,
                y + tile.y * unit,
                tile.width * unit,
                tile.height * unit,
                tile.radius * unit,
            ) else {
                continue;
            };
            let transform = match tile.tilt {
                Some((_, cx, cy)) => Transform::from_rotate_at(hat, x + cx * unit, y + cy * unit),
                None => Transform::identity(),
            };
            pixmap.fill_path(&path, &paint(tile.fill), FillRule::Winding, transform, None);
        }
    }
}

/// The theme's colours the card is drawn in, for one scheme.
struct Colors {
    /// `--popover`: the Top layer's ground.
    ground: Color,
    /// `--foreground`, and `--primary`, which is the text's colour.
    text: Color,
    /// `--muted-foreground`.
    quiet: Color,
    /// `--primary-foreground`.
    on_primary: Color,
    /// `--window-line` and `--window-highlight`, and the lift's darkness.
    line: Color,
    highlight: Color,
    shadow: f32,
}

impl Colors {
    fn of(light: bool) -> Colors {
        let theme: toml::Table = toml::from_str(THEME).unwrap_or_default();
        let scheme = if light { "light" } else { "dark" };
        let get = |section: &str, key: &str| -> Option<Color> {
            let value = theme.get(section)?.get(key)?;
            let text = value.as_str().or_else(|| value.get(scheme)?.as_str())?;
            hex(text)
        };
        let color = |key: &str| get("colors", key).unwrap_or(Color::BLACK);
        let (line, highlight, shadow) = if light {
            (rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.5), 0.22)
        } else {
            (rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.05), 0.45)
        };
        Colors {
            ground: color("lighter_background"),
            text: color("foreground"),
            quiet: color("dark_foreground"),
            on_primary: get("tokens", "primary-foreground").unwrap_or_else(|| color("background")),
            line,
            highlight,
            shadow,
        }
    }
}

/// A card drawn: its picture, and where its buttons are, in the picture's
/// pixels, with what each answers.
pub struct Drawn {
    pub pixmap: Pixmap,
    pub buttons: Vec<(Rect, u32)>,
}

/// A shadow's width, height, scale and strength, in hundredths.
type ShadowKey = (u32, u32, u32, u32);

/// Draws cards. It keeps the fonts and the last shadow, which is the
/// slowest part and changes only with the card's size.
pub struct Painter {
    regular: FontRef<'static>,
    semibold: FontRef<'static>,
    dark: Colors,
    light: Colors,
    shadow: Option<(ShadowKey, Vec<u8>)>,
}

impl Default for Painter {
    fn default() -> Painter {
        Painter {
            regular: FontRef::try_from_slice(REGULAR).expect("Inter Regular is a font"),
            semibold: FontRef::try_from_slice(SEMIBOLD).expect("Inter SemiBold is a font"),
            dark: Colors::of(false),
            light: Colors::of(true),
            shadow: None,
        }
    }
}

impl Painter {
    /// The card, `scale` device pixels to a CSS pixel, with the room its
    /// shadow takes around it.
    pub fn draw(&mut self, card: &Card, scale: f32) -> Option<Drawn> {
        let s = |v: f32| v * scale;
        let inner = WIDTH - 2.0 * PAD_X;
        let title = card.title();
        let lines = self.wrap(&self.regular, META.0, inner, &card.line());
        let buttons = card.buttons();

        // The height, top to bottom, in CSS pixels.
        let mut height = PAD_TOP + ICON + GAP + TITLE.1;
        if card.progress().is_some() {
            height += GAP + BAR_HEIGHT;
        }
        height += GAP + META.1 * lines.len() as f32;
        if !buttons.is_empty() {
            height += GAP + 4.0 + BUTTON_HEIGHT;
        }
        height += PAD_BOTTOM;

        let (left, top, right, bottom) = margins();
        let width_px = s(left + WIDTH + right).ceil() as u32;
        let height_px = s(top + height + bottom).ceil() as u32;
        let mut pixmap = Pixmap::new(width_px, height_px)?;
        let strength = if card.light {
            self.light.shadow
        } else {
            self.dark.shadow
        };
        let (x0, y0) = (s(left), s(top));
        let (w, h) = (s(WIDTH), s(height));

        // The lift, then a hairline ring, the ground, and the light on its
        // top edge.
        let shadow = self.shadow(width_px, height_px, scale, strength);
        for (pixel, alpha) in pixmap.pixels_mut().iter_mut().zip(shadow) {
            *pixel = PremultipliedColorU8::from_rgba(0, 0, 0, *alpha).unwrap_or(*pixel);
        }
        let colors = if card.light { &self.light } else { &self.dark };
        fill(
            &mut pixmap,
            rounded(
                x0 - s(1.0),
                y0 - s(1.0),
                w + s(2.0),
                h + s(2.0),
                s(TILE_RADIUS + 1.0),
            ),
            colors.line,
        );
        fill(
            &mut pixmap,
            rounded(x0, y0, w, h, s(TILE_RADIUS)),
            colors.ground,
        );
        fill(
            &mut pixmap,
            rounded(x0, y0, w, h, s(TILE_RADIUS)),
            colors.highlight,
        );
        fill(
            &mut pixmap,
            rounded(x0, y0 + s(1.0), w, h - s(1.0), s(TILE_RADIUS)),
            colors.ground,
        );

        let centre = x0 + w / 2.0;
        let mut y = y0 + s(PAD_TOP);
        card.icon
            .draw(&mut pixmap, centre - s(ICON) / 2.0, y, s(ICON), card.hat);
        y += s(ICON + GAP);
        self.centred(
            &mut pixmap,
            true,
            s(TITLE.0),
            s(TITLE.1),
            centre,
            y,
            colors.text,
            &title,
        );
        y += s(TITLE.1);

        if let Some(progress) = card.progress() {
            y += s(GAP);
            let (bx, bw) = (x0 + s(PAD_X), s(inner));
            let mut track = colors.text;
            track.apply_opacity(0.1);
            fill(
                &mut pixmap,
                rounded(bx, y, bw, s(BAR_HEIGHT), s(BAR_HEIGHT / 2.0)),
                track,
            );
            let done = bw * progress.clamp(0.0, 1.0);
            if done >= s(BAR_HEIGHT) {
                let mut bar = colors.text;
                bar.apply_opacity(0.75);
                fill(
                    &mut pixmap,
                    rounded(bx, y, done, s(BAR_HEIGHT), s(BAR_HEIGHT / 2.0)),
                    bar,
                );
            }
            y += s(BAR_HEIGHT);
        }

        y += s(GAP);
        for line in &lines {
            self.centred(
                &mut pixmap,
                false,
                s(META.0),
                s(META.1),
                centre,
                y,
                colors.quiet,
                line,
            );
            y += s(META.1);
        }

        let mut placed = Vec::new();
        if !buttons.is_empty() {
            y += s(GAP + 4.0);
            let widths: Vec<f32> = buttons
                .iter()
                .map(|(label, _, _)| {
                    self.width(&self.semibold, s(BUTTON_TEXT), label) + s(2.0 * BUTTON_PAD)
                })
                .collect();
            let row = widths.iter().sum::<f32>() + s(BUTTON_GAP) * (widths.len() - 1) as f32;
            let mut x = centre - row / 2.0;
            for (index, ((label, kind, answer), width)) in buttons.iter().zip(widths).enumerate() {
                let hover = card.hover == Some(index);
                let shape = rounded(x, y, width, s(BUTTON_HEIGHT), s(BUTTON_RADIUS));
                let mut ink = colors.text;
                match kind {
                    Kind::Primary => {
                        let mut ground = colors.text;
                        if hover {
                            ground.apply_opacity(0.9);
                        }
                        fill(&mut pixmap, shape, ground);
                        ink = colors.on_primary;
                    }
                    Kind::Ghost => {
                        if hover {
                            // `--hover`: the text at 5%.
                            let mut wash = colors.text;
                            wash.apply_opacity(0.05);
                            fill(&mut pixmap, shape, wash);
                        } else {
                            ink = colors.quiet;
                        }
                    }
                }
                self.centred(
                    &mut pixmap,
                    true,
                    s(BUTTON_TEXT),
                    s(BUTTON_HEIGHT),
                    x + width / 2.0,
                    y,
                    ink,
                    label,
                );
                placed.push((Rect::from_xywh(x, y, width, s(BUTTON_HEIGHT))?, *answer));
                x += width + s(BUTTON_GAP);
            }
        }
        Some(Drawn {
            pixmap,
            buttons: placed,
        })
    }

    /// The shadow's darkness for each pixel: the card's shape, moved and
    /// shrunk as the lift has it, blurred.
    fn shadow(&mut self, width: u32, height: u32, scale: f32, strength: f32) -> &[u8] {
        let key = (
            width,
            height,
            (scale * 100.0) as u32,
            (strength * 100.0) as u32,
        );
        if self.shadow.as_ref().is_none_or(|(k, _)| *k != key) {
            let s = |v: f32| v * scale;
            let (left, top, _, bottom) = margins();
            let card_h = height as f32 - s(top + bottom);
            let mut mask = vec![0f32; (width * height) as usize];
            let (x0, y0) = (s(left - SHADOW_SPREAD), s(top - SHADOW_SPREAD + SHADOW_Y));
            let (x1, y1) = (
                x0 + s(WIDTH + 2.0 * SHADOW_SPREAD),
                y0 + card_h + s(2.0 * SHADOW_SPREAD),
            );
            if let Some(mut shape) = Pixmap::new(width, height) {
                fill(
                    &mut shape,
                    rounded(x0, y0, x1 - x0, y1 - y0, s(TILE_RADIUS)),
                    Color::BLACK,
                );
                for (m, pixel) in mask.iter_mut().zip(shape.pixels()) {
                    *m = f32::from(pixel.alpha()) / 255.0;
                }
            }
            // A Gaussian of CSS's blur (σ = blur / 2), as three boxes.
            let sigma = s(SHADOW_BLUR) / 2.0;
            let radius = ((12.0 * sigma * sigma / 3.0 + 1.0).sqrt() / 2.0).round() as usize;
            for _ in 0..3 {
                blur(&mut mask, width as usize, height as usize, radius);
            }
            let alpha = mask
                .iter()
                .map(|m| (m * strength * 255.0).round() as u8)
                .collect();
            self.shadow = Some((key, alpha));
        }
        &self.shadow.as_ref().expect("made above").1
    }

    fn width(&self, font: &FontRef, size: f32, text: &str) -> f32 {
        let font = font.as_scaled(PxScale::from(size));
        let mut width = 0.0;
        let mut last = None;
        for c in text.chars() {
            let id = font.glyph_id(c);
            if let Some(last) = last {
                width += font.kern(last, id);
            }
            width += font.h_advance(id);
            last = Some(id);
        }
        width
    }

    /// The text in lines no wider than `width`, broken between words.
    fn wrap(&self, font: &FontRef, size: f32, width: f32, text: &str) -> Vec<String> {
        let mut lines: Vec<String> = Vec::new();
        for word in text.split(' ') {
            match lines.last_mut() {
                Some(line) if self.width(font, size, &format!("{line} {word}")) <= width => {
                    line.push(' ');
                    line.push_str(word);
                }
                _ => lines.push(word.to_owned()),
            }
        }
        lines
    }

    /// One line of text centred on `centre`, in a line box of `leading`
    /// from `top`, as CSS sets it: the half-leading above and below.
    #[allow(clippy::too_many_arguments)]
    fn centred(
        &self,
        pixmap: &mut Pixmap,
        bold: bool,
        size: f32,
        leading: f32,
        centre: f32,
        top: f32,
        color: Color,
        text: &str,
    ) {
        let font = if bold { &self.semibold } else { &self.regular };
        let scaled = font.as_scaled(PxScale::from(size));
        let baseline =
            top + (leading - (scaled.ascent() - scaled.descent())) / 2.0 + scaled.ascent();
        let mut x = centre - self.width(font, size, text) / 2.0;
        let mut last = None;
        for c in text.chars() {
            let id = scaled.glyph_id(c);
            if let Some(last) = last {
                x += scaled.kern(last, id);
            }
            let glyph = id.with_scale_and_position(size, point(x, baseline));
            x += scaled.h_advance(id);
            last = Some(id);
            let Some(outline) = font.outline_glyph(glyph) else {
                continue;
            };
            let bounds = outline.px_bounds();
            outline.draw(|gx, gy, coverage| {
                let px = bounds.min.x as i32 + gx as i32;
                let py = bounds.min.y as i32 + gy as i32;
                blend(pixmap, px, py, color, coverage);
            });
        }
    }
}

/// One pass of a box blur, across then down.
fn blur(values: &mut [f32], width: usize, height: usize, radius: usize) {
    if radius == 0 {
        return;
    }
    let mut line = Vec::new();
    let mut pass =
        |values: &mut [f32], count: usize, len: usize, at: &dyn Fn(usize, usize) -> usize| {
            for row in 0..count {
                line.clear();
                line.extend((0..len).map(|i| values[at(row, i)]));
                let span = (2 * radius + 1) as f32;
                let mut sum: f32 = (0..=radius)
                    .map(|i| line.get(i).copied().unwrap_or(0.0))
                    .sum();
                for i in 0..len {
                    values[at(row, i)] = sum / span;
                    if let Some(v) = line.get(i + radius + 1) {
                        sum += v;
                    }
                    if i >= radius {
                        sum -= line[i - radius];
                    }
                }
            }
        };
    pass(values, height, width, &|row, i| row * width + i);
    pass(values, width, height, &|column, i| i * width + column);
}

/// A rounded rectangle, its corners as CSS draws them.
fn rounded(x: f32, y: f32, width: f32, height: f32, radius: f32) -> Option<Path> {
    let r = radius.min(width / 2.0).min(height / 2.0).max(0.0);
    let k = r * 0.552_284_8;
    let (x1, y1) = (x + width, y + height);
    let mut path = PathBuilder::new();
    path.move_to(x + r, y);
    path.line_to(x1 - r, y);
    path.cubic_to(x1 - r + k, y, x1, y + r - k, x1, y + r);
    path.line_to(x1, y1 - r);
    path.cubic_to(x1, y1 - r + k, x1 - r + k, y1, x1 - r, y1);
    path.line_to(x + r, y1);
    path.cubic_to(x + r - k, y1, x, y1 - r + k, x, y1 - r);
    path.line_to(x, y + r);
    path.cubic_to(x, y + r - k, x + r - k, y, x + r, y);
    path.close();
    path.finish()
}

fn paint(color: Color) -> Paint<'static> {
    let mut paint = Paint::default();
    paint.set_color(color);
    paint.anti_alias = true;
    paint
}

fn fill(pixmap: &mut Pixmap, path: Option<Path>, color: Color) {
    if let Some(path) = path {
        pixmap.fill_path(
            &path,
            &paint(color),
            FillRule::Winding,
            Transform::identity(),
            None,
        );
    }
}

/// A text pixel: `color` at `coverage` over what is there.
fn blend(pixmap: &mut Pixmap, x: i32, y: i32, color: Color, coverage: f32) {
    let (width, height) = (pixmap.width() as i32, pixmap.height() as i32);
    if x < 0 || y < 0 || x >= width || y >= height {
        return;
    }
    let index = (y * width + x) as usize;
    let pixels = pixmap.pixels_mut();
    let under = pixels[index];
    let a = color.alpha() * coverage.clamp(0.0, 1.0);
    let over = |c: f32, u: u8| {
        (c * a * 255.0 + f32::from(u) * (1.0 - a))
            .round()
            .clamp(0.0, 255.0) as u8
    };
    let alpha = (a * 255.0 + f32::from(under.alpha()) * (1.0 - a))
        .round()
        .clamp(0.0, 255.0) as u8;
    let (r, g, b) = (
        over(color.red(), under.red()).min(alpha),
        over(color.green(), under.green()).min(alpha),
        over(color.blue(), under.blue()).min(alpha),
    );
    if let Some(pixel) = PremultipliedColorU8::from_rgba(r, g, b, alpha) {
        pixels[index] = pixel;
    }
}

fn hex(text: &str) -> Option<Color> {
    let digits = text.strip_prefix('#')?;
    if digits.len() != 6 {
        return None;
    }
    let value = u32::from_str_radix(digits, 16).ok()?;
    Some(Color::from_rgba8(
        (value >> 16) as u8,
        (value >> 8) as u8,
        value as u8,
        255,
    ))
}

fn rgba(r: u8, g: u8, b: u8, a: f32) -> Color {
    Color::from_rgba8(r, g, b, (a * 255.0).round() as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEV: &str = include_str!("../../../../client/desktop/icons/banda-dev.svg");
    const STABLE: &str = include_str!("../../../../client/desktop/icons/banda.svg");

    #[test]
    fn both_icons_are_four_tiles_and_a_tilted_hat() {
        for svg in [DEV, STABLE] {
            let icon = Icon::parse(svg).unwrap();
            assert_eq!(icon.tiles.len(), 4);
            assert_eq!(icon.hat(), -8.0);
        }
    }

    #[test]
    fn an_icon_it_cannot_read_is_refused() {
        assert!(Icon::parse("<svg><circle r=\"3\"/></svg>").is_err());
        assert!(
            Icon::parse("<rect x=\"1\" y=\"1\" width=\"2\" height=\"2\" fill=\"red\"/>").is_err()
        );
    }

    #[test]
    fn the_colours_are_the_themes() {
        let dark = Colors::of(false);
        assert_eq!(dark.ground, hex("#202024").unwrap());
        assert_eq!(dark.text, hex("#ededef").unwrap());
        assert_eq!(dark.quiet, hex("#a1a1aa").unwrap());
        let light = Colors::of(true);
        assert_eq!(light.ground, hex("#ffffff").unwrap());
        assert_eq!(light.on_primary, hex("#fafafa").unwrap());
    }

    #[test]
    fn every_step_draws_and_only_questions_have_buttons() {
        let icon = Icon::parse(DEV).unwrap();
        let mut painter = Painter::default();
        for step in [
            Step::Installing,
            Step::Closing,
            Step::Opening,
            Step::Open,
            Step::Stuck,
        ] {
            let card = Card {
                name: "Banda Dev",
                version: "0.1.0-dev.900",
                icon: &icon,
                step,
                light: false,
                progress: 0.5,
                hat: icon.hat(),
                hover: None,
            };
            let drawn = painter.draw(&card, 1.0).unwrap();
            assert_eq!(drawn.buttons.is_empty(), !step.asks(), "{step:?}");
        }
    }
}
