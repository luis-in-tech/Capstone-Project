-- ═════════════════════════════════════════════════════════════════════════════
-- Consolidated Migration: 20261016_all_missing_tables.sql
-- Description: Creates warehouse_zones, warehouse_zone_allocations, and pricelists
-- Resolves: 
--   1. HTTP 404 (PGRST205) on /inventory (Warehouse Layout)
--   2. HTTP 404 (PGRST205) on /pricelist
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: Warehouse Zones & Allocations
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.warehouse_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "warehouseId" UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
    name VARCHAR(60) NOT NULL,
    "sortOrder" INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warehouse_zones_warehouseId 
ON public.warehouse_zones("warehouseId");

CREATE TABLE IF NOT EXISTS public.warehouse_zone_allocations (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "warehouseId" UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
    "zoneId" UUID NOT NULL REFERENCES public.warehouse_zones(id) ON DELETE CASCADE,
    "productId" UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    quantity INT NOT NULL CHECK (quantity >= 0),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warehouse_zone_allocations_wh 
ON public.warehouse_zone_allocations("warehouseId");

CREATE INDEX IF NOT EXISTS idx_warehouse_zone_allocations_zone 
ON public.warehouse_zone_allocations("zoneId");

CREATE INDEX IF NOT EXISTS idx_warehouse_zone_allocations_product 
ON public.warehouse_zone_allocations("productId");

ALTER TABLE public.warehouse_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_zone_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated and anon select on warehouse_zones" ON public.warehouse_zones;
CREATE POLICY "Allow authenticated and anon select on warehouse_zones" 
ON public.warehouse_zones FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Allow authenticated and anon modify on warehouse_zones" ON public.warehouse_zones;
CREATE POLICY "Allow authenticated and anon modify on warehouse_zones" 
ON public.warehouse_zones FOR ALL 
USING (true);

DROP POLICY IF EXISTS "Allow authenticated and anon select on warehouse_zone_allocations" ON public.warehouse_zone_allocations;
CREATE POLICY "Allow authenticated and anon select on warehouse_zone_allocations" 
ON public.warehouse_zone_allocations FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Allow authenticated and anon modify on warehouse_zone_allocations" ON public.warehouse_zone_allocations;
CREATE POLICY "Allow authenticated and anon modify on warehouse_zone_allocations" 
ON public.warehouse_zone_allocations FOR ALL 
USING (true);

-- RPC Helper function for managing zones safely
CREATE OR REPLACE FUNCTION public.manage_warehouse_zone(
    p_warehouse UUID,
    p_zone UUID,
    p_action TEXT,
    p_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_new_id UUID;
BEGIN
    IF p_action = 'add' THEN
        INSERT INTO public.warehouse_zones ("warehouseId", name, "sortOrder")
        VALUES (
            p_warehouse,
            p_name,
            COALESCE((SELECT MAX("sortOrder") FROM public.warehouse_zones WHERE "warehouseId" = p_warehouse), -1) + 1
        )
        RETURNING id INTO v_new_id;
        RETURN jsonb_build_object('success', true, 'id', v_new_id);

    ELSIF p_action = 'rename' THEN
        UPDATE public.warehouse_zones
        SET name = p_name
        WHERE id = p_zone AND "warehouseId" = p_warehouse;
        RETURN jsonb_build_object('success', true);

    ELSIF p_action = 'delete' THEN
        DELETE FROM public.warehouse_zone_allocations WHERE "zoneId" = p_zone;
        DELETE FROM public.warehouse_zones WHERE id = p_zone AND "warehouseId" = p_warehouse;
        RETURN jsonb_build_object('success', true);
    ELSE
        RAISE EXCEPTION 'Invalid action: %', p_action;
    END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: Pricelists Table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pricelists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ DEFAULT now(),
    "updatedAt" TIMESTAMPTZ DEFAULT now(),
    "lastPdfGeneratedAt" TIMESTAMPTZ,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    sections JSONB NOT NULL DEFAULT '[]'::jsonb,
    "defaultScheme" TEXT NOT NULL DEFAULT 'base',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricelists_createdat 
ON public.pricelists("createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_pricelists_name 
ON public.pricelists(name);

ALTER TABLE public.pricelists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public select on pricelists" ON public.pricelists;
CREATE POLICY "Allow public select on pricelists" 
ON public.pricelists FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Allow public insert on pricelists" ON public.pricelists;
CREATE POLICY "Allow public insert on pricelists" 
ON public.pricelists FOR INSERT 
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update on pricelists" ON public.pricelists;
CREATE POLICY "Allow public update on pricelists" 
ON public.pricelists FOR UPDATE 
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete on pricelists" ON public.pricelists;
CREATE POLICY "Allow public delete on pricelists" 
ON public.pricelists FOR DELETE 
USING (true);
