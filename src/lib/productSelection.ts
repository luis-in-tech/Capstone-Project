import { classifyBatchQr } from './receiptBatches';

export function matchProductSku<T extends { sku: string }>(products: T[], value: string): { product: T; error?: never } | { product?: never; error: string } {
  const sku = value.trim().toLowerCase();
  const matches = sku ? products.filter(product => product.sku.trim().toLowerCase() === sku) : [];
  if (!matches.length) return { error: 'No eligible product matches this SKU.' };
  if (matches.length > 1) return { error: 'Multiple items match this SKU. Choose the item under Select products.' };
  return { product: matches[0] };
}

export type BatchResolver = (batchId: string, context: { signal: AbortSignal }) => Promise<{ productId: string } | null>;
export type SelectionOutcome = 'selected' | 'rejected' | 'retryable' | 'ignored';
export interface SelectionContext<T> {
  products: T[];
  onAdd: (product: T) => string | void;
  resolveBatch?: BatchResolver;
  getProductId?: (product: T) => string;
  active: boolean;
}
export const batchLookupUnavailable = 'Batch QR lookup is not available yet. Enter the product SKU or use Select products.';

// Owns only selection lifecycle. Callers retain authorization, eligibility and stock rules.
export function createProductSelection<T extends { sku: string }>(
  current: () => SelectionContext<T>,
  report: (message: string) => void,
  pending: (value: boolean) => void,
) {
  let request: AbortController | undefined;
  function cancel() {
    request?.abort();
    request = undefined;
    pending(false);
  }
  function choose(product: T): SelectionOutcome {
    const error = current().onAdd(product);
    if (error) { report(error); return 'rejected'; }
    report(`${product.sku} selected. Open Select products to view the item.`);
    return 'selected';
  }
  function submit(value: string, scan: boolean, origin: string): SelectionOutcome | Promise<SelectionOutcome> {
    if (!current().active || request) return 'ignored';
    const input = scan ? classifyBatchQr(value, origin) : { kind: 'sku' as const };
    if (input.kind === 'sku') {
      const match = matchProductSku(current().products, value);
      if (match.error) { report(match.error); return 'rejected'; }
      return choose(match.product);
    }
    if (input.kind === 'invalid-batch') { report('Invalid batch QR.'); return 'rejected'; }
    const { resolveBatch, getProductId } = current();
    if (!resolveBatch || !getProductId) { report(batchLookupUnavailable); return 'rejected'; }
    const controller = new AbortController();
    request = controller;
    pending(true);
    report('Looking up batch…');
    const valid = () => request === controller && !controller.signal.aborted && current().active
      && current().resolveBatch === resolveBatch && current().getProductId === getProductId;
    return (async (): Promise<SelectionOutcome> => {
      try {
        const result = await resolveBatch(input.batchId, { signal: controller.signal });
        if (!valid()) return 'ignored';
        if (!result?.productId) { report('Batch not found or unavailable.'); return 'rejected'; }
        const matches = current().products.filter(product => getProductId(product) === result.productId);
        if (!matches.length) { report('No eligible product matches this batch.'); return 'rejected'; }
        if (matches.length > 1) { report('Multiple items match this batch. Choose the item under Select products.'); return 'rejected'; }
        return choose(matches[0]);
      } catch {
        if (!valid()) return 'ignored';
        report('Batch lookup failed. Please try again.');
        return 'retryable';
      } finally {
        if (request === controller) { request = undefined; pending(false); }
      }
    })();
  }
  return { submit, cancel };
}
