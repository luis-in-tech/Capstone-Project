# Warehouse Layout

Apply `20260927_warehouse_layout.sql` after the existing migrations through
`20260926_admin_creation_tags.sql`.

If the zone tables are missing (`PGRST205` / `42P01`), Warehouse Layout uses
temporary browser localStorage, scoped by Supabase project, signed-in user and
warehouse. This supports zone editing and quantity assignment without SQL access.
The UI labels this mode clearly. It uses the existing inventory edit permission,
but is a local preview, not a shared or server-enforced inventory record.
It does not integrate local allocations into movements or modify warehouse totals.
Permission, session and network errors still surface instead of activating fallback.
Clearing browser data removes temporary layouts; browser storage failures surface
as errors. Once the tables are available, database mode resumes and temporary data
remains in browser storage without automatic import. Conflicting local allocations
are excluded from the preview when they exceed current warehouse stock, without
guessing which zone was consumed. Saving a new allocation discards those conflicts.

The feature adds two tables: warehouse zones (name and automatic order) and
positive quantity allocations referencing existing products and warehouses.
It does not create inventory or product duplicates. Unassigned is calculated
as the sum of existing warehouse inventory rows minus zone allocations.
Deleting a zone cascades its allocations, returning that quantity to Unassigned.

Read access uses `staff_warehouse_allowed`. Zone edits and quantity assignment
require the existing inventory `adjust` permission; writes are RPC-only.
Movement creation uses the existing movement and warehouse permission checks.

`confirm_inventory_movement_with_zones` wraps the existing confirmation RPC in
one transaction. It validates zone ownership and available source quantity,
updates allocations, invokes existing warehouse/expense logic, and snapshots
zone names in movement history. Repeated request IDs cannot double-allocate.
Receipts and transfers without zones use Unassigned. Existing movement records
retain their original history without invented zone assignments.

Legacy orders, stock adjustments, and transport flows have no source-zone input.
They may reduce Unassigned stock. If a reduction would consume allocated stock,
the database rejects it with instructions to return enough stock to Unassigned
first. This is intentional: the system must not guess which zone was emptied.
No financial or order implementation was changed. Inventory writes are serialized
to enforce reconciliation across concurrent writers; this favors correctness
over write throughput for this lightweight application.

## Database verification before deployment

Run on a staging database with the existing migrations and authenticated test users:

- Warehouse stock 100: assign 30 to Zone 1 and 50 to Zone 2; verify Unassigned 20.
- Try assigning 51 to Zone 2; verify rejection and unchanged warehouse stock.
- Rename a zone, reject a duplicate name within that warehouse, and permit the
  same name in another warehouse.
- Delete Zone 1; verify warehouse stock 100 and Unassigned 50.
- Receive 10 into a named zone; verify warehouse and zone both increase by 10,
  and the original purchase expense is created exactly once.
- Transfer from a named zone to another warehouse/zone; verify source and
  destination totals and allocations change together, without a purchase expense.
- Repeat a confirmed request ID; verify no duplicate stock, allocation, or expense.
- Try insufficient source-zone stock, a zone from another warehouse, or an invalid
  receipt; verify the entire transaction rolls back.
- Try direct table writes, a view-only user, a revoked user, and a user outside
  the warehouse scope; verify the applicable reads/writes are denied.
- Concurrent allocations/reductions cannot overallocate. Legacy reductions into
  allocated stock must fail; returning stock to Unassigned allows them to proceed.

Frontend checks: `npm run lint`, `npm run build`, and
`node --import tsx --test src/lib/warehouseLayout.test.ts src/lib/inventoryMovement.test.ts`.


### Visual floorplan

Apply `20260928_warehouse_floorplans.sql` after the warehouse layout migration to share zone positions, colors and boundary entrance markers across sessions. The table uses the existing warehouse access and inventory-adjust permissions. Without this table, the visual arrangement uses account/project/warehouse-scoped browser storage and displays a local-storage notice. Browser arrangements are not automatically imported into the database.

Edit Layout enables zone dragging, resize handles, colors, and entrance editing. Entrance edge selection attaches a marker to that edge; dragging stays on the selected edge. Arrow keys also move selected zones and entrances. Save Layout saves visual changes; Cancel restores the last saved arrangement. Add, rename and delete zone dialogs use the existing immediate-save operations (including returning deleted-zone allocations to Unassigned). Unassigned Stock is outside the floorplan.
