export function receiptBatchUrl(batchId: string, origin: string): string {
  const url = new URL('/transfers', origin);
  url.searchParams.set('batch', batchId);
  return url.href;
}

export function receiptDateToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
