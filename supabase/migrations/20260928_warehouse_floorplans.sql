-- Visual UI positions only; no physical dimensions or inventory changes.
BEGIN;
CREATE TABLE public.warehouse_floorplans (
  "warehouseId" uuid PRIMARY KEY REFERENCES public.warehouses(id) ON DELETE CASCADE,
  layout jsonb NOT NULL CHECK (
    jsonb_typeof(layout) = 'object'
    AND layout ? 'boxes' AND jsonb_typeof(layout->'boxes') = 'object'
    AND layout ? 'doors' AND jsonb_typeof(layout->'doors') = 'array'
    AND octet_length(layout::text) <= 262144
  )
);
ALTER TABLE public.warehouse_floorplans ENABLE ROW LEVEL SECURITY;
CREATE POLICY floorplan_read ON public.warehouse_floorplans FOR SELECT TO authenticated
  USING (public.staff_warehouse_allowed("warehouseId"::text));
CREATE POLICY floorplan_insert ON public.warehouse_floorplans FOR INSERT TO authenticated
  WITH CHECK (public.staff_warehouse_allowed("warehouseId"::text) AND coalesce(public.staff_permissions()->>'inventory', '') = 'adjust');
CREATE POLICY floorplan_update ON public.warehouse_floorplans FOR UPDATE TO authenticated
  USING (public.staff_warehouse_allowed("warehouseId"::text) AND coalesce(public.staff_permissions()->>'inventory', '') = 'adjust')
  WITH CHECK (public.staff_warehouse_allowed("warehouseId"::text) AND coalesce(public.staff_permissions()->>'inventory', '') = 'adjust');
REVOKE ALL ON public.warehouse_floorplans FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.warehouse_floorplans TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
