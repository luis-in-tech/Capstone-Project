-- ═══════════════════════════════════════════════════════════════════════════
--  Add Missing Product Columns (costPrice, mmPrice, provincialPrice, etc.)
--  Fixes PGRST204: Could not find the 'costPrice' column of 'products'
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "costPrice" NUMERIC(12,2) DEFAULT 0;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "mmPrice" NUMERIC(12,2) DEFAULT 0;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "provincialPrice" NUMERIC(12,2) DEFAULT 0;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "promoPrice" NUMERIC(12,2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "supplier" TEXT DEFAULT 'N/A';
