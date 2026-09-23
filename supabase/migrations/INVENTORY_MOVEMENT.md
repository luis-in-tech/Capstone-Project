# Inventory Movement setup

Apply `20260918_inventory_movements.sql` in the Supabase SQL editor after the existing `create_tables.sql` migration. The frontend uses Supabase directly, as the previous Transport screen did; this change does not require a separate Express endpoint or any environment-variable changes.

The migration adds a movement header with product snapshots, a daily sequence, and an authenticated confirmation function. It reuses `users`, `suppliers`, `products`, `warehouses`, `inventory`, `expenses`, `expenseCategories`, and `stockAdjustments`. Earlier records in `transfers` remain accessible through **Earlier transport records**, including their original pending/in-transit actions.

Confirmation saves stock adjustments, the movement, and (for external receipts only) the purchase expense in one database transaction. Internal transfers are completed immediately on confirmation. The authenticated user's name, timestamp, and `MOV-YYYYMMDD-###` ID are assigned by the server. Dates reset at midnight in Asia/Manila; the strict three-digit format supports 999 movements per day. Request IDs make retries idempotent. New movement records cannot be edited or deleted through the module.

## Verification

- Run `npm.cmd run lint` and `npm.cmd run build`.
- Run `node --import tsx --test src/lib/inventoryMovement.test.ts`.
- After applying the migration in a test database, confirm a multi-product receipt. Verify receiving stock increases, one `Inventory Purchase` expense matches the summary, and audit entries reference the Movement ID.
- Confirm an internal transfer. Verify source stock decreases, destination stock increases, and no expense is created.
- Try a transfer whose source stock was reduced after review. Confirmation should fail with no partial updates.
- Retry the same confirmation request ID. Verify it returns the original movement without changing stock or creating another expense.
- Confirm two movements concurrently and check that their daily sequence numbers differ.

The migration must be applied before new movement history and confirmation work. The form can be previewed as soon as the existing reference data loads.
