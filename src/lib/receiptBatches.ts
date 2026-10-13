export function receiptBatchUrl(batchId: string, origin: string): string {
  const url = new URL('/transfers', origin);
  url.searchParams.set('batch', batchId);
  return url.href;
}

export type BatchQrInput = { kind: 'sku' } | { kind: 'invalid-batch' } | { kind: 'batch'; batchId: string };

// Pure classification: no navigation or fetching; only the current origin is trusted.
export function classifyBatchQr(value: string, origin: string): BatchQrInput {
  const input = value.trim();
  const looksLikeBatch = /(?:^|\/)transfers(?:[/?#]|$)/i.test(input) || /[?&]batch(?:=|&|#|$)/i.test(input);
  if (!looksLikeBatch) return { kind: 'sku' };
  try {
    const base = new URL(origin);
    const url = new URL(input, base.origin);
    const batches = url.searchParams.getAll('batch');
    if (!(input.startsWith('/transfers') || /^https?:\/\//i.test(input))
      || !['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin
      || url.username || url.password || url.pathname !== '/transfers' || url.hash
      || /[\s\\]/.test(input) || /%(?![\da-f]{2})/i.test(input)
      || batches.length !== 1 || !batches[0].trim() || batches[0] !== batches[0].trim()
      || [...url.searchParams.keys()].some(key => key !== 'batch')) return { kind: 'invalid-batch' };
    return { kind: 'batch', batchId: batches[0] };
  } catch {
    return { kind: 'invalid-batch' };
  }
}

export function receiptDateToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
