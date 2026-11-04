//! Keep tool images before facts or item bodies are written. Invalid
//! images stay as a readable explanation beside the rest of the result.
use crate::acp::ToolPart;
use crate::images::{self, Images};
use crate::model::{Image, ToolContent};
use crate::{plain, rules};
use banda_kernel::{ModuleSpace, Refusal};

pub async fn keep(space: &ModuleSpace, parts: Vec<ToolPart>) -> Result<Vec<ToolContent>, String> {
    let files = Images::of(space.data());
    let mut carried: Vec<Image> = Vec::new();
    let mut content = Vec::with_capacity(parts.len());
    for part in parts {
        match part {
            ToolPart::Shown(part) => content.push(part),
            ToolPart::Image { mime, data } => {
                let prepared = images::prepare(mime, &data, None).and_then(|(image, bytes)| {
                    let mut together = carried.clone();
                    together.push(image.clone());
                    rules::message::may_send(
                        "Tool image",
                        &together.iter().map(|image| image.id).collect::<Vec<_>>(),
                    )?;
                    rules::message::may_carry(&together)?;
                    Ok((image, bytes))
                });
                match prepared {
                    Ok((image, bytes)) => {
                        files.keep(image.id, bytes).await.map_err(plain)?;
                        carried.push(image.clone());
                        content.push(ToolContent::Image { image });
                    }
                    Err(Refusal { message, .. }) => content.push(ToolContent::Text {
                        text: format!("Image could not be shown: {message}"),
                    }),
                }
            }
        }
    }
    Ok(super::output::bound(content))
}
