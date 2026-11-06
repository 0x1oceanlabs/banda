/** The worker that reads PDFs off the main thread: PDF.js's, loaded
 * through a file of Banda's so Vite bundles it as a module worker, as the
 * Diff's is, and tests never run it. */
import "pdfjs-dist/build/pdf.worker.min.mjs"
