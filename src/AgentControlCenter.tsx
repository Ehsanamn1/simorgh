import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, Bot, CalendarClock, CheckCircle2, ClipboardList, Clock3, LoaderCircle, Plus, RefreshCw, ShieldCheck, UserRound, X } from 'lucide-react';
import type { Membership } from './lib/types';
import { api } from './lib/apiClient';

type AgentActionStatus = 'proposed' | 'executed' | 'cancelled' | 'failed';
type AgentPriority = 'low' | 'normal' | 'high' | 'critical';
type AgentAction = {
  id: string;
  toolKey: 'create_operational_task';
  status: AgentActionStatus;
  arguments: {
    title?: string;
    instructions?: string;
    priority?: AgentPriority;
    dueAt?: string;
    assigneeUserId?: string;
    assigneeSupplierId?: string;
  };
  result?: { taskId?: string; title?: string; status?: string; dueAt?: string } | null;
  createdAt: string;
  executedAt?: string | null;
  requestedByName?: string;
  requestedBy: string;
};
type WorkspaceMember = {
  membership_id: string;
  user_id: string;
  role: string;
  active: boolean;
  username: string;
  full_name: string;
};
type AgentControlCenterProps = { membership: Membership };

const statusLabels: Record<AgentActionStatus, string> = {
  proposed: 'در انتظار تأیید',
  executed: 'اجرا شد',
  cancelled: 'لغو شد',
  failed: 'ناموفق',
};
const priorityLabels: Record<AgentPriority, string> = {
  low: 'کم',
  normal: 'عادی',
  high: 'زیاد',
  critical: 'بحرانی',
};
const priorityOptions: AgentPriority[] = ['low', 'normal', 'high', 'critical'];
const priorityTone: Record<AgentPriority, string> = {
  low: 'low',
  normal: 'normal',
  high: 'high',
  critical: 'critical',
};
function formatDate(value?: string | null): string {
  if (!value) return 'بدون مهلت';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'زمان نامشخص';
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function AgentControlCenter({ membership }: AgentControlCenterProps) {
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [priority, setPriority] = useState<AgentPriority>('normal');
  const [dueAt, setDueAt] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState(membership.user_id);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canAssignTeam = membership.role === 'owner' || membership.role === 'admin';
  const canManage = canAssignTeam || membership.role === 'staff';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<{ actions: AgentAction[] }>(
        '/api/ai/actions?companyId=' + encodeURIComponent(membership.company_id),
      );
      setActions(result.actions ?? []);
      if (canAssignTeam) {
        const membersResult = await api.get<{ members: WorkspaceMember[] }>(
          '/api/workspace/members?companyId=' + encodeURIComponent(membership.company_id),
        );
        const activeMembers = (membersResult.members ?? []).filter(member => member.active && ['owner', 'admin', 'staff', 'driver'].includes(member.role));
        setMembers(activeMembers);
        if (activeMembers.some(member => member.user_id === membership.user_id)) {
          setAssigneeUserId(current => current || membership.user_id);
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'مرکز ایجنت‌ها بارگذاری نشد.');
    } finally {
      setLoading(false);
    }
  }, [membership.company_id, membership.role, membership.user_id, canAssignTeam]);

  useEffect(() => { void load(); }, [load]);

  async function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const args = {
        title: title.trim(),
        instructions: instructions.trim(),
        priority,
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
        ...(assigneeUserId ? { assigneeUserId } : {}),
      };
      const result = await api.post<{ action: AgentAction; requiresConfirmation: boolean }>('/api/ai/actions/propose', {
        companyId: membership.company_id,
        toolKey: 'create_operational_task',
        arguments: args,
      });
      setActions(current => [result.action, ...current.filter(item => item.id !== result.action.id)]);
      setTitle('');
      setInstructions('');
      setPriority('normal');
      setDueAt('');
      setNotice('پیشنهاد ذخیره شد؛ هنوز هیچ وظیفه‌ای در عملیات ایجاد نشده است. برای اجرا باید آن را جداگانه تأیید کنی.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'پیشنهاد اقدام ثبت نشد.');
    } finally {
      setSubmitting(false);
    }
  }

  async function execute(action: AgentAction) {
    const actionTitle = action.arguments.title || 'وظیفهٔ پیشنهادی';
    if (!window.confirm('آیا تأیید می‌کنی وظیفهٔ «' + actionTitle + '» در داده‌های واقعی صحرا ایجاد شود؟')) return;
    setActingOn(action.id);
    setError('');
    setNotice('');
    try {
      const result = await api.post<{ ok: boolean; result: AgentAction['result'] }>(
        '/api/ai/actions/' + encodeURIComponent(action.id) + '/execute',
        { companyId: membership.company_id, confirmed: true },
      );
      setActions(current => current.map(item => item.id === action.id
        ? { ...item, status: 'executed', result: result.result ?? item.result, executedAt: new Date().toISOString() }
        : item));
      setNotice('وظیفه پس از تأیید در صحرا ایجاد شد.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'اجرای پیشنهاد ناموفق بود.');
    } finally {
      setActingOn(null);
    }
  }

  async function cancel(action: AgentAction) {
    if (!window.confirm('پیشنهاد «' + (action.arguments.title || 'بدون عنوان') + '» لغو شود؟ این کار هیچ وظیفه‌ای ایجاد نمی‌کند.')) return;
    setActingOn(action.id);
    setError('');
    setNotice('');
    try {
      await api.post('/api/ai/actions/' + encodeURIComponent(action.id) + '/cancel', { companyId: membership.company_id });
      setActions(current => current.map(item => item.id === action.id ? { ...item, status: 'cancelled' } : item));
      setNotice('پیشنهاد لغو شد.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'لغو پیشنهاد ناموفق بود.');
    } finally {
      setActingOn(null);
    }
  }

  if (!canManage) {
    return <section className="agent-center-page" dir="rtl">
      <header className="agent-center-hero"><span className="agent-center-mark"><ShieldCheck size={23}/></span><div><p className="eyebrow">هوش عملیاتی</p><h1>مرکز ایجنت‌ها</h1><p>این بخش فقط برای اعضای داخلی مجموعه فعال است.</p></div></header>
    </section>;
  }

  return <section className="agent-center-page" dir="rtl">
    <header className="agent-center-hero">
      <span className="agent-center-mark"><Bot size={25}/></span>
      <div className="agent-center-hero-copy">
        <p className="eyebrow">هوش عملیاتی صحرا</p>
        <h1>مرکز ایجنت‌ها و اقدامات</h1>
        <p>پیشنهادهای قابل بررسی را ثبت کن، جزئیات و مسئول را بازبینی کن و فقط پس از تأیید صریح آن‌ها را به وظیفهٔ واقعی تبدیل کن.</p>
      </div>
      <button type="button" className="agent-secondary-button agent-refresh" onClick={() => void load()} disabled={loading || submitting || Boolean(actingOn)}>
        {loading ? <LoaderCircle size={16} className="ai-spin"/> : <RefreshCw size={16}/>} به‌روزرسانی
      </button>
    </header>

    <div className="agent-center-safety" role="note">
      <ShieldCheck size={18}/>
      <span><b>حالت اجرای کنترل‌شده</b> — ثبت پیشنهاد به‌تنهایی هیچ دادهٔ عملیاتی را تغییر نمی‌دهد. فقط اعضای مجاز می‌توانند پیشنهاد را اجرا کنند؛ اجرای وظیفه در تاریخچهٔ اقدامات ثبت می‌شود. پرداخت، انتقال وجه و تغییرات مالی از این ابزار قابل اجرا نیست.</span>
    </div>

    {error && <div className="agent-feedback error" role="alert"><AlertTriangle size={17}/><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="بستن خطا"><X size={15}/></button></div>}
    {notice && <div className="agent-feedback notice" role="status"><CheckCircle2 size={17}/><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="بستن پیام"><X size={15}/></button></div>}

    <div className="agent-center-grid">
      <form className="agent-proposal-card" onSubmit={event => void propose(event)}>
        <div className="agent-card-heading"><span><Plus size={18}/></span><div><b>پیشنهاد وظیفهٔ جدید</b><small>ایجاد یک پیش‌نویس برای بررسی و تأیید</small></div></div>
        <label>عنوان وظیفه
          <input value={title} onChange={event => setTitle(event.target.value)} required minLength={2} maxLength={180} placeholder="مثلاً پیگیری تأمین خوراک فردا"/>
        </label>
        <label>شرح و نتیجهٔ مورد انتظار
          <textarea value={instructions} onChange={event => setInstructions(event.target.value)} maxLength={3000} rows={3} placeholder="چه کاری باید انجام شود و چه مدرکی لازم است؟"/>
        </label>
        <div className="agent-form-row">
          <label>اولویت
            <select value={priority} onChange={event => setPriority(event.target.value as AgentPriority)}>
              {priorityOptions.map(option => <option key={option} value={option}>{priorityLabels[option]}</option>)}
            </select>
          </label>
          <label>مهلت (اختیاری)
            <input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)}/>
          </label>
        </div>
        <label>مسئول
          {canAssignTeam && members.length > 0
            ? <select value={assigneeUserId} onChange={event => setAssigneeUserId(event.target.value)} required>
                {members.map(member => <option key={member.membership_id} value={member.user_id}>{member.full_name || member.username} — {member.role === 'owner' ? 'مالک' : member.role === 'admin' ? 'مدیر' : member.role === 'driver' ? 'راننده' : 'کارشناس'}</option>)}
              </select>
            : <input value="خودم" disabled aria-label="مسئول وظیفه"/>}
          <small>مسئول باید عضو فعال و مجاز همین مجموعه باشد.</small>
        </label>
        <button type="submit" className="agent-primary-button" disabled={submitting || !title.trim()}>
          {submitting ? <LoaderCircle size={16} className="ai-spin"/> : <Plus size={16}/>} {submitting ? 'در حال ثبت پیشنهاد…' : 'ثبت پیشنهاد برای تأیید'}
        </button>
      </form>

      <section className="agent-actions-card">
        <div className="agent-card-heading"><span><ClipboardList size={18}/></span><div><b>تاریخچهٔ اقدامات پیشنهادی</b><small>{actions.length.toLocaleString('fa-IR')} مورد · با دادهٔ واقعی API</small></div></div>
        {loading ? <div className="agent-empty"><LoaderCircle size={22} className="ai-spin"/><span>در حال بارگذاری تاریخچه…</span></div>
          : actions.length === 0 ? <div className="agent-empty"><ClipboardList size={27}/><b>هنوز پیشنهادی ثبت نشده</b><span>برای شروع یک پیشنهاد بساز. وظیفه فقط بعد از تأیید جداگانه ایجاد می‌شود.</span></div>
          : <div className="agent-action-list">{actions.map(action => {
            const titleText = action.arguments?.title || 'پیشنهاد بدون عنوان';
            const actionPriority = action.arguments?.priority && priorityOptions.includes(action.arguments.priority) ? action.arguments.priority : 'normal';
            return <article className={'agent-action-item status-' + action.status} key={action.id}>
              <div className="agent-action-top">
                <div><b>{titleText}</b><small>{action.requestedByName ? 'ثبت‌کننده: ' + action.requestedByName : 'ثبت‌شده در صحرا'} · {formatDate(action.createdAt)}</small></div>
                <span className={'agent-status status-' + action.status}>{statusLabels[action.status]}</span>
              </div>
              {action.arguments?.instructions && <p>{action.arguments.instructions}</p>}
              <div className="agent-action-meta">
                <span className={'agent-priority priority-' + priorityTone[actionPriority]}>{priorityLabels[actionPriority]}</span>
                {action.arguments?.dueAt && <span><CalendarClock size={14}/>{formatDate(action.arguments.dueAt)}</span>}
                {action.result?.taskId && <span><CheckCircle2 size={14}/>شناسه وظیفه: <code>{action.result.taskId.slice(0, 8)}</code></span>}
                {action.status === 'executed' && action.executedAt && <span><Clock3 size={14}/>اجرا: {formatDate(action.executedAt)}</span>}
              </div>
              {action.status === 'proposed' && <div className="agent-action-buttons">
                <button type="button" className="agent-primary-button" onClick={() => void execute(action)} disabled={Boolean(actingOn)}>
                  {actingOn === action.id ? <LoaderCircle size={15} className="ai-spin"/> : <CheckCircle2 size={15}/>} تأیید و ایجاد وظیفه
                </button>
                <button type="button" className="agent-secondary-button" onClick={() => void cancel(action)} disabled={Boolean(actingOn)}>لغو پیشنهاد</button>
              </div>}
            </article>;
          })}</div>}
      </section>
    </div>
    <p className="agent-center-footnote"><UserRound size={14}/> این مرحله اجرای کنترل‌شدهٔ ابزار ایجاد وظیفه را فراهم می‌کند؛ اتصال مکالمهٔ زبانی به فراخوانی خودکار ابزار، گفت‌وگوی صوتی realtime و اجرای دیگر انواع اقدام هنوز مراحل جداگانه‌اند.</p>
  </section>;
}
