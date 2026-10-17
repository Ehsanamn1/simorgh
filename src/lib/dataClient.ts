import { HttpError } from './http';
import { medarApiUrl, MEDAR_API_CONFIGURATION_ERROR } from './runtimeConfig';

export const isDataApiConfigured = import.meta.env.VITE_DISABLE_API_UI !== 'true' && !MEDAR_API_CONFIGURATION_ERROR;

type Filter = { column: string; op: string; value?: unknown };
type Order = { column: string; ascending: boolean };
type ApiError = { message: string; code?: string; details?: string };
type ApiResult<T = any> = { data: T | null; error: ApiError | null; count: number | null };

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new HttpError(503, 'این میزبان به API مدار متصل نیست؛ نسخه عملیاتی باید از Cloudflare Worker باز شود.');
  }
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    throw new HttpError(502, 'پاسخ API مدار معتبر نیست.');
  }
}

class DataQuery implements PromiseLike<ApiResult> {
  private action = 'select';
  private selection = '*';
  private values: unknown;
  private filters: Filter[] = [];
  private orFilters: Filter[] = [];
  private orderBy: Order | null = null;
  private limitValue = 200;
  private countRequested = false;
  private headRequested = false;
  private cardinality: 'many' | 'single' | 'maybeSingle' = 'many';
  private executed: Promise<ApiResult> | null = null;

  constructor(private readonly table: string) {}

