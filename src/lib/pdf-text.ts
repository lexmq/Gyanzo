import { loadPdfBytes } from '@/lib/pdf-store';
import path from 'path';
import { extractText, getDocumentProxy } from 'unpdf';

/**
 * Shared PDF → plain-text extraction for the AI features (chat context,
 * smart summaries, easy explanations). Uploads live in db/uploads/<storedAs>.
 *
 * A single unreadable/corrupt PDF can never break the caller: extraction
 * failures are logged and skipped. Output is capped so the model prompt
 * stays bounded.
 */

export const UPLOAD_DIR = path.join(process.cwd(), 'db', 'uploads');

const PER_DOC_CHARS = 6000; // extracted text per PDF
const TOTAL_CONTEXT_CHARS = 24000; // total document context cap

export async function extractPdfText(
  rows: { name: string; storedAs: string }[]
): Promise<string | null> {
  const { context } = await extractPdfSource(rows);
  return context;
}

/* Detailed extraction used by the per-subject study features (Quiz,
   Flashcards, Revision Notes): besides the merged context it reports WHICH
   documents actually contributed text and which were found but unreadable
   (corrupt or scanned/image-only), so the UI can be transparent about the
   generation source. */
export type PdfSource = {
  context: string | null;
  used: string[]; // docs whose text made it into the context
  unreadable: string[]; // docs found but with no extractable text
};

export async function extractPdfSource(
  rows: { name: string; storedAs: string }[],
  opts?: { perDocChars?: number; totalChars?: number }
): Promise<PdfSource> {
  const perDocChars = opts?.perDocChars ?? PER_DOC_CHARS;
  const totalChars = opts?.totalChars ?? TOTAL_CONTEXT_CHARS;
  const parts: string[] = [];
  const used: string[] = [];
  const unreadable: string[] = [];
  let usedChars = 0;
  for (const p of rows) {
    if (usedChars >= totalChars) break;
    try {
      const buf = await loadPdfBytes(p);
      const doc = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(doc, { mergePages: true });
      const clean = String(text).replace(/\s+/g, ' ').trim();
      if (!clean) {
        unreadable.push(p.name);
        continue;
      }
      const slice = clean.slice(
        0,
        Math.min(perDocChars, totalChars - usedChars)
      );
      usedChars += slice.length;
      parts.push(`--- ${p.name} ---\n${slice}`);
      used.push(p.name);
    } catch (error) {
      console.warn('[pdf-text] extraction failed for', p.storedAs, error);
      unreadable.push(p.name);
    }
  }
  return {
    context: parts.length > 0 ? parts.join('\n\n') : null,
    used,
    unreadable,
  };
}
