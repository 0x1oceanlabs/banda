//! The card's window on Windows: borderless, layered, drawn by
//! [`crate::card`] and given to Windows whole, its shadow and corners in
//! its own pixels' alpha.
//!
//! NSIS tells it the step and asks for the Person's answer by window
//! messages to the window of class `BandaSetup-<installer pid>`:
//!
//! - [`SET`] (`WM_APP + 1`): `wParam` is the step, 1 installing, 2 Banda
//!   is open, 3 it could not be stopped, 5 closing Banda, 6 Banda is
//!   opening. It forgets the last answer.
//! - [`ANSWER`] (`WM_APP + 2`): what the Person answered since, 0 nothing
//!   yet, 1 go on, 2 stop.
//!
//! It finds how far the copying is by itself, from the bytes in the
//! folders the installer unpacks and copies into. It ends when the
//! installer has, once Banda's own window is up after "opening", at once
//! otherwise.
#![allow(unsafe_code)]

use crate::Args;
use crate::card::{Card, Drawn, GO, Icon, Painter, STOP, Step};
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{
    COLORREF, CloseHandle, HANDLE, HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WAIT_OBJECT_0, WPARAM,
};
use windows::Win32::Graphics::Gdi::{
    AC_SRC_ALPHA, AC_SRC_OVER, BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BLENDFUNCTION, CreateBitmap,
    CreateCompatibleDC, CreateDIBSection, DIB_RGB_COLORS, DeleteDC, DeleteObject, GetMonitorInfoW,
    HBITMAP, HGDIOBJ, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromPoint, SelectObject,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
    QueryFullProcessImageNameW, WaitForSingleObject,
};
use windows::Win32::UI::HiDpi::{
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, GetDpiForMonitor, MDT_EFFECTIVE_DPI,
    SetProcessDpiAwarenessContext,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    ReleaseCapture, TME_LEAVE, TRACKMOUSEEVENT, TrackMouseEvent, VK_ESCAPE, VK_RETURN,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateIconIndirect, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW,
    EnumWindows, GetCursorPos, GetMessageW, GetWindowRect, GetWindowThreadProcessId, HTCAPTION,
    ICON_BIG, ICON_SMALL, ICONINFO, IDC_ARROW, IDC_HAND, IsWindowVisible, LoadCursorW, MSG,
    PostQuitMessage, RegisterClassW, SW_SHOW, SendMessageW, SetCursor, SetForegroundWindow,
    SetTimer, ShowWindow, TranslateMessage, ULW_ALPHA, UpdateLayeredWindow, WM_APP, WM_CLOSE,
    WM_DESTROY, WM_DPICHANGED, WM_KEYDOWN, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE,
    WM_NCLBUTTONDOWN, WM_SETCURSOR, WM_SETICON, WM_TIMER, WNDCLASSW, WS_EX_APPWINDOW,
    WS_EX_LAYERED, WS_POPUP,
};
use windows::core::{BOOL, HSTRING, PCWSTR, PWSTR};

/// Sets the step: `wParam` the step.
pub const SET: u32 = WM_APP + 1;
/// Returns the Person's answer since the last [`SET`].
pub const ANSWER: u32 = WM_APP + 2;
/// The pointer left the window (`winuser.h`; the crate has it only with
/// the common controls).
const WM_MOUSELEAVE: u32 = 0x02A3;

/// A frame each 40 ms while the card moves: the hat tilts only while
/// Banda installs, a few seconds, so it may move smoothly.
const FRAME: u32 = 40;
/// How often the folders are measured.
const MEASURE: Duration = Duration::from_millis(300);
const FADE: Duration = Duration::from_millis(160);
/// How long the card waits for Banda's window after the installer ends.
const OPENING: Duration = Duration::from_secs(20);
/// The hat's swing while Banda installs: one tilt and back, in seconds.
const SWING: f32 = 2.4;

