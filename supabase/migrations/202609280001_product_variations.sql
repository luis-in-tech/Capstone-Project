-- Apply to the Supabase database used by VITE_SUPABASE_URL (not the backup-service Prisma database).
-- Existing product/inventory RLS policies remain in force: this RPC is SECURITY INVOKER.
begin;
alter table public.products add column if not exists "hasVariations" boolean not null default false;
alter table public.products add column if not exists "variationAttributes" jsonb not null default '[]';
alter table public.products add column if not exists "variantValues" jsonb not null default '{}';
alter table public.products add column if not exists "variantEnabled" boolean not null default true;
-- Match the existing ID type, whether this installation uses text or UUIDs.
do $$ declare id_type text; begin
  select format_type(atttypid, atttypmod) into id_type from pg_attribute where attrelid = 'public.products'::regclass and attname = 'id';
  execute format('alter table public.products add column if not exists "parentProductId" %s references public.products(id)', id_type);
end $$;
create index if not exists products_parent_product_idx on public.products ("parentProductId");

-- Keep stock on leaf products even when an existing workflow writes inventory directly.
create or replace function public.require_variant_stock() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if new.quantity <> 0 and exists(select 1 from public.products where id = new."productId" and "hasVariations") then
    raise exception 'Select a specific variant when changing stock for this product.';
  end if;
  return new;
end $$;
drop trigger if exists inventory_require_variant on public.inventory;
create trigger inventory_require_variant before insert or update on public.inventory for each row execute function public.require_variant_stock();

create or replace function public.save_product_variations(parent_data jsonb, variant_data jsonb)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  payload jsonb; row_data jsonb; existing public.products%rowtype;
  parent_id text := parent_data->>'id';
  cols text; vals text; assignments text; affected integer; field text;
  allowed text[] := array['id','sku','name','category','supplier','photoUrl','basePrice','mmPrice','wholesalePrice','provincialPrice','dealerPrice','costPrice','promoPrice','minStockLevel','reorderPoint','createdAt','updatedAt','hasVariations','variationAttributes','parentProductId','variantValues','variantEnabled'];
begin
  if auth.uid() is null then raise exception 'Sign in to manage products.'; end if;
  if parent_id is null or jsonb_typeof(variant_data) <> 'array' then raise exception 'Invalid product data.'; end if;
  -- Serialize catalog writes while checking SKUs and conversion stock. RLS still applies.
  lock table public.products in share row exclusive mode;
  lock table public.inventory in share row exclusive mode;
  select * into existing from public.products where id::text = parent_id;
  if existing."parentProductId" is not null then raise exception 'Edit variants through their parent product.'; end if;
  if coalesce(existing."hasVariations", false) <> coalesce((parent_data->>'hasVariations')::boolean, false) then
    if exists(select 1 from public.inventory i where i.quantity <> 0 and
      (i."productId"::text = parent_id or i."productId" in (select id from public.products where "parentProductId"::text = parent_id))) then
      raise exception 'Clear existing stock through Adjust Stock before changing variation mode.';
    end if;
  end if;
  if (parent_data->>'hasVariations')::boolean then
    if jsonb_array_length(parent_data->'variationAttributes') not between 1 and 3 then raise exception 'Use one to three attributes.'; end if;
    if not exists(select 1 from jsonb_array_elements(variant_data) v where (v->>'variantEnabled')::boolean) then raise exception 'Enable at least one variant.'; end if;
  end if;
  if exists(select 1 from public.products p where p."parentProductId"::text = parent_id and not exists(select 1 from jsonb_array_elements(variant_data) v where v->>'id' = p.id::text)) then
    raise exception 'A saved variant is missing. Reload the product and try again.';
  end if;
  if exists(select 1 from jsonb_array_elements(variant_data) v where v->>'id' = parent_id or v->>'parentProductId' is distinct from parent_id) then raise exception 'Invalid variant parent.'; end if;
  if exists(select 1 from jsonb_array_elements(variant_data) v join public.products p on p.id::text = v->>'id' where p."parentProductId"::text is distinct from parent_id) then raise exception 'Variant belongs to another product.'; end if;
  if exists(select 1 from jsonb_array_elements(variant_data) v group by v->>'id' having count(*) > 1) then raise exception 'Duplicate variant identity.'; end if;
  payload := jsonb_build_array(parent_data - 'parentProductId') || variant_data;
  if exists(select 1 from jsonb_array_elements(payload) p group by lower(trim(p->>'sku')) having count(*) > 1) then raise exception 'Every SKU must be unique.'; end if;
  for row_data in select value from jsonb_array_elements(payload) loop
    if coalesce(trim(row_data->>'sku'), '') = '' then raise exception 'SKU is required.'; end if;
    if exists(select 1 from public.products p where lower(trim(p.sku)) = lower(trim(row_data->>'sku')) and p.id::text <> row_data->>'id') then raise exception 'SKU already exists: %', row_data->>'sku'; end if;
    foreach field in array array['basePrice','mmPrice','provincialPrice','costPrice','promoPrice','minStockLevel','reorderPoint'] loop
      if row_data->>field is not null and ((row_data->>field)::numeric < 0 or (row_data->>field)::numeric::text in ('NaN','Infinity','-Infinity')) then raise exception 'Prices and stock thresholds must be non-negative.'; end if;
    end loop;
    if not exists(select 1 from public.products where id::text = row_data->>'id') then
      row_data := jsonb_build_object('createdAt', now()) || row_data;
      select string_agg(format('%I', key), ', '), string_agg(format('r.%I', key), ', ') into cols, vals from jsonb_object_keys(row_data) key where key = any(allowed);
      execute format('insert into public.products (%s) select %s from jsonb_populate_record(null::public.products, $1) r', cols, vals) using row_data;
    else
      select string_agg(format('%1$I = r.%1$I', key), ', ') into assignments from jsonb_object_keys(row_data) key where key = any(allowed) and key not in ('id','createdAt');
      execute format('update public.products p set %s from jsonb_populate_record(null::public.products, $1) r where p.id = r.id', assignments) using row_data;
      get diagnostics affected = row_count;
      if affected <> 1 then raise exception 'Product update was denied.'; end if;
    end if;
    -- Use the same productId/warehouseId/quantity records as ordinary products.
    insert into public.inventory ("productId", "warehouseId", quantity, "lastUpdated")
      select r."productId", r."warehouseId", r.quantity, r."lastUpdated"
      from public.warehouses w
      cross join lateral jsonb_populate_record(null::public.inventory, jsonb_build_object('productId', row_data->>'id', 'warehouseId', w.id, 'quantity', 0, 'lastUpdated', now())) r
      where not exists(select 1 from public.inventory i where i."productId" = r."productId" and i."warehouseId" = r."warehouseId");
  end loop;
end $$;
revoke all on function public.save_product_variations(jsonb, jsonb) from public, anon;
grant execute on function public.save_product_variations(jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
