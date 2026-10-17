-- Server-side settlement calculations and transitions for the private Medar Worker API.
-- All actor checks are explicit membership checks; this does not depend on Supabase auth.uid().

CREATE OR REPLACE FUNCTION public.medar_partner_statement_snapshot(_agreement uuid, _period_start date, _period_end date)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
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
BEGIN
  IF _period_start IS NULL OR _period_end IS NULL OR _period_end<_period_start THEN RAISE EXCEPTION 'بازه زمانی دوره نامعتبر است'; END IF;
  SELECT * INTO a FROM public.partnership_agreements WHERE id=_agreement;
  IF NOT FOUND THEN RAISE EXCEPTION 'قرارداد مشارکت پیدا نشد'; END IF;
  IF _period_start < a.effective_from OR (a.effective_to IS NOT NULL AND _period_end > a.effective_to) THEN
    RAISE EXCEPTION 'دوره باید در بازه اعتبار قرارداد باشد';
  END IF;

  SELECT
    COALESCE(SUM(CASE
      WHEN e.entry_type='sale_invoice' AND e.status='posted' THEN e.amount
      WHEN e.entry_type='adjustment' AND target.entry_type='sale_invoice' AND e.status='posted'
        THEN e.amount * CASE WHEN e.adjustment_effect='increase' THEN 1 ELSE -1 END
      ELSE 0 END),0),
    COALESCE(SUM(CASE
      WHEN e.entry_type='sale_collection' AND e.status='posted' THEN e.amount
      WHEN e.entry_type='adjustment' AND target.entry_type='sale_collection' AND e.status='posted'
        THEN e.amount * CASE WHEN e.adjustment_effect='increase' THEN 1 ELSE -1 END
      ELSE 0 END),0),
    GREATEST(0,COALESCE(SUM(CASE
      WHEN e.entry_type='expense' AND e.is_shared_cost AND e.status IN ('approved','posted') THEN e.amount
      WHEN e.entry_type='adjustment' AND target.entry_type='expense' AND target.is_shared_cost AND e.status='posted'
        THEN e.amount * CASE WHEN e.adjustment_effect='increase' THEN 1 ELSE -1 END
      ELSE 0 END),0)),
    GREATEST(0,COALESCE(SUM(CASE
      WHEN e.entry_type='expense' AND e.is_shared_cost AND e.status IN ('approved','posted') THEN e.amount-e.paid_amount
      WHEN e.entry_type='adjustment' AND target.entry_type='expense' AND target.is_shared_cost AND e.status='posted'
        THEN e.amount * CASE WHEN e.adjustment_effect='increase' THEN 1 ELSE -1 END
      ELSE 0 END),0)),
    COALESCE(SUM(e.paid_amount) FILTER(WHERE e.entry_type='expense' AND e.is_shared_cost AND e.status IN ('approved','posted') AND e.paid_by='company'),0),
    COALESCE(SUM(e.paid_amount) FILTER(WHERE e.entry_type='expense' AND e.is_shared_cost AND e.status IN ('approved','posted') AND e.paid_by='partner'),0),
    COALESCE(SUM(e.amount) FILTER(WHERE e.entry_type='partner_advance' AND e.status='posted' AND e.direction='company_to_partner'),0),
    COALESCE(SUM(e.amount) FILTER(WHERE e.entry_type='partner_advance' AND e.status='posted' AND e.direction='partner_to_company'),0),
    COALESCE(SUM(e.amount) FILTER(WHERE e.entry_type='settlement_payment' AND e.status='posted' AND e.direction='company_to_partner'),0),
    COALESCE(SUM(e.amount) FILTER(WHERE e.entry_type='settlement_payment' AND e.status='posted' AND e.direction='partner_to_company'),0)
  INTO invoice_total,collection_total,expense_total,unpaid_expense_total,company_paid_total,partner_paid_total,
       company_advance_total,partner_advance_total,paid_to_partner_total,paid_to_company_total
  FROM public.partner_financial_entries e
  LEFT JOIN public.partner_financial_entries target
    ON target.company_id=e.company_id AND target.id=e.linked_entry_id
   AND target.supplier_id=e.supplier_id AND target.agreement_id=e.agreement_id
  WHERE e.company_id=a.company_id AND e.supplier_id=a.supplier_id AND e.agreement_id=a.id
    AND e.recognized_on BETWEEN _period_start AND _period_end;

  revenue_used:=CASE WHEN a.settlement_basis='accrual' THEN invoice_total ELSE collection_total END;
  net_total:=revenue_used-expense_total;
  company_share_total:=round(net_total*a.company_profit_share_pct/100.0,0);
  partner_share_total:=round(net_total*a.partner_profit_share_pct/100.0,0);
  balance_partner:=partner_share_total+partner_paid_total-(expense_total*a.partner_profit_share_pct/100.0)+partner_advance_total+paid_to_company_total-company_advance_total-paid_to_partner_total;
  balance_company:=CASE WHEN balance_partner < 0 THEN abs(balance_partner) ELSE 0 END;
  balance_partner:=CASE WHEN balance_partner > 0 THEN balance_partner ELSE 0 END;
  cash_available:=collection_total-company_paid_total-company_advance_total-paid_to_partner_total+partner_advance_total+paid_to_company_total;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',e.id,'type',e.entry_type,'status',e.status,'amount',e.amount,'paid_amount',e.paid_amount,
    'currency',e.currency,'category',e.expense_category,'shared_cost',e.is_shared_cost,'paid_by',e.paid_by,
    'date',e.recognized_on,'reference',e.external_reference,'source_table',e.source_table,'source_record_id',e.source_record_id,
    'linked_entry_id',e.linked_entry_id,'adjustment_effect',e.adjustment_effect,'notes',e.notes
  ) ORDER BY e.recognized_on,e.created_at,e.id),'[]'::jsonb)
  INTO lines
  FROM public.partner_financial_entries e
  WHERE e.company_id=a.company_id AND e.supplier_id=a.supplier_id AND e.agreement_id=a.id
    AND e.status IN ('approved','posted') AND e.recognized_on BETWEEN _period_start AND _period_end;

  RETURN jsonb_build_object(
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
END $$;

CREATE OR REPLACE FUNCTION public.medar_create_partner_settlement_period(_actor uuid,_agreement uuid,_period_start date,_period_end date)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a public.partnership_agreements%rowtype; snap jsonb; new_id uuid;
BEGIN
  SELECT * INTO a FROM public.partnership_agreements WHERE id=_agreement;
  IF NOT FOUND THEN RAISE EXCEPTION 'قرارداد مشارکت پیدا نشد'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.company_id=a.company_id AND m.user_id=_actor AND m.active=true AND m.role::text IN ('owner','admin')) THEN
    RAISE EXCEPTION 'ایجاد دوره فقط برای مالک یا مدیر مجاز است';
  END IF;
  IF a.status NOT IN ('active','suspended','expired','terminated') THEN RAISE EXCEPTION 'قرارداد باید امضا و تأیید شده باشد'; END IF;
  IF _period_start IS NULL OR _period_end IS NULL OR _period_end<_period_start THEN RAISE EXCEPTION 'بازه زمانی دوره نامعتبر است'; END IF;
  IF _period_end>current_date THEN RAISE EXCEPTION 'دوره تسویه آینده قابل ایجاد نیست'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_agreement::text));
  IF EXISTS(SELECT 1 FROM public.partner_settlement_periods p WHERE p.agreement_id=_agreement AND p.company_id=a.company_id AND p.status<>'cancelled' AND p.period_start<=_period_end AND p.period_end>=_period_start) THEN
    RAISE EXCEPTION 'این بازه با یک دوره تسویه موجود هم‌پوشانی دارد';
  END IF;
  snap:=public.medar_partner_statement_snapshot(_agreement,_period_start,_period_end);
  INSERT INTO public.partner_settlement_periods(
    company_id,supplier_id,agreement_id,period_start,period_end,status,currency,
    invoiced_revenue,collected_revenue,recognized_revenue,approved_shared_expenses,unpaid_approved_expenses,
    company_paid_shared_expenses,partner_paid_shared_expenses,net_result,company_share_amount,partner_share_amount,
    balance_due_to_partner,balance_due_to_company,recorded_cash_available,calculation_snapshot,calculated_at,created_by
  ) VALUES(
    a.company_id,a.supplier_id,a.id,_period_start,_period_end,'draft','TOMAN',
    (snap->>'invoiced_revenue')::numeric,(snap->>'collected_revenue')::numeric,(snap->>'recognized_revenue')::numeric,
    (snap->>'approved_shared_expenses')::numeric,(snap->>'unpaid_approved_expenses')::numeric,
    (snap->>'company_paid_shared_expenses')::numeric,(snap->>'partner_paid_shared_expenses')::numeric,
    (snap->>'net_result')::numeric,(snap->>'company_share_amount')::numeric,(snap->>'partner_share_amount')::numeric,
    (snap->>'balance_due_to_partner')::numeric,(snap->>'balance_due_to_company')::numeric,
    (snap->>'recorded_cash_available')::numeric,snap,now(),_actor
  ) RETURNING id INTO new_id;
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.medar_refresh_partner_settlement_period(_actor uuid,_period uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.partner_settlement_periods%rowtype; snap jsonb;
BEGIN
  SELECT * INTO p FROM public.partner_settlement_periods WHERE id=_period FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'دوره تسویه پیدا نشد'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.company_id=p.company_id AND m.user_id=_actor AND m.active=true AND m.role::text IN ('owner','admin')) THEN
    RAISE EXCEPTION 'بازمحاسبه فقط برای مالک یا مدیر مجاز است';
  END IF;
  IF p.status<>'draft' THEN RAISE EXCEPTION 'فقط دوره پیش‌نویس قابل بازمحاسبه است'; END IF;
  snap:=public.medar_partner_statement_snapshot(p.agreement_id,p.period_start,p.period_end);
  UPDATE public.partner_settlement_periods SET
    invoiced_revenue=(snap->>'invoiced_revenue')::numeric,
    collected_revenue=(snap->>'collected_revenue')::numeric,
    recognized_revenue=(snap->>'recognized_revenue')::numeric,
    approved_shared_expenses=(snap->>'approved_shared_expenses')::numeric,
    unpaid_approved_expenses=(snap->>'unpaid_approved_expenses')::numeric,
    company_paid_shared_expenses=(snap->>'company_paid_shared_expenses')::numeric,
    partner_paid_shared_expenses=(snap->>'partner_paid_shared_expenses')::numeric,
    net_result=(snap->>'net_result')::numeric,
    company_share_amount=(snap->>'company_share_amount')::numeric,
    partner_share_amount=(snap->>'partner_share_amount')::numeric,
    balance_due_to_partner=(snap->>'balance_due_to_partner')::numeric,
    balance_due_to_company=(snap->>'balance_due_to_company')::numeric,
    recorded_cash_available=(snap->>'recorded_cash_available')::numeric,
    calculation_snapshot=snap,calculated_at=now(),updated_at=now()
  WHERE id=p.id;
