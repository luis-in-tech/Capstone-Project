-- Apply after 20260922_staff_permissions.sql (also supports databases that applied 20260923).
-- Remove the extra administrator tier without altering staff permissions or business calculations.
BEGIN;
DROP TRIGGER IF EXISTS guard_staff_identity ON public.users;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE public.users SET role = 'admin' WHERE role = 'superadmin';
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','secretary','agent','staff'));

CREATE OR REPLACE FUNCTION public.staff_access_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.uid = auth.uid()::text AND
    (u.role = 'admin' OR NOT EXISTS (SELECT 1 FROM public.delegations d WHERE lower(btrim(d."staffEmail")) = lower(btrim(u.email)) AND NOT d.active)));
$$;
CREATE OR REPLACE FUNCTION public.staff_is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.staff_access_active() AND EXISTS (SELECT 1 FROM public.users WHERE uid = auth.uid()::text AND role = 'admin');
$$;

-- Convert old exclusive Supply Chain settings to independent view selections.
UPDATE public.delegations SET permissions = jsonb_set(permissions, '{supplyChain}',
  CASE permissions->>'supplyChain' WHEN 'all' THEN '["customers","suppliers","warehouses"]'::jsonb
    WHEN 'customers' THEN '["customers"]'::jsonb WHEN 'suppliers' THEN '["suppliers"]'::jsonb
    WHEN 'warehouses' THEN '["warehouses"]'::jsonb ELSE '[]'::jsonb END)
WHERE permissions IS NOT NULL AND jsonb_typeof(permissions->'supplyChain') IS DISTINCT FROM 'array';

