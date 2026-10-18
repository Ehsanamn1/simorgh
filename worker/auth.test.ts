import { describe, expect, it } from 'vitest';
import {
  CREATE_OWNER_WORKSPACE_SQL,
  AI_PROVIDERS,
  requireAiEncryptionKey,
  canTransitionMedarStatus,
  isProductionBatchSubmissionValid,
  isProductionBatchCompletionReady,
  isPartnerFinancialEntryReadyToPost,
  DUMMY_PASSWORD_HASH,
  FAILED_LOGIN_UPSERT_SQL,
  normalizeUsername,
  parseClientHeartbeat,
  resolveApiModeAccess,
  aggregateModulePermissionRows,
  isBankReconciliationDirectionCompatible,
  isBankTransactionCurrencyCompatible,
  isMaskedBankAccountValid,
  allowedWebPushEndpoint,
  scopeHasModulePermission,
  verifyPassword,
} from './index';


describe('AI provider default model IDs', () => {
  it('uses model identifiers supported by the current provider APIs', () => {
    expect(AI_PROVIDERS.openai.model).toBe('gpt-6-luna');
    expect(AI_PROVIDERS.gemini.model).toBe('gemini-3.8-flash');
    expect(AI_PROVIDERS.deepseek.model).toBe('deepseek-flash');
    expect(AI_PROVIDERS.anthropic.model).toBe('claude-sonnet-5-5');
  });
});

describe('dedicated AI encryption key', () => {
  it('requires a non-empty dedicated secret instead of falling back to the database URL', () => {
    expect(requireAiEncryptionKey('stable-dedicated-key')).toBe('stable-dedicated-key');
    expect(() => requireAiEncryptionKey(undefined)).toThrow(/AI_ENCRYPTION_KEY/);
    expect(() => requireAiEncryptionKey('')).toThrow(/AI_ENCRYPTION_KEY/);
  });
});

describe('production and partner-finance status workflows', () => {
  it('allows only the intended production batch lifecycle transitions', () => {
    expect(canTransitionMedarStatus('production_batches', 'planned', 'active')).toBe(true);
    expect(canTransitionMedarStatus('production_batches', 'active', 'submitted_for_review')).toBe(true);
    expect(canTransitionMedarStatus('production_batches', 'submitted_for_review', 'approved')).toBe(true);
    expect(canTransitionMedarStatus('production_batches', 'approved', 'completed')).toBe(true);
    expect(canTransitionMedarStatus('production_batches', 'planned', 'completed')).toBe(false);
    expect(canTransitionMedarStatus('production_batches', 'completed', 'active')).toBe(false);
  });

  it('allows partner financial entries to be submitted, approved and posted, but never reopened after posting', () => {
    expect(canTransitionMedarStatus('partner_financial_entries', 'draft', 'submitted')).toBe(true);
    expect(canTransitionMedarStatus('partner_financial_entries', 'submitted', 'approved')).toBe(true);
    expect(canTransitionMedarStatus('partner_financial_entries', 'approved', 'posted')).toBe(true);
    expect(canTransitionMedarStatus('partner_financial_entries', 'submitted', 'posted')).toBe(false);
    expect(canTransitionMedarStatus('partner_financial_entries', 'posted', 'draft')).toBe(false);
    expect(canTransitionMedarStatus('partner_financial_entries', 'rejected', 'draft')).toBe(true);
  });

  it('rejects production review submissions with invalid produced/rejected quantities', () => {
    expect(isProductionBatchSubmissionValid(100, 5)).toBe(true);
    expect(isProductionBatchSubmissionValid('100', '5')).toBe(true);
    expect(isProductionBatchSubmissionValid(0, 0)).toBe(false);
    expect(isProductionBatchSubmissionValid(100, 101)).toBe(false);
    expect(isProductionBatchSubmissionValid(100, -1)).toBe(false);
  });

  it('requires passed quality, a valid lot ID, and a released lot with a passing review to complete production', () => {
    const lotId = '0b9a0d6f-f5a0-4a0f-9a9b-7d8b30d5d482';
    expect(isProductionBatchCompletionReady('passed', lotId, true)).toBe(true);
    expect(isProductionBatchCompletionReady('pending', lotId, true)).toBe(false);
    expect(isProductionBatchCompletionReady('passed', 'not-a-uuid', true)).toBe(false);
    expect(isProductionBatchCompletionReady('passed', lotId, false)).toBe(false);
  });

  it('requires real payment evidence before posting cash-related partner entries', () => {
    expect(isPartnerFinancialEntryReadyToPost('sale_collection', 'paid', 100, 100, 'bank-ref-1')).toBe(true);
    expect(isPartnerFinancialEntryReadyToPost('partner_advance', 'paid', '250', '250', 'bank-ref-2')).toBe(true);
    expect(isPartnerFinancialEntryReadyToPost('settlement_payment', 'paid', 400, 400, 'receipt-400')).toBe(true);
    expect(isPartnerFinancialEntryReadyToPost('sale_collection', 'unpaid', 0, 100, 'bank-ref-3')).toBe(false);
    expect(isPartnerFinancialEntryReadyToPost('sale_collection', 'paid', 90, 100, 'bank-ref-4')).toBe(false);
    expect(isPartnerFinancialEntryReadyToPost('sale_collection', 'paid', 100, 100, '   ')).toBe(false);
    expect(isPartnerFinancialEntryReadyToPost('sale_invoice', 'not_applicable', 0, 100, '')).toBe(true);
  });
});