END $$;

CREATE OR REPLACE FUNCTION public.medar_approve_partner_settlement_period(_actor uuid,_period uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.partner_settlement_periods%rowtype;
BEGIN
  SELECT * INTO p FROM public.partner_settlement_periods WHERE id=_period FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'دوره تسویه پیدا نشد'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.company_id=p.company_id AND m.user_id=_actor AND m.active=true AND m.role::text IN ('owner','admin')) THEN
    RAISE EXCEPTION 'تأیید تسویه فقط برای مالک یا مدیر مجاز است';
  END IF;
  IF p.status<>'draft' THEN RAISE EXCEPTION 'فقط دوره پیش‌نویس قابل تأیید است'; END IF;
  PERFORM public.medar_refresh_partner_settlement_period(_actor,p.id);
  UPDATE public.partner_settlement_periods SET status='approved',approved_by=_actor,approved_at=now(),updated_at=now() WHERE id=p.id;
END $$;

CREATE OR REPLACE FUNCTION public.medar_record_partner_settlement_payment(_actor uuid,_period uuid,_amount numeric,_payment_reference text,_paid_at timestamptz DEFAULT now())
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.partner_settlement_periods%rowtype; remaining numeric(16,0); new_settled numeric(16,0);
BEGIN
  SELECT * INTO p FROM public.partner_settlement_periods WHERE id=_period FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'دوره تسویه پیدا نشد'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.company_id=p.company_id AND m.user_id=_actor AND m.active=true AND m.role::text IN ('owner','admin')) THEN
    RAISE EXCEPTION 'ثبت پرداخت فقط برای مالک یا مدیر مجاز است';
  END IF;
  IF p.status NOT IN ('approved','settled') THEN RAISE EXCEPTION 'دوره باید قبل از ثبت پرداخت تأیید شده باشد'; END IF;
  IF _amount IS NULL OR _amount<=0 OR nullif(trim(_payment_reference),'') IS NULL THEN RAISE EXCEPTION 'مبلغ و مرجع پرداخت واقعی لازم است'; END IF;
  IF p.balance_due_to_partner<=0 THEN RAISE EXCEPTION 'این دوره مبلغی برای پرداخت به شریک ندارد'; END IF;
  remaining:=p.balance_due_to_partner-p.settled_amount;
  IF _amount>remaining THEN RAISE EXCEPTION 'مبلغ پرداخت بیشتر از مانده دوره است'; END IF;
  IF _amount>greatest(0,p.recorded_cash_available-p.settled_amount) THEN RAISE EXCEPTION 'مبلغ پرداخت از وجه نقد محاسبه‌شده در اسناد دوره بیشتر است'; END IF;
  INSERT INTO public.partner_financial_entries(
    company_id,supplier_id,agreement_id,entry_type,status,direction,amount,paid_amount,currency,
    paid_by,payment_status,recognized_on,external_reference,source_table,source_record_id,notes,created_by,
    submitted_by,submitted_at,approved_by,approved_at,posted_by,posted_at
  ) VALUES(
    p.company_id,p.supplier_id,p.agreement_id,'settlement_payment','posted','company_to_partner',_amount,_amount,p.currency,
    'company','paid',(_paid_at AT TIME ZONE 'Asia/Tehran')::date,_payment_reference,'partner_settlement_periods',p.id,
    'پرداخت توسط مدیر ثبت و تأیید شده؛ انتقال بانکی توسط سامانه اجرا نمی‌شود.',_actor,
    _actor,now(),_actor,now(),_actor,now()
  );
  new_settled:=p.settled_amount+_amount;
  UPDATE public.partner_settlement_periods SET settled_amount=new_settled,
    status=CASE WHEN new_settled>=balance_due_to_partner THEN 'settled' ELSE 'approved' END,
    settled_at=CASE WHEN new_settled>=balance_due_to_partner THEN coalesce(_paid_at,now()) ELSE NULL END,
    settled_by=CASE WHEN new_settled>=balance_due_to_partner THEN _actor ELSE NULL END,
    updated_at=now()
  WHERE id=p.id;
END $$;