struct App {
    hwnd: HWND,
    name: String,
    version: String,
    icon: Icon,
    painter: Painter,
    light: bool,
    dpi: u32,
    step: Step,
    answer: u32,
    hover: Option<usize>,
    pressed: Option<usize>,
    buttons: Vec<(tiny_skia::Rect, u32)>,
    /// How far the copying is, as the measuring thread last found it,
    /// in an f32's bits; the bar shows `shown`, which follows it.
    measured: Arc<AtomicU32>,
    shown: f32,
    /// When the windows were last looked at for Banda's.
    looked_at: Instant,
    dir: Option<PathBuf>,
    installer: Option<HANDLE>,
    /// When the installer ended.
    ended: Option<Instant>,
    started: Instant,
    /// When the card began to fade out.
    leaving: Option<Instant>,
    /// Where the card's top left is, and its size, in screen pixels.
    at: POINT,
    size: SIZE,
    /// What is done once the app is let go of: a call that sends this
    /// window messages of its own, which the app must answer.
    after: Option<After>,
}

enum After {
    /// The Person drags the card, as by a title bar.
    Drag,
    Close,
}

thread_local! {
    static APP: RefCell<Option<App>> = const { RefCell::new(None) };
}

pub fn run(args: &Args, icon: Icon) -> ExitCode {
    match open(args, icon) {
        Ok(()) => {
            let mut message = MSG::default();
            // SAFETY: the thread's own message loop.
            unsafe {
                while GetMessageW(&mut message, None, 0, 0).as_bool() {
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("banda-setup: {error}");
            ExitCode::FAILURE
        }
    }
}

fn open(args: &Args, icon: Icon) -> windows::core::Result<()> {
    let class = HSTRING::from(format!("BandaSetup-{}", args.pid.unwrap_or_default()));
    let title = HSTRING::from(args.name.as_str());
    // SAFETY: plain calls into Windows with values made here; the class
    // name and title live until the window is made.
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let instance = GetModuleHandleW(None)?;
        let window_class = WNDCLASSW {
            lpfnWndProc: Some(procedure),
            hInstance: instance.into(),
            hCursor: LoadCursorW(None, IDC_ARROW)?,
            lpszClassName: PCWSTR(class.as_ptr()),
            ..Default::default()
        };
        if RegisterClassW(&window_class) == 0 {
            return Err(windows::core::Error::from_thread());
        }
        let hwnd = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_APPWINDOW,
            PCWSTR(class.as_ptr()),
            PCWSTR(title.as_ptr()),
            WS_POPUP,
            0,
            0,
            0,
            0,
            None,
            None,
            Some(instance.into()),
            None,
        )?;

        // The monitor the Person double-clicked on, and its work area.
        let mut cursor = POINT::default();
        let _ = GetCursorPos(&mut cursor);
        let monitor = MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let _ = GetMonitorInfoW(monitor, &mut info);
        let (mut dpi, mut unused) = (96, 96);
        let _ = GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi, &mut unused);

        let installer = args.pid.and_then(|pid| {
            OpenProcess(
                PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                false,
                pid,
            )
            .ok()
        });
        let now = Instant::now();
        let app = App {
            hwnd,
            name: args.name.clone(),
            version: args.version.clone(),
            icon,
            painter: Painter::default(),
            light: light(),
            dpi,
            step: Step::Installing,
            answer: 0,
            hover: None,
            pressed: None,
            buttons: Vec::new(),
            measured: measuring(args),
            shown: 0.0,
            looked_at: now - MEASURE,
            dir: args.dir.clone(),
            installer,
            ended: None,
            started: now,
            leaving: None,
            at: POINT::default(),
            size: SIZE::default(),
            after: None,
        };
        let work = info.rcWork;
        APP.with_borrow_mut(|slot| *slot = Some(app));
        with_app(|app| {
            app.taskbar_icon();
            app.paint(Some(work));
        });
        let _ = ShowWindow(hwnd, SW_SHOW);
        let _ = SetForegroundWindow(hwnd);
        SetTimer(Some(hwnd), 1, FRAME, None);
    }
    Ok(())
}

