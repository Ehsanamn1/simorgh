import { describe, expect, it } from 'vitest';
import { buildMembershipScopeSql, canTransitionMedarStatus, decodePrivateBytes, encodePrivateBytes, normalizeUsername, resolveRpcArguments, sanitizeExternalRows } from '../../worker/index';

describe('Worker username/password input validation', () => {
  it('canonicalizes usernames and rejects malformed or ambiguous values', () => {
    expect(normalizeUsername(' Owner.Test ')).toBe('owner.test');
    expect(normalizeUsername('کاربر۱۲۳')).toBe('کاربر۱۲۳');
    expect(normalizeUsername('test_user-7')).toBe('test_user-7');
    expect(normalizeUsername('ab')).toBeNull();
    expect(normalizeUsername('_owner')).toBeNull();
    expect(normalizeUsername('owner!')).toBeNull();
    expect(normalizeUsername('')).toBeNull();
  });
});

describe('RPC defaulted argument handling', () => {
  const names = ['_actor', '_task', '_completion_note'];
  const types = ['uuid', 'uuid', 'text'];

  it('omits an absent optional note so PostgreSQL applies its declared default', () => {
    expect(resolveRpcArguments(names, types, 1, {
      _actor: 'actor-uuid',
      _task: 'task-uuid',
    })).toEqual({
      names: ['_actor', '_task'],
      types: ['uuid', 'uuid'],
      values: ['actor-uuid', 'task-uuid'],
    });
  });

  it('preserves an explicitly supplied optional argument', () => {
    expect(resolveRpcArguments(names, types, 1, {
      _actor: 'actor-uuid',
      _task: 'task-uuid',
      _completion_note: 'completed safely',
    })).toEqual({
      names,
      types,
      values: ['actor-uuid', 'task-uuid', 'completed safely'],
    });
  });

  it('rejects missing required args and caller-supplied unknown args', () => {
    expect(resolveRpcArguments(names, types, 1, { _actor: 'actor-uuid' })).toBeNull();
    expect(resolveRpcArguments(names, types, 1, {
      _actor: 'actor-uuid',
      _task: 'task-uuid',
      _admin: true,
    })).toBeNull();
  });

  it('allows safe array type metadata but rejects malformed SQL type metadata', () => {
    expect(resolveRpcArguments(['_actor', '_ids'], ['uuid', 'text[]'], 0, {
      _actor: 'actor-uuid',
      _ids: ['one', 'two'],
    })?.types).toEqual(['uuid', 'text[]']);
    expect(resolveRpcArguments(['_actor', '_task'], ['uuid', 'uuid); drop table public.companies; --'], 0, {
      _actor: 'actor-uuid',
      _task: 'task-uuid',
    })).toBeNull();
  });
});

