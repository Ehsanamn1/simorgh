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
export async function onRequest({ request, env }: Context) {
  if (request.method !== 'GET') return json({ message: 'روش درخواست مجاز نیست.' }, 405);
  if (!env.DATABASE_URL) return json({ message: 'پایگاه داده پیکربندی نشده است.' }, 503);
  const raw = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith('medar_session='));
  const token = raw ? decodeURIComponent(raw.slice('medar_session='.length)) : null;
  if (!token || token.length > 200) return json({ message: 'برای مشاهده فضای کاری ابتدا وارد حساب شو.' }, 401);
  try {
    const sql = neon(env.DATABASE_URL);
    const tokenHash = await digest(token);
    const rows = await sql`SELECT u.id FROM public.medar_sessions s JOIN public.medar_users u ON u.id=s.user_id
      WHERE s.token_hash=${tokenHash} AND s.revoked_at IS NULL AND s.expires_at > now() AND u.account_status='active' LIMIT 1`;
    if (!rows[0]) return json({ message: 'نشست کاربری معتبر نیست.' }, 401);
    const userId = String((rows[0] as {id:string}).id);
    const requests = await sql`SELECT id, requested_role AS role, organization_name AS "organizationName", status, created_at AS "createdAt"
      FROM public.medar_access_requests WHERE user_id=${userId}::uuid ORDER BY created_at DESC LIMIT 20`;
    // Memberships are intentionally empty until a tenant membership is explicitly approved and provisioned.
    return json({ memberships: [], accessRequests: requests });
  } catch {
    return json({ message: 'خواندن فضای کاری انجام نشد. مهاجرت Neon را بررسی کن.' }, 500);
  }
}
