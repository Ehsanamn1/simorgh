import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Ban, CheckCircle2, ChevronDown, CreditCard, FileSpreadsheet, Link2, LoaderCircle, Plus, RefreshCw, ShieldCheck, Upload, X } from 'lucide-react';
import type { Membership } from './lib/types';
import { api } from './lib/apiClient';
import { parseBankStatementCsv, type ParsedBankTransaction } from './lib/bankStatement';

type BankAccount = {
  id: string; label: string; bankName: string; maskedAccount: string; currency: string; provider: string;
  connectionStatus: string; active: boolean; lastImportedAt: string | null; createdAt: string;
  transactionCount: number; unmatchedCount: number;
};
type BankTransaction = {
  id: string; bankAccountId: string; externalTransactionId: string; bookedAt: string; amount: string;
  currency: string; description: string; counterparty: string; reference: string; direction: 'incoming' | 'outgoing';
  reconciliationStatus: 'unmatched' | 'suggested' | 'reconciled' | 'ignored'; matchedEntityType?: string | null;
  matchedEntityId?: string | null; matchedAt?: string | null; importedAt: string;
};
type BankCandidate = {
  entityType: 'invoice' | 'purchase_order' | 'settlement' | 'partner_financial_entry';
  entityId: string; label: string; amount: string; dueAt: string | null; status: string;
};
type BankCapabilities = { canCreate: boolean; canUpdate: boolean; canDelete: boolean; canReconcile: boolean };
type Props = { membership: Membership };
const statusLabel: Record<BankTransaction['reconciliationStatus'], string> = {
  unmatched: 'تطبیق‌نشده', suggested: 'پیشنهاد تطبیق', reconciled: 'تطبیق نهایی', ignored: 'نادیده‌گرفته‌شده',
};
const entityLabel: Record<BankCandidate['entityType'], string> = {
  invoice: 'فاکتور', purchase_order: 'سفارش خرید', settlement: 'تسویه تأمین‌کننده', partner_financial_entry: 'سند مالی شریک',
};
function dateLabel(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(date) : '—';
}
function moneyLabel(amount: string | number, currency: string) {
  const value = Number(amount);
  return (Number.isFinite(value) ? new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(value) : '—') + ' ' + currency;
}

