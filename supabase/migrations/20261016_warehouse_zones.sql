-- ═════════════════════════════════════════════════════════════════════════════
-- Migration: 20261016_warehouse_zones.sql
-- Description: Create warehouse_zones and warehouse_zone_allocations tables
-- Resolves: HTTP 404 (PGRST205) on /inventory Warehouse Layout queries
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. Create warehouse_zones table
CREATE TABLE IF NOT EXISTS public.warehouse_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "warehouseId" UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
    name VARCHAR(60) NOT NULL,
    "sortOrder" INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast warehouse zone queries
CREATE INDEX IF NOT EXISTS idx_warehouse_zones_warehouseId 
ON public.warehouse_zones("warehouseId");

-- 2. Create warehouse_zone_allocations table
CREATE TABLE IF NOT EXISTS public.warehouse_zone_allocations (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "warehouseId" UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
    "zoneId" UUID NOT NULL REFERENCES public.warehouse_zones(id) ON DELETE CASCADE,
    "productId" UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    quantity INT NOT NULL CHECK (quantity >= 0),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for fast allocation lookups
CREATE INDEX IF NOT EXISTS idx_warehouse_zone_allocations_wh 
ON public.warehouse_zone_allocations("warehouseId");

CREATE INDEX IF NOT EXISTS idx_warehouse_zone_allocations_zone 
ON public.warehouse_zone_allocations("zoneId");

CREATE INDEX IF NOT EXISTS idx_warehouse_zone_allocations_product 
ON public.warehouse_zone_allocations("productId");

-- 3. Row Level Security (RLS) Policies
ALTER TABLE public.warehouse_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_zone_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated and anon select on warehouse_zones" 
ON public.warehouse_zones FOR SELECT 
USING (true);

CREATE POLICY "Allow authenticated and anon modify on warehouse_zones" 
ON public.warehouse_zones FOR ALL 
USING (true);

CREATE POLICY "Allow authenticated and anon select on warehouse_zone_allocations" 
ON public.warehouse_zone_allocations FOR SELECT 
USING (true);

CREATE POLICY "Allow authenticated and anon modify on warehouse_zone_allocations" 
ON public.warehouse_zone_allocations FOR ALL 
USING (true);

-- 4. RPC Helper function for managing zones
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
