-- ═════════════════════════════════════════════════════════════════════════════
-- ACTIVE PRO — COMPLETE SUPABASE SCHEMA & RPC RECONCILIATION
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. Ensure inventory table has required tracking columns
ALTER TABLE IF EXISTS public.inventory 
ADD COLUMN IF NOT EXISTS "quarantineQuantity" INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "lastUpdated" TIMESTAMPTZ DEFAULT now();

-- 2. Ensure orders table has dispatch photo, audit, and reservation columns
ALTER TABLE IF EXISTS public.orders 
ADD COLUMN IF NOT EXISTS "orderNumber" TEXT,
ADD COLUMN IF NOT EXISTS "photoValidationUrl" TEXT,
ADD COLUMN IF NOT EXISTS "stockReserved" BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS "statusHistory" JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS "receiptDetails" JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS "allocationStrategy" TEXT DEFAULT 'FIFO',
ADD COLUMN IF NOT EXISTS skus TEXT[] DEFAULT '{}'::text[],
ADD COLUMN IF NOT EXISTS "deliveryDeadline" TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS "deliveryRegion" TEXT,
ADD COLUMN IF NOT EXISTS "deliveryCity" TEXT,
ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT DEFAULT 'unpaid',
ADD COLUMN IF NOT EXISTS "amountPaid" NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS "remainingBalance" NUMERIC,
ADD COLUMN IF NOT EXISTS "totalAmount" NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS "clientId" TEXT,
ADD COLUMN IF NOT EXISTS "clientName" TEXT,
ADD COLUMN IF NOT EXISTS "agentId" TEXT,
ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ DEFAULT now();

