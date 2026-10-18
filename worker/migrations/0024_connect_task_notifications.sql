-- Notify task assignees and explicit conversation participants through the authoritative in-app inbox.
-- The existing notification outbox trigger fans these notifications out to opted-in Push subscriptions.
CREATE OR REPLACE FUNCTION public.medar_notify_task_assignee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  task_title text;
  due_label text;
  assignment_key text;
  recipient_user_id uuid;
BEGIN
  IF NEW.status IN ('cancelled','approved') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
    AND OLD.assignee_user_id IS NOT DISTINCT FROM NEW.assignee_user_id
    AND OLD.assignee_supplier_id IS NOT DISTINCT FROM NEW.assignee_supplier_id THEN
    RETURN NEW;
  END IF;

  task_title := left(trim(NEW.title),180);
  due_label := CASE WHEN NEW.due_at IS NULL THEN '' ELSE ' · موعد: ' || to_char(NEW.due_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') || ' UTC' END;

  FOR recipient_user_id IN
    SELECT m.user_id
    FROM public.memberships m
    WHERE m.company_id=NEW.company_id
      AND m.active=true
      AND (
        (NEW.assignee_user_id IS NOT NULL AND m.user_id=NEW.assignee_user_id)
        OR
        (NEW.assignee_user_id IS NULL AND NEW.assignee_supplier_id IS NOT NULL
          AND m.supplier_id=NEW.assignee_supplier_id AND m.role::text='supplier')
      )
  LOOP
    assignment_key := left('task-assigned:' || NEW.id::text || ':' || recipient_user_id::text || ':' ||
      coalesce(NEW.updated_at,NEW.created_at,now())::text,240);
    INSERT INTO public.notifications(company_id,user_id,title,body,href,dedupe_key)
    VALUES (NEW.company_id,recipient_user_id,'وظیفهٔ جدید به شما واگذار شد',task_title || due_label,'/app/home',assignment_key)
    ON CONFLICT (company_id,user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS medar_notify_task_assignee ON public.operational_tasks;
CREATE TRIGGER medar_notify_task_assignee
AFTER INSERT OR UPDATE ON public.operational_tasks
FOR EACH ROW EXECUTE FUNCTION public.medar_notify_task_assignee();

CREATE OR REPLACE FUNCTION public.medar_notify_conversation_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  message_title text := 'پیام کاری جدید';
  message_body text := left(trim(NEW.body),500);
  message_href text := '/app/connect';
  message_key text := 'connect-message:' || NEW.id::text;
BEGIN
  INSERT INTO public.notifications(company_id,user_id,title,body,href,dedupe_key)
  SELECT NEW.company_id,participant.user_id,message_title,message_body,message_href,message_key
  FROM public.medar_conversation_participants participant
  JOIN public.memberships membership
    ON membership.company_id=participant.company_id
   AND membership.user_id=participant.user_id
   AND membership.active=true
  WHERE participant.company_id=NEW.company_id
    AND participant.conversation_id=NEW.conversation_id
    AND participant.user_id<>NEW.sender_user_id
  ON CONFLICT (company_id,user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS medar_notify_conversation_participants ON public.medar_messages;
CREATE TRIGGER medar_notify_conversation_participants
AFTER INSERT ON public.medar_messages
FOR EACH ROW EXECUTE FUNCTION public.medar_notify_conversation_participants();

COMMENT ON FUNCTION public.medar_notify_task_assignee() IS
  'Creates an idempotent in-app notification when a task is newly assigned or reassigned to an active company member.';
COMMENT ON FUNCTION public.medar_notify_conversation_participants() IS
  'Notifies only active company members explicitly participating in the conversation, excluding the sender.';
