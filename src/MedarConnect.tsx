import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { MessageCircle, Plus, RefreshCw, Send, Users } from 'lucide-react';
import { api } from './lib/apiClient';
import type { Membership } from './lib/types';

type Person = { id: string; username: string; displayName: string; role: string };
type Conversation = { id: string; title: string; relatedEntityType: string | null; relatedEntityId: string | null; updatedAt: string; unreadCount: number; lastMessage: string | null };
type Message = { id: string; senderUserId: string; senderUsername: string; body: string; createdAt: string };

function roleName(role: string) {
  return ({ owner: 'مالک', admin: 'مدیر', staff: 'کارمند', supplier: 'تأمین‌کننده', driver: 'راننده', customer: 'مشتری' } as Record<string, string>)[role] ?? role;
}
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(date) : 'زمان نامشخص';
}

export function MedarConnect({ membership }: { membership: Membership }) {
  const companyId = membership.company_id;
  const internal = ['owner', 'admin', 'staff'].includes(membership.role);
  const [people, setPeople] = useState<Person[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedPerson, setSelectedPerson] = useState('');
  const [title, setTitle] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadConversations = useCallback(async (preferredId?: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<{ conversations: Conversation[] }>('/api/connect/conversations?companyId=' + encodeURIComponent(companyId));
      const rows = result.conversations ?? [];
      setConversations(rows);
      const nextId = preferredId && rows.some(row => row.id === preferredId) ? preferredId : selectedId && rows.some(row => row.id === selectedId) ? selectedId : rows[0]?.id ?? '';
      setSelectedId(nextId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'گفت‌وگوها دریافت نشدند.');
    } finally {
      setLoading(false);
    }
  }, [companyId, selectedId]);

  const loadPeople = useCallback(async () => {
    if (!internal) return;
    try {
      const result = await api.get<{ people: Person[] }>('/api/connect/people?companyId=' + encodeURIComponent(companyId));
      setPeople((result.people ?? []).filter(person => person.id !== membership.user_id));
    } catch {
      // Conversation reading stays available if directory access is restricted.
    }
  }, [companyId, internal, membership.user_id]);

  const loadMessages = useCallback(async (conversationId: string) => {
    if (!conversationId) { setMessages([]); return; }
    try {
      const result = await api.get<{ messages: Message[] }>('/api/connect/conversations/' + encodeURIComponent(conversationId) + '/messages?companyId=' + encodeURIComponent(companyId));
      setMessages(result.messages ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'پیام‌ها دریافت نشدند.');
    }
  }, [companyId]);

  useEffect(() => { void loadConversations(); void loadPeople(); }, [loadConversations, loadPeople]);
  useEffect(() => { void loadMessages(selectedId); }, [loadMessages, selectedId]);

  async function createConversation() {
    if (!selectedPerson) { setError('برای شروع گفت‌وگو، یک همکار یا شریک مجاز انتخاب کن.'); return; }
    setError(''); setNotice('');
    try {
      const result = await api.post<{ conversation: { id: string } }>('/api/connect/conversations', {
        companyId, title: title.trim(), participantUserIds: [selectedPerson],
      });
      setTitle('');
      setSelectedPerson('');
      await loadConversations(result.conversation.id);
      setNotice('گفت‌وگو ایجاد شد.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ایجاد گفت‌وگو ناموفق بود.');
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!selectedId || !text || sending) return;
    setSending(true); setError(''); setNotice('');
    try {
      await api.post('/api/connect/conversations/' + encodeURIComponent(selectedId) + '/messages', {
        companyId, body: text, clientMessageId: crypto.randomUUID(),
      });
      setDraft('');
      await loadMessages(selectedId);
      await loadConversations(selectedId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ارسال پیام ناموفق بود.');
    } finally {
      setSending(false);
    }
  }

  const selected = conversations.find(item => item.id === selectedId);
  return <section className="medar-connect-page" dir="rtl">
    <header className="medar-connect-heading">
      <div className="medar-connect-heading-icon"><MessageCircle size={22}/></div>
      <div className="medar-connect-heading-copy">
        <span className="medar-connect-eyebrow">MEDAR CONNECT</span>
        <h1>مرکز ارتباطات</h1>
        <p>پیام‌های کاری در کنار پروندهٔ عملیات؛ گفت‌وگو فقط برای اعضای مجاز قابل مشاهده است.</p>
      </div>
      <button className="medar-connect-refresh" type="button" onClick={() => void loadConversations()} disabled={loading}><RefreshCw size={15}/> تازه‌سازی</button>
    </header>
    {error && <div className="medar-connect-alert" role="alert">{error}</div>}
    {notice && <div className="medar-connect-notice" role="status">{notice}</div>}
    <div className="medar-connect-layout">
      <aside className="medar-connect-sidebar">
        {internal && <form className="medar-connect-new" onSubmit={event => { event.preventDefault(); void createConversation(); }}>
          <h2><Plus size={17}/> گفت‌وگوی جدید</h2>
          <label>فرد یا شریک کاری
            <select value={selectedPerson} onChange={event => setSelectedPerson(event.target.value)} required>
              <option value="">انتخاب عضو شرکت</option>
              {people.map(person => <option key={person.id} value={person.id}>{person.displayName || person.username} · {roleName(person.role)}</option>)}
            </select>
          </label>
          <label>عنوان (اختیاری)
            <input value={title} onChange={event => setTitle(event.target.value)} maxLength={180} placeholder="مثلاً تحویل سفارش ۱۲۴"/>
          </label>
          <button type="submit" disabled={!selectedPerson}><Plus size={15}/> ایجاد گفت‌وگو</button>
        </form>}
        <div className="medar-connect-list-heading"><h2><Users size={17}/> گفت‌وگوها</h2><span>{conversations.length.toLocaleString('fa-IR')}</span></div>
        {loading ? <p className="medar-connect-muted">در حال دریافت گفت‌وگوها…</p> : conversations.length === 0 ? <div className="medar-connect-empty"><MessageCircle size={24}/><b>هنوز گفت‌وگویی ندارید</b><span>برای شروع، یک گفت‌وگوی کاری بسازید یا منتظر دعوت به گفت‌وگو باشید.</span></div> :
          <div className="medar-connect-list">{conversations.map(item => <button key={item.id} type="button" className={'medar-connect-thread' + (selectedId === item.id ? ' active' : '')} onClick={() => setSelectedId(item.id)}>
            <span className="medar-connect-thread-icon"><MessageCircle size={17}/></span><span className="medar-connect-thread-copy"><b>{item.title || 'گفت‌وگوی کاری'}</b><small>{item.lastMessage || 'هنوز پیامی ثبت نشده'}</small></span>{item.unreadCount > 0 && <span className="medar-connect-unread">{item.unreadCount.toLocaleString('fa-IR')}</span>}
          </button>)}</div>}
      </aside>
      <section className="medar-connect-chat">
        {!selected ? <div className="medar-connect-empty large"><MessageCircle size={30}/><b>یک گفت‌وگو انتخاب کن</b><span>پیام‌ها و پاسخ‌ها در همین پرونده نگهداری می‌شوند.</span></div> : <>
          <header className="medar-connect-chat-heading"><div><h2>{selected.title || 'گفت‌وگوی کاری'}</h2><p>{selected.relatedEntityType ? 'متصل به ' + selected.relatedEntityType : 'گفت‌وگوی داخلی یا همکاری'}</p></div><span className="medar-connect-secure">دسترسی محدود</span></header>
          <div className="medar-connect-messages">{messages.length === 0 ? <div className="medar-connect-empty"><MessageCircle size={24}/><b>اولین پیام را بفرست</b><span>برای هماهنگی کار یا ثبت پاسخ از این گفت‌وگو استفاده کن.</span></div> : messages.map(message => <article key={message.id} className={'medar-connect-message' + (message.senderUserId === membership.user_id ? ' own' : '')}><div className="medar-connect-message-meta"><b>{message.senderUserId === membership.user_id ? 'شما' : message.senderUsername}</b><time>{dateLabel(message.createdAt)}</time></div><p>{message.body}</p></article>)}</div>
          <form className="medar-connect-composer" onSubmit={sendMessage}><textarea value={draft} onChange={event => setDraft(event.target.value)} maxLength={8000} rows={2} placeholder="پیام کاری خود را بنویس…" aria-label="متن پیام" required/><button type="submit" disabled={sending || !draft.trim()}><Send size={17}/>{sending ? 'در حال ارسال…' : 'ارسال پیام'}</button></form>
        </>}
      </section>
    </div>
  </section>;
}