describe('Worker API deployment mode isolation', () => {
  it('keeps an unconfigured or public-demo Worker read-only by default', () => {
    for (const mode of [undefined, 'public-demo', 'unknown']) {
      expect(resolveApiModeAccess(mode, 'GET', '/api/health')).toBe('allow');
      expect(resolveApiModeAccess(mode, 'GET', '/api/auth/me')).toBe('anonymous-session');
      expect(resolveApiModeAccess(mode, 'POST', '/api/auth/signup')).toBe('deny');
      expect(resolveApiModeAccess(mode, 'POST', '/api/auth/login')).toBe('deny');
      expect(resolveApiModeAccess(mode, 'POST', '/api/data/orders')).toBe('deny');
      expect(resolveApiModeAccess(mode, 'POST', '/api/storage/contract-documents')).toBe('deny');
    }
  });

  it('allows the full API only when the Worker is explicitly operational', () => {
    expect(resolveApiModeAccess('operational', 'POST', '/api/auth/signup')).toBe('allow');
    expect(resolveApiModeAccess('operational', 'POST', '/api/data/orders')).toBe('allow');
    expect(resolveApiModeAccess('operational', 'GET', '/api/storage/contract-documents')).toBe('allow');
  });

  it('does not allow unsafe methods to use public health/session exceptions', () => {
    expect(resolveApiModeAccess('public-demo', 'POST', '/api/health')).toBe('deny');
    expect(resolveApiModeAccess('public-demo', 'POST', '/api/auth/me')).toBe('deny');
  });
});

describe('shared web/mobile presence payload validation', () => {
  const valid = {
    companyId: '0b9a0d6f-f5a0-4a0f-9a9b-7d8b30d5d482',
    clientId: 'dd4bd88c-8c1d-4cf5-a9f2-61aafba2bdf1',
    platform: 'android',
    appVersion: '0.1.0',
  };

  it('accepts a validated platform heartbeat for an existing tenant', () => {
    expect(parseClientHeartbeat(valid)).toEqual(valid);
  });

  it('rejects unsupported platforms, malformed identifiers, and oversized versions', () => {
    expect(parseClientHeartbeat({ ...valid, platform: 'unknown' })).toBeNull();
    expect(parseClientHeartbeat({ ...valid, clientId: 'not-a-uuid' })).toBeNull();
    expect(parseClientHeartbeat({ ...valid, companyId: 'public' })).toBeNull();
    expect(parseClientHeartbeat({ ...valid, appVersion: 'v'.repeat(41) })).toBeNull();
    expect(parseClientHeartbeat(null)).toBeNull();
  });
});

