# Inventory product variations

Apply `migrations/202609280001_product_variations.sql` in the SQL editor of the Supabase project configured by `VITE_SUPABASE_URL`, before using the variation forms. This is separate from the backend's Prisma database. The migration has not been applied automatically to a remote database.

Variants reuse `products` records and the existing `inventory.productId` and `stockAdjustments.productId` relationships. `parentProductId` links each variant to its parent; each QR encodes the variant product ID, so existing product lookup remains usable. Parent products group variants in Inventory. General information is copied to variant records on save for existing product consumers.

`save_product_variations` saves the parent and variants and initializes missing warehouse inventory rows in one transaction. It runs with the caller's existing RLS permissions, not elevated privileges. New stock rows start at zero. Existing stock is preserved on edit. Nonzero stock cannot be assigned directly to a variation parent.

Disabled variants remain stored to preserve stock, QR identities and historical references. Removed saved attribute values disable their combinations. Changing between ordinary and variation products requires zero stock in every affected warehouse. Up to three attributes and 250 generated combinations are supported by the editor.

Scope: the grouped view and variation controls are implemented in Inventory; other product consumers retain their existing interfaces. There are no changes to order, financial, authentication or warehouse models.

Checks: `npm run lint`, `npm run build`, and `node --import tsx --test src/lib/productVariations.test.ts`. Browser checks used isolated fixture data; database transaction/RLS checks used local PostgreSQL via PGlite with both UUID and text IDs.
