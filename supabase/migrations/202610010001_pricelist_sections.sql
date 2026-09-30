-- Preserve document sections independently of product inventory categories.
ALTER TABLE public.pricelists
  ADD COLUMN IF NOT EXISTS sections jsonb,
  ADD COLUMN IF NOT EXISTS "defaultScheme" text;
