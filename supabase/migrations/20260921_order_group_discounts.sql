-- Apply after 20260920_order_entry.sql. Extends the same transactional API; no schema or status changes.
BEGIN;
CREATE OR REPLACE FUNCTION public.create_order_entry(p_request_id uuid, p_order jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
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
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A request ID is required.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  SELECT * INTO v_order FROM public.orders WHERE id = p_request_id;
  IF FOUND THEN
    IF v_order."agentId" <> v_uid THEN RAISE EXCEPTION 'This order belongs to another user.'; END IF;
    RETURN jsonb_build_object('order', to_jsonb(v_order), 'items', (SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY (i."entryDetails"->>'position')::integer), '[]'::jsonb) FROM public.order_items i WHERE "orderId" = p_request_id::text));
  END IF;
  SELECT * INTO v_source FROM public.orders WHERE id::text = p_order->>'customerSourceId'
    AND (v_role IN ('admin', 'secretary') OR "agentId" = v_uid);
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


COMMIT;
