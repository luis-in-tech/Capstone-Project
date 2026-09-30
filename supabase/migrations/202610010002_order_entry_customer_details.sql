-- Persist the edited customer details together with the new order.
begin;

create function public.create_order_entry_with_customer_details(p_request_id uuid, p_order jsonb)
returns jsonb
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  result jsonb;
  saved_order jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to create an order.';
  end if;

  -- Keep authorization, stock reservation and duplicate-request handling in the
  -- existing order-entry function. Any failure below rolls back that work too.
  result := public.create_order_entry(p_request_id, p_order);
  if result->'order'->>'id' is null then
    raise exception 'Saved order could not be confirmed.';
  end if;

  update public.orders as o
  set "clientName" = btrim(p_order->>'clientName'),
      "deliveryRegion" = p_order->>'deliveryRegion',
      "receiptDetails" = coalesce(o."receiptDetails", '{}'::jsonb) ||
        jsonb_build_object(
          'address', btrim(coalesce(p_order->>'address', '')),
          'paymentTerms', btrim(coalesce(p_order->>'paymentTerms', ''))
        )
  where o.id::text = result->'order'->>'id'
  returning to_jsonb(o) into saved_order;

  if saved_order is null then
    raise exception 'Customer details could not be saved with the order.';
  end if;

  return jsonb_set(result, '{order}', saved_order);
end;
$$;

revoke all on function public.create_order_entry_with_customer_details(uuid, jsonb) from public, anon;
grant execute on function public.create_order_entry_with_customer_details(uuid, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
