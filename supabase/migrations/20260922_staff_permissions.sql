-- Apply after 20260921_order_group_discounts.sql. Keeps existing business transactions.
BEGIN;
ALTER TABLE public.delegations ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE public.delegations ADD COLUMN IF NOT EXISTS permissions jsonb;
-- Preserve all existing grants if historical records used duplicate email casing.
WITH merged AS (
  SELECT lower(btrim("staffEmail")) email, bool_or("canAdjustInventory") inventory, bool_or("canAdjustPricelist") pricelist,
    (array_agg(id ORDER BY "createdAt" DESC, id))[1] keep_id
  FROM public.delegations GROUP BY lower(btrim("staffEmail"))
)
UPDATE public.delegations d SET "staffEmail" = m.email, "canAdjustInventory" = m.inventory, "canAdjustPricelist" = m.pricelist
FROM merged m WHERE d.id = m.keep_id;
DELETE FROM public.delegations a USING public.delegations b
WHERE lower(btrim(a."staffEmail")) = lower(btrim(b."staffEmail")) AND (a."createdAt", a.id) < (b."createdAt", b.id);
CREATE UNIQUE INDEX IF NOT EXISTS delegations_email_unique ON public.delegations (lower(btrim("staffEmail")));

CREATE OR REPLACE FUNCTION public.staff_is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE uid = auth.uid()::text AND role = 'admin');
$$;
CREATE OR REPLACE FUNCTION public.staff_access_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.uid = auth.uid()::text AND
    (u.role = 'admin' OR NOT EXISTS (SELECT 1 FROM public.delegations d WHERE lower(btrim(d."staffEmail")) = lower(btrim(u.email)) AND NOT d.active)));
$$;
CREATE OR REPLACE FUNCTION public.staff_permissions() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN u.role = 'admin' THEN '{"inventory":"adjust","pricelist":"edit","orders":"create","movementView":"both","movementCreate":"both","supplyChain":"all","warehouseAccess":"all","warehouseIds":[]}'::jsonb
    WHEN d.active = false THEN '{"inventory":"view","pricelist":"view","orders":"none","movementView":"none","movementCreate":"none","supplyChain":"none","warehouseAccess":"selected","warehouseIds":[]}'::jsonb
    ELSE coalesce(d.permissions, jsonb_build_object('inventory', CASE WHEN d."canAdjustInventory" THEN 'adjust' ELSE 'view' END,
      'pricelist', CASE WHEN d."canAdjustPricelist" THEN 'edit' ELSE 'view' END, 'orders', CASE WHEN u.role = 'staff' THEN 'none' ELSE 'create' END,
      'movementView', CASE WHEN u.role = 'secretary' THEN 'both' ELSE 'none' END, 'movementCreate', CASE WHEN u.role = 'secretary' THEN 'both' ELSE 'none' END,
      'supplyChain', 'none', 'warehouseAccess', 'all', 'warehouseIds', '[]'::jsonb)) END
  FROM public.users u LEFT JOIN public.delegations d ON lower(btrim(d."staffEmail")) = lower(btrim(u.email)) WHERE u.uid = auth.uid()::text;