CREATE OR REPLACE FUNCTION public.staff_permissions_for(p_uid text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN u.role = 'admin'
    THEN '{"inventory":"adjust","pricelist":"edit","orders":"create","movementView":"both","movementCreate":"both","supplyChain":["customers","suppliers","warehouses"],"warehouseAccess":"all","warehouseIds":[]}'::jsonb
    WHEN d.active = false THEN '{"inventory":"view","pricelist":"view","orders":"none","movementView":"none","movementCreate":"none","supplyChain":[],"warehouseAccess":"selected","warehouseIds":[]}'::jsonb
    ELSE coalesce(d.permissions, jsonb_build_object('inventory', CASE WHEN d."canAdjustInventory" THEN 'adjust' ELSE 'view' END,
      'pricelist', CASE WHEN d."canAdjustPricelist" THEN 'edit' ELSE 'view' END, 'orders', CASE WHEN u.role = 'staff' THEN 'none' ELSE 'create' END,
      'movementView', CASE WHEN u.role = 'secretary' THEN 'both' ELSE 'none' END, 'movementCreate', CASE WHEN u.role = 'secretary' THEN 'both' ELSE 'none' END,
      'supplyChain', '[]'::jsonb, 'warehouseAccess', 'all', 'warehouseIds', '[]'::jsonb)) END
  FROM public.users u LEFT JOIN public.delegations d ON lower(btrim(d."staffEmail")) = lower(btrim(u.email)) WHERE u.uid = p_uid;
$$;
REVOKE ALL ON FUNCTION public.staff_permissions_for(text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.staff_permissions() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.staff_permissions_for(auth.uid()::text);
$$;
CREATE OR REPLACE FUNCTION public.staff_supply_allowed(p_view text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(public.staff_access_active() AND (public.staff_permissions()->'supplyChain') ? p_view, false);
$$;

CREATE OR REPLACE FUNCTION public.validate_staff_permissions(p jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN false; END IF;
  IF coalesce(p->>'inventory','') NOT IN ('view','adjust') OR coalesce(p->>'pricelist','') NOT IN ('view','edit')
    OR coalesce(p->>'orders','') NOT IN ('none','view','create') OR coalesce(p->>'movementView','') NOT IN ('none','external','internal','both')
    OR coalesce(p->>'movementCreate','') NOT IN ('none','external','internal','both')
    OR coalesce(p->>'warehouseAccess','') NOT IN ('all','selected') OR jsonb_typeof(p->'warehouseIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p->'supplyChain') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p->'supplyChain') AS s(value) WHERE s.value NOT IN ('"customers"'::jsonb,'"suppliers"'::jsonb,'"warehouses"'::jsonb)) THEN RETURN false; END IF;
  IF p->>'movementCreate' <> 'none' AND p->>'movementView' <> 'both' AND p->>'movementCreate' <> p->>'movementView' THEN RETURN false; END IF;
  IF p->>'warehouseAccess' = 'selected' AND jsonb_array_length(p->'warehouseIds') = 0 THEN RETURN false; END IF;
  IF p->>'warehouseAccess' = 'all' AND jsonb_array_length(p->'warehouseIds') <> 0 THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p->'warehouseIds') value WHERE jsonb_typeof(value) <> 'string') THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(p->'warehouseIds') AS selected(warehouse_id) WHERE NOT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id::text = selected.warehouse_id)) THEN RETURN false; END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_can_delegate(p jsonb, p_actor text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE uid = p_actor AND role = 'admin');
$$;
REVOKE ALL ON FUNCTION public.staff_can_delegate(jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_can_delegate(jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.set_staff_access(p_uid text, p_permissions jsonb, p_active boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target public.users; saved public.delegations;
BEGIN
  IF NOT public.staff_is_admin() THEN RAISE EXCEPTION 'Only the admin can manage permissions.'; END IF;
  SELECT * INTO target FROM public.users WHERE uid = p_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This user account no longer exists.'; END IF;
  IF target.role = 'admin' OR target.uid = auth.uid()::text THEN RAISE EXCEPTION 'Administrator access cannot be changed here.'; END IF;
  IF p_active IS NULL THEN RAISE EXCEPTION 'Choose an access status.'; END IF;
  IF p_active AND NOT public.validate_staff_permissions(p_permissions) THEN RAISE EXCEPTION 'Choose valid permissions and existing warehouses.'; END IF;
  IF p_active AND NOT public.staff_can_delegate(p_permissions, auth.uid()::text) THEN RAISE EXCEPTION 'You cannot delegate access beyond your own permissions or warehouse scope.'; END IF;
  IF NOT p_active THEN
    p_permissions := coalesce((SELECT d.permissions FROM public.delegations d WHERE lower(btrim(d."staffEmail")) = lower(btrim(target.email))), public.staff_permissions_for(p_uid));
  END IF;
  INSERT INTO public.delegations ("agentId", "staffEmail", "canAdjustInventory", "canAdjustPricelist", permissions, active)
  VALUES (auth.uid()::text, lower(btrim(target.email)), coalesce(p_permissions->>'inventory' = 'adjust', false), coalesce(p_permissions->>'pricelist' = 'edit', false), p_permissions, p_active)
  ON CONFLICT (lower(btrim("staffEmail"))) DO UPDATE SET permissions = EXCLUDED.permissions, active = EXCLUDED.active,
    "agentId" = EXCLUDED."agentId", "canAdjustInventory" = EXCLUDED."canAdjustInventory", "canAdjustPricelist" = EXCLUDED."canAdjustPricelist"
  RETURNING * INTO saved;
  RETURN to_jsonb(saved);
END;
$$;

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

DROP POLICY IF EXISTS staff_order_scope ON public.orders;
CREATE POLICY staff_order_scope ON public.orders AS RESTRICTIVE FOR SELECT TO authenticated USING
  (public.staff_order_allowed(id::text) AND (public.staff_permissions()->>'orders' <> 'none' OR public.staff_supply_allowed('customers') OR public.staff_supply_allowed('warehouses')));
DROP POLICY IF EXISTS staff_order_items_scope ON public.order_items;
CREATE POLICY staff_order_items_scope ON public.order_items AS RESTRICTIVE FOR SELECT TO authenticated USING
  (public.staff_order_allowed("orderId") AND (public.staff_permissions()->>'orders' <> 'none' OR public.staff_supply_allowed('customers') OR public.staff_supply_allowed('warehouses')));
DROP POLICY IF EXISTS staff_transfer_scope ON public.transfers;
CREATE POLICY staff_transfer_scope ON public.transfers AS RESTRICTIVE FOR SELECT TO authenticated USING
  (public.staff_warehouse_allowed("sourceWarehouseId") AND public.staff_warehouse_allowed("destinationWarehouseId") AND (public.staff_movement_allowed('internal') OR public.staff_supply_allowed('warehouses')));
DROP POLICY IF EXISTS movement_read ON public.inventory_movements;
CREATE POLICY movement_read ON public.inventory_movements FOR SELECT TO authenticated USING
  (public.staff_warehouse_allowed("destinationWarehouseId") AND (type = 'external' OR public.staff_warehouse_allowed("sourceWarehouseId"))
    AND (public.staff_movement_allowed(type) OR public.staff_supply_allowed('warehouses') OR (type = 'external' AND public.staff_supply_allowed('suppliers'))));

-- Staff Supply Chain access stays view-only; admin can manage records.
CREATE OR REPLACE FUNCTION public.staff_manage_supply() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.staff_is_admin();
$$;
DROP POLICY IF EXISTS staff_warehouse_insert ON public.warehouses;
DROP POLICY IF EXISTS staff_warehouse_update ON public.warehouses;
DROP POLICY IF EXISTS staff_warehouse_delete ON public.warehouses;
DROP POLICY IF EXISTS staff_supplier_insert ON public.suppliers;
DROP POLICY IF EXISTS staff_supplier_update ON public.suppliers;
DROP POLICY IF EXISTS staff_supplier_delete ON public.suppliers;
CREATE POLICY staff_warehouse_insert ON public.warehouses AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.staff_manage_supply());
CREATE POLICY staff_warehouse_update ON public.warehouses AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.staff_manage_supply()) WITH CHECK (public.staff_manage_supply());
CREATE POLICY staff_warehouse_delete ON public.warehouses AS RESTRICTIVE FOR DELETE TO authenticated USING (public.staff_manage_supply());
CREATE POLICY staff_supplier_insert ON public.suppliers AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.staff_manage_supply());
CREATE POLICY staff_supplier_update ON public.suppliers AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.staff_manage_supply()) WITH CHECK (public.staff_manage_supply());
CREATE POLICY staff_supplier_delete ON public.suppliers AS RESTRICTIVE FOR DELETE TO authenticated USING (public.staff_manage_supply());

