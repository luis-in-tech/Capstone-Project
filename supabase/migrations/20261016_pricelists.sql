-- ═════════════════════════════════════════════════════════════════════════════
-- Migration: 20261016_pricelists.sql
-- Description: Create pricelists table and configure RLS policies
-- Resolves: HTTP 404 (PGRST205) on /pricelist (relation "public.pricelists" does not exist)
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. Create pricelists table
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

-- 2. Indexes for fast retrieval & ordering
CREATE INDEX IF NOT EXISTS idx_pricelists_createdat 
ON public.pricelists("createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_pricelists_name 
ON public.pricelists(name);

-- 3. Row Level Security (RLS) Policies
ALTER TABLE public.pricelists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public select on pricelists" 
ON public.pricelists FOR SELECT 
USING (true);

CREATE POLICY "Allow public insert on pricelists" 
ON public.pricelists FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow public update on pricelists" 
ON public.pricelists FOR UPDATE 
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow public delete on pricelists" 
ON public.pricelists FOR DELETE 
USING (true);
