-- Apply after 20260925_role_presets.sql. No changes to stock, financial, or staff access logic.
BEGIN;
CREATE OR REPLACE FUNCTION public.staff_can_create_admin(p_actor text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u JOIN auth.users a ON a.id::text = u.uid
    WHERE u.uid = p_actor AND u.role = 'admin'
      AND lower(btrim(a.email)) = 'admin@example.com' AND a.email_confirmed_at IS NOT NULL
  );
$$;
REVOKE ALL ON FUNCTION public.staff_can_create_admin(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_can_create_admin(text) TO service_role;

-- Protect the same rule against direct profile inserts/updates, not just the account service.
CREATE OR REPLACE FUNCTION public.guard_staff_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.role = 'admin' AND NOT public.staff_can_create_admin(auth.uid()::text) THEN
        RAISE EXCEPTION 'Only admin@example.com can create another admin.';
      END IF;
      IF NOT public.staff_is_admin() AND (NEW.uid <> auth.uid()::text OR NEW.role <> 'agent' OR lower(NEW.email) <> lower(auth.jwt()->>'email')) THEN
        RAISE EXCEPTION 'Invalid account identity.';
      END IF;
    ELSE
      IF NEW.role = 'admin' AND OLD.role IS DISTINCT FROM 'admin' AND NOT public.staff_can_create_admin(auth.uid()::text) THEN
        RAISE EXCEPTION 'Only admin@example.com can assign the admin role.';
      END IF;
      IF NOT public.staff_can_create_admin(auth.uid()::text) AND
        (NEW.uid IS DISTINCT FROM OLD.uid OR NEW.email IS DISTINCT FROM OLD.email OR (OLD.role = 'admin' AND NEW.role IS DISTINCT FROM OLD.role)) THEN
        RAISE EXCEPTION 'Account identity and administrator roles are protected.';
      END IF;
      IF NOT public.staff_is_admin() AND NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'Only administrators can change account roles.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.provision_staff_user(p_uid text, p_email text, p_name text, p_permissions jsonb, p_admin_uid text, p_role text DEFAULT 'staff')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE new_user public.users; new_delegation public.delegations; actor_role text;
BEGIN
  SELECT role INTO actor_role FROM public.users WHERE uid = p_admin_uid FOR UPDATE;
  IF actor_role IS NULL OR actor_role <> 'admin' THEN RAISE EXCEPTION 'Administrator required.'; END IF;
  IF p_role IS NULL OR p_role NOT IN ('admin', 'secretary', 'agent', 'staff') THEN RAISE EXCEPTION 'Choose a valid account role.'; END IF;
  IF p_role = 'admin' AND NOT public.staff_can_create_admin(p_admin_uid) THEN RAISE EXCEPTION 'Only admin@example.com can create another admin.'; END IF;
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




COMMIT;
