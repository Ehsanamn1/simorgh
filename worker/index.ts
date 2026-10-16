import { neon } from '@neondatabase/serverless';
import { Hono } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';

type Bindings = { DATABASE_URL?: string; NEON_AUTH_JWKS_URL?: string; ASSETS?: { fetch(request: Request): Promise<Response> } };
type AuthUser = { id: string; email: string; emailVerified: boolean };
type Ctx = { env: Bindings; req: { header(name: string): string | undefined; json<T>(): Promise<T> }; json(body: unknown, status?: number): Response };

const app = new Hono<{ Bindings: Bindings }>();

async function requireUser(c: Ctx): Promise<AuthUser | Response> {
  const databaseUrl = c.env.DATABASE_URL;
  const jwksUrl = c.env.NEON_AUTH_JWKS_URL;
  const header = c.req.header('authorization') ?? '';
  if (!databaseUrl || !jwksUrl || !header.startsWith('Bearer ')) return c.json({ message: 'احراز هویت لازم است.' }, 401);
  try {
    const { payload } = await jwtVerify(header.slice(7).trim(), createRemoteJWKSet(new URL(jwksUrl)));
    if (!payload.sub) return c.json({ message: 'نشست نامعتبر است.' }, 401);
    const sql = neon(databaseUrl);
    const rows = await sql`select id, email, "emailVerified" from neon_auth."user" where id=${payload.sub} limit 1`;
    const row = rows[0] as { id: string; email: string; emailVerified: boolean } | undefined;
    if (!row) return c.json({ message: 'حساب کاربری پیدا نشد.' }, 401);
    return row;
  } catch { return c.json({ message: 'نشست کاربری معتبر نیست.' }, 401); }
}

app.get('/api/health', (c) => c.json({ ok: true, service: 'medar-api', database: Boolean(c.env.DATABASE_URL), auth: Boolean(c.env.NEON_AUTH_JWKS_URL) }));

app.get('/api/auth/me', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const sql = neon(c.env.DATABASE_URL!);
  const memberships = await sql`select m.id, m.company_id as "companyId", m.role, m.active, c.name as "companyName"
    from public.memberships m join public.companies c on c.id=m.company_id
    where m.user_id=${user.id} and m.active=true order by m.created_at`;
  return c.json({ user, memberships });
});

app.get('/api/workspace/memberships', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const sql = neon(c.env.DATABASE_URL!);
  const memberships = await sql`select m.id, m.company_id as "companyId", m.user_id as "userId", m.role, m.active,
    json_build_object('id', c.id, 'name', c.name) as company
    from public.memberships m join public.companies c on c.id=m.company_id
    where m.user_id=${user.id} and m.active=true order by m.created_at`;
  return c.json({ memberships });
});

app.post('/api/workspace/provision', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  if (!user.emailVerified) return c.json({ message: 'تأیید ایمیل برای ساخت فضای کاری الزامی است.' }, 403);
  const body = await c.req.json<{ companyName?: string; fullName?: string; phone?: string }>();
  const companyName = body.companyName?.trim() ?? '';
  const fullName = body.fullName?.trim() ?? '';
  const phone = body.phone?.trim() || null;
  if (companyName.length < 2 || companyName.length > 160) return c.json({ message: 'نام مجموعه نامعتبر است.' }, 422);
  if (fullName.length < 2 || fullName.length > 160) return c.json({ message: 'نام کامل نامعتبر است.' }, 422);
  const sql = neon(c.env.DATABASE_URL!);
  const existing = await sql`select company_id as "companyId" from public.memberships where user_id=${user.id} and active=true and role='owner' order by created_at limit 1`;
  if (existing[0]) return c.json({ companyId: existing[0].companyId });
  const conflict = await sql`select 1 from public.memberships where user_id=${user.id} and active=true limit 1`;
  if (conflict[0]) return c.json({ message: 'این حساب از قبل به یک مجموعه متصل است.' }, 409);
  const companyRows = await sql`insert into public.companies(name) values(${companyName}) returning id`;
  const companyId = (companyRows[0] as { id: string }).id;
  await sql`insert into public.profiles(id,full_name,phone) values(${user.id},${fullName},${phone}) on conflict(id) do update set full_name=excluded.full_name, phone=coalesce(excluded.phone,public.profiles.phone), updated_at=now()`;
  await sql`insert into public.memberships(company_id,user_id,role,active,created_by) values(${companyId},${user.id},'owner',true,${user.id})`;
  return c.json({ companyId }, 201);
});

app.post('/api/access-requests', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<{ role?: string; fullName?: string; organizationName?: string | null; phone?: string | null }>();
  const allowed = ['staff','supplier','driver','customer'];
  if (!body.role || !allowed.includes(body.role)) return c.json({ message: 'نقش انتخاب‌شده معتبر نیست.' }, 422);
  const sql = neon(c.env.DATABASE_URL!);
  const rows = await sql`insert into public.access_requests(user_id,company_name,full_name,phone,requested_role)
    values(${user.id},${body.organizationName?.trim() || null},${body.fullName?.trim() || user.email},${body.phone?.trim() || null},${body.role}::public.app_role) returning id`;
  return c.json({ requestId: (rows[0] as { id: string }).id }, 201);
});

app.notFound((c) => c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.json({ message: 'مسیر پیدا نشد.' }, 404));

app.notFound((c) => c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.json({ message: 'مسیر پیدا نشد.' }, 404));

export default app;