-- 3. Ensure order_items table exists (needed for transition_order_entry restocking and order creation)
CREATE TABLE IF NOT EXISTS public.order_items (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT,
    sku TEXT,
    name TEXT,
    unit TEXT DEFAULT 'pc',
    quantity INT NOT NULL DEFAULT 1,
    "unitPrice" NUMERIC DEFAULT 0,
    subtotal NUMERIC DEFAULT 0,
    "locationAisle" TEXT,
    "locationBin" TEXT,
    "entryDetails" JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    "createdAt" TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE IF EXISTS public.order_items
ADD COLUMN IF NOT EXISTS "orderId" TEXT,
ADD COLUMN IF NOT EXISTS "productId" TEXT,
ADD COLUMN IF NOT EXISTS "warehouseId" TEXT,
ADD COLUMN IF NOT EXISTS sku TEXT,
ADD COLUMN IF NOT EXISTS name TEXT,
ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'pc',
ADD COLUMN IF NOT EXISTS quantity INT DEFAULT 1,
ADD COLUMN IF NOT EXISTS "unitPrice" NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS subtotal NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS "locationAisle" TEXT,
ADD COLUMN IF NOT EXISTS "locationBin" TEXT,
ADD COLUMN IF NOT EXISTS "entryDetails" JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on order_items" ON public.order_items;
CREATE POLICY "Allow all on order_items" 
ON public.order_items FOR ALL 
USING (true) WITH CHECK (true);

-- 4. Ensure stockAdjustments table exists before function uses it
CREATE TABLE IF NOT EXISTS public."stockAdjustments" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "adjustmentAmount" INT NOT NULL,
    reason TEXT,
    "recordedBy" TEXT,
    timestamp TIMESTAMPTZ DEFAULT now(),
    "createdAt" TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE IF EXISTS public."stockAdjustments"
ADD COLUMN IF NOT EXISTS "productId" TEXT,
ADD COLUMN IF NOT EXISTS "warehouseId" TEXT,
ADD COLUMN IF NOT EXISTS "adjustmentAmount" INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS reason TEXT,
ADD COLUMN IF NOT EXISTS "recordedBy" TEXT,
ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ DEFAULT now();

ALTER TABLE public."stockAdjustments" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on stockAdjustments" ON public."stockAdjustments";
CREATE POLICY "Allow all on stockAdjustments" 
ON public."stockAdjustments" FOR ALL 
USING (true) WITH CHECK (true);

-- 5. Create defective_tickets table for ITIL Damaged Goods Quarantine
CREATE TABLE IF NOT EXISTS public.defective_tickets (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "ticketNumber" TEXT NOT NULL,
    "incidentId" TEXT,
    "productId" TEXT NOT NULL,
    sku TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    brand TEXT,
    "warehouseId" TEXT NOT NULL,
    "warehouseName" TEXT,
    quantity INT NOT NULL DEFAULT 1,
    "defectReason" TEXT NOT NULL,
    "loggedBy" TEXT,
    "loggedByName" TEXT,
    "photoUrl" TEXT,
    "supplierName" TEXT,
    status TEXT NOT NULL DEFAULT 'QUARANTINED',
    "resolutionNotes" TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    "createdAt" TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_defective_tickets_product ON public.defective_tickets("productId");
CREATE INDEX IF NOT EXISTS idx_defective_tickets_warehouse ON public.defective_tickets("warehouseId");
CREATE INDEX IF NOT EXISTS idx_defective_tickets_status ON public.defective_tickets(status);

ALTER TABLE public.defective_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to defective_tickets" ON public.defective_tickets;
CREATE POLICY "Allow all access to defective_tickets" 
ON public.defective_tickets FOR ALL 
USING (true) WITH CHECK (true);

-- 6. Create itil_incidents table for SLA & Defect Tracking
CREATE TABLE IF NOT EXISTS public.itil_incidents (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "ticketNumber" TEXT NOT NULL,
    "incidentType" TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'HIGH',
    status TEXT NOT NULL DEFAULT 'ESCALATED',
    "orderId" TEXT,
    "orderNumber" TEXT,
    "clientId" TEXT,
    "clientName" TEXT,
    "deliveryLocation" TEXT,
    "daysOverdue" INT DEFAULT 0,
    "assignedAgentId" TEXT,
    "assignedAgentName" TEXT,
    description TEXT,
    "rootCause" TEXT,
    "delayedCIs" JSONB DEFAULT '[]'::jsonb,
    "resolutionNotes" TEXT,
    "resolvedAt" TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    "createdAt" TIMESTAMPTZ DEFAULT now(),
    "updatedAt" TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE IF EXISTS public.itil_incidents
ADD COLUMN IF NOT EXISTS "rootCause" TEXT,
ADD COLUMN IF NOT EXISTS "delayedCIs" JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.itil_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to itil_incidents" ON public.itil_incidents;
CREATE POLICY "Allow all access to itil_incidents" 
ON public.itil_incidents FOR ALL 
USING (true) WITH CHECK (true);

-- 7. Ensure fleet, trips, and logistics tables exist
CREATE TABLE IF NOT EXISTS public.dispatch_trips (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    route_id TEXT,
    vehicle_id TEXT,
    vehicle_name TEXT,
    plate TEXT,
    driver TEXT,
    region TEXT,
    total_units INT DEFAULT 0,
    savings_php NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'in_transit',
    dispatched_at TIMESTAMPTZ DEFAULT now(),
    dispatched_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.dispatch_trips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on dispatch_trips" ON public.dispatch_trips;
CREATE POLICY "Allow all on dispatch_trips" ON public.dispatch_trips FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.trip_orders (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    trip_id TEXT,
    order_id TEXT,
    order_number TEXT,
    client_name TEXT,
    delivery_city TEXT,
    stop_sequence INT DEFAULT 1,
    units INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.trip_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on trip_orders" ON public.trip_orders;
CREATE POLICY "Allow all on trip_orders" ON public.trip_orders FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.traffic_incidents (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    type TEXT DEFAULT 'accident',
    corridor TEXT,
    delay_minutes INT DEFAULT 0,
    reporter TEXT,
    bypass_route TEXT,
    time_saved_minutes INT DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.traffic_incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on traffic_incidents" ON public.traffic_incidents;
CREATE POLICY "Allow all on traffic_incidents" ON public.traffic_incidents FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.fleet_vehicles (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    plate TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'truck',
    capacity INT DEFAULT 80,
    status TEXT DEFAULT 'available',
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.fleet_vehicles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on fleet_vehicles" ON public.fleet_vehicles;
CREATE POLICY "Allow all on fleet_vehicles" ON public.fleet_vehicles FOR ALL USING (true) WITH CHECK (true);

-- 8. Ensure expenses table exists for P&L Ledger
CREATE TABLE IF NOT EXISTS public.expenses (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    category TEXT NOT NULL,
    description TEXT,
    amount NUMERIC NOT NULL,
    date TIMESTAMPTZ DEFAULT now(),
    "orderId" TEXT,
    "recordedBy" TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE IF EXISTS public.expenses
ADD COLUMN IF NOT EXISTS "orderId" TEXT,
ADD COLUMN IF NOT EXISTS "recordedBy" TEXT;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on expenses" ON public.expenses;
CREATE POLICY "Allow all on expenses" ON public.expenses FOR ALL USING (true) WITH CHECK (true);

-- 9. Ensure delegations table exists for staff permissions
CREATE TABLE IF NOT EXISTS public.delegations (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "agentId" TEXT,
    "staffEmail" TEXT NOT NULL,
    "canAdjustInventory" BOOLEAN DEFAULT false,
    "canAdjustPricelist" BOOLEAN DEFAULT false,
    permissions JSONB DEFAULT '{}'::jsonb,
    active BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE IF EXISTS public.delegations
ADD COLUMN IF NOT EXISTS "agentId" TEXT,
ADD COLUMN IF NOT EXISTS "staffEmail" TEXT,
ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
ALTER TABLE public.delegations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on delegations" ON public.delegations;
CREATE POLICY "Allow all on delegations" ON public.delegations FOR ALL USING (true) WITH CHECK (true);

-- 10. Ensure transfers table exists with all dispatch and reception audit columns
CREATE TABLE IF NOT EXISTS public.transfers (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "sourceWarehouseId" TEXT NOT NULL,
    "destinationWarehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    quantity INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    "initiatedBy" TEXT,
    "driverName" TEXT,
    "vehiclePlate" TEXT,
    "dispatchedAt" TIMESTAMPTZ,
    "dispatchedBy" TEXT,
    "receivedAt" TIMESTAMPTZ,
    "receivedBy" TEXT,
    "cancellationReason" TEXT,
    "cancelledAt" TIMESTAMPTZ,
    "cancelledBy" TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    "createdAt" TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    "updatedAt" TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE IF EXISTS public.transfers
ADD COLUMN IF NOT EXISTS "driverName" TEXT,
ADD COLUMN IF NOT EXISTS "vehiclePlate" TEXT,
ADD COLUMN IF NOT EXISTS "dispatchedAt" TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS "dispatchedBy" TEXT,
ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS "receivedBy" TEXT,
ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT,
ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS "cancelledBy" TEXT,
ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on transfers" ON public.transfers;
CREATE POLICY "Allow all on transfers" ON public.transfers FOR ALL USING (true) WITH CHECK (true);

-- 10b. Ensure inventory_movements table columns for payment balance tracking
ALTER TABLE IF EXISTS public.inventory_movements
ADD COLUMN IF NOT EXISTS amountPaid NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS remainingBalance NUMERIC,
ADD COLUMN IF NOT EXISTS lastUpdated TIMESTAMPTZ DEFAULT now();

-- 10c. Ensure customers table exists for multi-user persistent customer directory
CREATE TABLE IF NOT EXISTS public.customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    contact TEXT,
    phone TEXT,
    terms TEXT,
    viber TEXT,
    messenger TEXT,
    email TEXT,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "bankAccountName" TEXT,
    "bankBranchAddress" TEXT,
    "paymentNotes" TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    "createdAt" TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    "updatedAt" TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on customers" ON public.customers;
CREATE POLICY "Allow all on customers" ON public.customers FOR ALL USING (true) WITH CHECK (true);

-- 11. Fix orders table RLS policies
ALTER TABLE IF EXISTS public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public and staff update on orders" ON public.orders;
CREATE POLICY "Allow public and staff update on orders" 
ON public.orders FOR UPDATE 
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public and staff insert on orders" ON public.orders;
CREATE POLICY "Allow public and staff insert on orders" 
ON public.orders FOR INSERT 
WITH CHECK (true);

-- 12. Recreate transition_order_entry RPC cleanly
DROP FUNCTION IF EXISTS public.transition_order_entry(uuid, text, text);
DROP FUNCTION IF EXISTS public.transition_order_entry(text, text, text);

CREATE OR REPLACE FUNCTION public.transition_order_entry(
  p_order_id text, 
  p_status text, 
  p_photo_url text DEFAULT NULL
)
RETURNS jsonb 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, pg_temp 
AS $$
DECLARE
  v_uid text := coalesce(nullif(auth.uid()::text, ''), 'system');
  v_user text := 'System / Staff';
  v_order_number text;
  v_current_status text;
  v_stock_reserved boolean;
  v_line record;
  v_inventory_id text;
  v_note text;
  v_result jsonb;
BEGIN
  -- 1. Query order using scalar variables (prevents relation "v_order" does not exist)
  SELECT 
    coalesce("orderNumber", id::text), 
    status, 
    coalesce("stockReserved", true)
  INTO 
    v_order_number, 
    v_current_status, 
    v_stock_reserved
  FROM public.orders 
  WHERE id::text = p_order_id 
  FOR UPDATE;

  IF NOT FOUND THEN 
    RAISE EXCEPTION 'Order % was not found.', p_order_id; 
  END IF;

  -- If status is already up-to-date, return current row
  IF v_current_status = p_status THEN 
    SELECT to_jsonb(orders.*) INTO v_result 
    FROM public.orders 
    WHERE id::text = p_order_id;
    RETURN v_result; 
  END IF;

  v_note := 'Status updated to ' || replace(p_status, '_', ' ');

  -- 2. Restock inventory if order is cancelled or escalated
  IF p_status IN ('cancelled', 'escalated') AND v_stock_reserved THEN
    FOR v_line IN 
      SELECT "productId", "warehouseId", sum(quantity)::integer AS quantity 
      FROM public.order_items 
      WHERE "orderId"::text = p_order_id 
      GROUP BY "productId", "warehouseId" 
    LOOP
      SELECT id::text INTO v_inventory_id 
      FROM public.inventory 
      WHERE "productId"::text = v_line."productId"::text
        AND (nullif(v_line."warehouseId", '') IS NULL OR "warehouseId"::text = v_line."warehouseId"::text) 
      ORDER BY id 
      LIMIT 1;

      IF v_inventory_id IS NOT NULL THEN 
        UPDATE public.inventory 
        SET quantity = quantity + v_line.quantity, 
            "lastUpdated" = now() 
        WHERE id::text = v_inventory_id;

        INSERT INTO public."stockAdjustments" (
          "productId", 
          "warehouseId", 
          "adjustmentAmount", 
          reason, 
          "recordedBy", 
          timestamp
        )
        VALUES (
          v_line."productId", 
          v_line."warehouseId", 
          v_line.quantity, 
          'Order ' || coalesce(v_order_number, p_order_id) || ' ' || p_status || ': stock replenishment', 
          v_uid, 
          now()
        );
      END IF;
    END LOOP;
    
    v_stock_reserved := false;
    v_note := v_note || '; stock restored to source warehouses.';
  END IF;

  -- 3. Update order record
  UPDATE public.orders SET 
    status = p_status, 
    "updatedAt" = now(), 
    "stockReserved" = v_stock_reserved,
    "photoValidationUrl" = CASE 
      WHEN p_status = 'out_for_delivery' THEN coalesce(nullif(p_photo_url, ''), "photoValidationUrl") 
      ELSE "photoValidationUrl" 
    END,
    "statusHistory" = coalesce("statusHistory", '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'status', p_status, 
        'changedBy', v_user, 
        'timestamp', now(), 
        'note', v_note
      )
    )
  WHERE id::text = p_order_id;

  -- 4. Return the updated row as jsonb
  SELECT to_jsonb(orders.*) INTO v_result 
  FROM public.orders 
  WHERE id::text = p_order_id;

  RETURN v_result;
END;
$$;

-- Grant execution to authenticated and anon users
GRANT EXECUTE ON FUNCTION public.transition_order_entry(text, text, text) TO authenticated, anon;

-- 13. Create or replace confirm_inventory_movement RPC for atomic server-side movements
DROP FUNCTION IF EXISTS public.confirm_inventory_movement(text, jsonb);
DROP FUNCTION IF EXISTS public.confirm_inventory_movement(text, json);

CREATE OR REPLACE FUNCTION public.confirm_inventory_movement(
  p_request_id text,
  p_movement jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mov_id text := coalesce(p_request_id, gen_random_uuid()::text);
  v_type text := coalesce(p_movement->>'type', 'external');
  v_dest_wh text := p_movement->>'destinationWarehouseId';
  v_source_wh text := p_movement->>'sourceWarehouseId';
  v_supplier_id text := p_movement->>'supplierId';
  v_invoice text := coalesce(p_movement->>'invoiceNumber', '');
  v_driver text := coalesce(p_movement->>'driverName', '');
  v_plate text := coalesce(p_movement->>'vehiclePlate', '');
  v_notes text := coalesce(p_movement->>'notes', '');
  v_recorded_by text := coalesce(p_movement->>'recordedBy', auth.uid()::text, 'system');
  v_item record;
  v_total_val numeric := 0;
  v_today_str text := to_char(now(), 'YYYYMMDD');
  v_seq text := lpad((floor(random() * 899 + 100))::text, 3, '0');
  v_mov_number text := 'MOV-' || v_today_str || '-' || v_seq;
  v_inv_id text;
  v_expense_id text;
  v_result jsonb;
BEGIN
  -- 1. Calculate total value
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_movement->'items') AS x(
    "productId" text,
    quantity int,
    "unitCost" numeric,
    "supplierLot" text
  )
  LOOP
    v_total_val := v_total_val + (coalesce(v_item.quantity, 0) * coalesce(v_item."unitCost", 0));
  END LOOP;

  -- 2. If external purchase, create expense entry
  IF v_type = 'external' AND v_total_val > 0 THEN
    INSERT INTO public.expenses (
      category,
      amount,
      description,
      date,
      "recordedBy"
    )
    VALUES (
      'Inventory Purchase',
      v_total_val,
      v_mov_number || ' · Purchase Receipt · Invoice ' || v_invoice,
      now(),
      v_recorded_by
    )
    RETURNING id::text INTO v_expense_id;
  END IF;

  -- 3. Insert into public.inventory_movements
  INSERT INTO public.inventory_movements (
    id,
    "movementNumber",
    type,
    "supplierId",
    "sourceWarehouseId",
    "destinationWarehouseId",
    items,
    "totalValue",
    "invoiceNumber",
    "driverName",
    "vehiclePlate",
    notes,
    status,
    "recordedBy",
    "expenseId",
    "createdAt",
    "lastUpdated"
  )
  VALUES (
    v_mov_id,
    v_mov_number,
    v_type,
    v_supplier_id,
    v_source_wh,
    v_dest_wh,
    p_movement->'items',
    v_total_val,
    v_invoice,
    v_driver,
    v_plate,
    v_notes,
    'confirmed',
    v_recorded_by,
    v_expense_id,
    now(),
    now()
  );

  -- 4. Process each item: adjust inventory & write stock adjustments
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_movement->'items') AS x(
    "productId" text,
    quantity int,
    "unitCost" numeric,
    "supplierLot" text
  )
  LOOP
    IF v_type = 'external' THEN
      SELECT id::text INTO v_inv_id
      FROM public.inventory
      WHERE "productId"::text = v_item."productId"::text
        AND "warehouseId"::text = v_dest_wh::text
      LIMIT 1;

      IF v_inv_id IS NOT NULL THEN
        UPDATE public.inventory
        SET quantity = quantity + v_item.quantity,
            "lastUpdated" = now()
        WHERE id::text = v_inv_id;
      ELSE
        INSERT INTO public.inventory ("productId", "warehouseId", quantity, "lastUpdated")
        VALUES (v_item."productId", v_dest_wh, v_item.quantity, now());
      END IF;

      INSERT INTO public."stockAdjustments" (
        "productId",
        "warehouseId",
        "adjustmentAmount",
        reason,
        "recordedBy",
        timestamp
      )
      VALUES (
        v_item."productId",
        v_dest_wh,
        v_item.quantity,
        v_mov_number || ' external receipt',
        v_recorded_by,
        now()
      );
    ELSE
      IF v_source_wh IS NOT NULL THEN
        SELECT id::text INTO v_inv_id
        FROM public.inventory
        WHERE "productId"::text = v_item."productId"::text
          AND "warehouseId"::text = v_source_wh::text
        LIMIT 1;

        IF v_inv_id IS NOT NULL THEN
          UPDATE public.inventory
          SET quantity = greatest(0, quantity - v_item.quantity),
              "lastUpdated" = now()
          WHERE id::text = v_inv_id;
        END IF;

        INSERT INTO public."stockAdjustments" (
          "productId",
          "warehouseId",
          "adjustmentAmount",
          reason,
          "recordedBy",
          timestamp
        )
        VALUES (
          v_item."productId",
          v_source_wh,
          -v_item.quantity,
          v_mov_number || ' internal transfer sent',
          v_recorded_by,
          now()
        );
      END IF;

      SELECT id::text INTO v_inv_id
      FROM public.inventory
      WHERE "productId"::text = v_item."productId"::text
        AND "warehouseId"::text = v_dest_wh::text
      LIMIT 1;

      IF v_inv_id IS NOT NULL THEN
        UPDATE public.inventory
        SET quantity = quantity + v_item.quantity,
            "lastUpdated" = now()
        WHERE id::text = v_inv_id;
      ELSE
        INSERT INTO public.inventory ("productId", "warehouseId", quantity, "lastUpdated")
        VALUES (v_item."productId", v_dest_wh, v_item.quantity, now());
      END IF;

      INSERT INTO public."stockAdjustments" (
        "productId",
        "warehouseId",
        "adjustmentAmount",
        reason,
        "recordedBy",
        timestamp
      )
      VALUES (
        v_item."productId",
        v_dest_wh,
        v_item.quantity,
        v_mov_number || ' internal transfer received',
        v_recorded_by,
        now()
      );
    END IF;
  END LOOP;

  -- 5. Return created movement record
  SELECT to_jsonb(im.*) INTO v_result
  FROM public.inventory_movements im
  WHERE id::text = v_mov_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_inventory_movement(text, jsonb) TO authenticated, anon;

-- Return successful execution status
SELECT 'Migration executed successfully!' AS status, now() AS executed_at;