  select(selection = '*', options?: { count?: string; head?: boolean }): this {
    this.selection = selection;
    this.countRequested = options?.count === 'exact';
    this.headRequested = options?.head === true;
    return this;
  }
  eq(column: string, value: unknown): this { this.filters.push({ column, op: 'eq', value }); return this; }
  neq(column: string, value: unknown): this { this.filters.push({ column, op: 'neq', value }); return this; }
  gt(column: string, value: unknown): this { this.filters.push({ column, op: 'gt', value }); return this; }
  gte(column: string, value: unknown): this { this.filters.push({ column, op: 'gte', value }); return this; }
  lt(column: string, value: unknown): this { this.filters.push({ column, op: 'lt', value }); return this; }
  lte(column: string, value: unknown): this { this.filters.push({ column, op: 'lte', value }); return this; }
  like(column: string, value: unknown): this { this.filters.push({ column, op: 'like', value }); return this; }
  ilike(column: string, value: unknown): this { this.filters.push({ column, op: 'ilike', value }); return this; }
  is(column: string, value: unknown): this { this.filters.push({ column, op: 'is', value }); return this; }
  in(column: string, value: unknown[]): this { this.filters.push({ column, op: 'in', value }); return this; }
  not(column: string, operator: string, value: unknown): this {
    this.filters.push({ column, op: operator === 'is' ? 'not_is' : operator === 'in' ? 'not_in' : 'neq', value });
    return this;
  }
  or(expression: string): this {
    const pieces = expression.split(',').flatMap((piece) => {
      const match = piece.match(/^([a-z_][a-z0-9_]*)\.(is|eq|neq|gt|gte|lt|lte|ilike|like)\.(.*)$/i);
      if (!match) return [];
      const raw = match[3];
      const value = match[2].toLowerCase() === 'is' && raw === 'null' ? null : raw;
      return [{ column: match[1], op: match[2].toLowerCase(), value }];
    });
    this.orFilters.push(...pieces);
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: options?.ascending === true };
    return this;
  }
  limit(value: number): this {
    if (Number.isFinite(value)) this.limitValue = Math.max(1, Math.min(500, Math.trunc(value)));
    return this;
  }
  insert(values: unknown): this { this.action = 'insert'; this.values = values; return this; }
  update(values: unknown): this { this.action = 'update'; this.values = values; return this; }
  delete(): this { this.action = 'delete'; return this; }
  upsert(values: unknown): this { this.action = 'insert'; this.values = values; return this; }
  single(): this { this.cardinality = 'single'; return this; }
  maybeSingle(): this { this.cardinality = 'maybeSingle'; return this; }

  private run(): Promise<ApiResult> {
    if (this.executed) return this.executed;
    this.executed = (async () => {
      try {
        const response = await fetch(medarApiUrl('/api/data/' + encodeURIComponent(this.table)), {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { 'content-type': 'application/json', 'x-application-name': 'medar-network' },
          body: JSON.stringify({
            action: this.action,
            selection: this.selection,
            values: this.values,
            filters: this.filters,
            orFilters: this.orFilters,
            order: this.orderBy,
            limit: this.limitValue,
            count: this.countRequested,
            head: this.headRequested,
          }),
        });
        const payload = await readJson(response);
        if (!response.ok) {
          const message = typeof payload.message === 'string' ? payload.message : 'درخواست داده ناموفق بود.';
          return { data: null, error: { message }, count: null };
        }
        const rows = Array.isArray(payload.data) ? payload.data : [];
        let data: unknown = rows;
        if (this.cardinality === 'single') {
          if (rows.length !== 1) return { data: null, error: { message: 'باید دقیقاً یک رکورد برگردد.' }, count: Number(payload.count ?? rows.length) };
          data = rows[0];
        } else if (this.cardinality === 'maybeSingle') {
          if (rows.length > 1) return { data: null, error: { message: 'بیش از یک رکورد برای خروجی تکی پیدا شد.' }, count: Number(payload.count ?? rows.length) };
          data = rows[0] ?? null;
        }
        return { data: data as any, error: null, count: payload.count == null ? null : Number(payload.count) };
      } catch (caught) {
        return { data: null, error: { message: caught instanceof HttpError ? caught.message : 'ارتباط با API مدار برقرار نشد.' }, count: null };
      }
    })();
    return this.executed;
  }

  then<TResult1 = ApiResult, TResult2 = never>(
    onfulfilled?: ((value: ApiResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class FileBucket {
  constructor(private readonly bucket: string) {}
  async upload(path: string, file: Blob, options?: { upsert?: boolean; contentType?: string }): Promise<ApiResult> {
    try {
      const response = await fetch(API_BASE_URL + '/api/storage/' + encodeURIComponent(this.bucket) + '?path=' + encodeURIComponent(path), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': options?.contentType || file.type || 'application/octet-stream', 'x-upsert': options?.upsert ? 'true' : 'false' },
        body: file,
      });
      const payload = await readJson(response);
      if (!response.ok) return { data: null, error: { message: String(payload.message ?? 'بارگذاری فایل ناموفق بود.') }, count: null };
      return { data: payload.data ?? { path }, error: null, count: null };
    } catch {
      return { data: null, error: { message: 'ارتباط با فضای فایل مدار برقرار نشد.' }, count: null };
    }
  }
  getPublicUrl(path: string): { data: { publicUrl: string } } {
    return { data: { publicUrl: API_BASE_URL + '/api/storage/' + encodeURIComponent(this.bucket) + '?path=' + encodeURIComponent(path) } };
  }
  async remove(paths: string[]): Promise<ApiResult> {
    try {
      const response = await fetch(API_BASE_URL + '/api/storage/' + encodeURIComponent(this.bucket) + '/remove', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paths }),
      });
      const payload = await readJson(response);
      if (!response.ok) return { data: null, error: { message: String(payload.message ?? 'حذف فایل ناموفق بود.') }, count: null };
      return { data: payload.data ?? [], error: null, count: null };
    } catch {
      return { data: null, error: { message: 'ارتباط با فضای فایل مدار برقرار نشد.' }, count: null };
    }
  }
}

export const dataApi: any = isDataApiConfigured ? {
  from(table: string) {
    return new DataQuery(table);
  },
  async rpc(name: string, args: Record<string, unknown> = {}): Promise<ApiResult> {
    try {
      const response = await fetch(API_BASE_URL + '/api/rpc/' + encodeURIComponent(name), {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args }),
      });
      const payload = await readJson(response);
      if (!response.ok) return { data: null, error: { message: String(payload.message ?? 'اجرای عملیات ناموفق بود.') }, count: null };
      return { data: payload.data ?? null, error: null, count: null };
    } catch {
      return { data: null, error: { message: 'ارتباط با API مدار برقرار نشد.' }, count: null };
    }
  },
  storage: {
    from(bucket: string) {
      return new FileBucket(bucket);
    },
  },
} : null;
