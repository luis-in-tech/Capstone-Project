-- Run after create_tables.sql in the Supabase SQL editor.
-- New multi-product movements reuse inventory, expenses, users and stockAdjustments.
-- Existing transport records remain in transfers with their original lifecycle.
BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_movement_sequences (
  movement_date date PRIMARY KEY,
  last_number integer NOT NULL CHECK (last_number BETWEEN 1 AND 999)
);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid PRIMARY KEY,
  "movementNumber" text NOT NULL UNIQUE CHECK ("movementNumber" ~ '^MOV-[0-9]{8}-[0-9]{3}$'),
  type text NOT NULL CHECK (type IN ('external', 'internal')),
  "supplierId" text,
  "supplierName" text,
  "sourceWarehouseId" text,
  "sourceWarehouseName" text,
  "destinationWarehouseId" text NOT NULL,
  "destinationWarehouseName" text NOT NULL,
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0),
  "totalValue" numeric(12,2),
  "invoiceNumber" text NOT NULL DEFAULT '',
  "driverName" text NOT NULL DEFAULT '',
  "vehiclePlate" text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'confirmed' CHECK (status = 'confirmed'),
  "recordedBy" text NOT NULL,
  "recordedByName" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "expenseId" uuid REFERENCES public.expenses(id),
  CHECK ((type = 'external' AND "supplierId" IS NOT NULL AND "sourceWarehouseId" IS NULL AND "totalValue" > 0 AND "expenseId" IS NOT NULL)
    OR (type = 'internal' AND "supplierId" IS NULL AND "sourceWarehouseId" IS NOT NULL AND "sourceWarehouseId" <> "destinationWarehouseId" AND "totalValue" IS NULL AND "expenseId" IS NULL))
);
CREATE INDEX IF NOT EXISTS inventory_movements_created ON public.inventory_movements ("createdAt" DESC);
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movement_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS movement_read ON public.inventory_movements;
CREATE POLICY movement_read ON public.inventory_movements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE uid = auth.uid()::text AND role IN ('admin', 'secretary')));
GRANT SELECT ON public.inventory_movements TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_movements FROM authenticated, anon;
REVOKE ALL ON public.inventory_movement_sequences FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.confirm_inventory_movement(p_request_id uuid, p_movement jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid text := auth.uid()::text;
  v_user text;
  v_type text := p_movement->>'type';
  v_source text := nullif(p_movement->>'sourceWarehouseId', '');
  v_dest text := nullif(p_movement->>'destinationWarehouseId', '');
  v_supplier text := nullif(p_movement->>'supplierId', '');
  v_source_name text;
  v_dest_name text;
  v_supplier_name text;
  v_now timestamptz := now();
  v_date date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_seq integer;
  v_number text;
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_product public.products%ROWTYPE;
  v_row public.inventory%ROWTYPE;
  v_qty integer;
  v_cost numeric(12,2);
  v_total numeric(12,2) := 0;
  v_available bigint;
  v_remaining integer;
  v_deduct integer;
  v_dest_row uuid;
  v_expense uuid;
  v_result jsonb;
BEGIN
  SELECT coalesce(nullif("displayName", ''), email) INTO v_user FROM public.users
    WHERE uid = v_uid AND role IN ('admin', 'secretary');
  IF v_user IS NULL THEN RAISE EXCEPTION 'Only administrators and secretaries can record movements.'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A request ID is required.'; END IF;

  -- Repeated clicks / network retries return the same committed movement.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  SELECT to_jsonb(m) INTO v_result FROM public.inventory_movements m WHERE id = p_request_id AND "recordedBy" = v_uid;
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  IF v_type IS NULL OR v_type NOT IN ('external', 'internal') THEN RAISE EXCEPTION 'Select a valid movement type.'; END IF;
  IF jsonb_typeof(p_movement->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Add at least one product.'; END IF;
  IF jsonb_array_length(p_movement->'items') = 0 THEN RAISE EXCEPTION 'Add at least one product.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_movement->'items') item GROUP BY item->>'productId' HAVING count(*) > 1)
    THEN RAISE EXCEPTION 'Combine duplicate products into one line.'; END IF;

  SELECT name INTO v_dest_name FROM public.warehouses WHERE id::text = v_dest AND active IS DISTINCT FROM false;
  IF v_dest_name IS NULL THEN RAISE EXCEPTION 'Select an active destination warehouse.'; END IF;
  IF v_type = 'external' THEN
    SELECT name INTO v_supplier_name FROM public.suppliers WHERE id::text = v_supplier;
    IF v_supplier_name IS NULL THEN RAISE EXCEPTION 'Select an existing supplier.'; END IF;
    IF coalesce(btrim(p_movement->>'invoiceNumber'), '') = '' THEN RAISE EXCEPTION 'Invoice number is required.'; END IF;
    v_source := NULL;
  ELSE
    v_supplier := NULL;
    SELECT name INTO v_source_name FROM public.warehouses WHERE id::text = v_source AND active IS DISTINCT FROM false;
    IF v_source_name IS NULL THEN RAISE EXCEPTION 'Select an active source warehouse.'; END IF;
    IF v_source = v_dest THEN RAISE EXCEPTION 'Source and destination must be different warehouses.'; END IF;
  END IF;

  -- Inventory has no unique product/warehouse constraint in the existing schema.
  -- Serialize writes and lock rows to check live stock, including duplicate rows.
  LOCK TABLE public.inventory IN SHARE ROW EXCLUSIVE MODE;
  INSERT INTO public.inventory_movement_sequences(movement_date, last_number) VALUES (v_date, 1)
    ON CONFLICT (movement_date) DO UPDATE SET last_number = inventory_movement_sequences.last_number + 1
    WHERE inventory_movement_sequences.last_number < 999
    RETURNING last_number INTO v_seq;
  IF v_seq IS NULL THEN RAISE EXCEPTION 'The daily limit of 999 movement IDs has been reached.'; END IF;
  v_number := 'MOV-' || to_char(v_date, 'YYYYMMDD') || '-' || lpad(v_seq::text, 3, '0');

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_movement->'items') LOOP
    SELECT * INTO v_product FROM public.products WHERE id::text = v_item->>'productId';
    IF NOT FOUND THEN RAISE EXCEPTION 'A selected product no longer exists. Please refresh.'; END IF;
    IF coalesce(v_item->>'quantity', '') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Quantities must be positive whole numbers.'; END IF;
    v_qty := (v_item->>'quantity')::integer;
    IF v_qty < 1 THEN RAISE EXCEPTION 'Quantities must be greater than zero.'; END IF;
    v_cost := 0;
    IF v_type = 'external' THEN
      IF coalesce(v_item->>'unitCost', '') !~ '^[0-9]+([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'Enter a valid unit cost with up to two decimal places.'; END IF;
      v_cost := (v_item->>'unitCost')::numeric;
      IF v_cost <= 0 THEN RAISE EXCEPTION 'Unit cost must be greater than zero.'; END IF;
      v_total := v_total + v_cost * v_qty;
    ELSE
      SELECT coalesce(sum(quantity), 0) INTO v_available FROM public.inventory WHERE "productId" = v_product.id::text AND "warehouseId" = v_source;
      IF v_available < v_qty THEN RAISE EXCEPTION 'Insufficient stock for %: % available.', v_product.name, v_available; END IF;
      v_remaining := v_qty;
      FOR v_row IN SELECT * FROM public.inventory WHERE "productId" = v_product.id::text AND "warehouseId" = v_source AND quantity > 0 ORDER BY id FOR UPDATE LOOP
        v_deduct := least(v_remaining, v_row.quantity);
        UPDATE public.inventory SET quantity = quantity - v_deduct, "lastUpdated" = v_now WHERE id = v_row.id;
        v_remaining := v_remaining - v_deduct;
        EXIT WHEN v_remaining = 0;
      END LOOP;
      INSERT INTO public."stockAdjustments" ("productId", "warehouseId", "adjustmentAmount", reason, "recordedBy", timestamp)
        VALUES (v_product.id::text, v_source, -v_qty, v_number || ' internal transfer sent', v_uid, v_now);
    END IF;
    SELECT id INTO v_dest_row FROM public.inventory WHERE "productId" = v_product.id::text AND "warehouseId" = v_dest ORDER BY id LIMIT 1 FOR UPDATE;
    IF v_dest_row IS NULL THEN
      INSERT INTO public.inventory ("productId", "warehouseId", quantity, "lastUpdated") VALUES (v_product.id::text, v_dest, v_qty, v_now);
    ELSE
      UPDATE public.inventory SET quantity = coalesce(quantity, 0) + v_qty, "lastUpdated" = v_now WHERE id = v_dest_row;
    END IF;
    INSERT INTO public."stockAdjustments" ("productId", "warehouseId", "adjustmentAmount", reason, "recordedBy", timestamp)
      VALUES (v_product.id::text, v_dest, v_qty, v_number || CASE WHEN v_type = 'external' THEN ' external receipt' ELSE ' internal transfer received' END, v_uid, v_now);
    v_items := v_items || jsonb_build_array(jsonb_build_object('productId', v_product.id, 'name', v_product.name, 'sku', v_product.sku, 'quantity', v_qty, 'unitCost', v_cost));
  END LOOP;

  IF v_type = 'external' THEN
    INSERT INTO public.expenses (category, amount, description, date, "recordedBy")
      VALUES ('Inventory Purchase', v_total, v_number || ' · ' || v_supplier_name || ' · Invoice ' || btrim(p_movement->>'invoiceNumber'), v_now, v_uid)
      RETURNING id INTO v_expense;
    INSERT INTO public."expenseCategories" (name, description, "isActive")
      SELECT 'Inventory Purchase', 'Supplier purchases received through Inventory Movement', true
      WHERE NOT EXISTS (SELECT 1 FROM public."expenseCategories" WHERE name = 'Inventory Purchase');
  END IF;

  INSERT INTO public.inventory_movements (id, "movementNumber", type, "supplierId", "supplierName", "sourceWarehouseId", "sourceWarehouseName", "destinationWarehouseId", "destinationWarehouseName", items, "totalValue", "invoiceNumber", "driverName", "vehiclePlate", notes, "recordedBy", "recordedByName", "createdAt", "expenseId")
    VALUES (p_request_id, v_number, v_type, v_supplier, v_supplier_name, v_source, v_source_name, v_dest, v_dest_name, v_items,
      CASE WHEN v_type = 'external' THEN v_total ELSE NULL END,
      CASE WHEN v_type = 'external' THEN btrim(p_movement->>'invoiceNumber') ELSE '' END,
      CASE WHEN v_type = 'internal' THEN coalesce(btrim(p_movement->>'driverName'), '') ELSE '' END,
      CASE WHEN v_type = 'internal' THEN upper(coalesce(btrim(p_movement->>'vehiclePlate'), '')) ELSE '' END,
      coalesce(btrim(p_movement->>'notes'), ''), v_uid, v_user, v_now, v_expense);
  SELECT to_jsonb(m) INTO v_result FROM public.inventory_movements m WHERE id = p_request_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_inventory_movement(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_inventory_movement(uuid, jsonb) TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'inventory_movements'
  ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_movements; END IF;
END $$;
COMMIT;
