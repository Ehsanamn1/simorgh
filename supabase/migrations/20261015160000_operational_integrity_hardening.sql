-- Forward-only hardening for projects where 20261015010000_operational_integrity.sql was already applied.
-- Safe for fresh installs too: named constraints are detected and not duplicated.
-- This migration deliberately does not insert any business or sample records.

alter table public.production_batches alter column supplier_id drop not null;
alter table public.daily_production_records add column if not exists updated_at timestamptz not null default now();
alter table public.task_evidence add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.task_evidence'::regclass and conname='task_evidence_storage_path_scope_check') then
    alter table public.task_evidence add constraint task_evidence_storage_path_scope_check
      check (storage_path is null or storage_path like (company_id::text || '/' || task_id::text || '/%'));
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.task_evidence'::regclass and conname='task_evidence_note_nonempty_check') then
    alter table public.task_evidence add constraint task_evidence_note_nonempty_check
      check (evidence_type <> 'note' or length(trim(coalesce(note,'')))>0);
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.partner_financial_entries'::regclass and conname='partner_financial_posted_sale_collection_evidence_check') then
    alter table public.partner_financial_entries add constraint partner_financial_posted_sale_collection_evidence_check
      check (entry_type <> 'sale_collection' or status <> 'posted' or (paid_amount=amount and payment_status='paid' and external_reference is not null));
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.partner_financial_entries'::regclass and conname='partner_financial_posted_cash_entry_evidence_check') then
    alter table public.partner_financial_entries add constraint partner_financial_posted_cash_entry_evidence_check
      check (entry_type not in ('partner_advance','settlement_payment') or status <> 'posted' or (paid_amount=amount and payment_status='paid' and external_reference is not null));
  end if;
end $$;

create or replace function public.guard_production_batch_scope()
returns trigger language plpgsql set search_path='' as $$
declare site_supplier uuid; agreement_supplier uuid; cycle_site uuid; lot_supplier uuid; lot_product uuid;
begin
  select fs.supplier_id into site_supplier from public.farm_sites fs where fs.company_id=new.company_id and fs.id=new.farm_site_id;
  if not found then raise exception 'سایت تولید متعلق به این شرکت نیست'; end if;
  if site_supplier is distinct from new.supplier_id then
    raise exception 'تأمین‌کننده بچ تولید باید با مالک سایت تولید یکسان باشد';
  end if;
  if new.agreement_id is not null then
    select pa.supplier_id into agreement_supplier from public.partnership_agreements pa where pa.company_id=new.company_id and pa.id=new.agreement_id;
    if not found or agreement_supplier is distinct from new.supplier_id then
      raise exception 'قرارداد مشارکت متعلق به تأمین‌کننده این بچ نیست';
    end if;
  end if;
  if new.flock_cycle_id is not null then
    select fc.farm_site_id into cycle_site from public.flock_cycles fc where fc.company_id=new.company_id and fc.id=new.flock_cycle_id;
    if not found or cycle_site is distinct from new.farm_site_id then
      raise exception 'چرخه گله باید متعلق به همان سایت تولید باشد';
    end if;
  end if;
  if new.lot_id is not null then
    select l.supplier_id,l.product_id into lot_supplier,lot_product from public.lots l where l.company_id=new.company_id and l.id=new.lot_id;
    if not found or lot_supplier is distinct from new.supplier_id or (new.product_id is not null and lot_product is distinct from new.product_id) then
      raise exception 'بچ ردیابی محصول با تأمین‌کننده یا محصول این بچ تطابق ندارد';
    end if;
  end if;
  if new.status='completed' and (new.quality_status<>'passed' or new.lot_id is null) then
    raise exception 'بچ تولید فقط پس از تأیید کیفیت و اتصال به بچ ردیابی قابل تکمیل است';
  end if;
  if new.status='completed' and not exists(
    select 1 from public.lots l join public.quality_reviews q on q.company_id=l.company_id and q.lot_id=l.id
    where l.company_id=new.company_id and l.id=new.lot_id and l.status='released' and q.result='pass'
  ) then raise exception 'بچ ردیابی باید بررسی کیفیت موفق و وضعیت آزادشده داشته باشد'; end if;
  return new;
