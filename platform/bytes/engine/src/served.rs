//! The answer at `/b/<token>` and `/p/<token>`, as the window's byte host
//! answered (`FileLinks.serve`, until step 4b): the token's file, when it
//! is still the file it was given for, through no link; its bytes whole or
//! in one range; and 404 for all else, so a wrong token says nothing of a
//! right one.

use crate::Bytes;
use crate::file::pin;
use crate::kinds::into_frame;
use crate::range::byte_range;
use axum::body::{Body, Bytes as Piece};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use banda_kernel::api::Served;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};

/// How much of a file is read at a time.
const PIECE: u64 = 256 * 1024;

impl Bytes {
    pub(crate) async fn answer(
        &self,
        served: Served,
        token: &str,
        request: axum::extract::Request,
    ) -> Response {
        let missing = || (StatusCode::NOT_FOUND, "Not found").into_response();
        let (asked, _) = request.into_parts();
        if asked.uri.query().is_some() {
            return missing();
        }
        if served == Served::Page && !into_frame(&asked.headers) {
            return missing();
        }
        let now = (self.clock)();
        let Some(claim) = self.claims.lock().unwrap().claim(token, served, now) else {
            return missing();
        };
        let Some(kind) = claim.used.kind_of(&claim.path) else {
            return missing();
        };
        // Pinned again, it is still the file the token was given for.
        let path = claim.path.clone();
        let pinned = tokio::task::spawn_blocking(move || pin(&path).ok());
        let pinned = match pinned.await {
            Ok(Some(pinned)) if pinned.id == claim.id => pinned,
            _ => return missing(),
        };
        let size = pinned.size;
        let mut headers = claim.used.headers(kind);
        let bounds = match asked.headers.get(header::RANGE) {
            None => None,
            Some(range) => match range
                .to_str()
                .ok()
                .and_then(|range| byte_range(range, size))
            {
                Some(bounds) => Some(bounds),
                None => {
                    let unmet = format!("bytes */{size}").parse().expect("a header's value");
                    headers.insert(header::CONTENT_RANGE, unmet);
                    return (StatusCode::RANGE_NOT_SATISFIABLE, headers).into_response();
                }
            },
        };
        let (start, length) = match bounds {
            Some((start, end)) => {
                let range = format!("bytes {start}-{end}/{size}");
                headers.insert(
                    header::CONTENT_RANGE,
                    range.parse().expect("a header's value"),
                );
                (start, end - start + 1)
            }
            None => (0, size),
        };
        headers.insert(header::CONTENT_LENGTH, length.into());
        let status = match bounds {
            Some(_) => StatusCode::PARTIAL_CONTENT,
            None => StatusCode::OK,
        };
        // A HEAD's answer goes without its body, which is then never read.
        (status, headers, read(pinned.file, start, length)).into_response()
    }
}

/// `length` bytes of `file` from `start`, read off the engine's threads a
/// piece at a time, as they are sent.
fn read(file: File, start: u64, length: u64) -> Body {
    let pieces = futures::stream::try_unfold(
        (file, Some(start), length),
        |(mut file, start, left)| async move {
            if left == 0 {
                return Ok::<_, io::Error>(None);
            }
            let (file, piece) = tokio::task::spawn_blocking(move || {
                if let Some(start) = start {
                    file.seek(SeekFrom::Start(start))?;
                }
                let mut piece = Vec::new();
                (&mut file).take(left.min(PIECE)).read_to_end(&mut piece)?;
                Ok::<_, io::Error>((file, piece))
            })
            .await
            .map_err(io::Error::other)??;
            // A file cut short as it is read ends the answer short, which
            // its length tells.
            if piece.is_empty() {
                return Ok(None);
            }
            let left = left - piece.len() as u64;
            Ok(Some((Piece::from(piece), (file, None, left))))
        },
    );
    Body::from_stream(pieces)
}
