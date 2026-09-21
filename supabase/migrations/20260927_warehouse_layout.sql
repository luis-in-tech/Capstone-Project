-- Apply after the existing staff permission migrations.
BEGIN;
CREATE TABLE public.warehouse_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "warehouseId" uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  "sortOrder" integer NOT NULL DEFAULT 0,
  UNIQUE (id, "warehouseId")
);
CREATE UNIQUE INDEX warehouse_zone_name ON public.warehouse_zones ("warehouseId", lower(btrim(name)));
CREATE TABLE public.warehouse_zone_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "warehouseId" uuid NOT NULL,
  "zoneId" uuid NOT NULL,
  "productId" uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  FOREIGN KEY ("zoneId", "warehouseId") REFERENCES public.warehouse_zones(id, "warehouseId") ON DELETE CASCADE,
  UNIQUE ("zoneId", "productId")
);
CREATE INDEX warehouse_allocations_stock ON public.warehouse_zone_allocations ("warehouseId", "productId");
ALTER TABLE public.warehouse_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_zone_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY zone_read ON public.warehouse_zones FOR SELECT TO authenticated USING (public.staff_warehouse_allowed("warehouseId"::text));
CREATE POLICY allocation_read ON public.warehouse_zone_allocations FOR SELECT TO authenticated USING (public.staff_warehouse_allowed("warehouseId"::text));
GRANT SELECT ON public.warehouse_zones, public.warehouse_zone_allocations TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.warehouse_zones, public.warehouse_zone_allocations FROM authenticated, anon;

