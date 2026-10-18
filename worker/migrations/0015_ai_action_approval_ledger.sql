-- Idempotent approval ledger for agent-proposed operational actions.
-- Proposals are inert until an authorized member explicitly confirms execution.
CREATE TABLE IF NOT EXISTS public.medar_ai_action_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.medar_users(id) ON DELETE CASCADE,
  tool_key text NOT NULL CHECK (tool_key IN ('create_operational_task')),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','executed','cancelled','failed')),
  arguments jsonb NOT NULL CHECK (jsonb_typeof(arguments) = 'object'),
  result jsonb,
  executed_by uuid REFERENCES public.medar_users(id) ON DELETE SET NULL,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'executed' OR (result IS NOT NULL AND executed_by IS NOT NULL AND executed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS medar_ai_action_runs_company_status_created_idx
  ON public.medar_ai_action_runs(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS medar_ai_action_runs_requester_created_idx
  ON public.medar_ai_action_runs(requested_by, created_at DESC);

COMMENT ON TABLE public.medar_ai_action_runs IS
  'Company-scoped AI/automation action proposals. Writes require a separate authenticated confirmation and are recorded idempotently.';

CREATE OR REPLACE FUNCTION public.medar_execute_ai_create_task(
  _actor uuid,
  _company uuid,
  _action uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_action public.medar_ai_action_runs%ROWTYPE;
  v_actor_role text;
  v_target_role text;
  v_title text;
  v_instructions text;
  v_priority text;
  v_due_at timestamptz;
  v_assignee_user uuid;
  v_assignee_supplier uuid;
  v_task_id uuid;
  v_result jsonb;
BEGIN
  IF _actor IS NULL OR _company IS NULL OR _action IS NULL THEN
    RAISE EXCEPTION 'شناسه کاربر، مجموعه و اقدام الزامی است';
  END IF;

  SELECT m.role::text INTO v_actor_role
  FROM public.memberships m
  WHERE m.user_id = _actor AND m.company_id = _company AND m.active = true
  LIMIT 1;
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner','admin','staff') THEN
    RAISE EXCEPTION 'برای اجرای اقدام عملیاتی دسترسی لازم وجود ندارد';
  END IF;

  SELECT * INTO v_action
  FROM public.medar_ai_action_runs a
  WHERE a.id = _action AND a.company_id = _company
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'پیشنهاد اقدام پیدا نشد'; END IF;
  IF v_action.status = 'executed' THEN RETURN v_action.result; END IF;
  IF v_action.status <> 'proposed' THEN RAISE EXCEPTION 'این پیشنهاد دیگر قابل اجرا نیست'; END IF;
  IF v_action.tool_key <> 'create_operational_task' THEN RAISE EXCEPTION 'نوع اقدام مجاز نیست'; END IF;
  IF v_action.requested_by <> _actor AND v_actor_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'فقط پیشنهاددهنده یا مدیر مجاز می‌تواند این پیشنهاد را اجرا کند';
  END IF;

  v_title := btrim(coalesce(v_action.arguments->>'title',''));
  IF length(v_title) < 2 OR length(v_title) > 180 THEN
    RAISE EXCEPTION 'عنوان وظیفه باید بین ۲ تا ۱۸۰ نویسه باشد';
  END IF;
  v_instructions := left(btrim(coalesce(v_action.arguments->>'instructions','')),3000);
  v_priority := coalesce(v_action.arguments->>'priority','normal');
  IF v_priority NOT IN ('low','normal','high','critical') THEN RAISE EXCEPTION 'اولویت وظیفه معتبر نیست'; END IF;
  IF nullif(v_action.arguments->>'dueAt','') IS NOT NULL THEN
    v_due_at := (v_action.arguments->>'dueAt')::timestamptz;
  END IF;
  IF nullif(v_action.arguments->>'assigneeUserId','') IS NOT NULL THEN
    IF (v_action.arguments->>'assigneeUserId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'شناسه مسئول وظیفه معتبر نیست';
    END IF;
    v_assignee_user := (v_action.arguments->>'assigneeUserId')::uuid;
  END IF;
  IF nullif(v_action.arguments->>'assigneeSupplierId','') IS NOT NULL THEN
    IF (v_action.arguments->>'assigneeSupplierId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'شناسه تأمین‌کننده معتبر نیست';
    END IF;
    v_assignee_supplier := (v_action.arguments->>'assigneeSupplierId')::uuid;
  END IF;
  IF v_assignee_user IS NOT NULL AND v_assignee_supplier IS NOT NULL THEN
    RAISE EXCEPTION 'وظیفه فقط می‌تواند یک مسئول داشته باشد';
  END IF;
  IF v_assignee_user IS NULL AND v_assignee_supplier IS NULL THEN v_assignee_user := _actor; END IF;

  IF v_assignee_user IS NOT NULL THEN
    SELECT m.role::text INTO v_target_role
    FROM public.memberships m
    WHERE m.user_id = v_assignee_user AND m.company_id = _company AND m.active = true
      AND m.role::text IN ('owner','admin','staff','driver')
    LIMIT 1;
    IF v_target_role IS NULL THEN RAISE EXCEPTION 'مسئول انتخاب‌شده عضو فعال و مجاز این مجموعه نیست'; END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.suppliers s
      WHERE s.id = v_assignee_supplier AND s.company_id = _company AND s.active = true
    ) THEN RAISE EXCEPTION 'تأمین‌کننده انتخاب‌شده فعال نیست یا به این مجموعه تعلق ندارد'; END IF;
  END IF;

  INSERT INTO public.operational_tasks(
    company_id, assignee_user_id, assignee_supplier_id, assigned_by,
    title, instructions_snapshot, category, priority, status, due_at
  ) VALUES (
    _company, v_assignee_user, v_assignee_supplier, _actor,
    v_title, v_instructions, 'operations', v_priority, 'pending', v_due_at
  ) RETURNING id INTO v_task_id;

  v_result := jsonb_build_object(
    'taskId', v_task_id,
    'title', v_title,
    'status', 'pending',
    'priority', v_priority,
    'dueAt', v_due_at
  );
  UPDATE public.medar_ai_action_runs
  SET status = 'executed', result = v_result, executed_by = _actor,
      executed_at = now(), updated_at = now()
  WHERE id = v_action.id AND company_id = _company;

  INSERT INTO public.medar_audit_log(actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (_actor, 'ai_action.task_created', 'operational_task', v_task_id::text,
          jsonb_build_object('company_id',_company::text,'action_run_id',v_action.id::text,'priority',v_priority));

  RETURN v_result;
END
$$;

REVOKE ALL ON FUNCTION public.medar_execute_ai_create_task(uuid,uuid,uuid) FROM PUBLIC;