end $$;
drop trigger if exists guard_production_batch_scope on public.production_batches;
create trigger guard_production_batch_scope before insert or update on public.production_batches
  for each row execute function public.guard_production_batch_scope();
revoke all on function public.guard_production_batch_scope() from public,anon,authenticated;

create or replace function public.guard_partner_financial_relationship()
returns trigger language plpgsql security definer set search_path='' as $$
declare source public.partner_financial_entries%rowtype; allowed_categories text[];
begin
  select a.shared_expense_categories into allowed_categories from public.partnership_agreements a
   where a.id=new.agreement_id and a.company_id=new.company_id and a.supplier_id=new.supplier_id;
  if not found then raise exception 'سند مالی باید به قرارداد همان تأمین‌کننده متصل باشد'; end if;
  if new.entry_type='expense' and new.is_shared_cost and not (new.expense_category=any(allowed_categories)) then
    raise exception 'این دسته هزینه طبق قرارداد برای تقسیم مشترک تأیید نشده است';
  end if;
  if new.entry_type='adjustment' then
    select * into source from public.partner_financial_entries
     where id=new.linked_entry_id and company_id=new.company_id
       and supplier_id=new.supplier_id and agreement_id=new.agreement_id;
    if not found or source.status<>'posted' or source.entry_type='adjustment' then
      raise exception 'سند تعدیلی باید به سند ثبت‌شده همان قرارداد متصل شود';
    end if;
    if new.is_shared_cost then raise exception 'تعدیل را از طریق سند مرتبط ثبت کنید؛ is_shared_cost روی تعدیل تنظیم نمی‌شود'; end if;
  elsif new.adjustment_effect is not null then
    raise exception 'adjustment_effect فقط برای سند تعدیلی مجاز است';
  end if;
  if new.entry_type='sale_collection' then
    select * into source from public.partner_financial_entries
     where id=new.linked_entry_id and company_id=new.company_id
       and supplier_id=new.supplier_id and agreement_id=new.agreement_id
       and entry_type='sale_invoice';
    if not found then raise exception 'دریافت فروش باید به فاکتور همین قرارداد متصل شود'; end if;
    if new.status='posted' then
      if (select coalesce(sum(c.amount),0) from public.partner_financial_entries c where c.company_id=new.company_id and c.linked_entry_id=new.linked_entry_id and c.entry_type='sale_collection' and c.status='posted' and c.id is distinct from new.id) + new.amount > source.amount then
        raise exception 'جمع دریافت‌های ثبت‌شده از مبلغ فاکتور بیشتر می‌شود';
      end if;
    end if;
  end if;
  return new;
