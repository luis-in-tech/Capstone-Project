-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: 202610020001_pl_historical_data.sql
-- Description:
--   Seeds Profit & Loss (P&L) statement records for January to March 2025.
--   Enables non-destructive historical financial tracking for Active Pro:
--     - Commercial sales orders representing Jan, Feb, Mar 2025 revenue
--     - Itemized COGS, Operating Expenses, and Other Expenses from audited P&L
--     - Expense categories ensuring seamless classification and chart mapping
--   Safe and idempotent: Uses ON CONFLICT DO UPDATE and UUID primary keys.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Ensure public."expenseCategories" table exists with required columns
CREATE TABLE IF NOT EXISTS public."expenseCategories" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS and permissive policy for expense categories
ALTER TABLE public."expenseCategories" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public."expenseCategories" TO anon, authenticated;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow select for all users on expenseCategories" ON public."expenseCategories";
  CREATE POLICY "Allow select for all users on expenseCategories" ON public."expenseCategories" FOR SELECT USING (true);
  
  DROP POLICY IF EXISTS "Allow insert/update for all users on expenseCategories" ON public."expenseCategories";
  CREATE POLICY "Allow insert/update for all users on expenseCategories" ON public."expenseCategories" FOR ALL USING (true) WITH CHECK (true);
END $$;

-- 2. Ensure public.expenses table exists with required columns
CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  description TEXT,
  date TIMESTAMPTZ NOT NULL,
  "recordedBy" UUID,
  "orderId" UUID,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS and permissive policy for expenses
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.expenses TO anon, authenticated;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow select for all users on expenses" ON public.expenses;
  CREATE POLICY "Allow select for all users on expenses" ON public.expenses FOR SELECT USING (true);
  
  DROP POLICY IF EXISTS "Allow insert/update for all users on expenses" ON public.expenses;
  CREATE POLICY "Allow insert/update for all users on expenses" ON public.expenses FOR ALL USING (true) WITH CHECK (true);
END $$;

-- 3. Ensure orders table allows select/write for financial records
GRANT SELECT ON TABLE public.orders TO anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'orders') THEN
    ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Allow select for all users on orders" ON public.orders;
    CREATE POLICY "Allow select for all users on orders" ON public.orders FOR SELECT USING (true);
    
    DROP POLICY IF EXISTS "Allow insert/update for all users on orders" ON public.orders;
    CREATE POLICY "Allow insert/update for all users on orders" ON public.orders FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 4. Seed Standard Expense Categories from P&L
INSERT INTO public."expenseCategories" (id, name, description, "isActive", "createdAt")
VALUES
  ('00000000-0000-4000-c000-000000000001', 'Cost of Goods Sold', 'Direct material costs and supplier manufacturing costs', true, '2025-01-01T00:00:00Z'),
  ('00000000-0000-4000-c000-000000000002', 'Freight and Shipping Costs', 'Outbound and inbound shipping freight adjustments', true, '2025-01-01T00:00:00Z'),
  ('00000000-0000-4000-c000-000000000003', 'Office Supplies', 'Office and administrative consumables', true, '2025-01-01T00:00:00Z'),
  ('00000000-0000-4000-c000-000000000004', 'Travel Expense', 'Field logistics, fleet transport, and travel expenditure', true, '2025-01-01T00:00:00Z'),
  ('00000000-0000-4000-c000-000000000005', 'Utilities', 'Electricity, water, and facility operational utilities', true, '2025-01-01T00:00:00Z'),
  ('00000000-0000-4000-c000-000000000006', 'Ask My Accountant', 'Professional auditing, CPA, and bookkeeping fees', true, '2025-01-01T00:00:00Z'),
  ('00000000-0000-4000-c000-000000000007', 'OTHER EXPENSE', 'Miscellaneous general and administrative expenditures', true, '2025-01-01T00:00:00Z'),
  ('00000000-0000-4000-c000-000000000008', 'Discounts & Allowances', 'Volume trade discounts and sales reductions', true, '2025-01-01T00:00:00Z')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  "isActive" = EXCLUDED."isActive";

-- 5. Seed Historical Revenue Orders (January to March 2025)
-- Represents Net Total Income from P&L:
--   Jan 2025: Sales 8,357,633.01 + Shipping 13,440.00 - Discount 252,702.08 = 8,118,370.93
--   Feb 2025: Sales 7,275,887.33 + Shipping 12,750.00 - Discount 215,941.08 + Exp 900.00 = 7,073,596.25
--   Mar 2025: Sales 6,555,467.70 + Shipping 13,650.00 - Discount 258,731.48 = 6,310,386.22
INSERT INTO public.orders (
  id, "orderNumber", "agentId", "clientName", status,
  "totalAmount", "paymentStatus", "deliveryRegion", "deliveryDeadline",
  "createdAt", "updatedAt"
)
VALUES
  (
    '00000000-2025-0100-0000-000000000001', 'ORD-2025-01-PL', NULL,
    'Commercial Operations (Jan 2025 P&L)', 'completed',
    8118370.93, 'paid', 'Metro Manila', '2025-01-31T23:59:59Z',
    '2025-01-31T23:59:59Z', '2025-01-31T23:59:59Z'
  ),
  (
    '00000000-2025-0200-0000-000000000002', 'ORD-2025-02-PL', NULL,
    'Commercial Operations (Feb 2025 P&L)', 'completed',
    7073596.25, 'paid', 'Metro Manila', '2025-02-28T23:59:59Z',
    '2025-02-28T23:59:59Z', '2025-02-28T23:59:59Z'
  ),
  (
    '00000000-2025-0300-0000-000000000003', 'ORD-2025-03-PL', NULL,
    'Commercial Operations (Mar 2025 P&L)', 'completed',
    6310386.22, 'paid', 'Metro Manila', '2025-03-31T23:59:59Z',
    '2025-03-31T23:59:59Z', '2025-03-31T23:59:59Z'
  )
