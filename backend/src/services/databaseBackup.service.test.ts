/**
 * @file databaseBackup.service.test.ts
 * @description Unit tests for Database Automated Backups to CSV service (FR-18 & NFR-07).
 */

import {
  escapeCsvField,
  buildCsv,
  exportDatabaseTableCsv,
  createScheduledSnapshot,
  listDatabaseSnapshots,
} from './databaseBackup.service';

describe('Database CSV Backup Service (FR-18 & NFR-07)', () => {
  it('escapes fields per RFC 4180 and protects against formula injection', () => {
    expect(escapeCsvField('Standard Text')).toBe('"Standard Text"');
    expect(escapeCsvField('Text with "quotes"')).toBe('"Text with ""quotes"""');
    expect(escapeCsvField('=SUM(A1:A10)')).toBe('"\'=SUM(A1:A10)"');
    expect(escapeCsvField('+12345')).toBe('"\'+12345"');
    expect(escapeCsvField(null)).toBe('""');
  });

  it('builds valid multi-row CSV content', () => {
    const headers = ['ID', 'Name', 'Amount'];
    const rows = [
      ['1', 'Widget A', 100],
      ['2', 'Widget B', 250.5],
    ];
    const csv = buildCsv(headers, rows);
    expect(csv).toContain('"ID","Name","Amount"');
    expect(csv).toContain('"1","Widget A","100"');
    expect(csv).toContain('"2","Widget B","250.5"');
  });

  it('exports individual tables and full combined database backup', async () => {
    const invExport = await exportDatabaseTableCsv('inventory');
    expect(invExport.filename).toMatch(/^cmdb_inventory_backup_/);
    expect(invExport.csv).toContain('SKU');
    expect(invExport.rowCount).toBeGreaterThan(1);

    const fullExport = await exportDatabaseTableCsv('all');
    expect(fullExport.filename).toMatch(/^full_database_backup_/);
    expect(fullExport.csv).toContain('CMDB INVENTORY LEDGER');
    expect(fullExport.csv).toContain('FINANCIAL P&L LEDGER');
  });

  it('creates an on-disk scheduled snapshot and registers manifest entry', async () => {
    const snapshot = await createScheduledSnapshot();
    expect(snapshot.snapshotId).toMatch(/^snap_/);
    expect(snapshot.files.length).toBe(4);
    expect(snapshot.totalBytes).toBeGreaterThan(0);

    const snapshots = await listDatabaseSnapshots();
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots[0].snapshotId).toBe(snapshot.snapshotId);
  });
});