describe('server-side username normalization', () => {
  it('lets PostgreSQL generate username_normalized during owner signup', () => {
    const columns = CREATE_OWNER_WORKSPACE_SQL.match(/insert into public\.medar_users\(([^)]+)\)/i)?.[1];
    expect(columns?.split(',').map((column) => column.trim())).toEqual([
      'username',
      'display_name',
      'password_hash',
      'requested_role',
      'account_status',
    ]);
    expect(CREATE_OWNER_WORKSPACE_SQL).toContain('returning id,username,username_normalized,display_name');
  });

  it('uses an explicit INSERT alias in the failed-login upsert', () => {
    expect(FAILED_LOGIN_UPSERT_SQL).toContain('INSERT INTO public.medar_rate_limits AS rate_limit');
    expect(FAILED_LOGIN_UPSERT_SQL).toContain('rate_limit.window_started_at');
    expect(FAILED_LOGIN_UPSERT_SQL).not.toContain('public.medar_rate_limits.window_started_at');
  });

  it('rejects PBKDF2 hashes above the Cloudflare Web Crypto iteration ceiling', async () => {
    const unsupportedHash = DUMMY_PASSWORD_HASH.replace('$100000$', '$310000$');
    await expect(verifyPassword('medar-invalid-login-dummy-password', unsupportedHash)).resolves.toBe(false);
  });

  it('uses a valid fixed PBKDF2 dummy verifier for missing-account login checks', async () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^pbkdf2_sha256\$100000\$/);
    await expect(verifyPassword('medar-invalid-login-dummy-password', DUMMY_PASSWORD_HASH)).resolves.toBe(true);
    await expect(verifyPassword('different-password', DUMMY_PASSWORD_HASH)).resolves.toBe(false);
  });

  it('normalizes usernames consistently and preserves legacy usernames', () => {
    expect(normalizeUsername('  Legacy_User  ')).toBe('legacy_user');
    expect(normalizeUsername('OWNER.TEST')).toBe('owner.test');
  });

  it('supports Persian usernames without requiring a phone number', () => {
    expect(normalizeUsername('کاربر_مدار')).toBe('کاربر_مدار');
  });

  it('rejects empty, malformed, or out-of-range username inputs', () => {
    expect(normalizeUsername(null)).toBeNull();
    expect(normalizeUsername({ username: 'bad' })).toBeNull();
    expect(normalizeUsername('@@')).toBeNull();
    expect(normalizeUsername('_starts_with_punctuation')).toBeNull();
    expect(normalizeUsername('a'.repeat(33))).toBeNull();
  });
});

describe('bank account and transaction input safeguards', () => {
  it('requires imported transaction currency to match the destination account', () => {
    expect(isBankTransactionCurrencyCompatible('IRR', 'IRR')).toBe(true);
    expect(isBankTransactionCurrencyCompatible('USD', 'USD')).toBe(true);
    expect(isBankTransactionCurrencyCompatible('IRR', 'USD')).toBe(false);
    expect(isBankTransactionCurrencyCompatible('IRR', 'irr')).toBe(false);
  });

  it('rejects full account numbers even when digits use Persian or Arabic numerals', () => {
    expect(isMaskedBankAccountValid('****1234')).toBe(true);
    expect(isMaskedBankAccountValid('****۱۲۳۴')).toBe(true);
    expect(isMaskedBankAccountValid('****١٢٣٤')).toBe(true);
    expect(isMaskedBankAccountValid('123456789012')).toBe(false);
    expect(isMaskedBankAccountValid('۱۲۳۴۵۶۷۸۹۰۱۲')).toBe(false);
  });
});

describe('bank reconciliation direction safeguards', () => {
  it('only reconciles bank receipts against incoming partner entries and payments against outgoing entries', () => {
    expect(isBankReconciliationDirectionCompatible('partner_financial_entry', 'incoming', 'inflow_to_company')).toBe(true);
    expect(isBankReconciliationDirectionCompatible('partner_financial_entry', 'incoming', 'partner_to_company')).toBe(true);
    expect(isBankReconciliationDirectionCompatible('partner_financial_entry', 'outgoing', 'outflow_from_company')).toBe(true);
    expect(isBankReconciliationDirectionCompatible('partner_financial_entry', 'outgoing', 'company_to_partner')).toBe(true);
    expect(isBankReconciliationDirectionCompatible('partner_financial_entry', 'incoming', 'outflow_from_company')).toBe(false);
    expect(isBankReconciliationDirectionCompatible('partner_financial_entry', 'outgoing', 'inflow_to_company')).toBe(false);
  });

  it('enforces direction for invoices, purchase orders, and settlements', () => {
    expect(isBankReconciliationDirectionCompatible('invoice', 'incoming')).toBe(true);
    expect(isBankReconciliationDirectionCompatible('invoice', 'outgoing')).toBe(false);
    expect(isBankReconciliationDirectionCompatible('purchase_order', 'outgoing')).toBe(true);
    expect(isBankReconciliationDirectionCompatible('settlement', 'incoming')).toBe(false);
    expect(isBankReconciliationDirectionCompatible('unsupported', 'incoming')).toBe(false);
  });
});

