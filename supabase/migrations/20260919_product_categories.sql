-- Run after create_tables.sql in the Supabase SQL editor.
BEGIN;

ALTER TABLE public."productCategories"
  ADD COLUMN IF NOT EXISTS code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- Preserve existing assignments, including categories created through product imports.
INSERT INTO public."productCategories" (name)
SELECT DISTINCT COALESCE(NULLIF(category, ''), 'Uncategorized')
FROM public.products p
WHERE NOT EXISTS (
  SELECT 1 FROM public."productCategories" c
  WHERE c.name = COALESCE(NULLIF(p.category, ''), 'Uncategorized')
);

CREATE UNIQUE INDEX IF NOT EXISTS product_categories_code_unique
  ON public."productCategories" (upper(trim(code))) WHERE trim(code) <> '';

-- Existing products use category names; update their assignments in the same
-- transaction as a rename, and reject deletion while assignments remain.
CREATE OR REPLACE FUNCTION public.protect_product_category_assignments()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  LOCK TABLE public.products IN SHARE ROW EXCLUSIVE MODE;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.products WHERE COALESCE(NULLIF(category, ''), 'Uncategorized') = OLD.name) THEN
      RAISE EXCEPTION 'Reassign all products before deleting this category.';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    IF EXISTS (SELECT 1 FROM public."productCategories" WHERE lower(trim(name)) = lower(trim(NEW.name)) AND id <> OLD.id) THEN
      RAISE EXCEPTION 'A category with that name already exists.';
    END IF;
    UPDATE public.products SET category = NEW.name, "updatedAt" = now()
      WHERE COALESCE(NULLIF(category, ''), 'Uncategorized') = OLD.name;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_product_category_assignments ON public."productCategories";
CREATE TRIGGER protect_product_category_assignments
  BEFORE UPDATE OF name OR DELETE ON public."productCategories"
  FOR EACH ROW EXECUTE FUNCTION public.protect_product_category_assignments();

COMMIT;
