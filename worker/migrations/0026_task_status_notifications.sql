-- Notify assignees and managers when an operational task changes state, including submission and review outcomes.
CREATE OR REPLACE FUNCTION public.medar_notify_task_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  status_title text;
  status_body text;
  notification_key text;
  recipient_user_id uuid;
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  status_title := CASE NEW.status
    WHEN 'submitted' THEN 'مأموریت تکمیل شد و آماده بررسی است'
    WHEN 'approved' THEN 'مأموریت تأیید شد'
    WHEN 'rejected' THEN 'مأموریت نیاز به اصلاح دارد'
    WHEN 'blocked' THEN 'مأموریت متوقف شده است'
    WHEN 'cancelled' THEN 'مأموریت لغو شد'
    WHEN 'in_progress' THEN 'مأموریت در حال انجام است'
    ELSE 'وضعیت مأموریت تغییر کرد'
  END;
  status_body := left(trim(NEW.title) || CASE
    WHEN nullif(trim(coalesce(NEW.completion_note,'')),'') IS NOT NULL THEN ' · ' || left(trim(NEW.completion_note),350)
    WHEN nullif(trim(coalesce(NEW.review_note,'')),'') IS NOT NULL THEN ' · ' || left(trim(NEW.review_note),350)
    ELSE '' END, 500);
  notification_key := left('task-status:' || NEW.id::text || ':' || NEW.status::text || ':' || coalesce(NEW.updated_at,now())::text,240);

  FOR recipient_user_id IN
    SELECT DISTINCT m.user_id
    FROM public.memberships m
    WHERE m.company_id=NEW.company_id
      AND m.active=true
      AND (
        m.user_id IN (NEW.assigned_by, NEW.assignee_user_id, NEW.reviewed_by)
        OR m.role::text IN ('owner','admin')
      )
      AND NOT (NEW.status='submitted' AND m.user_id=NEW.assignee_user_id)
  LOOP
    INSERT INTO public.notifications(company_id,user_id,title,body,href,dedupe_key)
    VALUES (NEW.company_id,recipient_user_id,status_title,status_body,'/app/operational-tasks',notification_key || ':' || recipient_user_id::text)
    ON CONFLICT (company_id,user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS medar_notify_task_status_change ON public.operational_tasks;
CREATE TRIGGER medar_notify_task_status_change
AFTER UPDATE OF status ON public.operational_tasks
FOR EACH ROW EXECUTE FUNCTION public.medar_notify_task_status_change();

COMMENT ON FUNCTION public.medar_notify_task_status_change() IS
  'Notifies assigned managers and active owners/admins when operational tasks are submitted, approved, rejected, blocked or cancelled. The existing notification outbox delivers to opted-in Push subscriptions.';