/// Runs `f` on the app, unless a call made from inside it came back here.
fn with_app<R>(f: impl FnOnce(&mut App) -> R) -> Option<R> {
    APP.with(|slot| slot.try_borrow_mut().ok()?.as_mut().map(f))
}

unsafe extern "system" fn procedure(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let (handled, after) = with_app(|app| (app.message(message, wparam, lparam), app.after.take()))
        .unwrap_or((None, None));
    // SAFETY: this window's own drag and end, from its own thread, with
    // the app let go of: Windows' move loop and WM_DESTROY come back here.
    unsafe {
        match after {
            Some(After::Drag) => {
                let _ = ReleaseCapture();
                SendMessageW(
                    hwnd,
                    WM_NCLBUTTONDOWN,
                    Some(WPARAM(HTCAPTION as usize)),
                    Some(LPARAM(0)),
                );
            }
            Some(After::Close) => {
                let _ = DestroyWindow(hwnd);
            }
            None => {}
        }
    }
    match handled {
        Some(result) => result,
        // SAFETY: Windows' own handling of the message it sent.
        None => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
    }
}

impl App {
    /// The answer to a message, or None for Windows' own.
    fn message(&mut self, message: u32, wparam: WPARAM, lparam: LPARAM) -> Option<LRESULT> {
        let point = || {
            let value = lparam.0 as u32;
            ((value & 0xffff) as i16 as f32, (value >> 16) as i16 as f32)
        };
        match message {
            SET => {
                self.step = match wparam.0 {
                    2 => Step::Open,
                    3 => Step::Stuck,
                    5 => Step::Closing,
                    6 => Step::Opening,
                    _ => Step::Installing,
                };
                self.answer = 0;
                self.hover = None;
                self.pressed = None;
                self.paint(None);
                Some(LRESULT(1))
            }
            ANSWER => Some(LRESULT(self.answer as isize)),
            WM_TIMER => {
                self.tick();
                Some(LRESULT(0))
            }
            WM_MOUSEMOVE => {
                let (x, y) = point();
                let hover = self.button_at(x, y);
                if hover != self.hover {
                    self.hover = hover;
                    self.paint(None);
                }
                let mut track = TRACKMOUSEEVENT {
                    cbSize: size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_LEAVE,
                    hwndTrack: self.hwnd,
                    dwHoverTime: 0,
                };
                // SAFETY: a struct made here, for this window.
                let _ = unsafe { TrackMouseEvent(&mut track) };
                Some(LRESULT(0))
            }
            WM_MOUSELEAVE => {
                if self.hover.take().is_some() {
                    self.paint(None);
                }
                Some(LRESULT(0))
            }
            WM_SETCURSOR if self.hover.is_some() => {
                // SAFETY: Windows' own cursor.
                unsafe {
                    if let Ok(hand) = LoadCursorW(None, IDC_HAND) {
                        SetCursor(Some(hand));
                    }
                }
                Some(LRESULT(1))
            }
            WM_LBUTTONDOWN => {
                let (x, y) = point();
                self.pressed = self.button_at(x, y);
                if self.pressed.is_none() {
                    // Anywhere but a button moves the card.
                    self.after = Some(After::Drag);
                }
                Some(LRESULT(0))
            }
            WM_LBUTTONUP => {
                let (x, y) = point();
                if let Some(index) = self.pressed.take()
                    && self.button_at(x, y) == Some(index)
                {
                    self.answer = self.buttons[index].1;
                }
                Some(LRESULT(0))
            }
            WM_KEYDOWN => {
                let key = wparam.0 as u16;
                if self.step.asks() {
                    if key == VK_RETURN.0 && self.buttons.iter().any(|(_, a)| *a == GO) {
                        self.answer = GO;
                    } else if key == VK_ESCAPE.0 {
                        self.answer = STOP;
                    }
                } else if key == VK_ESCAPE.0 && self.installer.is_none() {
                    // Started by hand, with no installer to wait for.
                    self.leave();
                }
                Some(LRESULT(0))
            }
            WM_CLOSE => {
                // Alt+F4: a question is answered Cancel; the copying is
                // not stopped half-way.
                if self.step.asks() {
                    self.answer = STOP;
                } else if self.installer.is_none() {
                    self.leave();
                }
                Some(LRESULT(0))
            }
            WM_DPICHANGED => {
                self.dpi = (wparam.0 & 0xffff) as u32;
                self.paint(None);
                Some(LRESULT(0))
            }
            WM_DESTROY => {
                if let Some(installer) = self.installer.take() {
                    // SAFETY: the handle opened in `open`, closed once.
                    let _ = unsafe { CloseHandle(installer) };
                }
                // SAFETY: ends this thread's message loop.
                unsafe { PostQuitMessage(0) };
                Some(LRESULT(0))
            }
            _ => None,
        }
    }

