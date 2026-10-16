-- Extend product catalog categories to match the generalized farm and production workflows.
-- Additive: existing supported values and product records remain valid.
begin;

alter table public.products drop constraint if exists products_kind_check;
alter table public.products add constraint products_kind_check
  check (kind in (
    'farm_product','crop','livestock','poultry','aquaculture','dairy',
    'eggs','meat','honey','forestry','greenhouse','orchard',
    'input','feed','equipment','processed','service','other'
  ));

commit;