$$;
CREATE OR REPLACE FUNCTION public.staff_warehouse_allowed(p_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(public.staff_access_active() AND (public.staff_permissions()->>'warehouseAccess' = 'all'
    OR (nullif(p_id, '') IS NOT NULL AND (public.staff_permissions()->'warehouseIds') ? p_id)), false);
$$;
CREATE OR REPLACE FUNCTION public.staff_order_allowed(p_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(public.staff_access_active() AND
    (public.staff_permissions()->>'warehouseAccess' = 'all' OR
      (EXISTS (SELECT 1 FROM public.order_items WHERE "orderId" = p_id)
       AND NOT EXISTS (SELECT 1 FROM public.order_items WHERE "orderId" = p_id AND NOT public.staff_warehouse_allowed("warehouseId")))), false);
$$;
CREATE OR REPLACE FUNCTION public.staff_movement_allowed(p_type text, p_create boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(public.staff_access_active() AND (public.staff_permissions()->>CASE WHEN p_create THEN 'movementCreate' ELSE 'movementView' END) IN ('both', p_type), false);
$$;

CREATE OR REPLACE FUNCTION public.validate_staff_permissions(p jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN false; END IF;
  IF coalesce(p->>'inventory','') NOT IN ('view','adjust') OR coalesce(p->>'pricelist','') NOT IN ('view','edit')
    OR coalesce(p->>'orders','') NOT IN ('none','view','create') OR coalesce(p->>'movementView','') NOT IN ('none','external','internal','both')
    OR coalesce(p->>'movementCreate','') NOT IN ('none','external','internal','both') OR coalesce(p->>'supplyChain','') NOT IN ('none','all','customers','suppliers','warehouses')
    OR coalesce(p->>'warehouseAccess','') NOT IN ('all','selected') OR jsonb_typeof(p->'warehouseIds') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF p->>'movementCreate' <> 'none' AND p->>'movementView' <> 'both' AND p->>'movementCreate' <> p->>'movementView' THEN RETURN false; END IF;
  IF p->>'warehouseAccess' = 'selected' AND jsonb_array_length(p->'warehouseIds') = 0 THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p->'warehouseIds') value WHERE jsonb_typeof(value) <> 'string') THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(p->'warehouseIds') AS selected(warehouse_id) WHERE NOT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id::text = selected.warehouse_id)) THEN RETURN false; END IF;
  RETURN true;
END;
$$;
CREATE OR REPLACE FUNCTION public.set_staff_access(p_uid text, p_permissions jsonb, p_active boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target public.users; saved public.delegations;
BEGIN
  IF NOT public.staff_is_admin() THEN RAISE EXCEPTION 'Only administrators can manage staff permissions.'; END IF;
  SELECT * INTO target FROM public.users WHERE uid = p_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This user account no longer exists.'; END IF;
  IF target.role = 'admin' OR target.uid = auth.uid()::text THEN RAISE EXCEPTION 'Administrator access is managed by role.'; END IF;
  IF p_active IS NULL THEN RAISE EXCEPTION 'Choose an access status.'; END IF;
  IF p_active AND NOT public.validate_staff_permissions(p_permissions) THEN RAISE EXCEPTION 'Choose valid permissions and at least one existing warehouse for selected access.'; END IF;
  INSERT INTO public.delegations ("agentId", "staffEmail", "canAdjustInventory", "canAdjustPricelist", permissions, active)
  VALUES (auth.uid()::text, lower(btrim(target.email)), coalesce(p_permissions->>'inventory' = 'adjust', false), coalesce(p_permissions->>'pricelist' = 'edit', false), p_permissions, p_active)
  ON CONFLICT (lower(btrim("staffEmail"))) DO UPDATE SET permissions = EXCLUDED.permissions, active = EXCLUDED.active,
    "canAdjustInventory" = EXCLUDED."canAdjustInventory", "canAdjustPricelist" = EXCLUDED."canAdjustPricelist"
  RETURNING * INTO saved;
  RETURN to_jsonb(saved);
END;
$$;

-- Only admins may write delegations; staff may read their own for live UI updates.
DROP POLICY IF EXISTS "Authenticated read delegations" ON public.delegations;
CREATE POLICY staff_delegation_read ON public.delegations FOR SELECT TO authenticated USING
  (public.staff_is_admin() OR lower(btrim("staffEmail")) = lower(btrim(auth.jwt()->>'email')));
REVOKE INSERT, UPDATE, DELETE ON public.delegations FROM authenticated, anon;
GRANT SELECT ON public.delegations TO authenticated;

-- Prevent a delegated user from bypassing permissions by changing their own role/email.
CREATE OR REPLACE FUNCTION public.guard_staff_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.staff_is_admin() THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.uid <> auth.uid()::text OR NEW.role <> 'agent' OR lower(NEW.email) <> lower(auth.jwt()->>'email') THEN RAISE EXCEPTION 'Invalid account identity.'; END IF;
    ELSIF NEW.uid IS DISTINCT FROM OLD.uid OR NEW.email IS DISTINCT FROM OLD.email OR NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Only administrators can change account identity or role.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_staff_identity BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.guard_staff_identity();
CREATE POLICY staff_user_write_scope ON public.users AS RESTRICTIVE FOR ALL TO authenticated USING
  (public.staff_is_admin() OR uid = auth.uid()::text) WITH CHECK (public.staff_is_admin() OR uid = auth.uid()::text);
-- Above ALL restriction would hide the directory from nonadmins, which is intentional;
-- administrators still see every account, including users with no delegation.

-- Restrictive policies intersect existing policies, preserving previous role rules.
CREATE POLICY staff_warehouse_scope ON public.warehouses AS RESTRICTIVE FOR SELECT TO authenticated USING (public.staff_warehouse_allowed(id::text));
CREATE POLICY staff_inventory_scope ON public.inventory AS RESTRICTIVE FOR SELECT TO authenticated USING (public.staff_warehouse_allowed("warehouseId"));
CREATE POLICY staff_inventory_update ON public.inventory AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.staff_warehouse_allowed("warehouseId") AND public.staff_permissions()->>'inventory' = 'adjust')
  WITH CHECK (public.staff_warehouse_allowed("warehouseId") AND public.staff_permissions()->>'inventory' = 'adjust');
