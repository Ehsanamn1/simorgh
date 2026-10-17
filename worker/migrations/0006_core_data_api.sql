-- Core RPC replacements and derived inventory balance for the Medar Worker API.

CREATE OR REPLACE VIEW public.inventory_balances AS
SELECT p.company_id,p.id AS product_id,p.sku,p.name AS product_name,p.unit,
  COALESCE(SUM(CASE WHEN m.movement_type IN ('purchase_in','adjustment_in','return_in') THEN m.quantity
                    WHEN m.movement_type IN ('sale_out','adjustment_out','waste_out') THEN -m.quantity ELSE 0 END),0)::numeric AS quantity_on_hand,
  (SELECT m2.unit_cost FROM public.inventory_movements m2
    WHERE m2.company_id=p.company_id AND m2.product_id=p.id AND m2.unit_cost IS NOT NULL
    ORDER BY m2.occurred_at DESC,m2.created_at DESC LIMIT 1) AS latest_unit_cost,
  MAX(m.occurred_at) AS last_movement_at,p.active AS product_active
FROM public.products p
LEFT JOIN public.inventory_movements m ON m.company_id=p.company_id AND m.product_id=p.id
GROUP BY p.company_id,p.id,p.sku,p.name,p.unit,p.active;

CREATE OR REPLACE FUNCTION public.medar_allocate_order_item(_actor uuid,_company uuid,_order_item uuid,_capacity uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  oid uuid; pid uuid; qty numeric; current_supplier uuid; current_capacity uuid; order_state public.order_status; due_on date;
  cap_supplier uuid; cap_product uuid; cap_start date; cap_end date; cap_confirmed numeric; cap_committed numeric; cap_state public.capacity_status; new_committed numeric;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.company_id=_company AND m.user_id=_actor AND m.active=true AND m.role::text IN ('owner','admin')) THEN
    RAISE EXCEPTION 'فقط مالک یا مدیر می‌تواند تأمین را تخصیص دهد';
  END IF;
  SELECT oi.order_id,oi.product_id,oi.quantity,oi.supplier_id,oi.capacity_commitment_id,o.status,COALESCE(o.requested_delivery,current_date)
    INTO oid,pid,qty,current_supplier,current_capacity,order_state,due_on
  FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id AND o.company_id=oi.company_id
  WHERE oi.id=_order_item AND oi.company_id=_company FOR UPDATE OF oi,o;
  IF oid IS NULL THEN RAISE EXCEPTION 'ردیف سفارش در این شرکت پیدا نشد'; END IF;
  IF order_state NOT IN ('confirmed','allocated') THEN RAISE EXCEPTION 'ابتدا سفارش باید تأیید شده باشد'; END IF;
  IF current_supplier IS NOT NULL OR current_capacity IS NOT NULL THEN RAISE EXCEPTION 'این ردیف قبلاً تخصیص یافته است؛ ابتدا تخصیص قبلی را آزاد کنید'; END IF;
  SELECT c.supplier_id,c.product_id,c.period_start,c.period_end,c.confirmed_qty,c.committed_qty,c.status
    INTO cap_supplier,cap_product,cap_start,cap_end,cap_confirmed,cap_committed,cap_state
  FROM public.capacity_commitments c WHERE c.id=_capacity AND c.company_id=_company FOR UPDATE;
  IF cap_supplier IS NULL THEN RAISE EXCEPTION 'رکورد ظرفیت پیدا نشد'; END IF;
  IF cap_product<>pid THEN RAISE EXCEPTION 'محصول ظرفیت با محصول سفارش یکسان نیست'; END IF;
  IF cap_state NOT IN ('confirmed','committed') OR cap_confirmed IS NULL THEN RAISE EXCEPTION 'این ظرفیت هنوز تأیید نشده است'; END IF;
  IF due_on<cap_start OR due_on>cap_end THEN RAISE EXCEPTION 'تاریخ تحویل در بازه ظرفیت تأییدشده نیست'; END IF;
  new_committed:=COALESCE(cap_committed,0)+qty;
  IF new_committed>cap_confirmed THEN RAISE EXCEPTION 'ظرفیت آزاد کافی نیست؛ مقدار آزاد: %',GREATEST(0,cap_confirmed-COALESCE(cap_committed,0)); END IF;
  UPDATE public.capacity_commitments SET committed_qty=new_committed,status=CASE WHEN new_committed>=cap_confirmed THEN 'committed'::public.capacity_status ELSE 'confirmed'::public.capacity_status END WHERE id=_capacity AND company_id=_company;
  UPDATE public.order_items SET supplier_id=cap_supplier,capacity_commitment_id=_capacity WHERE id=_order_item AND company_id=_company;
  IF NOT EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=oid AND oi.company_id=_company AND oi.supplier_id IS NULL) THEN
    UPDATE public.orders SET status='allocated',updated_at=now() WHERE id=oid AND company_id=_company AND status='confirmed';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.medar_record_inventory_movement(
  _actor uuid,_company uuid,_product uuid,_movement_type text,_quantity numeric,_unit_cost numeric DEFAULT NULL,
  _supplier uuid DEFAULT NULL,_order uuid DEFAULT NULL,_lot uuid DEFAULT NULL,_reference_code text DEFAULT NULL,_note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE role_name text; product_active boolean; order_status public.order_status; lot_product uuid; balance numeric; new_id uuid;
BEGIN
  SELECT m.role::text INTO role_name FROM public.memberships m
  WHERE m.company_id=_company AND m.user_id=_actor AND m.active=true
  ORDER BY CASE m.role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END LIMIT 1;
  IF role_name IS NULL OR role_name NOT IN ('owner','admin','staff') THEN RAISE EXCEPTION 'ثبت گردش انبار برای این نقش مجاز نیست'; END IF;
  IF _movement_type NOT IN ('purchase_in','sale_out','adjustment_in','adjustment_out','waste_out','return_in') THEN RAISE EXCEPTION 'نوع گردش انبار معتبر نیست'; END IF;
  IF _quantity IS NULL OR _quantity<=0 THEN RAISE EXCEPTION 'مقدار گردش باید بیشتر از صفر باشد'; END IF;
  IF _unit_cost IS NOT NULL AND _unit_cost<0 THEN RAISE EXCEPTION 'بهای واحد نمی‌تواند منفی باشد'; END IF;
  SELECT active INTO product_active FROM public.products WHERE id=_product AND company_id=_company;
  IF product_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'محصول پیدا نشد یا غیرفعال است'; END IF;
  IF _supplier IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=_supplier AND company_id=_company) THEN RAISE EXCEPTION 'تأمین‌کننده متعلق به این مجموعه نیست'; END IF;
  IF _order IS NOT NULL THEN
    SELECT status INTO order_status FROM public.orders WHERE id=_order AND company_id=_company;
    IF order_status IS NULL THEN RAISE EXCEPTION 'سفارش متعلق به این مجموعه نیست'; END IF;
  END IF;
  IF _lot IS NOT NULL THEN
    SELECT product_id INTO lot_product FROM public.lots WHERE id=_lot AND company_id=_company;
    IF lot_product IS NULL OR lot_product<>_product THEN RAISE EXCEPTION 'بچ انتخاب‌شده متعلق به این محصول یا مجموعه نیست'; END IF;
  END IF;
  IF _movement_type='purchase_in' AND (_supplier IS NULL OR _unit_cost IS NULL) THEN RAISE EXCEPTION 'رسید خرید به تأمین‌کننده و بهای واحد نیاز دارد'; END IF;
  IF _movement_type='sale_out' AND (_order IS NULL OR order_status NOT IN ('allocated','in_fulfillment','dispatched')) THEN RAISE EXCEPTION 'خروج فروش فقط برای سفارش تخصیص‌یافته مجاز است'; END IF;
  IF _movement_type IN ('adjustment_in','adjustment_out','waste_out') AND role_name NOT IN ('owner','admin') THEN RAISE EXCEPTION 'اصلاح موجودی و ضایعات فقط برای مالک یا مدیر مجاز است'; END IF;
  IF _movement_type IN ('sale_out','adjustment_out','waste_out') THEN
    SELECT COALESCE(SUM(CASE WHEN movement_type IN ('purchase_in','adjustment_in','return_in') THEN quantity ELSE -quantity END),0)
      INTO balance FROM public.inventory_movements WHERE company_id=_company AND product_id=_product;
    IF _quantity>balance THEN RAISE EXCEPTION 'موجودی آزاد کافی نیست؛ موجودی فعلی: %',GREATEST(0,balance); END IF;
  END IF;
  INSERT INTO public.inventory_movements(company_id,product_id,movement_type,quantity,unit_cost,supplier_id,order_id,lot_id,reference_code,note,recorded_by,occurred_at)
  VALUES(_company,_product,_movement_type,_quantity,_unit_cost,_supplier,_order,_lot,NULLIF(trim(_reference_code),''),NULLIF(trim(_note),''),_actor,now())
  RETURNING id INTO new_id;
  INSERT INTO public.audit_events(company_id,actor_id,table_name,record_id,action,changes,occurred_at)
  VALUES(_company,_actor,'inventory_movements',new_id,'inventory.movement.created',jsonb_build_object('product_id',_product,'movement_type',_movement_type,'quantity',_quantity),now());
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.medar_record_quality_review(_actor uuid,_company uuid,_lot uuid,_result text,_notes text,_checklist jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE role_name text; lot_state public.lot_status; review_id uuid;
BEGIN
  SELECT m.role::text INTO role_name FROM public.memberships m
  WHERE m.company_id=_company AND m.user_id=_actor AND m.active=true
  ORDER BY CASE m.role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END LIMIT 1;
  IF role_name IS NULL OR role_name NOT IN ('owner','admin','staff') THEN RAISE EXCEPTION 'ثبت بازبینی کیفیت برای این نقش مجاز نیست'; END IF;
  IF _result NOT IN ('pass','fail','conditional') THEN RAISE EXCEPTION 'نتیجه بازبینی کیفیت معتبر نیست'; END IF;
  SELECT status INTO lot_state FROM public.lots WHERE id=_lot AND company_id=_company FOR UPDATE;
  IF lot_state IS NULL THEN RAISE EXCEPTION 'سری محصول متعلق به این مجموعه نیست'; END IF;
  IF lot_state<>'pending_review' THEN RAISE EXCEPTION 'فقط سری در انتظار بازبینی قابل بررسی است'; END IF;
  INSERT INTO public.quality_reviews(company_id,lot_id,result,notes,checklist,reviewer_id,reviewed_at)
  VALUES(_company,_lot,_result,NULLIF(trim(_notes),''),COALESCE(_checklist,'{}'::jsonb),_actor,now())
  RETURNING id INTO review_id;
  UPDATE public.lots SET status=CASE WHEN _result='pass' THEN 'released'::public.lot_status WHEN _result='fail' THEN 'rejected'::public.lot_status ELSE 'pending_review'::public.lot_status END
  WHERE id=_lot AND company_id=_company;
  INSERT INTO public.audit_events(company_id,actor_id,table_name,record_id,action,changes,occurred_at)
  VALUES(_company,_actor,'quality_reviews',review_id,'quality.review.recorded',jsonb_build_object('lot_id',_lot,'result',_result),now());
  RETURN review_id;
END $$;