end $$;
create or replace function public.guard_posted_partner_financial_entry()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' and old.status='posted' then
    raise exception 'سند مالی ثبت‌شده حذف نمی‌شود؛ سند اصلاحی ثبت کنید';
  end if;
  if tg_op='DELETE' then return old; end if;
  if tg_op='UPDATE' and old.status='posted' then
    raise exception 'سند مالی ثبت‌شده تغییر نمی‌کند؛ سند اصلاحی ثبت کنید';
  end if;
  if tg_op='UPDATE' and new.status is distinct from old.status and not (
    (old.status='draft' and new.status in ('submitted','rejected')) or
    (old.status='submitted' and new.status in ('approved','rejected')) or
    (old.status='approved' and new.status in ('posted','rejected'))
  ) then
    raise exception 'انتقال وضعیت سند مالی مجاز نیست';
  end if;
  if new.status='submitted' and new.submitted_at is null then
    new.submitted_at:=now(); new.submitted_by:=coalesce(new.submitted_by,auth.uid());
  end if;
  if new.status='approved' and new.approved_at is null then
    new.approved_at:=now(); new.approved_by:=coalesce(new.approved_by,auth.uid());
  end if;
  if new.status='posted' and new.posted_at is null then
    new.posted_at:=now(); new.posted_by:=coalesce(new.posted_by,auth.uid());
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create or replace function public.submit_operational_task(_task uuid, _completion_note text default null)
returns void language plpgsql security definer set search_path='' as $$
declare t public.operational_tasks%rowtype;
begin
  select * into t from public.operational_tasks where id=_task for update;
  if not found then raise exception 'وظیفه پیدا نشد'; end if;
  if not (public.is_company_manager(t.company_id) or t.assignee_user_id=auth.uid() or t.assignee_supplier_id in (select public.my_supplier_ids())) then
    raise exception 'این وظیفه به شما واگذار نشده است';
  end if;
  if t.status not in ('pending','in_progress','rejected') then raise exception 'وضعیت فعلی اجازه ارسال پایان کار نمی‌دهد'; end if;
  if t.evidence_required and not exists(
    select 1 from public.task_evidence e
    where e.company_id=t.company_id and e.task_id=t.id
      and ((e.evidence_type='note' and length(trim(coalesce(e.note,'')))>0)
        or (e.evidence_type='measurement' and e.measurement_value is not null)
        or (e.evidence_type in ('photo','document') and e.storage_path like t.company_id::text || '/' || t.id::text || '/%' and exists(
          select 1 from storage.objects o where o.bucket_id='operational-evidence' and o.name=e.storage_path
        )))
  ) then raise exception 'برای تکمیل این وظیفه مدرک واقعی لازم است'; end if;
  update public.operational_tasks set status='submitted', submitted_at=now(), completion_note=nullif(trim(_completion_note),''), updated_at=now()
   where id=t.id;
