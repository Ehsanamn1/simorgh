-- Stock and purchase receipt ledger with transactional stock checks and internal-only visibility.
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check (movement_type in ('purchase_in','sale_out','adjustment_in','adjustment_out','waste_out','return_in')),
  quantity numeric(16,3) not null check (quantity > 0),
  unit_cost numeric(16,2) check (unit_cost is null or unit_cost >= 0),
  supplier_id uuid references public.suppliers(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  lot_id uuid references public.lots(id) on delete set null,
  reference_code text check (reference_code is null or length(reference_code) <= 120),
  note text check (note is null or length(note) <= 2000),
  recorded_by uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index inventory_movements_company_product_time_idx
  on public.inventory_movements(company_id, product_id, occurred_at desc);
create index inventory_movements_company_supplier_time_idx
  on public.inventory_movements(company_id, supplier_id, occurred_at desc);

alter table public.inventory_movements enable row level security;
revoke all on public.inventory_movements from anon, authenticated;
grant select on public.inventory_movements to authenticated;

create policy inventory_movements_internal_read
  on public.inventory_movements
  for select to authenticated
  using (public.is_company_internal(company_id));

create view public.inventory_balances
with (security_invoker = true, security_barrier = true)
as
select
  p.company_id,
  p.id as product_id,
  p.sku,
  p.name as product_name,
  p.unit,
  p.active as product_active,
  coalesce(sum(
    case
      when m.movement_type in ('purchase_in','adjustment_in','return_in') then m.quantity
      when m.movement_type in ('sale_out','adjustment_out','waste_out') then -m.quantity
      else 0
    end
  ), 0)::numeric(16,3) as quantity_on_hand,
  max(m.occurred_at) as last_movement_at,
  (
    select im.unit_cost
    from public.inventory_movements im
    where im.company_id = p.company_id
      and im.product_id = p.id
      and im.unit_cost is not null
    order by im.occurred_at desc, im.created_at desc
    limit 1
  ) as latest_unit_cost
from public.products p
left join public.inventory_movements m
  on m.company_id = p.company_id and m.product_id = p.id
where public.is_company_internal(p.company_id)
group by p.company_id, p.id, p.sku, p.name, p.unit, p.active;

revoke all on public.inventory_balances from anon, authenticated;
grant select on public.inventory_balances to authenticated;

create or replace function public.record_inventory_movement(
  _company uuid,
  _product uuid,
  _movement_type text,
  _quantity numeric,
  _unit_cost numeric default null,
  _supplier uuid default null,
  _order uuid default null,
  _lot uuid default null,
  _reference_code text default null,
  _note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current numeric(16,3);
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required.';
  end if;
  if not public.is_company_internal(_company) then
    raise exception 'Company internal role required.';
  end if;
  if _quantity is null or _quantity <= 0 then
    raise exception 'Quantity must be greater than zero.';
  end if;
  if _movement_type not in ('purchase_in','sale_out','adjustment_in','adjustment_out','waste_out','return_in') then
    raise exception 'Invalid inventory movement type.';
  end if;
  if not exists (
    select 1 from public.products p
    where p.id = _product and p.company_id = _company
  ) then
    raise exception 'Product does not belong to this company.';
  end if;
  if _supplier is not null and not exists (
    select 1 from public.suppliers s
    where s.id = _supplier and s.company_id = _company
  ) then
    raise exception 'Supplier does not belong to this company.';
  end if;
  if _order is not null and not exists (
    select 1 from public.orders o
    where o.id = _order and o.company_id = _company
  ) then
    raise exception 'Order does not belong to this company.';
  end if;
  if _lot is not null and not exists (
    select 1 from public.lots l
    where l.id = _lot and l.company_id = _company and l.product_id = _product
  ) then
    raise exception 'Lot does not match the company and product.';
  end if;
  if _movement_type = 'purchase_in' and (_supplier is null or _unit_cost is null or _unit_cost < 0) then
    raise exception 'Purchase receipts require a valid supplier and unit cost.';
  end if;
  if _movement_type = 'sale_out' and _order is null then
    raise exception 'Sales issue requires a linked order.';
  end if;
  if _movement_type in ('adjustment_in','adjustment_out','waste_out')
     and length(trim(coalesce(_note,''))) < 4 then
    raise exception 'A reason of at least four characters is required for adjustments and waste.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(_company::text || ':' || _product::text, 0)
  );

  if _movement_type in ('sale_out','adjustment_out','waste_out') then
    select coalesce(sum(
      case
        when movement_type in ('purchase_in','adjustment_in','return_in') then quantity
        else -quantity
      end
    ),0)
    into v_current
    from public.inventory_movements
    where company_id = _company and product_id = _product;
    if _quantity > v_current then
      raise exception 'Insufficient stock. Available: %, requested: %.', v_current, _quantity;
    end if;
  end if;

  insert into public.inventory_movements(
    company_id,product_id,movement_type,quantity,unit_cost,supplier_id,order_id,lot_id,
    reference_code,note,recorded_by
  ) values (
    _company,_product,_movement_type,_quantity,_unit_cost,_supplier,_order,_lot,
    nullif(trim(coalesce(_reference_code,'')),''),
    nullif(trim(coalesce(_note,'')),''),
    (select auth.uid())
  ) returning id into v_id;

  insert into public.audit_events(company_id,actor_id,table_name,record_id,action,changes)
  values (
    _company,(select auth.uid()),'inventory_movements',v_id,'insert',
    jsonb_build_object('product_id',_product,'movement_type',_movement_type,'quantity',_quantity,'reference_code',nullif(trim(coalesce(_reference_code,'')),''))
  );

  return v_id;
end;
$$;

revoke all on function public.record_inventory_movement(uuid,uuid,text,numeric,numeric,uuid,uuid,uuid,text,text) from public, anon;
grant execute on function public.record_inventory_movement(uuid,uuid,text,numeric,numeric,uuid,uuid,uuid,text,text) to authenticated;
