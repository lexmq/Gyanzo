import 'server-only';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { put, del } from '@vercel/blob';
import { getStore } from '@netlify/blobs';

/**
 * Multi-backend PDF storage — local disk (sandbox / self-hosted), Vercel
 * Blob, or Netlify Blobs (both serverless, read-only filesystem).
 *
 * Mode is chosen automatically:
 *   - BLOB_READ_WRITE_TOKEN present  → Vercel Blob (row.blobUrl set)
 *   - running on Netlify             → Netlify Blobs (row.blobUrl is a
 *                                      `netlify-blobs:<storedAs>:<parts>` ref)
 *   - otherwise                      → db/uploads/<storedAs> on disk
 *
 * Every reader/writer of PDF binaries MUST go through this module so the
 * same code runs in both environments without conditionals at call sites.
 */

export const UPLOAD_DIR = path.join(process.cwd(), 'db', 'uploads');

export const blobEnabled = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export type StorageMode = 'blob' | 'netlify' | 'disk';

/** Evaluated per call — Netlify's runtime globals exist only at request time. */
export function netlifyBlobsEnabled(): boolean {
  if (blobEnabled) return false;
  const g = globalThis as { Netlify?: unknown; netlifyBlobsContext?: unknown };
  return Boolean(
    g.Netlify ||
      g.netlifyBlobsContext ||
      process.env.NETLIFY_BLOBS_CONTEXT ||
      process.env.NETLIFY === 'true'
  );
}

export function storageMode(): StorageMode {
  if (blobEnabled) return 'blob';
  return netlifyBlobsEnabled() ? 'netlify' : 'disk';
}

/* ── Netlify Blobs ──────────────────────────────────────────────────────
   Netlify Functions cap request bodies at ~6 MB, so the browser uploads a
   PDF as ≤ NETLIFY_CHUNK_BYTES parts (key `<storedAs>/<index>`) and the
   row's blobUrl records how many parts make up the file. Reads stitch the
   parts back together in order. */

export const NETLIFY_CHUNK_BYTES = 4 * 1024 * 1024;
const NETLIFY_REF_PREFIX = 'netlify-blobs:';

export function pdfBlobStore() {
  return getStore({ name: 'pdfs', consistency: 'strong' });
}

export function netlifyPartKey(storedAs: string, index: number): string {
  return `${storedAs}/${index}`;
}

export function netlifyRef(storedAs: string, parts: number): string {
  return `${NETLIFY_REF_PREFIX}${storedAs}:${parts}`;
}

/** Parses a `netlify-blobs:` ref; null for Vercel URLs / disk rows. */
export function parseNetlifyRef(
  blobUrl: string | null | undefined
): { storedAs: string; parts: number } | null {
  if (!blobUrl?.startsWith(NETLIFY_REF_PREFIX)) return null;
  const rest = blobUrl.slice(NETLIFY_REF_PREFIX.length);
  const sep = rest.lastIndexOf(':');
  const parts = Number(rest.slice(sep + 1));
  if (sep <= 0 || !Number.isInteger(parts) || parts < 1) return null;
  return { storedAs: rest.slice(0, sep), parts };
}

/** Streams a Netlify-stored PDF part by part (constant memory). */
export function streamNetlifyPdf(ref: {
  storedAs: string;
  parts: number;
}): ReadableStream<Uint8Array> {
  const store = pdfBlobStore();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= ref.parts) {
        controller.close();
        return;
      }
      const buf = await store.get(netlifyPartKey(ref.storedAs, index), {
        type: 'arrayBuffer',
      });
      if (!buf) {
        controller.error(new Error(`missing part ${index} of ${ref.storedAs}`));
        return;
      }
      index += 1;
      controller.enqueue(new Uint8Array(buf));
    },
  });
}

async function loadNetlifyPdf(ref: {
  storedAs: string;
  parts: number;
}): Promise<Buffer> {
  const store = pdfBlobStore();
  const bufs = await Promise.all(
    Array.from({ length: ref.parts }, async (_, i) => {
      const buf = await store.get(netlifyPartKey(ref.storedAs, i), {
        type: 'arrayBuffer',
      });
      if (!buf) throw new Error(`missing part ${i} of ${ref.storedAs}`);
      return Buffer.from(buf);
    })
  );
  return Buffer.concat(bufs);
}

/** Persist an uploaded PDF; returns its Blob URL or null when on disk. */
export async function storePdfFile(
  storedAs: string,
  data: Buffer
): Promise<string | null> {
  if (netlifyBlobsEnabled()) {
    const store = pdfBlobStore();
    let parts = 0;
    for (let off = 0; off < data.length; off += NETLIFY_CHUNK_BYTES) {
      const part = data.subarray(off, off + NETLIFY_CHUNK_BYTES);
      await store.set(
        netlifyPartKey(storedAs, parts),
        part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer
      );
      parts += 1;
    }
    return netlifyRef(storedAs, Math.max(parts, 1));
  }
  if (blobEnabled) {
    const blob = await put(`pdfs/${storedAs}`, data, {
      access: 'public',
      addRandomSuffix: false,
    });
    return blob.url;
  }
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, storedAs), data);
  return null;
}

/** Load a stored PDF's bytes from whichever backend holds it. */
export async function loadPdfBytes(pdf: {
  storedAs: string;
  blobUrl?: string | null;
}): Promise<Buffer> {
  const netlify = parseNetlifyRef(pdf.blobUrl);
  if (netlify) return loadNetlifyPdf(netlify);
  if (pdf.blobUrl) {
    const res = await fetch(pdf.blobUrl, {
      /* no-store: these are large binaries consumed on demand — never
         let the framework's fetch cache buffer them. */
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`blob fetch failed (${res.status}) for ${pdf.storedAs}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(path.join(UPLOAD_DIR, pdf.storedAs));
}

/** Best-effort delete of the stored binary (never throws). */
export async function removePdfFile(pdf: {
  storedAs: string;
  blobUrl?: string | null;
}): Promise<void> {
  const netlify = parseNetlifyRef(pdf.blobUrl);
  if (netlify) {
    const store = pdfBlobStore();
    await Promise.all(
      Array.from({ length: netlify.parts }, (_, i) =>
        store.delete(netlifyPartKey(netlify.storedAs, i)).catch(() => {})
      )
    );
    return;
  }
  if (pdf.blobUrl) {
    try {
      await del(pdf.blobUrl);
      return;
    } catch {
      /* fall through — nothing else to clean up for a blob */
    }
  }
  try {
    await unlink(path.join(UPLOAD_DIR, pdf.storedAs));
  } catch {
    /* file already gone */
  }
}