    fn tick(&mut self) {
        let now = Instant::now();
        if let Some(since) = self.leaving {
            if now - since >= FADE {
                self.after = Some(After::Close);
            } else {
                self.paint(None);
            }
            return;
        }

        if self.ended.is_none()
            && let Some(installer) = self.installer
            // SAFETY: the handle opened in `open`; a zero wait only asks.
            && unsafe { WaitForSingleObject(installer, 0) } == WAIT_OBJECT_0
        {
            self.ended = Some(now);
        }
        // The windows are looked at less often than a frame.
        let looks = now - self.looked_at >= MEASURE;
        if looks {
            self.looked_at = now;
        }
        if let Some(ended) = self.ended {
            // Banda is starting: the card stays until its window shows.
            let opening = self.step == Step::Opening && now - ended < OPENING;
            if !opening || (looks && self.banda_shows()) {
                self.leave();
                return;
            }
        }

        let target = if self.step == Step::Opening {
            1.0
        } else {
            f32::from_bits(self.measured.load(Ordering::Relaxed))
        };
        let gap = target - self.shown;
        self.shown += gap * 0.2;
        // Only what moves is drawn again: the hat while Banda installs, the
        // bar, the fade in.
        let moves = matches!(self.step, Step::Installing | Step::Closing)
            || gap.abs() > 0.001
            || now - self.started < FADE * 2;
        if moves {
            self.paint(None);
        }
    }

    /// Whether a window of the installed Banda shows.
    fn banda_shows(&self) -> bool {
        let Some(dir) = &self.dir else {
            return true;
        };
        let mut search = Search {
            dir: format!("{}\\", dir.to_string_lossy().trim_end_matches('\\')).to_lowercase(),
            found: false,
        };
        // SAFETY: the callback reads `search` only while EnumWindows runs.
        unsafe {
            let _ = EnumWindows(Some(each_window), LPARAM(&raw mut search as isize));
        }
        search.found
    }

    fn leave(&mut self) {
        if self.leaving.is_none() {
            self.leaving = Some(Instant::now());
        }
    }

    fn button_at(&self, x: f32, y: f32) -> Option<usize> {
        self.buttons.iter().position(|(rect, _)| {
            x >= rect.left() && x < rect.right() && y >= rect.top() && y < rect.bottom()
        })
    }