CREATE POLICY staff_inventory_insert ON public.inventory AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.staff_warehouse_allowed("warehouseId") AND public.staff_permissions()->>'inventory' = 'adjust');
CREATE POLICY staff_inventory_delete ON public.inventory AS RESTRICTIVE FOR DELETE TO authenticated USING (public.staff_is_admin());
CREATE POLICY staff_adjustment_scope ON public."stockAdjustments" AS RESTRICTIVE FOR SELECT TO authenticated USING (public.staff_warehouse_allowed("warehouseId"));
CREATE POLICY staff_adjustment_insert ON public."stockAdjustments" AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.staff_warehouse_allowed("warehouseId") AND public.staff_permissions()->>'inventory' = 'adjust');
CREATE POLICY staff_order_scope ON public.orders AS RESTRICTIVE FOR SELECT TO authenticated USING
  (public.staff_order_allowed(id::text) AND (public.staff_permissions()->>'orders' <> 'none' OR public.staff_permissions()->>'supplyChain' IN ('all','customers','warehouses')));
CREATE POLICY staff_order_items_scope ON public.order_items AS RESTRICTIVE FOR SELECT TO authenticated USING
  (public.staff_order_allowed("orderId") AND (public.staff_permissions()->>'orders' <> 'none' OR public.staff_permissions()->>'supplyChain' IN ('all','customers','warehouses')));
CREATE POLICY staff_transfer_scope ON public.transfers AS RESTRICTIVE FOR SELECT TO authenticated USING
  (public.staff_warehouse_allowed("sourceWarehouseId") AND public.staff_warehouse_allowed("destinationWarehouseId")
    AND (public.staff_movement_allowed('internal') OR public.staff_permissions()->>'supplyChain' IN ('all','warehouses')));
CREATE POLICY staff_transfer_insert ON public.transfers AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK
  (public.staff_movement_allowed('internal', true) AND public.staff_warehouse_allowed("sourceWarehouseId") AND public.staff_warehouse_allowed("destinationWarehouseId"));
CREATE POLICY staff_transfer_update ON public.transfers AS RESTRICTIVE FOR UPDATE TO authenticated USING
  (public.staff_movement_allowed('internal', true) AND public.staff_warehouse_allowed("sourceWarehouseId") AND public.staff_warehouse_allowed("destinationWarehouseId")) WITH CHECK
  (public.staff_movement_allowed('internal', true) AND public.staff_warehouse_allowed("sourceWarehouseId") AND public.staff_warehouse_allowed("destinationWarehouseId"));
