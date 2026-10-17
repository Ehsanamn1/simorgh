-- Serialize all inventory movements by company/product before checking and changing the ledger.
-- Prevents concurrent outbound movements from both observing the same stock and overselling it.
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

  -- Transaction-scoped advisory lock is stable for this tenant/product pair.
  -- Inbound and outbound movements share the same lock so no write can race a balance check.
  PERFORM pg_advisory_xact_lock(hashtextextended(_company::text || ':' || _product::text, 0));

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