end $$;
create or replace function public.partner_statement_snapshot(_agreement uuid, _period_start date, _period_end date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  a public.partnership_agreements%rowtype;
  invoice_total numeric(16,0);
  collection_total numeric(16,0);
  revenue_used numeric(16,0);
  expense_total numeric(16,0);
  unpaid_expense_total numeric(16,0);
  company_paid_total numeric(16,0);
  partner_paid_total numeric(16,0);
  company_advance_total numeric(16,0);
  partner_advance_total numeric(16,0);
  paid_to_partner_total numeric(16,0);
  paid_to_company_total numeric(16,0);
  net_total numeric(16,0);
  company_share_total numeric(16,0);
  partner_share_total numeric(16,0);
  balance_partner numeric(16,0);
  balance_company numeric(16,0);
  cash_available numeric(16,0);
  lines jsonb;
begin
  if _period_start is null or _period_end is null or _period_end<_period_start then raise exception 'بازه زمانی دوره نامعتبر است'; end if;
  select * into a from public.partnership_agreements where id=_agreement;
  if not found then raise exception 'قرارداد مشارکت پیدا نشد'; end if;
  if not (public.is_company_manager(a.company_id) or a.supplier_id in (select public.my_supplier_ids())) then
    raise exception 'دسترسی به این قرارداد مجاز نیست';
  end if;
  if _period_start < a.effective_from or (a.effective_to is not null and _period_end > a.effective_to) then
    raise exception 'دوره باید در بازه اعتبار قرارداد باشد';
  end if;

  select
    coalesce(sum(case
      when e.entry_type='sale_invoice' and e.status='posted' then e.amount
      when e.entry_type='adjustment' and target.entry_type='sale_invoice' and e.status='posted'
        then e.amount * case when e.adjustment_effect='increase' then 1 else -1 end
      else 0 end),0),
    coalesce(sum(case
      when e.entry_type='sale_collection' and e.status='posted' then e.amount
      when e.entry_type='adjustment' and target.entry_type='sale_collection' and e.status='posted'
        then e.amount * case when e.adjustment_effect='increase' then 1 else -1 end
      else 0 end),0),
    greatest(0,coalesce(sum(case
      when e.entry_type='expense' and e.is_shared_cost and e.status in ('approved','posted') then e.amount
      when e.entry_type='adjustment' and target.entry_type='expense' and target.is_shared_cost and e.status='posted'
        then e.amount * case when e.adjustment_effect='increase' then 1 else -1 end
      else 0 end),0)),
    greatest(0,coalesce(sum(case
      when e.entry_type='expense' and e.is_shared_cost and e.status in ('approved','posted') then e.amount-e.paid_amount
      when e.entry_type='adjustment' and target.entry_type='expense' and target.is_shared_cost and e.status='posted'
        then e.amount * case when e.adjustment_effect='increase' then 1 else -1 end
      else 0 end),0)),
    coalesce(sum(e.paid_amount) filter(where e.entry_type='expense' and e.is_shared_cost and e.status in ('approved','posted') and e.paid_by='company'),0),
    coalesce(sum(e.paid_amount) filter(where e.entry_type='expense' and e.is_shared_cost and e.status in ('approved','posted') and e.paid_by='partner'),0),
    coalesce(sum(e.amount) filter(where e.entry_type='partner_advance' and e.status='posted' and e.direction='company_to_partner'),0),
    coalesce(sum(e.amount) filter(where e.entry_type='partner_advance' and e.status='posted' and e.direction='partner_to_company'),0),
    coalesce(sum(e.amount) filter(where e.entry_type='settlement_payment' and e.status='posted' and e.direction='company_to_partner'),0),
    coalesce(sum(e.amount) filter(where e.entry_type='settlement_payment' and e.status='posted' and e.direction='partner_to_company'),0)
  into invoice_total,collection_total,expense_total,unpaid_expense_total,company_paid_total,partner_paid_total,
       company_advance_total,partner_advance_total,paid_to_partner_total,paid_to_company_total
  from public.partner_financial_entries e
  left join public.partner_financial_entries target
    on target.company_id=e.company_id and target.id=e.linked_entry_id
   and target.supplier_id=e.supplier_id and target.agreement_id=e.agreement_id
  where e.company_id=a.company_id and e.supplier_id=a.supplier_id and e.agreement_id=a.id
    and e.recognized_on between _period_start and _period_end;

  revenue_used:=case when a.settlement_basis='accrual' then invoice_total else collection_total end;
  net_total:=revenue_used-expense_total;
  company_share_total:=round(net_total*a.company_profit_share_pct/100.0,0);
  partner_share_total:=round(net_total*a.partner_profit_share_pct/100.0,0);
  balance_partner:=partner_share_total+partner_paid_total+partner_advance_total-company_advance_total-paid_to_partner_total-paid_to_company_total;
  balance_company:=case when balance_partner < 0 then abs(balance_partner) else 0 end;
  balance_partner:=case when balance_partner > 0 then balance_partner else 0 end;
  cash_available:=collection_total-company_paid_total-company_advance_total-paid_to_partner_total+partner_advance_total+paid_to_company_total;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'type',e.entry_type,'status',e.status,'amount',e.amount,'paid_amount',e.paid_amount,
    'currency',e.currency,'category',e.expense_category,'shared_cost',e.is_shared_cost,'paid_by',e.paid_by,
    'date',e.recognized_on,'reference',e.external_reference,'source_table',e.source_table,'source_record_id',e.source_record_id,
    'linked_entry_id',e.linked_entry_id,'adjustment_effect',e.adjustment_effect,'notes',e.notes
  ) order by e.recognized_on,e.created_at,e.id),'[]'::jsonb)
  into lines
  from public.partner_financial_entries e
  where e.company_id=a.company_id and e.supplier_id=a.supplier_id and e.agreement_id=a.id
    and e.recognized_on between _period_start and _period_end;

  return jsonb_build_object(
    'agreement_id',a.id,'agreement_code',a.agreement_code,'agreement_version',a.version,
    'supplier_id',a.supplier_id,'period_start',_period_start,'period_end',_period_end,
    'settlement_basis',a.settlement_basis,'currency','TOMAN',
    'company_profit_share_pct',a.company_profit_share_pct,'partner_profit_share_pct',a.partner_profit_share_pct,
    'invoiced_revenue',invoice_total,'collected_revenue',collection_total,'recognized_revenue',revenue_used,
    'approved_shared_expenses',expense_total,'unpaid_approved_expenses',unpaid_expense_total,
    'company_paid_shared_expenses',company_paid_total,'partner_paid_shared_expenses',partner_paid_total,
    'net_result',net_total,'company_share_amount',company_share_total,'partner_share_amount',partner_share_total,
    'balance_due_to_partner',balance_partner,'balance_due_to_company',balance_company,
    'recorded_cash_available',cash_available,
    'cash_note','این عدد فقط از اسناد ثبت‌شده محاسبه می‌شود و موجودی بانکی را تأیید نمی‌کند.',
    'entries',lines,'calculated_at',now()
  );