ON CONFLICT (id) DO UPDATE SET
  "totalAmount" = EXCLUDED."totalAmount",
  status = EXCLUDED.status,
  "paymentStatus" = EXCLUDED."paymentStatus",
  "clientName" = EXCLUDED."clientName";

-- 6. Seed Itemized P&L Expenses (January to March 2025)
INSERT INTO public.expenses (id, category, amount, description, date, "recordedBy", "orderId")
VALUES
  -- ─── JANUARY 2025 ─────────────────────────────────────────────────────────────
  ('00000000-2025-0100-e000-000000000001', 'Cost of Goods Sold', 5904520.17, 'Jan 2025 Direct Cost of Goods Sold', '2025-01-31T20:00:00Z', NULL, '00000000-2025-0100-0000-000000000001'),
  ('00000000-2025-0100-e000-000000000002', 'Freight and Shipping Costs', -405.00, 'Jan 2025 Freight and Shipping Cost Adjustment', '2025-01-31T20:10:00Z', NULL, '00000000-2025-0100-0000-000000000001'),
  ('00000000-2025-0100-e000-000000000003', 'Office Supplies', -230.00, 'Jan 2025 Office Supplies Credit Adjustment', '2025-01-31T20:20:00Z', NULL, NULL),
  ('00000000-2025-0100-e000-000000000004', 'Travel Expense', 2500.00, 'Jan 2025 Operational Travel Expense', '2025-01-31T20:30:00Z', NULL, NULL),
  ('00000000-2025-0100-e000-000000000005', 'Utilities', 0.00, 'Jan 2025 Facility Utilities', '2025-01-31T20:40:00Z', NULL, NULL),
  ('00000000-2025-0100-e000-000000000006', 'Ask My Accountant', -2515.17, 'Jan 2025 CPA & Accountant Reconciled Credit', '2025-01-31T20:50:00Z', NULL, NULL),
  ('00000000-2025-0100-e000-000000000007', 'OTHER EXPENSE', 12670.27, 'Jan 2025 General Operational & Other Expense', '2025-01-31T21:00:00Z', NULL, NULL),

  -- ─── FEBRUARY 2025 ────────────────────────────────────────────────────────────
  ('00000000-2025-0200-e000-000000000001', 'Cost of Goods Sold', 6100297.72, 'Feb 2025 Direct Cost of Goods Sold', '2025-02-28T20:00:00Z', NULL, '00000000-2025-0200-0000-000000000002'),
  ('00000000-2025-0200-e000-000000000002', 'Freight and Shipping Costs', -185.00, 'Feb 2025 Freight and Shipping Cost Adjustment', '2025-02-28T20:10:00Z', NULL, '00000000-2025-0200-0000-000000000002'),
  ('00000000-2025-0200-e000-000000000003', 'Office Supplies', -345.00, 'Feb 2025 Office Supplies Credit Adjustment', '2025-02-28T20:20:00Z', NULL, NULL),
  ('00000000-2025-0200-e000-000000000004', 'Travel Expense', 9000.00, 'Feb 2025 Operational Travel & Logistics Expense', '2025-02-28T20:30:00Z', NULL, NULL),
  ('00000000-2025-0200-e000-000000000005', 'Utilities', 0.00, 'Feb 2025 Facility Utilities', '2025-02-28T20:40:00Z', NULL, NULL),
  ('00000000-2025-0200-e000-000000000006', 'Ask My Accountant', -13735.76, 'Feb 2025 Accountant Audit Adjustments (Credit)', '2025-02-28T20:50:00Z', NULL, NULL),
  ('00000000-2025-0200-e000-000000000007', 'OTHER EXPENSE', 4000.00, 'Feb 2025 General Operational & Other Expense', '2025-02-28T21:00:00Z', NULL, NULL),

  -- ─── MARCH 2025 ───────────────────────────────────────────────────────────────
  ('00000000-2025-0300-e000-000000000001', 'Cost of Goods Sold', 5082247.40, 'Mar 2025 Direct Cost of Goods Sold', '2025-03-31T20:00:00Z', NULL, '00000000-2025-0300-0000-000000000003'),
  ('00000000-2025-0300-e000-000000000002', 'Freight and Shipping Costs', -640.00, 'Mar 2025 Freight and Shipping Cost Adjustment', '2025-03-31T20:10:00Z', NULL, '00000000-2025-0300-0000-000000000003'),
  ('00000000-2025-0300-e000-000000000003', 'Office Supplies', -690.00, 'Mar 2025 Office Supplies Credit Adjustment', '2025-03-31T20:20:00Z', NULL, NULL),
  ('00000000-2025-0300-e000-000000000004', 'Travel Expense', 3000.00, 'Mar 2025 Operational Travel Expense', '2025-03-31T20:30:00Z', NULL, NULL),
  ('00000000-2025-0300-e000-000000000005', 'Utilities', 0.00, 'Mar 2025 Facility Utilities', '2025-03-31T20:40:00Z', NULL, NULL),
  ('00000000-2025-0300-e000-000000000006', 'Ask My Accountant', -2611.22, 'Mar 2025 Accountant Reconciliation Credit', '2025-03-31T20:50:00Z', NULL, NULL),
  ('00000000-2025-0300-e000-000000000007', 'OTHER EXPENSE', 25710.23, 'Mar 2025 General Operational & Other Expense', '2025-03-31T21:00:00Z', NULL, NULL)
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  amount = EXCLUDED.amount,
  description = EXCLUDED.description,
  date = EXCLUDED.date,
  "orderId" = EXCLUDED."orderId";

COMMIT;
NOTIFY pgrst, 'reload schema';
