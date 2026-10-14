/**
 * @file itil.service.test.ts
 * @description Unit tests for ITIL SLA Monitoring and Quarantine service (FR-06 & FR-11).
 */

import {
  evaluateSlaIncidents,
  createQuarantineTicket,
  listQuarantineTickets,
  exportSupplierReturnsCsv,
} from './itil.service';

describe('ITIL Service Management (FR-06 & FR-11)', () => {
  it('evaluates SLA fulfillment without breaking on active orders', async () => {
    const report = await evaluateSlaIncidents();
    expect(report).toBeDefined();
    expect(Array.isArray(report.incidents)).toBe(true);
    expect(typeof report.breachCount).toBe('number');
  });

  it('creates an ITIL exception ticket for defective items and logs to quarantine', async () => {
    const ticket = await createQuarantineTicket({
      sku: 'AC-FLT-003',
      productName: 'High-Flow Air Filter Element',
      warehouseId: 'wh-a',
      quantity: 3,
      defectCategory: 'manufacturing_defect',
      severity: 'moderate',
      reportedBy: 'qa_inspector',
      notes: 'Pore diameter does not match OEM spec',
    });

    expect(ticket).toBeDefined();
    expect(ticket.ticketNumber).toMatch(/^QRN-/);
    expect(ticket.status).toBe('quarantined');
    expect(ticket.quantity).toBe(3);

    const list = await listQuarantineTickets({ warehouseId: 'wh-a' });
    expect(list.total).toBeGreaterThanOrEqual(1);
    expect(list.items.some((t) => t.id === ticket.id)).toBe(true);
  });

  it('rejects quarantine ticket creation if SKU or warehouse is invalid', async () => {
    await expect(
      createQuarantineTicket({
        sku: '',
        productName: 'Bad Item',
        warehouseId: 'wh-a',
        quantity: 1,
        defectCategory: 'shipping_damage',
        severity: 'minor',
        reportedBy: 'staff',
      })
    ).rejects.toThrow('Product SKU is required.');

    await expect(
      createQuarantineTicket({
        sku: 'AC-ENG-002',
        productName: 'Engine Oil',
        warehouseId: '',
        quantity: 1,
        defectCategory: 'shipping_damage',
        severity: 'minor',
        reportedBy: 'staff',
      })
    ).rejects.toThrow('Origin warehouse ID is required.');
  });

  it('exports Defective Products Report to CSV for supplier returns', async () => {
    const csv = await exportSupplierReturnsCsv();
    expect(csv).toContain('Ticket Number');
    expect(csv).toContain('SKU');
    expect(csv).toContain('Defective Units');
  });
});
