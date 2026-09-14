-- ═══════════════════════════════════════════════════════════════════════════
--  Fix Order Items RLS Policies & Realtime Publication
--  Required for Order Entry line items creation and view details modal
-- ═══════════════════════════════════════════════════════════════════════════

-- Ensure order_items table exists with proper types and primary key
CREATE TABLE IF NOT EXISTS "order_items" (
  "id"          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "orderId"     TEXT NOT NULL,
  "productId"   TEXT NOT NULL,
  "sku"         TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "quantity"    INTEGER NOT NULL DEFAULT 1,
  "unitPrice"   NUMERIC(12,2) NOT NULL DEFAULT 0,
  "subtotal"    NUMERIC(12,2) NOT NULL DEFAULT 0,
  "warehouseId" TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_items_orderId ON "order_items" ("orderId");
CREATE INDEX IF NOT EXISTS idx_order_items_productId ON "order_items" ("productId");

-- Enable Row Level Security
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;

-- Idempotent Realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'order_items'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE "order_items"';
  END IF;
END $$;

-- Permissive RLS Policies for authenticated users and app operations
DROP POLICY IF EXISTS "Authenticated read order_items" ON "order_items";
CREATE POLICY "Authenticated read order_items" ON "order_items"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon order_items policy" ON "order_items";
CREATE POLICY "Anon order_items policy" ON "order_items"
  FOR ALL TO anon USING (true) WITH CHECK (true);
