-- ==============================================================================
-- Migration: 202610160001_security_and_atomicity.sql
-- Description:
--   1. Protects the `role` column on public.users from self-promotion.
--   2. Provides a SECURITY DEFINER RPC `admin_set_user_role` for authorized role changes.
--   3. Provides an atomic inventory adjustment RPC `adjust_inventory_atomic` to prevent
--      lost updates, race conditions, and ghost inventory.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Trigger: Prevent Self-Promotion on public.users
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_user_role_update()
RETURNS TRIGGER AS $$
DECLARE
  v_caller_role TEXT;
BEGIN
  -- If role has not changed, allow update
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    -- Allow service_role to make updates (e.g. backend or migration scripts)
    IF (auth.jwt() ->> 'role') != 'service_role' THEN
      -- Fetch the caller's role from public.users using auth.uid()
      SELECT role INTO v_caller_role
      FROM public.users
      WHERE uid = auth.uid();

      -- Only callers with role 'admin' can alter the role column
      IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Access Denied: Non-admin users cannot alter user roles (Self-Promotion violation).';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_user_role ON public.users;
CREATE TRIGGER trg_protect_user_role
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.check_user_role_update();

-- ------------------------------------------------------------------------------
-- 2. Privileged RPC: Admin Set User Role
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  p_target_uid UUID,
  p_new_role TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_caller_role TEXT;
BEGIN
  -- Verify caller is admin
  IF (auth.jwt() ->> 'role') != 'service_role' THEN
    SELECT role INTO v_caller_role
    FROM public.users
    WHERE uid = auth.uid();

    IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
      RAISE EXCEPTION 'Access Denied: Only administrators can update staff roles.';
    END IF;
  END IF;

  -- Validate role value
  IF p_new_role NOT IN ('admin', 'secretary', 'agent', 'staff') THEN
    RAISE EXCEPTION 'Invalid role specified: %', p_new_role;
  END IF;

  -- Update target user
  UPDATE public.users
  SET role = p_new_role, updated_at = NOW()
  WHERE uid = p_target_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user not found: %', p_target_uid;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'uid', p_target_uid,
    'role', p_new_role
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------------------------
-- 3. Atomic RPC: adjust_inventory_atomic (Prevents Lost Updates & Ghost Inventory)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_inventory_atomic(
  p_product_id TEXT,
  p_warehouse_id TEXT,
  p_delta INT,
  p_recorded_by TEXT,
  p_reason TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_current_qty INT;
  v_new_qty INT;
  v_inv_id TEXT;
BEGIN
  -- Row-level lock to prevent concurrent race conditions
  SELECT id, quantity INTO v_inv_id, v_current_qty
  FROM public.inventory
  WHERE "productId" = p_product_id AND "warehouseId" = p_warehouse_id
  FOR UPDATE;

  IF v_current_qty IS NULL THEN
    IF p_delta < 0 THEN
      RAISE EXCEPTION 'Insufficient inventory: product not found in source facility.';
    END IF;

    v_inv_id := 'inv-' || gen_random_uuid();
    v_new_qty := p_delta;

    INSERT INTO public.inventory(id, "productId", "warehouseId", quantity, "lastUpdated")
    VALUES (v_inv_id, p_product_id, p_warehouse_id, v_new_qty, NOW());
  ELSE
    IF v_current_qty + p_delta < 0 THEN
      RAISE EXCEPTION 'Insufficient stock. Current: %, requested reduction: %', v_current_qty, -p_delta;
    END IF;

    v_new_qty := v_current_qty + p_delta;

    UPDATE public.inventory
    SET quantity = v_new_qty, "lastUpdated" = NOW()
    WHERE id = v_inv_id;
  END IF;

  -- Record audit log entry in stockAdjustments
  INSERT INTO public."stockAdjustments"(
    id,
    "productId",
    "warehouseId",
    "adjustmentAmount",
    reason,
    "recordedBy",
    timestamp
  )
  VALUES (
    'adj-' || gen_random_uuid(),
    p_product_id,
    p_warehouse_id,
    p_delta,
    p_reason,
    p_recorded_by,
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'inventoryId', v_inv_id,
    'previousQuantity', COALESCE(v_current_qty, 0),
    'newQuantity', v_new_qty,
    'delta', p_delta
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
