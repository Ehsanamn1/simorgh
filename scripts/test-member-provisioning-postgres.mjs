import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const workerSource = await readFile('worker/index.ts', 'utf8');
const match = workerSource.match(/export const MEMBER_ACCOUNT_INSERT_SQL\s*=([\s\S]*?);\s*\n\s*app\.post\('\/api\/workspace\/members\/create'/);
if (!match) throw new Error('Could not find MEMBER_ACCOUNT_INSERT_SQL in worker/index.ts');

// The expression is intentionally restricted to quoted string literals joined by +.
// Avoid evaluating arbitrary source just to extract the SQL used by the Worker.
const expression = match[1];
const tokens = expression.match(/"(?:\\.|[^"\\])*"/g) ?? [];
const residue = expression.replace(/"(?:\\.|[^"\\])*"/g, '').replace(/[+\s]/g, '');
if (!tokens.length || residue) throw new Error('Member provisioning SQL expression contains an unexpected non-literal token.');
const memberSql = tokens.map(token => JSON.parse(token)).join('');
if (!memberSql.includes('insert into public.medar_users') ||
    !memberSql.includes('insert into public.memberships') ||
    !memberSql.includes('insert into public.medar_audit_log')) {
  throw new Error('The extracted query is not the complete owner-provisioned account transaction.');
}

const companyId = '00000000-0000-4000-8000-000000000222';
const ownerId = '00000000-0000-4000-8000-000000000211';
const ownerMembershipId = '00000000-0000-4000-8000-000000000244';
const supplierId = '00000000-0000-4000-8000-000000000233';
const customerId = '00000000-0000-4000-8000-000000000255';
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const execute = (username, displayName, role, linkedCustomerId = null, linkedSupplierId = null) =>
  'EXECUTE medar_member_provisioning(' +
  [username, displayName, 'ci-only-not-a-real-login-hash', role, companyId, ownerId, linkedCustomerId, linkedSupplierId]
    .map(value => value === null ? 'NULL' : quote(value)).join(', ') + ');';

const sql = [
  'BEGIN;',
  `INSERT INTO public.companies(id,name) VALUES (${quote(companyId)},'CI member provisioning') ON CONFLICT(id) DO NOTHING;`,
  `INSERT INTO public.medar_users(id,username,username_normalized,phone_e164,display_name,password_hash,requested_role,account_status) VALUES (${quote(ownerId)},'ci_provision_owner','ci_provision_owner',NULL,'CI Provision Owner','ci-only-not-a-real-login-hash','owner','active') ON CONFLICT(id) DO NOTHING;`,
  `INSERT INTO public.memberships(id,company_id,user_id,role,active,created_by) VALUES (${quote(ownerMembershipId)},${quote(companyId)},${quote(ownerId)},'owner',true,${quote(ownerId)}) ON CONFLICT(id) DO NOTHING;`,
  `INSERT INTO public.suppliers(id,company_id,name) VALUES (${quote(supplierId)},${quote(companyId)},'CI Provision Supplier') ON CONFLICT(id) DO NOTHING;`,
  `INSERT INTO public.customers(id,company_id,name) VALUES (${quote(customerId)},${quote(companyId)},'CI Provision Customer') ON CONFLICT(id) DO NOTHING;`,
  `PREPARE medar_member_provisioning(text,text,text,text,uuid,uuid,uuid,uuid) AS ${memberSql};`,
  execute('ci_supplier_member','CI Supplier Member','supplier',null,supplierId),
  execute('ci_driver_member','CI Driver Member','driver'),
  execute('ci_staff_member','CI Staff Member','staff'),
  execute('ci_admin_member','CI Admin Member','admin'),
  execute('ci_customer_member','CI Customer Member','customer',customerId,null),
  `DO $verify_member_provisioning$
    DECLARE expected_count integer;
    BEGIN
      SELECT count(*) INTO expected_count FROM public.medar_users
      WHERE username_normalized IN ('ci_supplier_member','ci_driver_member','ci_staff_member','ci_admin_member','ci_customer_member')
        AND account_status='active';
      IF expected_count <> 5 THEN RAISE EXCEPTION 'Expected five active provisioned identities, got %', expected_count; END IF;

      SELECT count(*) INTO expected_count FROM public.profiles p JOIN public.medar_users u ON u.id=p.id
      WHERE u.username_normalized IN ('ci_supplier_member','ci_driver_member','ci_staff_member','ci_admin_member','ci_customer_member');
      IF expected_count <> 5 THEN RAISE EXCEPTION 'Expected five profile rows, got %', expected_count; END IF;

      SELECT count(*) INTO expected_count FROM public.memberships m JOIN public.medar_users u ON u.id=m.user_id
      WHERE m.company_id='${companyId}'::uuid AND m.active
        AND ((u.username_normalized='ci_supplier_member' AND m.role::text='supplier' AND m.supplier_id='${supplierId}'::uuid)
          OR (u.username_normalized='ci_driver_member' AND m.role::text='driver')
          OR (u.username_normalized='ci_staff_member' AND m.role::text='staff')
          OR (u.username_normalized='ci_admin_member' AND m.role::text='admin')
          OR (u.username_normalized='ci_customer_member' AND m.role::text='customer' AND m.customer_id='${customerId}'::uuid));
      IF expected_count <> 5 THEN RAISE EXCEPTION 'Expected all five correctly scoped memberships, got %', expected_count; END IF;

      SELECT count(*) INTO expected_count FROM public.medar_audit_log
      WHERE actor_user_id='${ownerId}'::uuid AND action='membership.account_created'
        AND metadata->>'company_id'='${companyId}';
      IF expected_count <> 5 THEN RAISE EXCEPTION 'Expected five account creation audit events, got %', expected_count; END IF;
    END
  $verify_member_provisioning$;
  'ROLLBACK;',
  ''
].join('\n');

const result = spawnSync('psql', ['-h', '127.0.0.1', '-U', 'postgres', '-d', 'medar_test', '-v', 'ON_ERROR_STOP=1'], {
  input: sql,
  encoding: 'utf8',
  env: process.env,
  maxBuffer: 5 * 1024 * 1024,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Real PostgreSQL transaction test passed: owner-provisioned supplier, driver, staff, admin and customer identities, profiles, memberships, record links and audit rows were all validated inside a rollback transaction. No fixture data was retained.');
