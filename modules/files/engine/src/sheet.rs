//! `files.sheet`: a workbook's sheet as rows of text (ADR 0073, decision
//! 6), read by `calamine`. Its formulas are not worked out again: a cell
//! shows the value the workbook kept.

use crate::model::Sheet;
use crate::shown;
use calamine::{Data, Reader, open_workbook_auto};
use std::path::Path;

/// The most rows, and cells in a row, it answers.
pub const MOST_ROWS: usize = 10_000;
pub const MOST_CELLS: usize = 500;

/// The sheet named `sheet` of the workbook at `path`, else its first; an
/// error in words for a workbook it cannot read, or a sheet it lacks.
pub fn read(path: &Path, sheet: Option<&str>) -> Result<Sheet, String> {
    let mut book = open_workbook_auto(path).map_err(|e| e.to_string())?;
    let sheets = book.sheet_names();
    let name = match sheet {
        Some(sheet) if sheets.iter().any(|one| one == sheet) => sheet.to_owned(),
        Some(sheet) => return Err(format!("It has no sheet \"{sheet}\"")),
        None => sheets.first().cloned().ok_or("It has no sheets")?,
    };
    let range = book.worksheet_range(&name).map_err(|e| e.to_string())?;
    let (height, width) = range.get_size();
    let rows = (range.rows().take(MOST_ROWS))
        .map(|row| row.iter().take(MOST_CELLS).map(text_of).collect())
        .collect();
    Ok(Sheet {
        path: shown(path),
        sheets,
        sheet: name,
        rows,
        truncated: height > MOST_ROWS || width > MOST_CELLS,
    })
}

/// A cell as text: a date as `2026-11-06 12:30:00`, or only its day at
/// midnight.
fn text_of(cell: &Data) -> String {
    match cell {
        Data::DateTime(time) if time.is_datetime() => {
            let (year, month, day, hour, minute, second, _) = time.to_ymd_hms_milli();
            if (hour, minute, second) == (0, 0, 0) {
                format!("{year:04}-{month:02}-{day:02}")
            } else {
                format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}")
            }
        }
        other => other.to_string(),
    }
}