export function BankReconciliationPanel({ membership }: Props) {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [summary, setSummary] = useState({ total: 0, unmatched: 0, reconciled: 0 });
  const [capabilities, setCapabilities] = useState<BankCapabilities>({ canCreate: false, canUpdate: false, canDelete: false, canReconcile: false });
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [statusFilter, setStatusFilter] = useState('unmatched');
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountForm, setAccountForm] = useState({ label: '', bankName: '', maskedAccount: '', currency: 'IRR' });
  const [importing, setImporting] = useState(false);
  const [reconcileFor, setReconcileFor] = useState<BankTransaction | null>(null);
  const [candidates, setCandidates] = useState<BankCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState('');
  const [savingReconciliation, setSavingReconciliation] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    setError('');
    try {
      const result = await api.get<{
        accounts: BankAccount[];
        summary: { total: number; unmatched: number; reconciled: number };
        capabilities: BankCapabilities;
      }>('/api/finance/bank-accounts?companyId=' + encodeURIComponent(membership.company_id));
      const nextAccounts = result.accounts ?? [];
      setAccounts(nextAccounts);
      setSummary({
        total: Number(result.summary?.total ?? 0),
        unmatched: Number(result.summary?.unmatched ?? 0),
        reconciled: Number(result.summary?.reconciled ?? 0),
      });
      setCapabilities(result.capabilities ?? { canCreate: false, canUpdate: false, canDelete: false, canReconcile: false });
      setSelectedAccountId(current => nextAccounts.some(account => account.id === current) ? current : (nextAccounts[0]?.id ?? ''));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'حساب‌های بانکی بارگذاری نشدند.');
    } finally {
      setLoadingAccounts(false);
    }
  }, [membership.company_id]);

  const loadTransactions = useCallback(async () => {
    if (!selectedAccountId) {
      setTransactions([]);
      return;
    }
    setLoadingTransactions(true);
    try {
      const result = await api.get<{ transactions: BankTransaction[] }>(
        '/api/finance/bank-transactions?companyId=' + encodeURIComponent(membership.company_id) +
        '&accountId=' + encodeURIComponent(selectedAccountId) +
        '&status=' + encodeURIComponent(statusFilter),
      );
      setTransactions(result.transactions ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تراکنش‌های حساب دریافت نشدند.');
      setTransactions([]);
    } finally {
      setLoadingTransactions(false);
    }
  }, [membership.company_id, selectedAccountId, statusFilter]);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);
  useEffect(() => { void loadTransactions(); }, [loadTransactions]);

  useEffect(() => {
    let cancelled = false;
    if (!reconcileFor) {
      setCandidates([]);
      setSelectedCandidate('');
      return () => { cancelled = true; };
    }
    setLoadingCandidates(true);
    setError('');
    void api.get<{ candidates: BankCandidate[] }>(
      '/api/finance/bank-transactions/' + encodeURIComponent(reconcileFor.id) +
      '/candidates?companyId=' + encodeURIComponent(membership.company_id),
    ).then(result => {
      if (cancelled) return;
      setCandidates(result.candidates ?? []);
      setSelectedCandidate('');
    }).catch(caught => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : 'اسناد قابل تطبیق دریافت نشدند.');
    }).finally(() => { if (!cancelled) setLoadingCandidates(false); });
    return () => { cancelled = true; };
  }, [membership.company_id, reconcileFor?.id]);

  const selectedAccount = accounts.find(account => account.id === selectedAccountId);
  const candidateValue = useMemo(() => {
    const item = candidates.find(candidate => candidate.entityType + ':' + candidate.entityId === selectedCandidate);
    return item ?? null;
  }, [candidates, selectedCandidate]);

  async function createAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingAccount) return;
    setSavingAccount(true);
    setError('');
    setNotice('');
    try {
      const result = await api.post<{ account: BankAccount }>('/api/finance/bank-accounts', {
        companyId: membership.company_id,
        label: accountForm.label.trim(),
        bankName: accountForm.bankName.trim(),
        maskedAccount: accountForm.maskedAccount.trim(),
        currency: accountForm.currency,
      });
      setAccounts(current => [result.account, ...current.filter(item => item.id !== result.account.id)]);
      setSelectedAccountId(result.account.id);
      setFormOpen(false);
      setAccountForm({ label: '', bankName: '', maskedAccount: '', currency: 'IRR' });
      setNotice('حساب ثبت شد. این حساب فعلاً فقط برای ورود دستی CSV فعال است؛ اتصال بانکی مستقیمی تأیید نشده است.');
      await loadAccounts();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعریف حساب بانکی ناموفق بود.');
    } finally {
      setSavingAccount(false);
    }
  }

  async function importStatement(file: File | undefined) {
    if (!file) return;
    setError('');
    setNotice('');
    if (!selectedAccountId) {
      setError('ابتدا یک حساب بانکی تعریف یا انتخاب کن.');
      return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      const parsed: ParsedBankTransaction[] = parseBankStatementCsv(text, selectedAccount?.currency || 'IRR');
      const result = await api.post<{ inserted: number; skippedDuplicates: number; submitted: number }>(
        '/api/finance/bank-transactions/import',
        { companyId: membership.company_id, accountId: selectedAccountId, transactions: parsed },
      );
      setNotice(
        'ورود صورت‌حساب تمام شد: ' + Number(result.inserted).toLocaleString('fa-IR') +
        ' تراکنش جدید ثبت شد و ' + Number(result.skippedDuplicates).toLocaleString('fa-IR') +
        ' مورد تکراری نادیده گرفته شد. هیچ پرداخت یا سند تجاری به‌صورت خودکار ثبت نشد.',
      );
      await loadAccounts();
      await loadTransactions();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'خواندن یا ورود CSV ناموفق بود.');
    } finally {
      setImporting(false);
    }
  }

  async function reconcile() {
    if (!reconcileFor || !candidateValue || savingReconciliation) return;
    if (!window.confirm('تراکنش «' + reconcileFor.externalTransactionId + '» به «' + candidateValue.label + '» متصل شود؟ این کار فقط پیوند تطبیق را ثبت می‌کند و فاکتور، تسویه یا انتقال بانکی را تغییر نمی‌دهد.')) return;
    setSavingReconciliation(true);
    setError('');
    setNotice('');
    try {
      await api.post('/api/finance/bank-transactions/' + encodeURIComponent(reconcileFor.id) + '/reconcile', {
        companyId: membership.company_id,
        entityType: candidateValue.entityType,
        entityId: candidateValue.entityId,
      });
      setReconcileFor(null);
      setNotice('پیوند تطبیق مالی ثبت و در تاریخچه ثبت شد؛ هیچ پرداخت یا وضعیت سند تجاری به‌صورت خودکار تغییر نکرد.');
      await Promise.all([loadAccounts(), loadTransactions()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ثبت تطبیق مالی ناموفق بود.');
    } finally {
      setSavingReconciliation(false);
    }
  }

  async function ignore(transaction: BankTransaction) {
    if (!window.confirm('تراکنش «' + transaction.externalTransactionId + '» نادیده گرفته شود؟ این کار حذف تراکنش نیست.')) return;
    setError('');
    setNotice('');
    try {
      await api.post('/api/finance/bank-transactions/' + encodeURIComponent(transaction.id) + '/ignore', { companyId: membership.company_id });
      setNotice('تراکنش در وضعیت نادیده‌گرفته‌شده قرار گرفت.');
      await Promise.all([loadAccounts(), loadTransactions()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تغییر وضعیت تراکنش ناموفق بود.');
    }
  }

  return <section className="bank-reconciliation" dir="rtl">
    <header className="bank-section-header">
      <div className="bank-header-icon"><CreditCard size={21}/></div>
      <div className="bank-section-title"><p className="eyebrow">BANK / RECONCILIATION</p><h2>صورت‌حساب بانکی و تطبیق تراکنش</h2><p>تراکنش‌ها از فایل واقعی بانک وارد می‌شوند، تکراری‌ها رد می‌شوند و تطبیق با سند تجاری فقط پس از تأیید ثبت می‌شود.</p></div>
      <button type="button" className="bank-quiet-button" disabled={loadingAccounts || loadingTransactions} onClick={() => void Promise.all([loadAccounts(), loadTransactions()])}>
        {loadingAccounts || loadingTransactions ? <LoaderCircle size={15} className="ai-spin"/> : <RefreshCw size={15}/>} تازه‌سازی
      </button>
    </header>

    <div className="bank-policy-note"><ShieldCheck size={17}/><span><b>اتصال بانکی شفاف:</b> این بخش فعلاً ورود CSV و تطبیق دستی را پشتیبانی می‌کند. رمز ورود بانک، رمز پویا و اطلاعات محرمانه را وارد نکن. هیچ انتقال وجه یا پرداخت خودکاری انجام نمی‌شود.</span></div>
    {error && <div className="bank-feedback error" role="alert"><AlertTriangle size={16}/><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="بستن خطا"><X size={14}/></button></div>}
    {notice && <div className="bank-feedback notice" role="status"><CheckCircle2 size={16}/><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="بستن پیام"><X size={14}/></button></div>}

    <div className="bank-summary-grid">
      <article><small>کل تراکنش‌ها</small><b>{summary.total.toLocaleString('fa-IR')}</b><span><FileSpreadsheet size={14}/> از داده‌های واردشده</span></article>
      <article><small>نیازمند بررسی</small><b>{summary.unmatched.toLocaleString('fa-IR')}</b><span>تطبیق‌نشده یا پیشنهادی</span></article>
      <article><small>تطبیق نهایی</small><b>{summary.reconciled.toLocaleString('fa-IR')}</b><span><CheckCircle2 size={14}/> پیوند ثبت‌شده با سند</span></article>
    </div>

    <section className="bank-accounts-panel">
      <div className="bank-panel-heading"><div><b>حساب‌های ثبت‌شده</b><small>فقط نام نمایشی و چهار رقم پایانی ذخیره می‌شود.</small></div>{capabilities.canCreate&&<button type="button" className="bank-primary-button" onClick={() => setFormOpen(current => !current)}><Plus size={15}/> حساب جدید</button>}</div>
      {loadingAccounts ? <div className="bank-loading"><LoaderCircle size={21} className="ai-spin"/> در حال بارگذاری حساب‌ها…</div>
        : accounts.length ? <div className="bank-account-list">{accounts.map(account=><button type="button" key={account.id} className={'bank-account-card'+(account.id===selectedAccountId?' selected':'')} onClick={()=>{setSelectedAccountId(account.id);setReconcileFor(null);}}>
          <span className="bank-account-mark"><CreditCard size={18}/></span><span className="bank-account-main"><b>{account.label}</b><small>{[account.bankName,account.maskedAccount].filter(Boolean).join(' · ') || 'شناسه حساب ثبت نشده'}</small><small>{account.provider==='manual_csv'?'ورود صورت‌حساب CSV':'اتصال مالی خارجی'}</small></span>
          <span className="bank-account-meta"><b>{Number(account.transactionCount??0).toLocaleString('fa-IR')} تراکنش</b><small>{Number(account.unmatchedCount??0).toLocaleString('fa-IR')} بررسی‌نشده</small><small>آخرین ورود: {dateLabel(account.lastImportedAt)}</small></span>
          <ChevronDown size={16} className="bank-account-chevron"/>
        </button>)}</div> : <div className="bank-empty"><CreditCard size={24}/><b>حسابی تعریف نشده است</b><span>برای شروع، حساب را با نام و مشخصات ماسک‌شده ثبت کن؛ سپس فایل CSV واقعی صورت‌حساب را وارد کن.</span></div>}
      {formOpen&&<form className="bank-account-form" onSubmit={event=>void createAccount(event)}>
        <label>نام نمایشی حساب<input required minLength={2} maxLength={120} value={accountForm.label} onChange={event=>setAccountForm(current=>({...current,label:event.target.value}))} placeholder="مثلاً حساب جاری عملیات"/></label>
        <label>نام بانک<input maxLength={120} value={accountForm.bankName} onChange={event=>setAccountForm(current=>({...current,bankName:event.target.value}))} placeholder="نام بانک"/></label>
        <label>چهار رقم پایانی (اختیاری)<input dir="ltr" maxLength={40} value={accountForm.maskedAccount} onChange={event=>setAccountForm(current=>({...current,maskedAccount:event.target.value}))} placeholder="****1234"/><small>شماره کامل حساب یا کارت را وارد نکن.</small></label>
        <label>ارز<select value={accountForm.currency} onChange={event=>setAccountForm(current=>({...current,currency:event.target.value}))}><option value="IRR">IRR — ریال</option><option value="USD">USD — دلار آمریکا</option><option value="EUR">EUR — یورو</option><option value="AED">AED — درهم</option></select></label>
        <div className="bank-form-actions"><button type="button" className="bank-quiet-button" onClick={()=>setFormOpen(false)} disabled={savingAccount}>انصراف</button><button type="submit" className="bank-primary-button" disabled={savingAccount}>{savingAccount?<LoaderCircle size={15} className="ai-spin"/>:<Plus size={15}/>} ثبت حساب</button></div>
      </form>}
    </section>

    <section className="bank-transactions-panel">
      <div className="bank-panel-heading"><div><b>تراکنش‌های حساب</b><small>{selectedAccount?.label??'حسابی انتخاب نشده'} · ردیف‌های ثبت‌شده در دیتابیس</small></div>
        <div className="bank-transactions-tools">
          <select aria-label="فیلتر وضعیت تراکنش" value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="unmatched">نیازمند بررسی</option><option value="suggested">پیشنهادی</option><option value="reconciled">تطبیق نهایی</option><option value="ignored">نادیده‌گرفته‌شده</option><option value="all">همه</option></select>
          {capabilities.canCreate&&<label className={'bank-import-button'+(!selectedAccountId||importing?' disabled':'')}><Upload size={15}/>{importing?'در حال ورود…':'ورود فایل CSV'}<input type="file" accept=".csv,text/csv,.txt,text/plain" disabled={!selectedAccountId||importing} onChange={event=>{const file=event.currentTarget.files?.[0];void importStatement(file);event.currentTarget.value='';}}/></label>}
        </div>
      </div>
      <p className="bank-csv-help">CSV باید ستون شناسه یکتا، تاریخ و مبلغ داشته باشد؛ نام‌های رایج فارسی/انگلیسی و تاریخ شمسی یا میلادی پذیرفته می‌شوند. در هر بار حداکثر ۵۰۰ ردیف وارد می‌شود.</p>
      {!selectedAccountId?<div className="bank-empty compact"><span>برای مشاهده تراکنش‌ها ابتدا یک حساب انتخاب کن.</span></div>
        : loadingTransactions ? <div className="bank-loading"><LoaderCircle size={21} className="ai-spin"/> در حال دریافت تراکنش‌ها…</div>
        : transactions.length ? <div className="bank-table-scroll"><table className="bank-transaction-table"><thead><tr><th>تاریخ</th><th>شرح و طرف حساب</th><th>مبلغ</th><th>شناسه تراکنش</th><th>وضعیت</th><th>عملیات</th></tr></thead>
        <tbody>{transactions.map(transaction=><tr key={transaction.id}>
          <td>{dateLabel(transaction.bookedAt)}</td>
          <td><b>{transaction.description||'تراکنش بدون شرح'}</b><small>{transaction.counterparty||'طرف حساب ثبت نشده'}</small>{transaction.reference&&<small>مرجع: {transaction.reference}</small>}</td>
          <td><span className={'bank-amount '+transaction.direction}>{transaction.direction==='incoming'?<ArrowDownLeft size={14}/>:<ArrowUpRight size={14}/>}<b>{moneyLabel(transaction.amount,transaction.currency)}</b></span></td>
          <td><code dir="ltr">{transaction.externalTransactionId}</code></td>
          <td><span className={'bank-transaction-status '+transaction.reconciliationStatus}>{statusLabel[transaction.reconciliationStatus]}</span>{transaction.matchedEntityType&&<small>{entityLabel[transaction.matchedEntityType as BankCandidate['entityType']]??transaction.matchedEntityType}</small>}</td>
          <td><div className="bank-row-actions">
            {capabilities.canReconcile&&['unmatched','suggested'].includes(transaction.reconciliationStatus)&&<button type="button" className="bank-mini-button" onClick={()=>setReconcileFor(transaction)}><Link2 size={13}/> تطبیق</button>}
            {capabilities.canUpdate&&['unmatched','suggested'].includes(transaction.reconciliationStatus)&&<button type="button" className="bank-mini-button" onClick={()=>void ignore(transaction)}><Ban size={13}/> نادیده‌گرفتن</button>}
          </div></td>
        </tr>)}</tbody></table></div>
        : <div className="bank-empty compact"><FileSpreadsheet size={22}/><span>تراکنشی با این فیلتر وجود ندارد.</span></div>}
      {reconcileFor&&<div className="bank-reconcile-box">
        <div className="bank-reconcile-heading"><div><b>تطبیق تراکنش انتخاب‌شده</b><small>{reconcileFor.externalTransactionId} · {moneyLabel(reconcileFor.amount,reconcileFor.currency)}</small></div><button type="button" aria-label="بستن فرم تطبیق" className="bank-icon-button" onClick={()=>setReconcileFor(null)}><X size={16}/></button></div>
        {loadingCandidates?<div className="bank-loading"><LoaderCircle size={18} className="ai-spin"/> در حال یافتن اسناد هم‌مجموعه…</div>
          : candidates.length ? <><label>سند تجاری مربوط<select value={selectedCandidate} onChange={event=>setSelectedCandidate(event.target.value)}><option value="">انتخاب سند…</option>{candidates.map(candidate=><option key={candidate.entityType+':'+candidate.entityId} value={candidate.entityType+':'+candidate.entityId}>{candidate.label} · {moneyLabel(candidate.amount,reconcileFor.currency)}</option>)}</select></label>
            {candidateValue&&<div className="bank-candidate-preview"><span>نوع سند: {entityLabel[candidateValue.entityType]}</span><span>مبلغ ثبت‌شده سند: {moneyLabel(candidateValue.amount,reconcileFor.currency)}</span><span>وضعیت سند: {candidateValue.status}</span><small>تطبیق فقط پیوند قابل‌ممیزی ایجاد می‌کند؛ هیچ مانده، فاکتور یا پرداختی خودکار تغییر نمی‌کند.</small></div>}
            <div className="bank-form-actions"><button type="button" className="bank-quiet-button" onClick={()=>setReconcileFor(null)} disabled={savingReconciliation}>انصراف</button><button type="button" className="bank-primary-button" disabled={!candidateValue||savingReconciliation} onClick={()=>void reconcile()}>{savingReconciliation?<LoaderCircle size={15} className="ai-spin"/>:<CheckCircle2 size={15}/>} تأیید و ثبت تطبیق</button></div>
          </> : <div className="bank-empty compact">سند باز و مجازی برای این جهت تراکنش پیدا نشد؛ می‌توانی بعداً دوباره بررسی کنی.</div>}
      </div>}
    </section>
  </section>;
}
