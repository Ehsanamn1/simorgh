import { neon } from '@neondatabase/serverless';

type Env = { DATABASE_URL?: string };
type Context = { request: Request; env: Env };
const encoder = new TextEncoder();
async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
function cookieToken(request: Request) {
  const part = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith('medar_session='));
  return part ? decodeURIComponent(part.slice('medar_session='.length)) : null;
}
export async function onRequest({ request, env }: Context) {
  if (request.method !== 'POST') return json({ message: 'روش درخواست مجاز نیست.' }, 405);
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return json({ message: 'مبدأ درخواست معتبر نیست.' }, 403);
  if (!(request.headers.get('content-type') || '').includes('application/json')) return json({ message: 'بدنه درخواست معتبر نیست.' }, 400);
  if (!env.DATABASE_URL) return json({ message: 'پایگاه داده پیکربندی نشده است.' }, 503);
  const token = cookieToken(request);
  if (!token || token.length > 200) return json({ message: 'برای ثبت درخواست ابتدا وارد حساب شو.' }, 401);
  try {
    const sql = neon(env.DATABASE_URL);
    const tokenHash = await digest(token);
    const users = await sql`SELECT u.id FROM public.medar_sessions s JOIN public.medar_users u ON u.id=s.user_id
      WHERE s.token_hash=${tokenHash} AND s.revoked_at IS NULL AND s.expires_at > now() AND u.account_status='active' LIMIT 1`;
    if (!users[0]) return json({ message: 'نشست کاربری معتبر نیست. دوباره وارد شو.' }, 401);
    const data = await request.json() as Record<string, unknown>;
    const role = typeof data.role === 'string' ? data.role : '';
    const organization = typeof data.organizationName === 'string' ? data.organizationName.trim().slice(0,160) : null;
    if (!['customer','supplier','driver','staff'].includes(role)) return json({ message: 'نقش انتخابی معتبر نیست.' }, 400);
    if (['customer','supplier'].includes(role) && (!organization || organization.length < 2)) return json({ message: 'برای این نقش نام شرکت یا مزرعه ضروری است.' }, 400);
    const rows = await sql`INSERT INTO public.medar_access_requests (user_id, requested_role, organization_name)
      VALUES (${String((users[0] as {id:string}).id)}::uuid, ${role}, ${organization})
      ON CONFLICT (user_id, requested_role, status) DO UPDATE SET organization_name=EXCLUDED.organization_name
      RETURNING id, status`;
    await sql`INSERT INTO public.medar_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
      VALUES (${String((users[0] as {id:string}).id)}::uuid, 'access.requested', 'access_request', ${String((rows[0] as {id:string}).id)}, jsonb_build_object('role', ${role}))`;
    return json({ requestId: (rows[0] as {id:string}).id, status: (rows[0] as {status:string}).status }, 201);
  } catch {
    return json({ message: 'ثبت درخواست انجام نشد. اتصال پایگاه داده و اجرای مهاجرت را بررسی کن.' }, 500);
  }
}