end $$;
create or replace function public.create_partner_settlement_period(_agreement uuid, _period_start date, _period_end date)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  a public.partnership_agreements%rowtype;
  snap jsonb;
  new_id uuid;
begin
  select * into a from public.partnership_agreements where id=_agreement;
  if not found then raise exception 'قرارداد مشارکت پیدا نشد'; end if;
  if not public.is_company_manager(a.company_id) then raise exception 'ایجاد دوره فقط برای مالک یا مدیر مجاز است'; end if;
  if a.status not in ('active','suspended','expired','terminated') then raise exception 'قرارداد باید امضا و تأیید شده باشد'; end if;
  if _period_start is null or _period_end is null or _period_end<_period_start then raise exception 'بازه زمانی دوره نامعتبر است'; end if;
  if _period_end>current_date then raise exception 'دوره تسویه آینده قابل ایجاد نیست'; end if;
  perform pg_advisory_xact_lock(hashtext(_agreement::text));
  if exists(select 1 from public.partner_settlement_periods p where p.agreement_id=_agreement and p.company_id=a.company_id and p.status<>'cancelled' and p.period_start<=_period_end and p.period_end>=_period_start) then
    raise exception 'این بازه با یک دوره تسویه موجود هم‌پوشانی دارد';
  end if;
  snap:=public.partner_statement_snapshot(_agreement,_period_start,_period_end);
  insert into public.partner_settlement_periods(
    company_id,supplier_id,agreement_id,period_start,period_end,status,currency,
    invoiced_revenue,collected_revenue,recognized_revenue,approved_shared_expenses,unpaid_approved_expenses,
    company_paid_shared_expenses,partner_paid_shared_expenses,net_result,company_share_amount,partner_share_amount,
    balance_due_to_partner,balance_due_to_company,recorded_cash_available,calculation_snapshot,calculated_at,created_by
  ) values(
    a.company_id,a.supplier_id,a.id,_period_start,_period_end,'draft','TOMAN',
    (snap->>'invoiced_revenue')::numeric,(snap->>'collected_revenue')::numeric,(snap->>'recognized_revenue')::numeric,
    (snap->>'approved_shared_expenses')::numeric,(snap->>'unpaid_approved_expenses')::numeric,
    (snap->>'company_paid_shared_expenses')::numeric,(snap->>'partner_paid_shared_expenses')::numeric,
    (snap->>'net_result')::numeric,(snap->>'company_share_amount')::numeric,(snap->>'partner_share_amount')::numeric,
    (snap->>'balance_due_to_partner')::numeric,(snap->>'balance_due_to_company')::numeric,
    (snap->>'recorded_cash_available')::numeric,snap,now(),auth.uid()
  ) returning id into new_id;
  return new_id;