CREATE POLICY staff_transfer_delete ON public.transfers AS RESTRICTIVE FOR DELETE TO authenticated USING (public.staff_is_admin());
DROP POLICY IF EXISTS movement_read ON public.inventory_movements;
CREATE POLICY movement_read ON public.inventory_movements FOR SELECT TO authenticated USING
  (public.staff_warehouse_allowed("destinationWarehouseId") AND (type = 'external' OR public.staff_warehouse_allowed("sourceWarehouseId"))
    AND (public.staff_movement_allowed(type) OR public.staff_permissions()->>'supplyChain' IN ('all','warehouses')
      OR (type = 'external' AND public.staff_permissions()->>'supplyChain' = 'suppliers')));
-- Operational writes must use the existing transaction functions; inventory adjustments
-- retain their existing endpoint and the warehouse/adjust permission checks above.
REVOKE INSERT, UPDATE, DELETE ON public.orders, public.order_items FROM authenticated, anon;
-- Existing supply chain grants are view-only. Only admins manage warehouse metadata.
CREATE POLICY staff_warehouse_insert ON public.warehouses AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.staff_is_admin());
CREATE POLICY staff_warehouse_update ON public.warehouses AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.staff_is_admin()) WITH CHECK (public.staff_is_admin());
CREATE POLICY staff_warehouse_delete ON public.warehouses AS RESTRICTIVE FOR DELETE TO authenticated USING (public.staff_is_admin());
CREATE POLICY staff_supplier_insert ON public.suppliers AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.staff_is_admin());
CREATE POLICY staff_supplier_update ON public.suppliers AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.staff_is_admin()) WITH CHECK (public.staff_is_admin());
CREATE POLICY staff_supplier_delete ON public.suppliers AS RESTRICTIVE FOR DELETE TO authenticated USING (public.staff_is_admin());