-- Keep existing product maintenance policies.
DROP POLICY IF EXISTS staff_product_insert ON public.products;
CREATE POLICY staff_product_insert ON public.products AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.staff_is_admin() AND public.staff_permissions()->>'inventory' = 'adjust');
DROP POLICY IF EXISTS staff_product_update ON public.products;
CREATE POLICY staff_product_update ON public.products AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.staff_is_admin() AND public.staff_permissions()->>'inventory' = 'adjust') WITH CHECK (public.staff_is_admin() AND public.staff_permissions()->>'inventory' = 'adjust');
DROP POLICY IF EXISTS staff_product_delete ON public.products;
CREATE POLICY staff_product_delete ON public.products AS RESTRICTIVE FOR DELETE TO authenticated USING (public.staff_is_admin() AND public.staff_permissions()->>'inventory' = 'adjust');
DROP POLICY IF EXISTS staff_inventory_delete ON public.inventory;
CREATE POLICY staff_inventory_delete ON public.inventory AS RESTRICTIVE FOR DELETE TO authenticated USING (public.staff_is_admin() AND public.staff_permissions()->>'inventory' = 'adjust' AND public.staff_warehouse_allowed("warehouseId"));
DROP POLICY IF EXISTS staff_transfer_delete ON public.transfers;
CREATE POLICY staff_transfer_delete ON public.transfers AS RESTRICTIVE FOR DELETE TO authenticated USING (public.staff_is_admin() AND public.staff_movement_allowed('internal', true) AND public.staff_warehouse_allowed("sourceWarehouseId") AND public.staff_warehouse_allowed("destinationWarehouseId"));

-- Both old (staff-only) and new account-service calls are protected by the same checks.
DROP FUNCTION IF EXISTS public.provision_staff_user(text,text,text,jsonb,text);
CREATE OR REPLACE FUNCTION public.provision_staff_user(p_uid text, p_email text, p_name text, p_permissions jsonb, p_admin_uid text, p_role text DEFAULT 'staff')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE new_user public.users; new_delegation public.delegations; actor_role text;
BEGIN
  SELECT role INTO actor_role FROM public.users WHERE uid = p_admin_uid FOR UPDATE;
  IF actor_role IS NULL OR actor_role <> 'admin' THEN RAISE EXCEPTION 'Administrator required.'; END IF;
  IF p_role IS DISTINCT FROM 'staff' THEN RAISE EXCEPTION 'The account service creates staff accounts only.'; END IF;
  IF NOT public.validate_staff_permissions(p_permissions) OR NOT public.staff_can_delegate(p_permissions, p_admin_uid) THEN RAISE EXCEPTION 'You cannot assign these permissions.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id::text = p_uid AND lower(email) = lower(btrim(p_email))) THEN RAISE EXCEPTION 'A matching login is required.'; END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE lower(btrim(email)) = lower(btrim(p_email))) THEN RAISE EXCEPTION 'An account already exists for this email.'; END IF;
  INSERT INTO public.users (uid, email, "displayName", role) VALUES (p_uid, lower(btrim(p_email)), btrim(p_name), p_role) RETURNING * INTO new_user;
  INSERT INTO public.delegations ("agentId", "staffEmail", "canAdjustInventory", "canAdjustPricelist", permissions, active)
    VALUES (p_admin_uid, lower(btrim(p_email)), p_permissions->>'inventory' = 'adjust', p_permissions->>'pricelist' = 'edit', p_permissions, true)
    ON CONFLICT (lower(btrim("staffEmail"))) DO UPDATE SET "agentId" = EXCLUDED."agentId", "canAdjustInventory" = EXCLUDED."canAdjustInventory",
      "canAdjustPricelist" = EXCLUDED."canAdjustPricelist", permissions = EXCLUDED.permissions, active = true RETURNING * INTO new_delegation;
  RETURN jsonb_build_object('user', to_jsonb(new_user), 'delegation', to_jsonb(new_delegation));
END;
$$;
REVOKE ALL ON FUNCTION public.provision_staff_user(text,text,text,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_staff_user(text,text,text,jsonb,text,text) TO service_role;


-- Restore the original order role allowlists if the obsolete migration expanded them.
DO $$
DECLARE signature regprocedure; definition text;
BEGIN
  FOREACH signature IN ARRAY ARRAY['public.create_order_entry(uuid,jsonb)'::regprocedure, 'public.transition_order_entry(uuid,text,text)'::regprocedure] LOOP
    definition := pg_get_functiondef(signature);
    definition := replace(definition, '''superadmin'', ', '');
    EXECUTE definition;
  END LOOP;
END;
$$;
DROP FUNCTION IF EXISTS public.staff_is_superadmin();
COMMIT;