end $$;
create or replace function public.record_partner_settlement_payment(_period uuid, _amount numeric, _payment_reference text, _paid_at timestamptz default now())
returns void language plpgsql security definer set search_path='' as $$
declare p public.partner_settlement_periods%rowtype; remaining numeric(16,0);
begin
  select * into p from public.partner_settlement_periods where id=_period for update;
  if not found then raise exception 'دوره تسویه پیدا نشد'; end if;
  if not public.is_company_manager(p.company_id) then raise exception 'ثبت پرداخت فقط برای مالک یا مدیر مجاز است'; end if;
  if p.status not in ('approved','settled') then raise exception 'دوره باید قبل از ثبت پرداخت تأیید شده باشد'; end if;
  if _amount is null or _amount<=0 or nullif(trim(_payment_reference),'') is null then raise exception 'مبلغ و مرجع پرداخت واقعی لازم است'; end if;
  if p.balance_due_to_partner<=0 then raise exception 'این دوره مبلغی برای پرداخت به شریک ندارد'; end if;
  remaining:=p.balance_due_to_partner-p.settled_amount;
  if _amount>remaining then raise exception 'مبلغ پرداخت بیشتر از مانده دوره است'; end if;
  if _amount>greatest(0,p.recorded_cash_available-p.settled_amount) then raise exception 'مبلغ پرداخت از وجه نقد محاسبه‌شده در اسناد دوره بیشتر است'; end if;
  insert into public.partner_financial_entries(
    company_id,supplier_id,agreement_id,entry_type,status,direction,amount,paid_amount,currency,
    paid_by,payment_status,recognized_on,external_reference,source_table,source_record_id,notes,
    approved_by,approved_at,posted_by,posted_at,created_by
  ) values(
    p.company_id,p.supplier_id,p.agreement_id,'settlement_payment','posted','company_to_partner',_amount,_amount,p.currency,
    'company','paid',(_paid_at at time zone 'Asia/Tehran')::date,_payment_reference,'partner_settlement_periods',p.id,
    'پرداخت توسط مدیر ثبت و تأیید شده؛ انتقال بانکی توسط سامانه اجرا نمی‌شود.',
    auth.uid(),now(),auth.uid(),now(),auth.uid()
  );
  update public.partner_settlement_periods set settled_amount=settled_amount+_amount,
    status=case when settled_amount+_amount>=balance_due_to_partner then 'settled' else 'approved' end,
    settled_at=case when settled_amount+_amount>=balance_due_to_partner then coalesce(_paid_at,now()) else null end,
    settled_by=case when settled_amount+_amount>=balance_due_to_partner then auth.uid() else null end,
    updated_at=now()
  where id=p.id;
end $$;

revoke all on function public.guard_partner_financial_relationship() from public,anon,authenticated;
revoke all on function public.guard_posted_partner_financial_entry() from public,anon,authenticated;
revoke all on function public.submit_operational_task(uuid,text) from public,anon;
revoke all on function public.partner_statement_snapshot(uuid,date,date) from public,anon;
revoke all on function public.create_partner_settlement_period(uuid,date,date) from public,anon;
revoke all on function public.record_partner_settlement_payment(uuid,numeric,text,timestamptz) from public,anon;
grant execute on function public.submit_operational_task(uuid,text) to authenticated;
grant execute on function public.partner_statement_snapshot(uuid,date,date) to authenticated;
grant execute on function public.create_partner_settlement_period(uuid,date,date) to authenticated;
grant execute on function public.record_partner_settlement_payment(uuid,numeric,text,timestamptz) to authenticated;

drop policy if exists operational_evidence_storage_insert on storage.objects;
create policy operational_evidence_storage_insert on storage.objects for insert to authenticated
with check (
  bucket_id='operational-evidence'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and (
    public.is_company_internal(((storage.foldername(name))[1])::uuid)
    or exists (
      select 1 from public.operational_tasks t
      where t.company_id=((storage.foldername(name))[1])::uuid
        and t.id=((storage.foldername(name))[2])::uuid
        and public.is_company_member(t.company_id)
        and (t.assignee_user_id=auth.uid() or t.assignee_supplier_id in (select public.my_supplier_ids()))
    )
  )
);

