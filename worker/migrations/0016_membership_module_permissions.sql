-- Company-scoped per-membership module/action overrides.
-- inherit_role_defaults=true is deliberately fail-open to the existing, separately enforced role scope.
CREATE TABLE IF NOT EXISTS public.medar_membership_module_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  module_key text NOT NULL CHECK (module_key IN (
    'home','command','agents','bank-reconciliation','orders','purchase-orders','customers','suppliers','contacts',
    'products','inventory','capacity','quality','shipments','finance','members','audit','catalog',
    'my-orders','my-account','supplier-work','supplier-capacity','supplier-settlement','driver-work',
    'farm-sites','flock-cycles','production-batches','daily-production','task-templates',
    'operational-tasks','incidents','partnership-agreements','partner-finance','partner-settlements',
    'contacts-import','goals'
  )),
  inherit_role_defaults boolean NOT NULL DEFAULT true,
  can_read boolean NOT NULL DEFAULT true,
  can_create boolean NOT NULL DEFAULT true,
  can_update boolean NOT NULL DEFAULT true,
  can_delete boolean NOT NULL DEFAULT false,
  can_approve boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES public.medar_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, membership_id, module_key)
);

CREATE INDEX IF NOT EXISTS medar_membership_module_permissions_company_member_idx
  ON public.medar_membership_module_permissions(company_id, membership_id);

CREATE OR REPLACE FUNCTION public.medar_check_membership_permission_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_membership_company uuid;
BEGIN
  SELECT m.company_id INTO v_membership_company
  FROM public.memberships m WHERE m.id = NEW.membership_id;
  IF v_membership_company IS NULL OR v_membership_company <> NEW.company_id THEN
    RAISE EXCEPTION 'عضویت انتخاب‌شده متعلق به این مجموعه نیست';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.medar_check_membership_permission_company() FROM PUBLIC;

DROP TRIGGER IF EXISTS medar_membership_permission_scope_guard ON public.medar_membership_module_permissions;
CREATE TRIGGER medar_membership_permission_scope_guard
BEFORE INSERT OR UPDATE OF company_id, membership_id
ON public.medar_membership_module_permissions
FOR EACH ROW EXECUTE FUNCTION public.medar_check_membership_permission_company();

COMMENT ON TABLE public.medar_membership_module_permissions IS
  'Optional company-scoped module/action overrides for a membership. Role scope and explicit approval checks remain enforced server-side.';