describe('company-scoped module permissions', () => {
  const staff = {
    membership_id: 'membership-staff',
    company_id: 'company-1',
    role: 'staff',
    customer_id: null,
    supplier_id: null,
  };
  const override = {
    membership_id: 'membership-staff',
    module_key: 'finance',
    inherit_role_defaults: false,
    can_read: false,
    can_create: true,
    can_update: false,
    can_delete: false,
    can_approve: false,
  };

  it('uses conservative inherited capability defaults for delegated roles', () => {
    expect(scopeHasModulePermission(staff, new Map(), 'can_read')).toBe(true);
    expect(scopeHasModulePermission(staff, new Map(), 'can_create')).toBe(true);
    expect(scopeHasModulePermission(staff, new Map(), 'can_update')).toBe(true);
    expect(scopeHasModulePermission(staff, new Map(), 'can_delete')).toBe(false);
    expect(scopeHasModulePermission(staff, new Map(), 'can_approve')).toBe(false);
  });

  it('uses explicit capabilities when a member has a custom module policy', () => {
    const policies = new Map([[staff.membership_id, override]]);
    expect(scopeHasModulePermission(staff, policies, 'can_read')).toBe(false);
    expect(scopeHasModulePermission(staff, policies, 'can_create')).toBe(true);
    expect(scopeHasModulePermission(staff, policies, 'can_update')).toBe(false);
    expect(scopeHasModulePermission(staff, policies, 'can_delete')).toBe(false);
    expect(scopeHasModulePermission(staff, policies, 'can_approve')).toBe(false);
  });

  it('preserves owner and admin authority while custom policy is applied to delegated roles', () => {
    const policies = new Map([[staff.membership_id, override]]);
    expect(scopeHasModulePermission({ ...staff, role: 'owner' }, policies, 'can_delete')).toBe(true);
    expect(scopeHasModulePermission({ ...staff, role: 'admin' }, policies, 'can_approve')).toBe(true);
  });

  it('does not let a second active delegated membership bypass a module denial', () => {
    const restricted = {
      role: 'staff', inherit_role_defaults: false,
      can_read: false, can_create: true, can_update: true, can_delete: false, can_approve: false,
    };
    const inherited = {
      role: 'driver', inherit_role_defaults: true,
      can_read: true, can_create: true, can_update: true, can_delete: false, can_approve: false,
    };
    expect(aggregateModulePermissionRows([restricted, inherited], 'can_read')).toBe(false);
    expect(aggregateModulePermissionRows([inherited], 'can_delete')).toBe(false);
    expect(aggregateModulePermissionRows([inherited], 'can_approve')).toBe(false);
    expect(aggregateModulePermissionRows([restricted, { ...inherited, role: 'owner' }], 'can_read')).toBe(true);
  });

  it('does not apply a policy to a different membership in the same company', () => {
    const otherMember = { ...staff, membership_id: 'membership-other' };
    const policies = new Map([[staff.membership_id, override]]);
    expect(scopeHasModulePermission(otherMember, policies, 'can_read')).toBe(true);
  });
});


describe('Web Push endpoint SSRF safeguards', () => {
  it('allows only HTTPS push service endpoints from known providers', () => {
    expect(allowedWebPushEndpoint('https://fcm.googleapis.com/fcm/send/example')?.hostname).toBe('fcm.googleapis.com');
    expect(allowedWebPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/example')?.hostname).toBe('updates.push.services.mozilla.com');
    expect(allowedWebPushEndpoint('https://web.push.apple.com/example')?.hostname).toBe('web.push.apple.com');
  });
  it('rejects arbitrary hosts, lookalikes, insecure schemes, credentials and nonstandard ports', () => {
    expect(allowedWebPushEndpoint('https://example.com/push')).toBeNull();
    expect(allowedWebPushEndpoint('https://fcm.googleapis.com.evil.test/push')).toBeNull();
    expect(allowedWebPushEndpoint('http://fcm.googleapis.com/push')).toBeNull();
    expect(allowedWebPushEndpoint('https://user:pass@fcm.googleapis.com/push')).toBeNull();
    expect(allowedWebPushEndpoint('https://fcm.googleapis.com:8443/push')).toBeNull();
    expect(allowedWebPushEndpoint('https://127.0.0.1/push')).toBeNull();
  });
});
