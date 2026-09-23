-- Apply after 20260924_single_admin.sql. Role presets are saved as editable permissions.
BEGIN;
CREATE OR REPLACE FUNCTION public.set_staff_role_access(p_uid text, p_role text, p_permissions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target public.users; saved jsonb;
BEGIN
  IF NOT public.staff_is_admin() THEN RAISE EXCEPTION 'Only the admin can assign roles and permissions.'; END IF;
  IF p_role IS NULL OR p_role NOT IN ('secretary','agent','staff') THEN RAISE EXCEPTION 'Choose a non-admin role.'; END IF;
  SELECT * INTO target FROM public.users WHERE uid = p_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This user account no longer exists.'; END IF;
  IF target.role = 'admin' OR target.uid = auth.uid()::text THEN RAISE EXCEPTION 'The administrator account cannot be changed here.'; END IF;
  -- Existing validation and delegation save run in the same transaction as the role change.
  saved := public.set_staff_access(p_uid, p_permissions, true);
  UPDATE public.users SET role = p_role WHERE uid = p_uid;
  RETURN saved;
END;
$$;
REVOKE ALL ON FUNCTION public.set_staff_role_access(text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_staff_role_access(text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.provision_staff_user(p_uid text, p_email text, p_name text, p_permissions jsonb, p_admin_uid text, p_role text DEFAULT 'staff')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE new_user public.users; new_delegation public.delegations; actor_role text;
BEGIN
  SELECT role INTO actor_role FROM public.users WHERE uid = p_admin_uid FOR UPDATE;
  IF actor_role IS NULL OR actor_role <> 'admin' THEN RAISE EXCEPTION 'Administrator required.'; END IF;
  IF p_role IS NULL OR p_role NOT IN ('secretary', 'agent', 'staff') THEN RAISE EXCEPTION 'Choose a non-admin account role.'; END IF;
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
