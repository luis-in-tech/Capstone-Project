/**
 * Escapes a value for safe inclusion in a RFC 4180 CSV cell while neutralizing
 * spreadsheet formula injection characters (`=`, `+`, `-`, `@`, `\t`, `\r`).
 */
export function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const formulaSafe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
}

/**
 * Escapes HTML special characters for safe interpolation inside print documents.
 */
export function escapeHtml(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