CREATE FUNCTION public.manage_warehouse_zone(p_warehouse uuid, p_zone uuid, p_action text, p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.staff_warehouse_allowed(p_warehouse::text) OR coalesce(public.staff_permissions()->>'inventory', '') <> 'adjust' THEN
    RAISE EXCEPTION 'You do not have permission to edit this warehouse layout.';
  END IF;
  -- Same lock order as stock writes and allocation edits.
  LOCK TABLE public.inventory IN SHARE ROW EXCLUSIVE MODE;
  PERFORM 1 FROM public.warehouses WHERE id = p_warehouse FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warehouse no longer exists.'; END IF;
  IF p_action IN ('add', 'rename') AND (p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 60) THEN
    RAISE EXCEPTION 'Enter a zone name between 1 and 60 characters.';
  END IF;
  IF p_action = 'add' THEN
    INSERT INTO public.warehouse_zones ("warehouseId", name, "sortOrder")
      SELECT p_warehouse, btrim(p_name), coalesce(max("sortOrder"), -1) + 1 FROM public.warehouse_zones WHERE "warehouseId" = p_warehouse;
  ELSIF p_action = 'rename' THEN
    UPDATE public.warehouse_zones SET name = btrim(p_name) WHERE id = p_zone AND "warehouseId" = p_warehouse;
    IF NOT FOUND THEN RAISE EXCEPTION 'Zone no longer exists.'; END IF;
  ELSIF p_action = 'delete' THEN
    DELETE FROM public.warehouse_zones WHERE id = p_zone AND "warehouseId" = p_warehouse;
    IF NOT FOUND THEN RAISE EXCEPTION 'Zone no longer exists.'; END IF;
  ELSE RAISE EXCEPTION 'Unknown zone action.';
  END IF;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'A zone with this name already exists in this warehouse.';
END;
$$;

CREATE FUNCTION public.set_warehouse_zone_quantity(p_zone uuid, p_product uuid, p_quantity integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_warehouse uuid; v_stock bigint; v_other bigint;
BEGIN
  LOCK TABLE public.inventory IN SHARE ROW EXCLUSIVE MODE;
  SELECT "warehouseId" INTO v_warehouse FROM public.warehouse_zones WHERE id = p_zone FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Zone no longer exists.'; END IF;
  IF NOT public.staff_warehouse_allowed(v_warehouse::text) OR coalesce(public.staff_permissions()->>'inventory', '') <> 'adjust' THEN
    RAISE EXCEPTION 'You do not have permission to assign stock in this warehouse.';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 0 THEN RAISE EXCEPTION 'Enter a non-negative whole quantity.'; END IF;
  SELECT coalesce(sum(quantity), 0) INTO v_stock FROM public.inventory WHERE "warehouseId" = v_warehouse::text AND "productId" = p_product::text;
  SELECT coalesce(sum(quantity), 0) INTO v_other FROM public.warehouse_zone_allocations WHERE "warehouseId" = v_warehouse AND "productId" = p_product AND "zoneId" <> p_zone;
  IF p_quantity > greatest(v_stock - v_other, 0) THEN RAISE EXCEPTION 'Not enough Unassigned stock. At most % units can be recorded in this zone.', greatest(v_stock - v_other, 0); END IF;
  IF p_quantity = 0 THEN
    DELETE FROM public.warehouse_zone_allocations WHERE "zoneId" = p_zone AND "productId" = p_product;
  ELSE
    INSERT INTO public.warehouse_zone_allocations ("warehouseId", "zoneId", "productId", quantity) VALUES (v_warehouse, p_zone, p_product, p_quantity)
      ON CONFLICT ("zoneId", "productId") DO UPDATE SET quantity = EXCLUDED.quantity;
  END IF;
END;
$$;

-- Legacy stock writers have no source zone. They may consume Unassigned stock,
-- but must not silently remove quantities still recorded in a zone.
CREATE FUNCTION public.guard_warehouse_zone_stock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_allocated bigint; v_stock bigint;
BEGIN
  SELECT coalesce(sum(quantity), 0) INTO v_allocated FROM public.warehouse_zone_allocations
    WHERE "warehouseId"::text = OLD."warehouseId" AND "productId"::text = OLD."productId";
  IF v_allocated > 0 THEN
    SELECT coalesce(sum(quantity), 0) INTO v_stock FROM public.inventory WHERE "warehouseId" = OLD."warehouseId" AND "productId" = OLD."productId";
    IF v_stock < v_allocated THEN
      RAISE EXCEPTION 'This stock is assigned to warehouse zones. Return enough quantity to Unassigned in Inventory > Warehouse Layout before reducing warehouse stock.';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER guard_warehouse_zone_stock AFTER UPDATE OR DELETE ON public.inventory FOR EACH ROW EXECUTE FUNCTION public.guard_warehouse_zone_stock();
REVOKE ALL ON FUNCTION public.manage_warehouse_zone(uuid,uuid,text,text), public.set_warehouse_zone_quantity(uuid,uuid,integer), public.guard_warehouse_zone_stock() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_warehouse_zone(uuid,uuid,text,text), public.set_warehouse_zone_quantity(uuid,uuid,integer) TO authenticated;

-- Serialize legacy inventory writers too, so concurrent reductions cannot leave
-- allocations above the remaining warehouse quantity.
CREATE FUNCTION public.lock_warehouse_zone_stock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  LOCK TABLE public.inventory IN SHARE ROW EXCLUSIVE MODE;
  RETURN NULL;
END;
$$;
CREATE TRIGGER lock_warehouse_zone_stock BEFORE INSERT OR UPDATE OR DELETE ON public.inventory
  FOR EACH STATEMENT EXECUTE FUNCTION public.lock_warehouse_zone_stock();
REVOKE ALL ON FUNCTION public.lock_warehouse_zone_stock() FROM PUBLIC, anon;

ALTER TABLE public.inventory_movements ADD COLUMN "sourceZoneId" uuid,
  ADD COLUMN "destinationZoneId" uuid, ADD COLUMN "sourceZoneName" text, ADD COLUMN "destinationZoneName" text;

-- Wrap the existing confirmation transaction: financials, stock validation,
-- permission checks, movement numbering and idempotency remain in that function.
CREATE FUNCTION public.confirm_inventory_movement_with_zones(p_request_id uuid, p_movement jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_source uuid := nullif(p_movement->>'sourceZoneId', '')::uuid;
  v_dest uuid := nullif(p_movement->>'destinationZoneId', '')::uuid;
  v_source_name text; v_dest_name text; v_item jsonb; v_qty integer;
  v_available bigint; v_result jsonb;
BEGIN
  IF NOT public.staff_movement_allowed(p_movement->>'type', true)
    OR NOT public.staff_warehouse_allowed(p_movement->>'destinationWarehouseId')
    OR (p_movement->>'type' = 'internal' AND NOT public.staff_warehouse_allowed(p_movement->>'sourceWarehouseId')) THEN
    RAISE EXCEPTION 'You do not have permission to record this movement.';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A request ID is required.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.inventory_movements WHERE id = p_request_id) THEN
    RETURN public.confirm_inventory_movement(p_request_id, p_movement);
  END IF;
  LOCK TABLE public.inventory IN SHARE ROW EXCLUSIVE MODE;
  IF p_movement->>'type' = 'external' THEN v_source := NULL; END IF;
  IF v_source IS NOT NULL THEN
    SELECT name INTO v_source_name FROM public.warehouse_zones WHERE id = v_source AND "warehouseId"::text = p_movement->>'sourceWarehouseId';
    IF NOT FOUND THEN RAISE EXCEPTION 'Source zone does not belong to the selected warehouse.'; END IF;
  END IF;
  IF v_dest IS NOT NULL THEN
    SELECT name INTO v_dest_name FROM public.warehouse_zones WHERE id = v_dest AND "warehouseId"::text = p_movement->>'destinationWarehouseId';
    IF NOT FOUND THEN RAISE EXCEPTION 'Destination zone does not belong to the selected warehouse.'; END IF;
  END IF;
  IF p_movement->>'type' = 'internal' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_movement->'items') LOOP
      IF coalesce(v_item->>'quantity', '') !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'Enter a positive whole quantity.'; END IF;
      v_qty := (v_item->>'quantity')::integer;
      IF v_source IS NULL THEN
        SELECT coalesce(sum(quantity), 0) INTO v_available FROM public.inventory
          WHERE "warehouseId" = p_movement->>'sourceWarehouseId' AND "productId" = v_item->>'productId';
        SELECT v_available - coalesce(sum(quantity), 0) INTO v_available FROM public.warehouse_zone_allocations
          WHERE "warehouseId"::text = p_movement->>'sourceWarehouseId' AND "productId"::text = v_item->>'productId';
      ELSE
        SELECT coalesce(sum(quantity), 0) INTO v_available FROM public.warehouse_zone_allocations
          WHERE "zoneId" = v_source AND "productId"::text = v_item->>'productId';
      END IF;
      IF v_qty > v_available THEN RAISE EXCEPTION 'Insufficient stock in the selected source zone or Unassigned allocation.'; END IF;
      IF v_source IS NOT NULL THEN
        DELETE FROM public.warehouse_zone_allocations WHERE "zoneId" = v_source AND "productId"::text = v_item->>'productId' AND quantity = v_qty;
        UPDATE public.warehouse_zone_allocations SET quantity = quantity - v_qty WHERE "zoneId" = v_source AND "productId"::text = v_item->>'productId';
      END IF;
    END LOOP;
  END IF;
  v_result := public.confirm_inventory_movement(p_request_id, p_movement);
  IF v_dest IS NOT NULL THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_movement->'items') LOOP
      INSERT INTO public.warehouse_zone_allocations ("warehouseId", "zoneId", "productId", quantity)
        VALUES ((p_movement->>'destinationWarehouseId')::uuid, v_dest, (v_item->>'productId')::uuid, (v_item->>'quantity')::integer)
        ON CONFLICT ("zoneId", "productId") DO UPDATE SET quantity = warehouse_zone_allocations.quantity + EXCLUDED.quantity;
    END LOOP;
  END IF;
  UPDATE public.inventory_movements SET "sourceZoneId" = v_source, "destinationZoneId" = v_dest,
    "sourceZoneName" = CASE WHEN p_movement->>'type' = 'internal' THEN coalesce(v_source_name, 'Unassigned') END,
    "destinationZoneName" = coalesce(v_dest_name, 'Unassigned') WHERE id = p_request_id;
  SELECT to_jsonb(m) INTO v_result FROM public.inventory_movements m WHERE id = p_request_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_inventory_movement_with_zones(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_inventory_movement_with_zones(uuid,jsonb) TO authenticated;
COMMIT;
