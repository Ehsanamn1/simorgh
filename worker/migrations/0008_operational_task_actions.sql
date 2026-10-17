-- Role-checked operational task actions for the existing Medar Neon schema.
-- All actor identity is passed only by the Worker after validating the HttpOnly session.

create or replace function public.medar_start_operational_task(_actor uuid, _task uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.operational_tasks%rowtype;
  can_manage boolean;
  can_execute boolean;
begin
  if _actor is null then raise exception 'ورود الزامی است'; end if;
  select * into t from public.operational_tasks where id = _task for update;
  if not found then raise exception 'وظیفه پیدا نشد'; end if;

  select exists (
    select 1 from public.memberships m
    where m.user_id = _actor and m.company_id = t.company_id and m.active
      and m.role::text in ('owner','admin','staff')
  ) into can_manage;

  select can_manage or t.assignee_user_id = _actor or exists (
    select 1 from public.memberships m
    where m.user_id = _actor and m.company_id = t.company_id and m.active
      and m.role::text = 'supplier' and m.supplier_id = t.assignee_supplier_id
  ) into can_execute;

  if not can_execute then raise exception 'این وظیفه به شما یا تأمین‌کننده شما واگذار نشده است'; end if;
  if t.status not in ('pending','rejected','blocked') then
    raise exception 'فقط وظیفه در انتظار، ردشده یا رفع‌مسدودی‌شده قابل شروع است';
  end if;

  update public.operational_tasks
  set status = 'in_progress',
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where id = t.id and company_id = t.company_id;
end
$$;

create or replace function public.medar_submit_operational_task(
  _actor uuid,
  _task uuid,
  _completion_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.operational_tasks%rowtype;
  can_manage boolean;
  can_execute boolean;
begin
  if _actor is null then raise exception 'ورود الزامی است'; end if;
  select * into t from public.operational_tasks where id = _task for update;
  if not found then raise exception 'وظیفه پیدا نشد'; end if;

  select exists (
    select 1 from public.memberships m
    where m.user_id = _actor and m.company_id = t.company_id and m.active
      and m.role::text in ('owner','admin','staff')
  ) into can_manage;

  select can_manage or t.assignee_user_id = _actor or exists (
    select 1 from public.memberships m
    where m.user_id = _actor and m.company_id = t.company_id and m.active
      and m.role::text = 'supplier' and m.supplier_id = t.assignee_supplier_id
  ) into can_execute;

  if not can_execute then raise exception 'این وظیفه به شما یا تأمین‌کننده شما واگذار نشده است'; end if;
  if t.status not in ('pending','in_progress','rejected') then
    raise exception 'وضعیت فعلی اجازه ارسال پایان کار نمی‌دهد';
  end if;

  if t.evidence_required and not exists (
    select 1
    from public.task_evidence e
    where e.company_id = t.company_id and e.task_id = t.id
      and (
        (e.evidence_type = 'note' and length(trim(coalesce(e.note,''))) > 0)
        or (e.evidence_type = 'measurement' and e.measurement_value is not null)
        or (
          e.evidence_type in ('photo','document')
          and e.storage_path like t.company_id::text || '/' || t.id::text || '/%'
          and exists (
            select 1 from public.medar_files f
            where f.bucket_id = 'operational-evidence'
              and f.company_id = t.company_id
              and f.name = e.storage_path
          )
        )
      )
  ) then
    raise exception 'برای تکمیل این وظیفه مدرک واقعی لازم است';
  end if;

  update public.operational_tasks
  set status = 'submitted',
      submitted_at = now(),
      completion_note = nullif(trim(coalesce(_completion_note,'')),''),
      updated_at = now()
  where id = t.id and company_id = t.company_id;
end
$$;

create or replace function public.medar_review_operational_task(
  _actor uuid,
  _task uuid,
  _decision text,
  _review_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.operational_tasks%rowtype;
  can_manage boolean;
begin
  if _actor is null then raise exception 'ورود الزامی است'; end if;
  if _decision not in ('approved','rejected') then raise exception 'تصمیم بازبینی نامعتبر است'; end if;
  select * into t from public.operational_tasks where id = _task for update;
  if not found then raise exception 'وظیفه پیدا نشد'; end if;

  select exists (
    select 1 from public.memberships m
    where m.user_id = _actor and m.company_id = t.company_id and m.active
      and m.role::text in ('owner','admin','staff')
  ) into can_manage;
  if not can_manage then raise exception 'دسترسی مالک، مدیر یا کارمند مجاز لازم است'; end if;
  if t.status <> 'submitted' then raise exception 'فقط وظیفه ارسال‌شده قابل بازبینی است'; end if;

  update public.operational_tasks
  set status = _decision,
      reviewed_at = now(),
      reviewed_by = _actor,
      review_note = nullif(trim(coalesce(_review_note,'')),''),
      updated_at = now()
  where id = t.id and company_id = t.company_id;
end
$$;

revoke all on function public.medar_start_operational_task(uuid,uuid) from public;
revoke all on function public.medar_submit_operational_task(uuid,uuid,text) from public;
revoke all on function public.medar_review_operational_task(uuid,uuid,text,text) from public;
