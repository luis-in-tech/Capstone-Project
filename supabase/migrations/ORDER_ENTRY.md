# Order Entry setup

Apply `20260920_order_entry.sql` after the existing base tables and order-item migrations. No existing rows or RLS policies are removed or rewritten. The two functions run with the caller's permissions; an inventory write denied by your policies fails the entire save instead of claiming stock was reserved.

The UI uses customers from existing orders visible to the signed-in user, matching Supply Chain's current customer source. Supply Chain's temporary customer previews are not a persisted directory and cannot be selected. Existing records have no street address; the order form allows an address to be entered for the receipt. Product variation and unit are shown if those fields exist; otherwise the product/SKU is used with `pc` as the unit.

New metadata is stored in `orders.receiptDetails`, `orders.stockReserved`, and `order_items.entryDetails`. `totalAmount` remains the discounted grand total for existing financial views. A generated request UUID makes retries idempotent. The save checks live prices and stock under row locks and commits the order, items, stock deductions, and adjustment logs together. Status changes preserve history, require a dispatch photo, and restore grouped product/warehouse quantities atomically on cancellation or escalation.

Legacy orders have no explicit reservation flag. Their cancellation retains the previous assumption that stock was deducted. This migration cannot retrospectively establish whether an older save's swallowed inventory error left stock undeducted; review any known affected legacy orders before cancelling them.

The receipt uses the fields supplied in the implementation request; no client DR sample was provided for exact visual matching. Print / Save PDF uses the browser's print dialog. Disable browser headers/footers for the cleanest PDF. Packing-list fields and totals appear only on the final receipt page.

## Database verification after applying the migration

Use a development database with authenticated users and existing customers:

- Save two lines for the same product/source warehouse using different prices. Verify both lines, their selected price snapshots, one order discount, and the combined stock deduction.
- Submit more stock than available, or deny the inventory update. Verify that no order, items, or adjustment logs remain and the cart displays the error without claiming a reservation.
- Retry a committed request UUID. Verify it returns the same order without deducting again.
- Submit concurrent orders competing for stock. Only demand covered by the locked stock can commit.
- Cancel an order with repeated product/warehouse lines. Verify the full quantity returns exactly once and the history remains intact. Deny a stock restoration and verify the status remains unchanged.
- Confirm agents cannot advance statuses, staff can advance only their own orders, and admins/secretaries can manage all orders. Dispatch without a photo must fail.
- Advance Pending → Preparing → Out for Delivery → Delivered → Completed and reopen the saved receipt.

These checks require the database migration and an authenticated database connection; frontend build/unit checks do not execute them.

## Group discounts

Apply `20260921_order_group_discounts.sql` after the original Order Entry migration. It extends `create_order_entry` using existing receipt metadata; inventory and status operations are unchanged. Each discount applies to the contiguous items since the preceding discount. The existing extra order discount remains available. The server recalculates group bases and discount amounts and rejects invalid or mismatched totals atomically. Older callers and receipts remain supported.

Verify percentage and fixed discounts across multiple groups, reopening/printing receipts, deleting a group-ending cart item, and cancellation restoring only product quantities.
