/**
 * A PDF made here, so no test carries one: pages of plain lines in
 * Helvetica, as PDF 1.4 writes them, and room after them of `padding`
 * bytes, so a large one is read in ranges.
 */
export function pdfOf(pages: readonly string[][], padding = 0): Buffer {
  const objects: string[] = []
  const add = (body: string) => objects.push(body) // its number is the count
  add("<< /Type /Catalog /Pages 2 0 R >>")
  const kids = pages.map((_, n) => `${4 + 2 * n} 0 R`).join(" ")
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
  for (const [n, lines] of pages.entries()) {
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * n} 0 R >>`
    )
    const text = lines
      .map(
        (line, at) =>
          `BT /F1 ${at === 0 ? 24 : 12} Tf 72 ${720 - at * 28} Td (${line.replace(/[()\\]/g, "\\$&")}) Tj ET`
      )
      .join("\n")
    add(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`)
  }
  if (padding > 0) {
    const filler = "%".repeat(padding)
    add(`<< /Length ${filler.length} >>\nstream\n${filler}\nendstream`)
  }
  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((body, n) => {
    offsets.push(pdf.length)
    pdf += `${n + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const at of offsets) pdf += `${String(at).padStart(10, "0")} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, "latin1")
}