    /// Draws the card and gives it to Windows. With `work`, the first
    /// time, it is centred in that work area; after, a change of its
    /// height keeps its centre where the Person left it.
    fn paint(&mut self, work: Option<RECT>) {
        let now = Instant::now();
        let hat = if matches!(self.step, Step::Installing | Step::Closing) {
            // From the icon's tilt to half as far the other way, and back.
            let rest = self.icon.hat();
            let phase = (now - self.started).as_secs_f32() / SWING * std::f32::consts::TAU;
            rest + (-rest / 2.0 - rest) * (1.0 - phase.cos()) / 2.0
        } else {
            self.icon.hat()
        };
        let card = Card {
            name: &self.name,
            version: &self.version,
            icon: &self.icon,
            step: self.step,
            light: self.light,
            progress: self.shown,
            hat,
            hover: self.hover,
        };
        let scale = self.dpi as f32 / 96.0;
        let Some(Drawn { pixmap, buttons }) = self.painter.draw(&card, scale) else {
            return;
        };
        self.buttons = buttons;
        let size = SIZE {
            cx: pixmap.width() as i32,
            cy: pixmap.height() as i32,
        };
        if let Some(work) = work {
            self.at = POINT {
                x: work.left + (work.right - work.left - size.cx) / 2,
                y: work.top + (work.bottom - work.top - size.cy) / 2,
            };
        } else {
            // Where the Person may have dragged it.
            let mut now_at = RECT::default();
            // SAFETY: this window's own rectangle, into a struct made here.
            if unsafe { GetWindowRect(self.hwnd, &mut now_at) }.is_ok() {
                self.at = POINT {
                    x: now_at.left,
                    y: now_at.top,
                };
            }
            self.at.x -= (size.cx - self.size.cx) / 2;
            self.at.y -= (size.cy - self.size.cy) / 2;
        }
        self.size = size;

        let fade = match self.leaving {
            Some(since) => 1.0 - ((now - since).as_secs_f32() / FADE.as_secs_f32()).min(1.0),
            None => ((now - self.started).as_secs_f32() / FADE.as_secs_f32()).min(1.0),
        };
        // SAFETY: a bitmap made, selected, given and freed here.
        unsafe {
            let Some((bitmap, dc)) = bitmap(&pixmap) else {
                return;
            };
            let blend = BLENDFUNCTION {
                BlendOp: AC_SRC_OVER as u8,
                BlendFlags: 0,
                SourceConstantAlpha: (fade * 255.0) as u8,
                AlphaFormat: AC_SRC_ALPHA as u8,
            };
            let origin = POINT::default();
            let old = SelectObject(dc, HGDIOBJ(bitmap.0));
            let _ = UpdateLayeredWindow(
                self.hwnd,
                None,
                Some(&self.at),
                Some(&self.size),
                Some(dc),
                Some(&origin),
                COLORREF(0),
                Some(&blend),
                ULW_ALPHA,
            );
            SelectObject(dc, old);
            let _ = DeleteDC(dc);
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
        }
    }

    /// The app's icon on the card's taskbar button.
    fn taskbar_icon(&self) {
        for (which, size) in [(ICON_BIG, 32), (ICON_SMALL, 16)] {
            let scaled = size * self.dpi / 96;
            let Some(picture) = self.icon.picture(scaled) else {
                continue;
            };
            // SAFETY: bitmaps made here and freed once the icon is made
            // from them.
            unsafe {
                let Some((color, dc)) = bitmap(&picture) else {
                    continue;
                };
                let _ = DeleteDC(dc);
                // The colour's alpha is the icon's shape; the mask is unused
                // but must be there, and is cleared.
                let clear = vec![0u8; (scaled as usize).div_ceil(16) * 2 * scaled as usize];
                let mask = CreateBitmap(
                    scaled as i32,
                    scaled as i32,
                    1,
                    1,
                    Some(clear.as_ptr().cast()),
                );
                let info = ICONINFO {
                    fIcon: BOOL(1),
                    hbmMask: mask,
                    hbmColor: color,
                    ..Default::default()
                };
                if let Ok(icon) = CreateIconIndirect(&info) {
                    SendMessageW(
                        self.hwnd,
                        WM_SETICON,
                        Some(WPARAM(which as usize)),
                        Some(LPARAM(icon.0 as isize)),
                    );
                }
                let _ = DeleteObject(HGDIOBJ(mask.0));
                let _ = DeleteObject(HGDIOBJ(color.0));
            }
        }
    }
}

