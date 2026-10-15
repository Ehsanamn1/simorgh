-- Start an assigned operational task through a role-checked RPC.
-- Direct table updates are not granted to supplier memberships.
create or replace function public.start_operational_task(_task uuid)
returns void language plpgsql security definer set search_path='' as $$
declare t public.operational_tasks%rowtype;
begin
  select * into t from public.operational_tasks where id=_task for update;
  if not found then raise exception 'وظیفه پیدا نشد'; end if;
  if not public.is_company_member(t.company_id) then raise exception 'عضویت فعال در این مجموعه لازم است'; end if;
  if not public.is_company_manager(t.company_id)
     and not (t.assignee_user_id=auth.uid() or t.assignee_supplier_id in (select public.my_supplier_ids())) then
    raise exception 'این وظیفه به شما یا تأمین‌کننده شما واگذار نشده است';
  end if;
  if t.status not in ('pending','rejected','blocked') then raise exception 'فقط وظیفه در انتظار، ردشده یا رفع‌مسدودی‌شده قابل شروع است'; end if;
  update public.operational_tasks
    set status='in_progress', started_at=coalesce(started_at,now()), updated_at=now()
    where id=t.id;
end $$;
revoke all on function public.start_operational_task(uuid) from public,anon;
grant execute on function public.start_operational_task(uuid) to authenticated;
