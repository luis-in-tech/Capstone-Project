-- Receipt identifiers are generated in the same transaction as stock and expenses.
begin;
create table public.receipt_product_numbers (
  product_id text primary key,
  number bigint generated always as identity unique,
  category_code text not null
);
create table public.receipt_batch_sequences (
  product_id text not null,
  received_date date not null,
  sequence integer not null,
  primary key (product_id, received_date)
);
revoke all on public.receipt_product_numbers, public.receipt_batch_sequences from public, anon, authenticated;
alter table public.receipt_product_numbers enable row level security;
alter table public.receipt_batch_sequences enable row level security;

create function public.assign_receipt_batches() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  line jsonb; lines jsonb := '[]'; metadata jsonb;
  received date; product_number bigint; prefix text; seq integer; category_name text;
begin
  if tg_op = 'UPDATE' then
    if old.type = 'external' and (new.items is distinct from old.items or new."createdAt" is distinct from old."createdAt"
       or new.type is distinct from old.type) then
      raise exception 'Confirmed receipt batches cannot be edited.';
    end if;
    return new;
  end if;
  if new.type <> 'external' then return new; end if;
  metadata := coalesce(nullif(current_setting('app.receipt_metadata', true), '')::jsonb, '{}');
  received := coalesce(nullif(metadata->>'receivedDate', '')::date, (now() at time zone 'Asia/Manila')::date);
  if received > (now() at time zone 'Asia/Manila')::date then raise exception 'Received date cannot be in the future.'; end if;
  for line in select value from jsonb_array_elements(new.items) loop
    select category into category_name from public.products where id::text = line->>'productId';
    if not found then raise exception 'Receipt product does not exist.'; end if;
    prefix := case when category_name ilike '%brake%' then 'BRK'
      else coalesce(nullif(left(regexp_replace(upper(category_name), '[^A-Z0-9]', '', 'g'), 3), ''), 'PRD') end;
    insert into public.receipt_product_numbers (product_id, category_code)
      values (line->>'productId', prefix) on conflict do nothing;
    select number, category_code into product_number, prefix from public.receipt_product_numbers where product_id = line->>'productId';
    insert into public.receipt_batch_sequences values (line->>'productId', received, 1)
      on conflict (product_id, received_date) do update set sequence = receipt_batch_sequences.sequence + 1
      returning sequence into seq;
    lines := lines || jsonb_build_array(line || jsonb_build_object(
      'batchId', gen_random_uuid(),
      'batchCode', prefix || '-' || lpad(product_number::text, greatest(6, length(product_number::text)), '0') || '-' || to_char(received, 'YYYYMMDD') || '-' || lpad(seq::text, greatest(2, length(seq::text)), '0'),
      'receivedDate', received,
      'supplierLot', coalesce((select x->>'supplierLot' from jsonb_array_elements(coalesce(metadata->'items', '[]')) x where x->>'productId' = line->>'productId' limit 1), '')
    ));
  end loop;
  new.items := lines;
  return new;
end $$;
revoke all on function public.assign_receipt_batches() from public, anon, authenticated;
create trigger assign_receipt_batches before insert or update on public.inventory_movements
  for each row execute function public.assign_receipt_batches();

-- Delegate authorization, stock, expenses and retry handling to the existing RPCs.
create function public.confirm_receipt_movement(p_request_id uuid, p_movement jsonb, p_with_zones boolean default false)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to receive stock.'; end if;
  if p_movement->>'type' is distinct from 'external' then raise exception 'Expected a supplier receipt.'; end if;
  perform set_config('app.receipt_metadata', p_movement::text, true);
  if p_with_zones then
    execute 'select to_jsonb(public.confirm_inventory_movement_with_zones($1, $2))' into result using p_request_id, p_movement;
  else
    execute 'select to_jsonb(public.confirm_inventory_movement($1, $2))' into result using p_request_id, p_movement;
  end if;
  perform set_config('app.receipt_metadata', '', true);
  -- Read persisted values even when the underlying RPC returns its original payload.
  select to_jsonb(m) into result from public.inventory_movements m where m.id::text = result->>'id';
  if result is null then raise exception 'Saved receipt could not be read.'; end if;
  return result;
end $$;
revoke all on function public.confirm_receipt_movement(uuid, jsonb, boolean) from public, anon;
grant execute on function public.confirm_receipt_movement(uuid, jsonb, boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