/// A 32-bit bitmap of the pixmap, in Windows' order: blue, green, red and
/// alpha, premultiplied, as UpdateLayeredWindow takes it; and a memory DC
/// to select it into.
///
/// # Safety
/// The caller frees both.
unsafe fn bitmap(
    pixmap: &tiny_skia::Pixmap,
) -> Option<(HBITMAP, windows::Win32::Graphics::Gdi::HDC)> {
    let (width, height) = (pixmap.width() as i32, pixmap.height() as i32);
    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits = std::ptr::null_mut();
    // SAFETY: the caller frees what is made; the bits are written within
    // the size asked for.
    unsafe {
        let dc = CreateCompatibleDC(None);
        let Ok(bitmap) = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0)
        else {
            let _ = DeleteDC(dc);
            return None;
        };
        let out = std::slice::from_raw_parts_mut(bits.cast::<u8>(), (width * height * 4) as usize);
        for (to, from) in out
            .as_chunks_mut::<4>()
            .0
            .iter_mut()
            .zip(pixmap.data().as_chunks::<4>().0)
        {
            *to = [from[2], from[1], from[0], from[3]];
        }
        Some((bitmap, dc))
    }
}

struct Search {
    dir: String,
    found: bool,
}

unsafe extern "system" fn each_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: `lparam` is the Search `banda_shows` lends for this call.
    let search = unsafe { &mut *(lparam.0 as *mut Search) };
    // SAFETY: questions about a window Windows just named, and a process
    // handle closed here.
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == std::process::id() {
            return BOOL(1);
        }
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return BOOL(1);
        };
        let mut name = [0u16; 1024];
        let mut length = name.len() as u32;
        let read = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(name.as_mut_ptr()),
            &mut length,
        );
        let _ = CloseHandle(process);
        if read.is_ok() {
            let path = String::from_utf16_lossy(&name[..length as usize]).to_lowercase();
            if path.starts_with(&search.dir) {
                search.found = true;
                return BOOL(0);
            }
        }
    }
    BOOL(1)
}

/// Whether Windows' apps are light (Settings → Personalisation → Colours).
fn light() -> bool {
    windows_registry::CURRENT_USER
        .open(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
        .and_then(|key| key.get_u32("AppsUseLightTheme"))
        .ok()
        .is_none_or(|value| value != 0)
}

/// A thread that measures how far the copying is, off the window's
/// thread, as a walk of a folder may take a while: the bytes unpacked,
/// then the bytes copied into the install folder, each of what the app
/// takes. It ends with the process.
fn measuring(args: &Args) -> Arc<AtomicU32> {
    let measured = Arc::new(AtomicU32::new(0f32.to_bits()));
    let total = args.size * 1024;
    if total == 0 {
        return measured;
    }
    let (extract, dir) = (args.extract.clone(), args.dir.clone());
    let out = Arc::clone(&measured);
    std::thread::spawn(move || {
        let of = |folder: &Option<PathBuf>| {
            folder.as_deref().map_or(0.0, |folder| {
                (bytes(folder) as f64 / total as f64).min(1.0) as f32
            })
        };
        loop {
            let unpacked = of(&extract);
            // What was there before the old Banda was taken out does not
            // count: the copy starts once the unpacking is through.
            let copied = if unpacked >= 0.97 { of(&dir) } else { 0.0 };
            let progress = (0.6 * unpacked + 0.4 * copied).min(0.98);
            out.store(progress.to_bits(), Ordering::Relaxed);
            std::thread::sleep(MEASURE);
        }
    });
    measured
}

/// The bytes of the files in a folder and under it.
fn bytes(folder: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => bytes(&entry.path()),
            Ok(_) => entry.metadata().map_or(0, |m| m.len()),
            Err(_) => 0,
        })
        .sum()
}
