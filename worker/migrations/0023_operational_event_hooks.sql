-- Canonical event emission from important operational state changes.
ALTER TABLE public.medar_operational_events
  DROP CONSTRAINT IF EXISTS medar_operational_events_source_type_check;
ALTER TABLE public.medar_operational_events
  ADD CONSTRAINT medar_operational_events_source_type_check
  CHECK (source_type IN ('order','purchase_order','task','shipment','invoice','inventory','production','quality','supplier','incident','system','other'));

CREATE OR REPLACE FUNCTION public.medar_emit_operational_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $
#variable_conflict use_variable
DECLARE
  row_data jsonb := to_jsonb(NEW);
  old_data jsonb;
  v_company_id uuid;
  record_id uuid;
  actor_id uuid;
  owner_id uuid;
  event_id uuid;
  exception_id uuid;
  source_kind text;
  current_status text;
  event_type text;
  event_severity text;
  event_title text;
  event_body text;
  event_key text;
  exception_key text;
  should_raise boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_data := to_jsonb(OLD);
    IF old_data IS NOT DISTINCT FROM row_data THEN RETURN NEW; END IF;
  END IF;
  v_company_id := nullif(row_data->>'company_id','')::uuid;
  record_id := nullif(row_data->>'id','')::uuid;
  IF v_company_id IS NULL OR record_id IS NULL THEN RETURN NEW; END IF;

  source_kind := CASE TG_TABLE_NAME
    WHEN 'orders' THEN 'order'
    WHEN 'purchase_orders' THEN 'purchase_order'
    WHEN 'operational_tasks' THEN 'task'
    WHEN 'shipments' THEN 'shipment'
    WHEN 'invoices' THEN 'invoice'
    WHEN 'inventory_movements' THEN 'inventory'
    WHEN 'production_batches' THEN 'production'
    WHEN 'quality_reviews' THEN 'quality'
    WHEN 'operational_incidents' THEN 'incident'
    ELSE 'other'
  END;
  current_status := lower(coalesce(row_data->>'status',row_data->>'stage',row_data->>'quality_status','changed'));
  event_type := regexp_replace(lower(TG_TABLE_NAME || '.' || TG_OP || '.' || current_status),'[^a-z0-9_.-]','','g');
  event_type := left(event_type,80);
  event_severity := CASE
    WHEN lower(coalesce(row_data->>'severity','')) IN ('critical','urgent') THEN 'critical'
    WHEN lower(coalesce(row_data->>'severity','')) IN ('warning','high','major')
      OR current_status IN ('blocked','rejected','failed','overdue') THEN 'warning'
    ELSE 'info'
  END;
  event_title := left(coalesce(nullif(trim(row_data->>'title'),''),nullif(trim(row_data->>'reference'),''),nullif(trim(row_data->>'name'),''),nullif(trim(row_data->>'vehicle'),''),TG_TABLE_NAME),180);
  event_body := left(coalesce(nullif(trim(row_data->>'description'),''),nullif(trim(row_data->>'notes'),''),''),4000);
  actor_id := coalesce(
    nullif(current_setting('medar.user_id',true),'')::uuid,
    nullif(row_data->>'updated_by','')::uuid,
    nullif(row_data->>'created_by','')::uuid,
    nullif(row_data->>'recorded_by','')::uuid,
    nullif(row_data->>'reported_by','')::uuid
  );
  event_key := 'db:' || TG_TABLE_NAME || ':' || record_id::text || ':' ||
    coalesce(row_data->>'updated_at',row_data->>'created_at',clock_timestamp()::text) || ':' || TG_OP;
  INSERT INTO public.medar_operational_events
    (company_id,actor_user_id,event_type,severity,source_type,source_id,title,body,payload,idempotency_key,occurred_at)
  VALUES
    (v_company_id,actor_id,event_type,event_severity,source_kind,record_id,event_title,event_body,
     jsonb_build_object('table',TG_TABLE_NAME,'operation',TG_OP,'status',current_status),
     left(event_key,240),coalesce(nullif(row_data->>'updated_at','')::timestamptz,nullif(row_data->>'created_at','')::timestamptz,now()))
  ON CONFLICT(company_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO event_id;
  IF event_id IS NULL THEN
    SELECT e.id INTO event_id FROM public.medar_operational_events e
      WHERE e.company_id=v_company_id AND e.idempotency_key=event_key LIMIT 1;
  END IF;

  should_raise := (TG_TABLE_NAME='operational_incidents' AND current_status NOT IN ('resolved','closed','cancelled'))
    OR (TG_TABLE_NAME='operational_tasks' AND current_status IN ('blocked','rejected'))
    OR (TG_TABLE_NAME='shipments' AND current_status IN ('failed','returned'));
  IF should_raise THEN
    SELECT m.user_id INTO owner_id FROM public.memberships m
      WHERE m.company_id=v_company_id AND m.active=true AND m.role::text IN ('owner','admin')
      ORDER BY CASE m.role::text WHEN 'owner' THEN 0 ELSE 1 END,m.created_at LIMIT 1;
    exception_key := 'auto:' || TG_TABLE_NAME || ':' || record_id::text;
    INSERT INTO public.medar_exception_cases
      (company_id,event_id,title,details,severity,status,assigned_user_id,due_at,created_by,dedupe_key)
    VALUES
      (v_company_id,event_id,event_title,event_body,
       CASE WHEN event_severity='critical' THEN 'critical' ELSE 'warning' END,
       'open',owner_id,now()+interval '1 day',actor_id,exception_key)
    ON CONFLICT(company_id,dedupe_key) WHERE dedupe_key IS NOT NULL AND status NOT IN ('resolved','closed')
      DO UPDATE SET updated_at=now()
    RETURNING id INTO exception_id;
    IF owner_id IS NOT NULL AND exception_id IS NOT NULL THEN
      INSERT INTO public.notifications(company_id,user_id,title,body,href,dedupe_key)
      VALUES (v_company_id,owner_id,'مسئلهٔ عملیاتی نیازمند رسیدگی',event_title,'/app/exceptions','exception:'||exception_id::text)
      ON CONFLICT(company_id,user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'orders','purchase_orders','operational_tasks','shipments','invoices',
    'inventory_movements','production_batches','quality_reviews','operational_incidents'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS medar_emit_operational_event ON public.%I',table_name);
    EXECUTE format('CREATE TRIGGER medar_emit_operational_event AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.medar_emit_operational_event()',table_name);
  END LOOP;
END
$$;

COMMENT ON FUNCTION public.medar_emit_operational_event() IS
  'Appends idempotent tenant-scoped events for core operational state changes and creates actionable cases for incidents, blocked tasks, and failed shipments.';
