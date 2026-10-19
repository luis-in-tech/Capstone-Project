/**
 * @file returns.service.test.ts
 * @description Unit tests for Returns & Exchange Processing service (FR-17).
 */

import { processReturn, listReturns, getReturnById, getReturnAuditTrail } from './returns.service';
import { createOrder } from './orders.service';

describe('Returns & Exchange Service (FR-17)', () => {
  let sampleOrderId: string;

  beforeAll(async () => {
    const res = await createOrder({
      clientName: 'Manila Auto Supply',
      address: '123 Rizal Ave, Manila',
      deliveryRegion: 'Metro Manila',
      paymentTerms: 'COD',
      items: [
        {
          productId: 'prod_ret_1',
          warehouseId: 'wh-a',
          sku: 'AC-BRK-001',
          name: 'Brake Pad Set',
          quantity: 4,
          unitPrice: 1250,
        },
      ],
    });
    sampleOrderId = res.order.id;
  });

  it('successfully processes a viable return, restocking units and logging audit', async () => {
    const returnRecord = await processReturn({
      orderId: sampleOrderId,
      actionType: 'refund',
      refundMethod: 'Cash',
      reason: 'Customer ordered wrong size',
      processedBy: 'officer_jane',
      items: [
        {
          productId: 'prod_ret_1',
          sku: 'AC-BRK-001',
          name: 'Brake Pad Set',
          quantity: 2,
          condition: 'viable',
          warehouseId: 'wh-a',
          unitPrice: 1250,
        },
      ],
    });

    expect(returnRecord).toBeDefined();
    expect(returnRecord.returnNumber).toMatch(/^RET-/);
    expect(returnRecord.restockedItemsCount).toBe(2);
    expect(returnRecord.quarantinedItemsCount).toBe(0);
    expect(returnRecord.totalRefundAmount).toBe(2500);
    expect(returnRecord.status).toBe('completed');

    // Audit trail verification
    const auditLogs = getReturnAuditTrail().filter((a) => a.returnId === returnRecord.id);
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].restockedQuantity).toBe(2);
    expect(auditLogs[0].destination).toBe('warehouse_inventory');
  });

  it('successfully processes a damaged item, routing it to quarantine', async () => {
    const returnRecord = await processReturn({
      orderId: sampleOrderId,
      actionType: 'credit',
      refundMethod: 'Debt_Adjustment',
      reason: 'Package crushed upon arrival',
      processedBy: 'officer_jane',
      items: [
        {
          productId: 'prod_ret_1',
          sku: 'AC-BRK-001',
          name: 'Brake Pad Set',
          quantity: 1,
          condition: 'damaged',
          warehouseId: 'wh-a',
          unitPrice: 1250,
        },
      ],
    });

    expect(returnRecord.quarantinedItemsCount).toBe(1);
    expect(returnRecord.restockedItemsCount).toBe(0);

    const auditLogs = getReturnAuditTrail().filter((a) => a.returnId === returnRecord.id);
    expect(auditLogs[0].destination).toBe('quarantine');
  });

  it('rejects return requests with missing line items', async () => {
    await expect(
      processReturn({
        orderId: sampleOrderId,
        actionType: 'refund',
        refundMethod: 'Cash',
        reason: 'Missing items test',
        processedBy: 'officer_jane',
        items: [],
      })
    ).rejects.toThrow('At least one return item must be specified.');
  });

  it('lists returns and retrieves a single return record by ID', async () => {
    const list = await listReturns();
    expect(list.total).toBeGreaterThanOrEqual(1);

    const first = list.items[0];
    const retrieved = await getReturnById(first.id);
    expect(retrieved.id).toBe(first.id);
  });
});
