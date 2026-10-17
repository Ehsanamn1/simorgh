-- Purchase orders connect supplier procurement, approval, partial receipts, and the immutable stock ledger.
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL,
  reference text NOT NULL CHECK (length(trim(reference)) BETWEEN 3 AND 80),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','partially_received','received','cancelled')),
  expected_delivery date,
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_by uuid NOT NULL REFERENCES public.medar_users(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES public.medar_users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id),
  UNIQUE(company_id,reference),
  FOREIGN KEY(company_id,supplier_id) REFERENCES public.suppliers(company_id,id) ON DELETE RESTRICT,
  CHECK ((status NOT IN ('approved','partially_received','received')) OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK ((status <> 'received') OR received_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL,
  product_id uuid NOT NULL,
  ordered_quantity numeric(14,3) NOT NULL CHECK (ordered_quantity > 0),
  received_quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0 AND received_quantity <= ordered_quantity),
  unit_cost numeric(16,2) NOT NULL CHECK (unit_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id),
  UNIQUE(company_id,purchase_order_id,product_id),
  FOREIGN KEY(company_id,purchase_order_id) REFERENCES public.purchase_orders(company_id,id) ON DELETE CASCADE,
  FOREIGN KEY(company_id,product_id) REFERENCES public.products(company_id,id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS purchase_orders_company_status_created_idx
  ON public.purchase_orders(company_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS purchase_order_items_company_order_idx
  ON public.purchase_order_items(company_id,purchase_order_id);

CREATE OR REPLACE FUNCTION public.medar_create_purchase_order(
  _actor uuid,
  _company uuid,
  _supplier uuid,
  _reference text,
  _items jsonb,
  _expected_delivery date DEFAULT NULL,
  _note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  role_name text;
  supplier_active boolean;
  item jsonb;
  product_id uuid;
  quantity numeric;
  cost numeric;
  order_id uuid;
  item_count integer;
BEGIN
  SELECT m.role::text INTO role_name
  FROM public.memberships m
  WHERE m.company_id=_company AND m.user_id=_actor AND m.active=true
  ORDER BY CASE m.role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END
  LIMIT 1;
  IF role_name IS NULL OR role_name NOT IN ('owner','admin','staff') THEN
    RAISE EXCEPTION 'ساخت سفارش خرید برای این نقش مجاز نیست';
  END IF;

  SELECT s.active INTO supplier_active
  FROM public.suppliers s WHERE s.id=_supplier AND s.company_id=_company;
  IF supplier_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'تأمین‌کننده پیدا نشد یا غیرفعال است';
  END IF;
  IF _reference IS NULL OR length(trim(_reference)) NOT BETWEEN 3 AND 80 THEN
    RAISE EXCEPTION 'شماره سفارش خرید باید بین ۳ تا ۸۰ نویسه باشد';
  END IF;
  IF _note IS NOT NULL AND length(_note)>2000 THEN RAISE EXCEPTION 'یادداشت بیش از حد مجاز است'; END IF;
  IF _items IS NULL OR jsonb_typeof(_items)<>'array' THEN RAISE EXCEPTION 'اقلام سفارش باید یک آرایه معتبر باشد'; END IF;
  item_count:=jsonb_array_length(_items);
  IF item_count<1 OR item_count>100 THEN RAISE EXCEPTION 'سفارش خرید باید بین ۱ تا ۱۰۰ قلم داشته باشد'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_items) x WHERE jsonb_typeof(x)<>'object') THEN
    RAISE EXCEPTION 'ساختار یکی از اقلام سفارش معتبر نیست';
  END IF;
  IF (SELECT count(DISTINCT x->>'product_id') FROM jsonb_array_elements(_items) x)
      <> item_count THEN RAISE EXCEPTION 'هر محصول فقط یک بار در فهرست اقلام سفارش وارد شود'; END IF;

  INSERT INTO public.purchase_orders(company_id,supplier_id,reference,status,expected_delivery,notes,created_by)
  VALUES(_company,_supplier,trim(_reference),'draft',_expected_delivery,COALESCE(_note,''),_actor)
  RETURNING id INTO order_id;

  FOR item IN SELECT value FROM jsonb_array_elements(_items) AS e(value) LOOP
    IF COALESCE(item->>'product_id','') !~* '^[0-9a-f-]{36}$' THEN
      RAISE EXCEPTION 'شناسه یکی از محصولات معتبر نیست';
    END IF;
    product_id:=(item->>'product_id')::uuid;
    IF COALESCE(item->>'quantity','') !~ '^[0-9]+([.][0-9]{1,3})?$' THEN
      RAISE EXCEPTION 'مقدار سفارش باید عدد مثبت با حداکثر سه رقم اعشار باشد';
    END IF;
    quantity:=(item->>'quantity')::numeric;
    IF quantity<=0 OR quantity>999999999 THEN RAISE EXCEPTION 'مقدار سفارش خارج از محدوده مجاز است'; END IF;
    IF COALESCE(item->>'unit_cost','') !~ '^[0-9]+([.][0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'بهای واحد باید عدد صفر یا مثبت باشد';
    END IF;
    cost:=(item->>'unit_cost')::numeric;
    IF cost<0 OR cost>999999999999 THEN RAISE EXCEPTION 'بهای واحد خارج از محدوده مجاز است'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.products p WHERE p.id=product_id AND p.company_id=_company AND p.active=true) THEN
      RAISE EXCEPTION 'یکی از محصولات متعلق به این مجموعه نیست یا غیرفعال است';
    END IF;
    INSERT INTO public.purchase_order_items(company_id,purchase_order_id,product_id,ordered_quantity,unit_cost)
    VALUES(_company,order_id,product_id,quantity,cost);
  END LOOP;

  INSERT INTO public.audit_events(company_id,actor_id,table_name,record_id,action,changes,occurred_at)
  VALUES(_company,_actor,'purchase_orders',order_id,'purchase_order.created',
    jsonb_build_object('supplier_id',_supplier,'reference',trim(_reference),'item_count',item_count,'status','draft'),now());
  RETURN order_id;
END $$;

CREATE OR REPLACE FUNCTION public.medar_approve_purchase_order(
  _actor uuid,
  _company uuid,
  _purchase_order uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE role_name text; current_status text; order_ref text; approved_id uuid;
BEGIN
  SELECT m.role::text INTO role_name
  FROM public.memberships m
  WHERE m.company_id=_company AND m.user_id=_actor AND m.active=true
  ORDER BY CASE m.role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
  LIMIT 1;
  IF role_name IS NULL OR role_name NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'فقط مالک یا مدیر می‌تواند سفارش خرید را تأیید کند';
  END IF;

  SELECT po.status,po.reference INTO current_status,order_ref
  FROM public.purchase_orders po
  WHERE po.id=_purchase_order AND po.company_id=_company FOR UPDATE;
  IF current_status IS NULL THEN RAISE EXCEPTION 'سفارش خرید در این مجموعه پیدا نشد'; END IF;
  IF current_status<>'draft' THEN RAISE EXCEPTION 'فقط سفارش خرید پیش‌نویس قابل تأیید است'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.purchase_order_items poi WHERE poi.purchase_order_id=_purchase_order AND poi.company_id=_company) THEN
    RAISE EXCEPTION 'سفارش خرید بدون قلم قابل تأیید نیست';
  END IF;

  UPDATE public.purchase_orders
  SET status='approved',approved_by=_actor,approved_at=now(),updated_at=now()
  WHERE id=_purchase_order AND company_id=_company
  RETURNING id INTO approved_id;
  INSERT INTO public.audit_events(company_id,actor_id,table_name,record_id,action,changes,occurred_at)
  VALUES(_company,_actor,'purchase_orders',approved_id,'purchase_order.approved',
    jsonb_build_object('reference',order_ref,'status','approved'),now());
  RETURN approved_id;
END $$;

CREATE OR REPLACE FUNCTION public.medar_receive_purchase_order(
  _actor uuid,
  _company uuid,
  _purchase_order uuid,
  _items jsonb,
  _reference text DEFAULT NULL,
  _note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  role_name text;
  order_supplier uuid;
  order_ref text;
  order_status text;
  item jsonb;
  line_id uuid;
  product_id uuid;
  ordered_qty numeric;
  received_qty numeric;
  unit_cost_value numeric;
  receive_qty numeric;
  receipt_ref text;
  receipt_note text;
  new_order_status text;
  line_count integer;
BEGIN
  SELECT m.role::text INTO role_name
  FROM public.memberships m
  WHERE m.company_id=_company AND m.user_id=_actor AND m.active=true
  ORDER BY CASE m.role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END
  LIMIT 1;
  IF role_name IS NULL OR role_name NOT IN ('owner','admin','staff') THEN
    RAISE EXCEPTION 'ثبت رسید سفارش خرید برای این نقش مجاز نیست';
  END IF;

  SELECT po.supplier_id,po.reference,po.status
  INTO order_supplier,order_ref,order_status
  FROM public.purchase_orders po
  WHERE po.id=_purchase_order AND po.company_id=_company
  FOR UPDATE;
  IF order_supplier IS NULL THEN RAISE EXCEPTION 'سفارش خرید در این مجموعه پیدا نشد'; END IF;
  IF order_status NOT IN ('approved','partially_received') THEN
    RAISE EXCEPTION 'فقط سفارش خرید تأییدشده یا دارای دریافت جزئی قابل رسیدگیری است';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items)<>'array' THEN RAISE EXCEPTION 'اقلام رسید باید یک آرایه معتبر باشد'; END IF;
  line_count:=jsonb_array_length(_items);
  IF line_count<1 OR line_count>100 THEN RAISE EXCEPTION 'رسید باید بین ۱ تا ۱۰۰ قلم داشته باشد'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_items) x WHERE jsonb_typeof(x)<>'object') THEN
    RAISE EXCEPTION 'ساختار یکی از اقلام رسید معتبر نیست';
  END IF;
  IF (SELECT count(DISTINCT x->>'purchase_order_item_id') FROM jsonb_array_elements(_items) x)
      <> line_count THEN RAISE EXCEPTION 'هر قلم سفارش فقط یک بار در هر رسید وارد شود'; END IF;
  IF _reference IS NOT NULL AND length(trim(_reference))>120 THEN RAISE EXCEPTION 'مرجع رسید بیش از حد مجاز است'; END IF;
  IF _note IS NOT NULL AND length(_note)>2000 THEN RAISE EXCEPTION 'یادداشت رسید بیش از حد مجاز است'; END IF;

  receipt_ref:=COALESCE(NULLIF(trim(_reference),''),order_ref);
  receipt_note:=COALESCE(NULLIF(trim(_note),''),'رسید سفارش خرید '||order_ref);

  FOR item IN
    SELECT value FROM jsonb_array_elements(_items) AS e(value)
    ORDER BY value->>'purchase_order_item_id'
  LOOP
    IF COALESCE(item->>'purchase_order_item_id','') !~* '^[0-9a-f-]{36}$' THEN
      RAISE EXCEPTION 'شناسه یکی از اقلام سفارش معتبر نیست';
    END IF;
    IF COALESCE(item->>'quantity_received','') !~ '^[0-9]+([.][0-9]{1,3})?$' THEN
      RAISE EXCEPTION 'مقدار دریافتی باید عدد مثبت با حداکثر سه رقم اعشار باشد';
    END IF;
    line_id:=(item->>'purchase_order_item_id')::uuid;
    receive_qty:=(item->>'quantity_received')::numeric;
    IF receive_qty<=0 OR receive_qty>999999999 THEN RAISE EXCEPTION 'مقدار دریافتی خارج از محدوده مجاز است'; END IF;

    SELECT poi.product_id,poi.ordered_quantity,poi.received_quantity,poi.unit_cost
    INTO product_id,ordered_qty,received_qty,unit_cost_value
    FROM public.purchase_order_items poi
    WHERE poi.id=line_id AND poi.company_id=_company AND poi.purchase_order_id=_purchase_order
    FOR UPDATE;
    IF product_id IS NULL THEN RAISE EXCEPTION 'قلم سفارش به این سفارش و مجموعه تعلق ندارد'; END IF;
    IF received_qty+receive_qty>ordered_qty THEN
      RAISE EXCEPTION 'مقدار دریافتی از مانده سفارش بیشتر است؛ مانده: %',GREATEST(0,ordered_qty-received_qty);
    END IF;

    PERFORM public.medar_record_inventory_movement(
      _actor,_company,product_id,'purchase_in',receive_qty,unit_cost_value,order_supplier,
      NULL,NULL,receipt_ref,receipt_note
    );
    UPDATE public.purchase_order_items
    SET received_quantity=received_quantity+receive_qty,updated_at=now()
    WHERE id=line_id AND company_id=_company;
  END LOOP;

  IF NOT EXISTS(
    SELECT 1 FROM public.purchase_order_items poi
    WHERE poi.purchase_order_id=_purchase_order AND poi.company_id=_company
      AND poi.received_quantity<poi.ordered_quantity
  ) THEN
    new_order_status:='received';
  ELSE
    new_order_status:='partially_received';
  END IF;
  UPDATE public.purchase_orders
  SET status=new_order_status,
      received_at=CASE WHEN new_order_status='received' THEN COALESCE(received_at,now()) ELSE received_at END,
      updated_at=now()
  WHERE id=_purchase_order AND company_id=_company;

  INSERT INTO public.audit_events(company_id,actor_id,table_name,record_id,action,changes,occurred_at)
  VALUES(_company,_actor,'purchase_orders',_purchase_order,'purchase_order.received',
    jsonb_build_object('reference',order_ref,'receipt_reference',receipt_ref,'status',new_order_status,'lines_received',line_count),now());
  RETURN _purchase_order;
END $$;