describe('Tenant membership isolation', () => {
  it('restricts customer rows to the linked customer and company', () => {
    const params: unknown[] = [];
    const scope = buildMembershipScopeSql('orders', new Set(['company_id', 'customer_id']), [
      { company_id: 'company-a', role: 'customer', customer_id: 'customer-a', supplier_id: null },
    ], 'user-a', params);
    expect(scope).toBe('((company_id = $1 and customer_id = $2))');
    expect(params).toEqual(['company-a', 'customer-a']);
  });

  it('keeps each membership constrained to its own company when users belong to multiple workspaces', () => {
    const params: unknown[] = [];
    const scope = buildMembershipScopeSql('orders', new Set(['company_id', 'customer_id']), [
      { company_id: 'company-a', role: 'owner', customer_id: null, supplier_id: null },
      { company_id: 'company-b', role: 'customer', customer_id: 'customer-b', supplier_id: null },
    ], 'user-a', params);
    expect(scope).toBe('((company_id = $1) or (company_id = $2 and customer_id = $3))');
    expect(params).toEqual(['company-a', 'company-b', 'customer-b']);
  });

  it('allows same-company internal reads of legacy access requests but denies external roles', () => {
    const internalParams: unknown[] = [];
    const internalScope = buildMembershipScopeSql('access_requests', new Set(['company_id']), [
      { company_id: 'company-a', role: 'owner', customer_id: null, supplier_id: null },
    ], 'owner-a', internalParams);
    expect(internalScope).toBe('((company_id = $1))');
    expect(internalParams).toEqual(['company-a']);
    const externalScope = buildMembershipScopeSql('access_requests', new Set(['company_id']), [
      { company_id: 'company-a', role: 'supplier', customer_id: null, supplier_id: 'supplier-a' },
    ], 'supplier-user', []);
    expect(externalScope).toBe('((false))');
  });
  it('restricts supplier task access to the assigned supplier', () => {
    const params: unknown[] = [];
    const scope = buildMembershipScopeSql('operational_tasks', new Set(['company_id', 'assignee_supplier_id']), [
      { company_id: 'company-a', role: 'supplier', customer_id: null, supplier_id: 'supplier-a' },
    ], 'user-a', params);
    expect(scope).toBe('((company_id = $1 and assignee_supplier_id = $2))');
    expect(params).toEqual(['company-a', 'supplier-a']);
  });

  it('fails closed for tables not explicitly scoped to an external role', () => {
    const params: unknown[] = [];
    expect(buildMembershipScopeSql('partner_financial_entries', new Set(['company_id', 'amount']), [
      { company_id: 'company-a', role: 'customer', customer_id: 'customer-a', supplier_id: null },
    ], 'user-a', params)).toBe('((false))');
    expect(buildMembershipScopeSql('orders', new Set(['customer_id']), [
      { company_id: 'company-a', role: 'owner', customer_id: null, supplier_id: null },
    ], 'user-a', [])).toBe('false');
  });

  it('redacts driver financial data recursively while preserving ordinary operational fields', () => {
    const rows = sanitizeExternalRows('shipments', [{
      company_id: 'company-a', id: 'shipment-a', stage: 'in_transit', amount: 4000,
      payment_reference: 'private-reference', nested: [{ company_id: 'company-a', unit_price: 120, net_result: 10, label: 'safe' }],
    }], [{ company_id: 'company-a', role: 'driver', customer_id: null, supplier_id: null }]);
    expect(rows[0]).toMatchObject({ id: 'shipment-a', stage: 'in_transit' });
    expect(rows[0]).not.toHaveProperty('amount');
    expect(rows[0]).not.toHaveProperty('payment_reference');
    expect((rows[0].nested as Record<string, unknown>[])[0]).not.toHaveProperty('unit_price');
    expect((rows[0].nested as Record<string, unknown>[])[0]).not.toHaveProperty('net_result');
    expect((rows[0].nested as Record<string, unknown>[])[0]).toHaveProperty('label', 'safe');
  });
});

describe('Medar operational state transitions', () => {
  it('allows only the next valid order states', () => {
    expect(canTransitionMedarStatus('orders', 'draft', 'submitted')).toBe(true);
    expect(canTransitionMedarStatus('orders', 'submitted', 'confirmed')).toBe(true);
    expect(canTransitionMedarStatus('orders', 'confirmed', 'allocated')).toBe(true);
    expect(canTransitionMedarStatus('orders', 'draft', 'delivered')).toBe(false);
    expect(canTransitionMedarStatus('orders', 'delivered', 'cancelled')).toBe(false);
  });

  it('keeps shipment progression ordered and terminal states closed', () => {
    expect(canTransitionMedarStatus('shipments', 'planned', 'loading')).toBe(true);
    expect(canTransitionMedarStatus('shipments', 'in_transit', 'arrived')).toBe(true);
    expect(canTransitionMedarStatus('shipments', 'planned', 'delivered')).toBe(false);
    expect(canTransitionMedarStatus('shipments', 'delivered', 'loading')).toBe(false);
  });

  it('requires invoices to be issued before payment states', () => {
    expect(canTransitionMedarStatus('invoices', 'draft', 'issued')).toBe(true);
    expect(canTransitionMedarStatus('invoices', 'issued', 'paid')).toBe(true);
    expect(canTransitionMedarStatus('invoices', 'draft', 'paid')).toBe(false);
    expect(canTransitionMedarStatus('invoices', 'paid', 'void')).toBe(false);
  });

  it('requires settlement approval before recording payment', () => {
    expect(canTransitionMedarStatus('settlements', 'pending', 'approved')).toBe(true);
    expect(canTransitionMedarStatus('settlements', 'approved', 'paid')).toBe(true);
    expect(canTransitionMedarStatus('settlements', 'pending', 'paid')).toBe(false);
    expect(canTransitionMedarStatus('settlements', 'paid', 'disputed')).toBe(false);
  });
});


describe('Private evidence byte encoding', () => {
  it('round-trips binary bytes including null and high-byte values', () => {
    const original = Uint8Array.from([0, 1, 2, 10, 127, 128, 200, 254, 255]);
    expect(Array.from(decodePrivateBytes(encodePrivateBytes(original)))).toEqual(Array.from(original));
  });

  it('round-trips data across the base64 encoder chunk boundary', () => {
    const original = new Uint8Array(32771);
    for (let index = 0; index < original.length; index += 1) original[index] = (index * 37) % 256;
    expect(Array.from(decodePrivateBytes(encodePrivateBytes(original)))).toEqual(Array.from(original));
  });
});
