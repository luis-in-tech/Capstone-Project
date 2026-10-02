-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: 202610020002_adjust_out_of_stock_inventory.sql
-- Description:
--   Adjusts half of the currently "Out of Stock" (stock <= 0) items
--   to quantity = 100 in the primary active warehouse for testing.
--   Preserves variation structures and logs adjustments to stockAdjustments.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_warehouse_id UUID;
  v_warehouse_name TEXT;
  v_total_out INT;
  v_target_count INT;
  rec RECORD;
BEGIN
  -- 1. Locate primary active warehouse
  SELECT id, name INTO v_warehouse_id, v_warehouse_name
  FROM public.warehouses
  WHERE active IS NOT FALSE
  ORDER BY name ASC
  LIMIT 1;

  IF v_warehouse_id IS NULL THEN
    SELECT id, name INTO v_warehouse_id, v_warehouse_name
    FROM public.warehouses
    LIMIT 1;
  END IF;

  IF v_warehouse_id IS NULL THEN
    RAISE NOTICE 'No warehouse found in public.warehouses. Please create a warehouse in Supply Chain first.';
    RETURN;
  END IF;

  -- 2. Create temporary table with all leaf items that are Out of Stock (total stock <= 0)
  CREATE TEMP TABLE temp_out_of_stock_candidates ON COMMIT DROP AS
  SELECT
    p.id AS product_id,
    p.sku,
    p.name,
    COALESCE((
      SELECT SUM(i.quantity)
      FROM public.inventory i
      WHERE i."productId"::text = p.id::text
    ), 0) AS current_stock
  FROM public.products p
  WHERE NOT COALESCE(p."hasVariations", false)
    AND COALESCE(p."variantEnabled", true) = true
    AND COALESCE((
      SELECT SUM(i.quantity)
      FROM public.inventory i
      WHERE i."productId"::text = p.id::text
    ), 0) <= 0
  ORDER BY p.sku ASC;

  SELECT COUNT(*) INTO v_total_out FROM temp_out_of_stock_candidates;
  v_target_count := CEIL(v_total_out / 2.0);

  RAISE NOTICE 'Found % out-of-stock items. Adjusting half (% items) to 100 units in %.', v_total_out, v_target_count, v_warehouse_name;

  IF v_target_count > 0 THEN
    FOR rec IN (
      SELECT product_id, sku, name
      FROM temp_out_of_stock_candidates
      ORDER BY sku ASC
      LIMIT v_target_count
    ) LOOP
      -- Upsert inventory row for this product and target warehouse
      IF EXISTS (
        SELECT 1 FROM public.inventory
        WHERE "productId"::text = rec.product_id::text
          AND "warehouseId"::text = v_warehouse_id::text
      ) THEN
        UPDATE public.inventory
        SET quantity = 100,
            "lastUpdated" = NOW()
        WHERE "productId"::text = rec.product_id::text
          AND "warehouseId"::text = v_warehouse_id::text;
      ELSE
        INSERT INTO public.inventory (id, "productId", "warehouseId", quantity, "lastUpdated")
        VALUES (gen_random_uuid(), rec.product_id, v_warehouse_id, 100, NOW());
      END IF;

      -- Audit trail in stockAdjustments
      BEGIN
        INSERT INTO public."stockAdjustments" (
          id, "productId", "warehouseId", "adjustmentAmount", reason, timestamp
        ) VALUES (
          gen_random_uuid(),
          rec.product_id,
          v_warehouse_id,
          100,
          'Test inventory adjustment: out-of-stock to 100',
          NOW()
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;

      RAISE NOTICE 'Adjusted [%] % to 100 units.', rec.sku, rec.name;
    END LOOP;
  END IF;
END $$;

COMMIT;

-- 3. Display summary of updated products
SELECT
  p.name AS "Product Name",
  p.sku AS "SKU",
  w.name AS "Warehouse",
  i.quantity AS "New Stock Level",
  CASE WHEN i.quantity > 0 THEN 'In Stock' ELSE 'Out of Stock' END AS "Stock Status"
FROM public.products p
JOIN public.inventory i ON i."productId"::text = p.id::text
JOIN public.warehouses w ON w.id::text = i."warehouseId"::text
WHERE i.quantity = 100
ORDER BY p.name ASC;