-- Existing transaction bodies, with permission checks before any stock/financial writes.
CREATE OR REPLACE FUNCTION public.create_order_entry(p_request_id uuid, p_order jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid text := auth.uid()::text;
  v_role text;
  v_user text;
  v_source public.orders%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_inventory public.inventory%ROWTYPE;
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_prices jsonb;
  v_scheme text;
  v_warehouse text;
  v_price numeric;
  v_qty integer;
  v_remaining integer;
  v_take integer;
  v_subtotal numeric := 0;
  v_discount numeric := coalesce((p_order->>'discount')::numeric, 0);
  v_group jsonb;
  v_groups jsonb := '[]'::jsonb;
  v_start integer := 0;
  v_end integer;
  v_base numeric;
  v_value numeric;
  v_amount numeric;
  v_group_total numeric := 0;
  v_extra numeric;
  v_number text := 'ORD-' || upper(p_request_id::text);
BEGIN
  SELECT role, coalesce(nullif("displayName", ''), email) INTO v_role, v_user FROM public.users WHERE uid = v_uid;
  IF v_uid IS NULL OR v_role IS NULL OR v_role NOT IN ('admin', 'secretary', 'agent', 'staff') THEN RAISE EXCEPTION 'Sign in to create an order.'; END IF;
  IF NOT public.staff_access_active() OR public.staff_permissions()->>'orders' IS DISTINCT FROM 'create' THEN RAISE EXCEPTION 'You cannot create orders.'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A request ID is required.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  SELECT * INTO v_order FROM public.orders WHERE id = p_request_id;
  IF FOUND THEN
    IF v_order."agentId" <> v_uid THEN RAISE EXCEPTION 'This order belongs to another user.'; END IF;
    IF NOT public.staff_order_allowed(v_order.id::text) THEN RAISE EXCEPTION 'You no longer have access to this order.'; END IF;
    RETURN jsonb_build_object('order', to_jsonb(v_order), 'items', (SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY (i."entryDetails"->>'position')::integer), '[]'::jsonb) FROM public.order_items i WHERE "orderId" = p_request_id::text));
  END IF;
  SELECT * INTO v_source FROM public.orders WHERE id::text = p_order->>'customerSourceId'
    AND (v_role IN ('admin', 'secretary', 'staff') OR "agentId" = v_uid) AND public.staff_order_allowed(id::text);
  IF NOT FOUND OR nullif(btrim(v_source."clientName"), '') IS NULL THEN RAISE EXCEPTION 'Select an existing customer from your accessible orders.'; END IF;
  IF coalesce(p_order->>'deliveryRegion', '') NOT IN ('Metro Manila', 'Luzon', 'Visayas', 'Mindanao') THEN RAISE EXCEPTION 'Select a delivery region.'; END IF;
  IF coalesce(length(btrim(p_order->>'paymentTerms')), 0) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Enter payment terms.'; END IF;
  IF jsonb_typeof(p_order->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Add order items.'; END IF;
  IF jsonb_array_length(p_order->'items') = 0 THEN RAISE EXCEPTION 'Add order items.'; END IF;
  IF v_discount::text IN ('NaN', 'Infinity', '-Infinity') OR v_discount < 0 OR v_discount <> round(v_discount, 2) THEN RAISE EXCEPTION 'Enter a valid order discount with at most two decimal places.'; END IF;

  -- Stable row-lock order prevents overselling and deadlocks between order saves.
  PERFORM id FROM public.inventory WHERE ("productId", "warehouseId") IN
    (SELECT item->>'productId', item->>'warehouseId' FROM jsonb_array_elements(p_order->'items') item)
    ORDER BY id FOR UPDATE;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_order->'items') LOOP
    SELECT * INTO v_product FROM public.products WHERE id::text = v_item->>'productId';
    IF NOT FOUND THEN RAISE EXCEPTION 'An ordered product is no longer available.'; END IF;
    v_warehouse := v_item->>'warehouseId';
    IF NOT public.staff_warehouse_allowed(v_warehouse) THEN RAISE EXCEPTION 'You do not have access to this warehouse.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id::text = v_warehouse AND active IS DISTINCT FROM false) THEN RAISE EXCEPTION 'Choose an active source warehouse.'; END IF;
    IF coalesce(v_item->>'quantity', '') !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'Quantity must be a positive whole number.'; END IF;
    v_qty := (v_item->>'quantity')::integer;
    v_scheme := v_item->>'priceType';
    v_prices := jsonb_build_object('regular', v_product."basePrice", 'mm', coalesce(v_product."mmPrice", v_product."wholesalePrice"), 'provincial', coalesce(v_product."provincialPrice", v_product."dealerPrice"), 'promo', v_product."promoPrice", 'cost', v_product."costPrice");
    IF v_scheme = 'custom' THEN v_price := (v_item->>'unitPrice')::numeric;
    ELSIF v_scheme IN ('regular', 'mm', 'provincial', 'promo') THEN v_price := (v_prices->>v_scheme)::numeric;
    ELSE RAISE EXCEPTION 'Select a selling price. Cost is reference-only.'; END IF;
    IF v_price IS NULL OR v_price::text IN ('NaN', 'Infinity', '-Infinity') OR v_price < 0 OR v_price <> round(v_price, 2) THEN RAISE EXCEPTION 'Invalid or unavailable selling price for %.', v_product.name; END IF;
    IF v_price IS DISTINCT FROM (v_item->>'unitPrice')::numeric THEN RAISE EXCEPTION 'The price for % changed. Edit the cart item to review the current price.', v_product.name; END IF;

    v_remaining := v_qty;
    FOR v_inventory IN SELECT * FROM public.inventory WHERE "productId" = v_product.id::text AND "warehouseId" = v_warehouse AND quantity > 0 ORDER BY id LOOP
      EXIT WHEN v_remaining = 0;
      v_take := least(v_inventory.quantity, v_remaining);
      UPDATE public.inventory SET quantity = quantity - v_take, "lastUpdated" = now() WHERE id = v_inventory.id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Inventory deduction was denied. Order was not saved.'; END IF;
      INSERT INTO public."stockAdjustments" ("productId", "warehouseId", "adjustmentAmount", reason, "recordedBy", timestamp)
        VALUES (v_product.id::text, v_warehouse, -v_take, 'Auto-deduction: Order ' || v_number, v_uid, now());
      v_remaining := v_remaining - v_take;
    END LOOP;
    IF v_remaining > 0 THEN RAISE EXCEPTION 'Insufficient stock for % at the selected warehouse. Order was not saved.', v_product.name; END IF;
    v_subtotal := v_subtotal + round(v_qty * v_price, 2);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'orderId', p_request_id::text, 'productId', v_product.id::text,
      'warehouseId', v_warehouse, 'sku', v_product.sku, 'name', v_product.name, 'quantity', v_qty,
      'unitPrice', v_price, 'subtotal', round(v_qty * v_price, 2),
      'entryDetails', jsonb_build_object('priceType', v_scheme, 'prices', v_prices,
        'variation', coalesce(to_jsonb(v_product)->>'variation', ''), 'unit', coalesce(to_jsonb(v_product)->>'unit', 'pc'), 'position', jsonb_array_length(v_items))));
  END LOOP;
  IF p_order ? 'groupDiscounts' THEN
    IF jsonb_typeof(p_order->'groupDiscounts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid group discounts.'; END IF;
    v_extra := coalesce((p_order->>'orderDiscount')::numeric, 0);
    IF v_extra::text IN ('NaN', 'Infinity', '-Infinity') OR v_extra < 0 OR v_extra <> round(v_extra, 2) THEN RAISE EXCEPTION 'Invalid extra discount.'; END IF;
    FOR v_group IN SELECT value FROM jsonb_array_elements(p_order->'groupDiscounts') LOOP
      IF coalesce(v_group->>'afterPosition', '') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Invalid discount position.'; END IF;
      v_end := (v_group->>'afterPosition')::integer;
      IF v_end < v_start OR v_end >= jsonb_array_length(v_items) THEN RAISE EXCEPTION 'Discount groups must follow item order without overlap.'; END IF;
      SELECT sum((item->>'subtotal')::numeric) INTO v_base FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(item, pos) WHERE pos BETWEEN v_start + 1 AND v_end + 1;
      v_value := (v_group->>'value')::numeric;
      IF v_value IS NULL OR v_value::text IN ('NaN', 'Infinity', '-Infinity') OR v_value < 0 OR v_value <> round(v_value, 2) THEN RAISE EXCEPTION 'Invalid group discount value.'; END IF;
      IF v_group->>'type' = 'percent' THEN
        IF v_value > 100 THEN RAISE EXCEPTION 'Percentage cannot exceed 100.'; END IF;
        v_amount := round(v_base * v_value / 100, 2);
      ELSIF v_group->>'type' = 'amount' THEN v_amount := v_value;
      ELSE RAISE EXCEPTION 'Invalid group discount type.'; END IF;
      IF v_amount > v_base THEN RAISE EXCEPTION 'Discount cannot exceed its group subtotal.'; END IF;
      v_groups := v_groups || jsonb_build_array(jsonb_build_object('afterLineId', v_items->v_end->>'id', 'afterPosition', v_end, 'startPosition', v_start, 'type', v_group->>'type', 'value', v_value, 'base', v_base, 'amount', v_amount));
      v_group_total := v_group_total + v_amount;
      v_start := v_end + 1;
    END LOOP;
    IF v_discount <> v_group_total + v_extra THEN RAISE EXCEPTION 'Discount totals changed. Review your order.'; END IF;
  ELSE
    v_extra := v_discount;
  END IF;
  IF v_discount > v_subtotal THEN RAISE EXCEPTION 'Order discount cannot exceed the subtotal.'; END IF;
  INSERT INTO public.orders (id, "orderNumber", "agentId", "clientId", "clientName", status, skus, "totalAmount", "paymentStatus", "deliveryRegion", "deliveryDeadline", "statusHistory", "receiptDetails", "stockReserved")
    VALUES (p_request_id, v_number, v_uid, v_source."clientId", v_source."clientName", 'pending',
      (SELECT jsonb_agg(item->>'sku') FROM jsonb_array_elements(v_items) item), v_subtotal - v_discount, 'unpaid', p_order->>'deliveryRegion',
      now() + CASE WHEN p_order->>'deliveryRegion' = 'Metro Manila' THEN interval '7 days' ELSE interval '14 days' END,
      jsonb_build_array(jsonb_build_object('status', 'pending', 'changedBy', v_user, 'timestamp', now(), 'note', 'Order created; stock reserved at the selected warehouses.')),
      jsonb_build_object('address', left(coalesce(p_order->>'address', ''), 300), 'paymentTerms', btrim(p_order->>'paymentTerms'), 'subtotal', v_subtotal, 'discount', v_discount, 'preparedBy', v_user, 'groupDiscounts', v_groups, 'orderDiscount', v_extra), true)
    RETURNING * INTO v_order;
  INSERT INTO public.order_items (id, "orderId", "productId", "warehouseId", sku, name, quantity, "unitPrice", subtotal, "entryDetails")
    SELECT x.id, x."orderId", x."productId", x."warehouseId", x.sku, x.name, x.quantity, x."unitPrice", x.subtotal, x."entryDetails"
      FROM jsonb_populate_recordset(NULL::public.order_items, v_items) x;
  RETURN jsonb_build_object('order', to_jsonb(v_order), 'items', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_order_entry(p_order_id uuid, p_status text, p_photo_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid text := auth.uid()::text;
  v_role text;
  v_user text;
  v_order public.orders%ROWTYPE;
  v_line record;
  v_inventory_id uuid;
  v_note text;
BEGIN
  IF NOT public.staff_access_active() OR public.staff_permissions()->>'orders' IS DISTINCT FROM 'create' OR NOT public.staff_order_allowed(p_order_id::text) THEN RAISE EXCEPTION 'You cannot update this order.'; END IF;
  SELECT role, coalesce(nullif("displayName", ''), email) INTO v_role, v_user FROM public.users WHERE uid = v_uid;
  IF v_uid IS NULL OR v_role IS NULL OR v_role NOT IN ('admin', 'secretary', 'staff') THEN RAISE EXCEPTION 'Your role cannot update order status.'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR (v_role = 'staff' AND v_order."agentId" <> v_uid) THEN RAISE EXCEPTION 'Order is not accessible.'; END IF;
  IF v_order.status = p_status THEN RETURN to_jsonb(v_order); END IF;
  IF NOT coalesce((v_order.status = 'pending' AND p_status = 'preparing')
    OR (v_order.status = 'preparing' AND p_status = 'out_for_delivery')
    OR (v_order.status = 'out_for_delivery' AND p_status = 'delivered')
    OR (v_order.status = 'delivered' AND p_status = 'completed')
    OR (v_order.status IN ('pending', 'preparing', 'out_for_delivery') AND p_status IN ('cancelled', 'escalated')), false)
    THEN RAISE EXCEPTION 'Invalid status transition. Refresh the order and retry.'; END IF;
  IF p_status = 'out_for_delivery' AND coalesce(nullif(p_photo_url, ''), nullif(v_order."photoValidationUrl", '')) IS NULL THEN RAISE EXCEPTION 'Upload a dispatch photo before dispatching.'; END IF;
  v_note := 'Status updated to ' || replace(p_status, '_', ' ');
  IF p_status IN ('cancelled', 'escalated') AND v_order."stockReserved" IS DISTINCT FROM false THEN
    -- Legacy orders keep their original restoration behavior. New orders always
    -- have an explicit reservation and exact source warehouse.
    PERFORM id FROM public.inventory WHERE "productId" IN (SELECT "productId" FROM public.order_items WHERE "orderId" = p_order_id::text) ORDER BY id FOR UPDATE;
    FOR v_line IN SELECT "productId", "warehouseId", sum(quantity)::integer AS quantity FROM public.order_items WHERE "orderId" = p_order_id::text GROUP BY "productId", "warehouseId" ORDER BY "productId", "warehouseId" LOOP
      SELECT id INTO v_inventory_id FROM public.inventory WHERE "productId" = v_line."productId"
        AND (nullif(v_line."warehouseId", '') IS NULL OR "warehouseId" = v_line."warehouseId") ORDER BY id LIMIT 1;
      IF v_inventory_id IS NULL THEN RAISE EXCEPTION 'Source inventory was not found. Stock restoration and status change were not saved.'; END IF;
      UPDATE public.inventory SET quantity = quantity + v_line.quantity, "lastUpdated" = now() WHERE id = v_inventory_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Stock restoration was denied. Status was not changed.'; END IF;
      INSERT INTO public."stockAdjustments" ("productId", "warehouseId", "adjustmentAmount", reason, "recordedBy", timestamp)
        SELECT "productId", "warehouseId", v_line.quantity, 'Order ' || v_order."orderNumber" || ' ' || p_status || ': stock replenishment', v_uid, now() FROM public.inventory WHERE id = v_inventory_id;
    END LOOP;
    v_order."stockReserved" := false;
    v_note := v_note || '; stock restored to source warehouses.';
  END IF;
  UPDATE public.orders SET status = p_status, "updatedAt" = now(), "stockReserved" = v_order."stockReserved",
    "photoValidationUrl" = CASE WHEN p_status = 'out_for_delivery' THEN coalesce(nullif(p_photo_url, ''), "photoValidationUrl") ELSE "photoValidationUrl" END,
    "statusHistory" = coalesce("statusHistory", '[]'::jsonb) || jsonb_build_array(jsonb_build_object('status', p_status, 'changedBy', v_user, 'timestamp', now(), 'note', v_note))
    WHERE id = p_order_id RETURNING * INTO v_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order status update was denied.'; END IF;
  RETURN to_jsonb(v_order);
END;
$$;

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
    WHERE uid = v_uid AND public.staff_movement_allowed(v_type, true);
  IF v_user IS NULL THEN RAISE EXCEPTION 'You do not have permission to create this movement type.'; END IF;
  IF NOT public.staff_warehouse_allowed(p_movement->>'destinationWarehouseId') OR (v_type = 'internal' AND NOT public.staff_warehouse_allowed(p_movement->>'sourceWarehouseId')) THEN RAISE EXCEPTION 'You do not have access to these warehouses.'; END IF;
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

REVOKE ALL ON FUNCTION public.set_staff_access(text,jsonb,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_staff_access(text,jsonb,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.create_order_entry(uuid,jsonb), public.transition_order_entry(uuid,text,text), public.confirm_inventory_movement(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order_entry(uuid,jsonb), public.transition_order_entry(uuid,text,text), public.confirm_inventory_movement(uuid,jsonb) TO authenticated;
-- Called only by the server-side account service after Auth creates a login.
CREATE OR REPLACE FUNCTION public.provision_staff_user(p_uid text, p_email text, p_name text, p_permissions jsonb, p_admin_uid text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE new_user public.users; new_delegation public.delegations;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE uid = p_admin_uid AND role = 'admin') THEN RAISE EXCEPTION 'Administrator required.'; END IF;
  IF NOT public.validate_staff_permissions(p_permissions) THEN RAISE EXCEPTION 'Invalid staff permissions.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id::text = p_uid AND lower(email) = lower(btrim(p_email))) THEN RAISE EXCEPTION 'A matching login is required.'; END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE lower(btrim(email)) = lower(btrim(p_email))) THEN RAISE EXCEPTION 'An account already exists for this email.'; END IF;
  INSERT INTO public.users (uid, email, "displayName", role) VALUES (p_uid, lower(btrim(p_email)), btrim(p_name), 'staff') RETURNING * INTO new_user;
  INSERT INTO public.delegations ("agentId", "staffEmail", "canAdjustInventory", "canAdjustPricelist", permissions, active)
    VALUES (p_admin_uid, lower(btrim(p_email)), p_permissions->>'inventory' = 'adjust', p_permissions->>'pricelist' = 'edit', p_permissions, true)
    ON CONFLICT (lower(btrim("staffEmail"))) DO UPDATE SET "agentId" = EXCLUDED."agentId", "canAdjustInventory" = EXCLUDED."canAdjustInventory",
      "canAdjustPricelist" = EXCLUDED."canAdjustPricelist", permissions = EXCLUDED.permissions, active = true RETURNING * INTO new_delegation;
  RETURN jsonb_build_object('user', to_jsonb(new_user), 'delegation', to_jsonb(new_delegation));
END;
$$;
REVOKE ALL ON FUNCTION public.provision_staff_user(text,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_staff_user(text,text,text,jsonb,text) TO service_role;

COMMIT;
