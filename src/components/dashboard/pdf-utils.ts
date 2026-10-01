/**
 * Shared PDF Library types + formatting helpers.
 */

export type Pdf = {
  id: string;
  name: string;
  subjectName: string | null;
  size: number;
  pages: number;
  status: string;
  createdAt: string;
};

export const MAX_PDF_BYTES = 500 * 1024 * 1024; // 500 MB

/** "28.7 MB" / "640 KB" */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "Sep 2, 2026" */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
