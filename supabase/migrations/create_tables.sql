-- ═══════════════════════════════════════════════════════════════════════════
--  ActivePro Capstone Project — Supabase Database Migration
--  Creates all tables required by the frontend application.
--  Run this in your Supabase project's SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── 1. users ─────────────────────────────────────────────────────────────
-- Referenced by: useAuth.tsx, AdminPanel.tsx
CREATE TABLE IF NOT EXISTS "users" (
  "id"           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "uid"          TEXT UNIQUE NOT NULL,
  "email"        TEXT NOT NULL,
  "displayName"  TEXT DEFAULT '',
  "firstName"    TEXT DEFAULT '',
  "lastName"     TEXT DEFAULT '',
  "photoUrl"     TEXT DEFAULT '',
  "role"         TEXT NOT NULL DEFAULT 'agent'
                   CHECK ("role" IN ('admin', 'secretary', 'agent', 'staff')),
  "region"       TEXT DEFAULT '',
  "createdAt"    TIMESTAMPTZ DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_uid ON "users" ("uid");
CREATE INDEX IF NOT EXISTS idx_users_email ON "users" ("email");

-- ─── 2. products ──────────────────────────────────────────────────────────
-- Referenced by: Inventory.tsx, Orders.tsx, Pricelist.tsx, AdminPanel.tsx
CREATE TABLE IF NOT EXISTS "products" (
  "id"              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "sku"             TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "category"        TEXT DEFAULT 'Uncategorized',
  "description"     TEXT DEFAULT '',
  "basePrice"       NUMERIC(12,2) DEFAULT 0,
  "wholesalePrice"  NUMERIC(12,2) DEFAULT 0,
  "dealerPrice"     NUMERIC(12,2) DEFAULT 0,
  "mmPrice"         NUMERIC(12,2) DEFAULT 0,
  "provincialPrice" NUMERIC(12,2) DEFAULT 0,
  "costPrice"       NUMERIC(12,2) DEFAULT 0,
  "promoPrice"      NUMERIC(12,2),
  "supplier"        TEXT DEFAULT 'N/A',
  "photoUrl"        TEXT DEFAULT '',
  "minStockLevel"   INTEGER DEFAULT 0,
  "reorderPoint"    INTEGER DEFAULT 0,
  "supplierMoq"     INTEGER,
  "supplierId"      TEXT,
  "createdAt"       TIMESTAMPTZ DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_sku ON "products" ("sku");
CREATE INDEX IF NOT EXISTS idx_products_category ON "products" ("category");

-- Ensure columns exist even if the products table was previously created with an older schema
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "costPrice" NUMERIC(12,2) DEFAULT 0;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "mmPrice" NUMERIC(12,2) DEFAULT 0;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "provincialPrice" NUMERIC(12,2) DEFAULT 0;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "promoPrice" NUMERIC(12,2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "supplier" TEXT DEFAULT 'N/A';


-- ─── 3. warehouses ────────────────────────────────────────────────────────
-- Referenced by: Inventory.tsx, Transfers.tsx
CREATE TABLE IF NOT EXISTS "warehouses" (
  "id"        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "location"  TEXT DEFAULT 'Warehouse Facility',
  "active"    BOOLEAN DEFAULT true,
  "createdAt" TIMESTAMPTZ DEFAULT now(),
  "updatedAt" TIMESTAMPTZ DEFAULT now()
);

-- ─── 4. inventory ─────────────────────────────────────────────────────────
-- Referenced by: Inventory.tsx, Orders.tsx, Transfers.tsx, AdminPanel.tsx
CREATE TABLE IF NOT EXISTS "inventory" (
  "id"           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "productId"    TEXT NOT NULL,
  "warehouseId"  TEXT NOT NULL,
  "quantity"     INTEGER DEFAULT 0,
  "lastUpdated"  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_productId ON "inventory" ("productId");
CREATE INDEX IF NOT EXISTS idx_inventory_warehouseId ON "inventory" ("warehouseId");

-- ─── 5. suppliers ─────────────────────────────────────────────────────────
-- Referenced by: Inventory.tsx (supplier filter dropdown & management)
-- ⚠️ THIS TABLE WAS MISSING — causing HTTP 404 / "Could not find table" errors
CREATE TABLE IF NOT EXISTS "suppliers" (
  "id"        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ DEFAULT now(),
  "updatedAt" TIMESTAMPTZ DEFAULT now()
);

-- ─── 6. productCategories ─────────────────────────────────────────────────
-- Referenced by: Inventory.tsx (category filter dropdown & management)
-- ⚠️ THIS TABLE WAS MISSING — causing "Could not find table 'public.productCategories'"
CREATE TABLE IF NOT EXISTS "productCategories" (
  "id"        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ DEFAULT now(),
  "updatedAt" TIMESTAMPTZ DEFAULT now()
);

-- ─── 7. orders ────────────────────────────────────────────────────────────
-- Referenced by: Orders.tsx, Finance.tsx, Dashboard.tsx, AdminPanel.tsx
CREATE TABLE IF NOT EXISTS "orders" (
  "id"                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "orderNumber"         TEXT NOT NULL,
  "agentId"             TEXT NOT NULL,
  "clientId"            TEXT DEFAULT '',
  "clientName"          TEXT DEFAULT '',
  "status"              TEXT NOT NULL DEFAULT 'pending'
                          CHECK ("status" IN ('pending', 'preparing', 'out_for_delivery', 'delivered', 'completed', 'escalated', 'cancelled')),
  "skus"                JSONB DEFAULT '[]'::jsonb,
  "totalAmount"         NUMERIC(12,2) DEFAULT 0,
  "paymentStatus"       TEXT DEFAULT 'unpaid'
                          CHECK ("paymentStatus" IN ('unpaid', 'partially_paid', 'paid', 'defaulted')),
  "deliveryRegion"      TEXT DEFAULT '',
  "deliveryDeadline"    TIMESTAMPTZ,
  "photoValidationUrl"  TEXT DEFAULT '',
  "statusHistory"       JSONB DEFAULT '[]'::jsonb,
  "createdAt"           TIMESTAMPTZ DEFAULT now(),
  "updatedAt"           TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_agentId ON "orders" ("agentId");
CREATE INDEX IF NOT EXISTS idx_orders_status ON "orders" ("status");
CREATE INDEX IF NOT EXISTS idx_orders_createdAt ON "orders" ("createdAt" DESC);

-- ─── 8. expenses ──────────────────────────────────────────────────────────
-- Referenced by: Finance.tsx
CREATE TABLE IF NOT EXISTS "expenses" (
  "id"          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "category"    TEXT NOT NULL,
  "amount"      NUMERIC(12,2) NOT NULL,
  "description" TEXT DEFAULT '',
  "date"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "recordedBy"  TEXT NOT NULL,
  "orderId"     TEXT,
  "createdAt"   TIMESTAMPTZ DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON "expenses" ("date" DESC);

-- ─── 9. expenseCategories ─────────────────────────────────────────────────
-- Referenced by: Finance.tsx
CREATE TABLE IF NOT EXISTS "expenseCategories" (
  "id"          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "description" TEXT DEFAULT '',
  "isActive"    BOOLEAN DEFAULT true,
  "createdAt"   TIMESTAMPTZ DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ DEFAULT now()
);

-- ─── 10. transfers ────────────────────────────────────────────────────────
-- Referenced by: Transfers.tsx, AdminPanel.tsx
CREATE TABLE IF NOT EXISTS "transfers" (
  "id"                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "sourceWarehouseId"      TEXT NOT NULL,
  "destinationWarehouseId" TEXT NOT NULL,
  "productId"              TEXT NOT NULL,
  "quantity"               INTEGER NOT NULL CHECK ("quantity" > 0),
  "status"                 TEXT NOT NULL DEFAULT 'pending'
                             CHECK ("status" IN ('pending', 'in_transit', 'received', 'cancelled')),
  "initiatedBy"            TEXT NOT NULL,
  "createdAt"              TIMESTAMPTZ DEFAULT now(),
  "updatedAt"              TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transfers_createdAt ON "transfers" ("createdAt" DESC);

-- ─── 11. stockAdjustments ─────────────────────────────────────────────────
-- Referenced by: Inventory.tsx (updateStock), Orders.tsx (order placement)
CREATE TABLE IF NOT EXISTS "stockAdjustments" (
  "id"               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "productId"        TEXT NOT NULL,
  "warehouseId"      TEXT NOT NULL,
  "adjustmentAmount" INTEGER NOT NULL,
  "reason"           TEXT NOT NULL,
  "recordedBy"       TEXT NOT NULL,
  "timestamp"        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stockAdjustments_productId ON "stockAdjustments" ("productId");

-- ─── 12. delegations ─────────────────────────────────────────────────────
-- Referenced by: DelegationPanel.tsx, Inventory.tsx, Pricelist.tsx
CREATE TABLE IF NOT EXISTS "delegations" (
  "id"                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "agentId"             TEXT NOT NULL,
  "staffEmail"          TEXT NOT NULL,
  "canAdjustInventory"  BOOLEAN DEFAULT false,
  "canAdjustPricelist"  BOOLEAN DEFAULT false,
  "createdAt"           TIMESTAMPTZ DEFAULT now(),
  "updatedAt"           TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_delegations_agentId ON "delegations" ("agentId");
CREATE INDEX IF NOT EXISTS idx_delegations_staffEmail ON "delegations" ("staffEmail");


-- ═══════════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════════
--  Enable Supabase Realtime for all tables (Idempotent)
--  Required for the onSnapshot() subscriptions in the frontend adapter
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'users', 'products', 'warehouses', 'inventory', 'suppliers',
    'productCategories', 'orders', 'order_items', 'expenses', 'expenseCategories',
    'transfers', 'stockAdjustments', 'delegations'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    END IF;
  END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
--  Row Level Security (RLS) Policies (Idempotent)
--  Mirrors the Firestore security rules from firestore.rules
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable RLS on all tables
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "productCategories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expenseCategories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transfers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stockAdjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delegations" ENABLE ROW LEVEL SECURITY;

-- Permissive policies for authenticated users
-- (Matching the relaxed Firestore rules used during development)

DROP POLICY IF EXISTS "Authenticated users can read all data" ON "users";
CREATE POLICY "Authenticated users can read all data" ON "users"
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can insert own profile" ON "users";
CREATE POLICY "Users can insert own profile" ON "users"
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update own profile or admin can update any" ON "users";
CREATE POLICY "Users can update own profile or admin can update any" ON "users"
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read products" ON "products";
CREATE POLICY "Authenticated read products" ON "products"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read warehouses" ON "warehouses";
CREATE POLICY "Authenticated read warehouses" ON "warehouses"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read inventory" ON "inventory";
CREATE POLICY "Authenticated read inventory" ON "inventory"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read suppliers" ON "suppliers";
CREATE POLICY "Authenticated read suppliers" ON "suppliers"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read productCategories" ON "productCategories";
CREATE POLICY "Authenticated read productCategories" ON "productCategories"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read orders" ON "orders";
CREATE POLICY "Authenticated read orders" ON "orders"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read expenses" ON "expenses";
CREATE POLICY "Authenticated read expenses" ON "expenses"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read expenseCategories" ON "expenseCategories";
CREATE POLICY "Authenticated read expenseCategories" ON "expenseCategories"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read transfers" ON "transfers";
CREATE POLICY "Authenticated read transfers" ON "transfers"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read stockAdjustments" ON "stockAdjustments";
CREATE POLICY "Authenticated read stockAdjustments" ON "stockAdjustments"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read delegations" ON "delegations";
CREATE POLICY "Authenticated read delegations" ON "delegations"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read order_items" ON "order_items";
CREATE POLICY "Authenticated read order_items" ON "order_items"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon order_items policy" ON "order_items";
CREATE POLICY "Anon order_items policy" ON "order_items"
  FOR ALL TO anon USING (true) WITH CHECK (true);

