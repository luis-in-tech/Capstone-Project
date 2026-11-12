# Security Specification - ActivePro Integrated System

## Data Invariants
1. A user cannot modify their own `role` in `/users/{userId}`.
2. An order can only be created by an `agent` or `admin`.
3. An order status can only be updated sequentially (e.g., `pending` -> `preparing` -> `out_for_delivery` -> `delivered`).
4. Physical stock is validated against live warehouse balances and deducted atomically at `OrderEntry` creation (`stockReserved: true`), while dispatch to `out_for_delivery` requires photo validation proof.
5. P&L financial data (expenses and total revenue) is only visible to `admin`.
6. Field agents can only view their own orders but can view all products and stock availability.
7. Warehouse transfers can only be initiated by `admin` or `secretary`.

## The "Dirty Dozen" Payloads (Denial Tests)
1. **Self-Promotion**: User attempts to set `role: 'admin'` on their own profile.
2. **Order Forgery**: Agent attempts to create an order as another agent ID.
3. **Price Manipulation**: Agent attempts to set `totalAmount: 0` for a bulk order.
4. **Illegal Status Jump**: Agent attempts to move order from `pending` to `delivered` directly, skipping `preparing` (where photos are required).
5. **Photo Bypass**: Secretary attempts to move status to `out_for_delivery` without providing a `photoValidationUrl`.
6. **Stock Spoofing**: Agent attempts to update `inventory` quantities directly.
7. **Negative Stock**: Transfer request with `quantity: -500`.
8. **Financial Peeking**: Agent attempts to read the `/expenses` collection.
9. **Inventory Poisoning**: Document creation with an ID larger than 128 characters or containing illegal symbols.
10. **Revenue Leakage**: Updating a `completed` order's `totalAmount` to hide revenue.
11. **Orphaned Order Item**: Creating an `OrderItem` without a valid parent `orderId`.
12. **SLA Tampering**: Agent attempts to update `deliveryDeadline` to avoid escalation.

## Access Control Matrix
| Collection | Create | Read (Get) | Read (List) | Update | Delete |
|------------|--------|------------|-------------|--------|--------|
| /products  | Admin  | All Auth   | All Auth    | Admin  | Admin  |
| /warehouses| Admin  | All Auth   | All Auth    | Admin  | Admin  |
| /inventory | Admin  | All Auth   | All Auth    | Admin  | Admin  |
| /orders    | Admin, Agent | Owner/Admin | Owner/Admin | (State Based) | Admin |
| /transfers | Admin, Secretary | All Auth | All Auth | Admin, Secretary | Admin |
| /expenses  | Admin, Secretary | Admin | Admin | Admin | Admin |
| /users     | System/Admin | Admin/Owner | Admin | Admin (Privileged) | Admin |
