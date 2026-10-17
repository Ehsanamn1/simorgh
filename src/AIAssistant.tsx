import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, Check, ChevronDown, FileText, Headphones, KeyRound, LoaderCircle, Mic, MicOff, Plus, Send, Settings2, ShieldCheck, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import type { AppRole } from './lib/types';
import { api } from './lib/apiClient';

type ProviderId = 'openai' | 'gemini' | 'deepseek' | 'anthropic';
type ProviderConfig = { provider: ProviderId; model: string; isDefault: boolean; configured: boolean; updatedAt: string | null };
type ChatMessage = { role: 'user' | 'assistant'; content: string; attachmentName?: string };
type AIAssistantProps = { companyId: string; role: AppRole; userName?: string };

const providerMeta: Record<ProviderId, { label: string; brand: string; defaultModel: string; detail: string }> = {
  openai: { label: 'OpenAI · GPT', brand: 'GPT', defaultModel: 'gpt-6-luna', detail: 'پاسخ‌گویی و تحلیل عمومی' },
  gemini: { label: 'Google · Gemini', brand: 'G', defaultModel: 'gemini-4-argon', detail: 'تحلیل چندمرحله‌ای و فایل' },
  deepseek: { label: 'DeepSeek', brand: 'DS', defaultModel: 'deepseek-v4-flash', detail: 'تحلیل اقتصادی و متنی' },
  anthropic: { label: 'Anthropic · Claude', brand: 'C', defaultModel: 'claude-sonnet-5-5', detail: 'برنامه‌ریزی و بررسی اسناد' },
};

const roleTitles: Record<AppRole, string> = {
  owner: 'مالک مجموعه', admin: 'مدیر مجموعه', staff: 'کارشناس عملیات',
  supplier: 'تأمین‌کننده', driver: 'راننده', customer: 'مشتری سازمانی',
};

function getSpeechConstructor(): (new () => SpeechRecognitionLike) | undefined {
  const browser = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return browser.SpeechRecognition || browser.webkitSpeechRecognition;
}
type SpeechRecognitionLike = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void;
};

export function AIAssistant({ companyId, role, userName }: AIAssistantProps) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeProvider, setActiveProvider] = useState<ProviderId | ''>('');
  const [configs, setConfigs] = useState<ProviderConfig[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('openai');
  const [model, setModel] = useState(providerMeta.openai.defaultModel);
  const [apiKey, setApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attached, setAttached] = useState<{ name: string; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const isAdmin = role === 'owner' || role === 'admin';
  const configuredConfigs = useMemo(() => configs.filter(item => item.configured), [configs]);

  useEffect(() => {
    if (!open) return;
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [open, messages, sending]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  async function loadProviders() {
    setLoadingConfigs(true);
    setError('');
    try {
      const result = await api.get<{ providers: ProviderConfig[]; activeProvider: ProviderId | null }>(
        '/api/ai/providers?companyId=' + encodeURIComponent(companyId),
      );
      setConfigs(result.providers ?? []);
      const preferred = result.activeProvider || (result.providers ?? []).find(item => item.configured)?.provider || '';
      setActiveProvider(preferred);
      if (preferred && providerMeta[preferred]) {
        setSelectedProvider(preferred);
        const current = (result.providers ?? []).find(item => item.provider === preferred);
        setModel(current?.model || providerMeta[preferred].defaultModel);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'وضعیت پرووایدرها دریافت نشد.');
    } finally {
      setLoadingConfigs(false);
    }
  }

  useEffect(() => {
    if (open && configs.length === 0 && !loadingConfigs) void loadProviders();
    // Configs load once per opening; provider save refreshes them explicitly.
  }, [open]);

  function openPanel() {
    setOpen(true);
    setError('');
    setNotice('');
  }

  async function saveProvider(makeDefault: boolean) {
    setSavingKey(true);
    setError('');
    setNotice('');
    try {
      const existing = configs.find(item => item.provider === selectedProvider && item.configured);
      if (!existing && !apiKey.trim()) throw new Error('برای اتصال اولیه، API key این پرووایدر را وارد کن.');
      if (apiKey && apiKey.length < 12) throw new Error('کلید API کوتاه به نظر می‌رسد؛ مقدار کامل کلید را وارد کن.');
      await api.put('/api/ai/providers', {
        companyId, provider: selectedProvider, model: model.trim() || providerMeta[selectedProvider].defaultModel,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), isDefault: makeDefault,
      });
      setApiKey('');
      setNotice(makeDefault ? 'پرووایدر ذخیره و فعال شد.' : 'تنظیمات پرووایدر ذخیره شد.');
      await loadProviders();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ذخیره‌ی تنظیمات ناموفق بود.');
    } finally {
      setSavingKey(false);
    }
  }

  async function handleFile(file: File) {
    setError('');
    const allowed = /\.(txt|csv|md|json|vcf)$/i.test(file.name);
    if (!allowed) {
      setError('فعلاً فایل متنی، CSV، Markdown، JSON یا مخاطبین vCard قابل خواندن است. PDF و فایل‌های Office در مرحله‌ی بعد به پردازش سند متصل می‌شوند.');
      return;
    }
    if (file.size > 1024 * 1024) {
      setError('برای حفظ سرعت و محدودیت درخواست، فایل دستیار باید حداکثر ۱ مگابایت باشد.');
      return;
    }
    try {
      const text = await file.text();
      setAttached({ name: file.name, text: text.slice(0, 24000) });
      setNotice('فایل به پیام بعدی پیوست شد. محتوایش همراه پیام برای پرووایدر فعال ارسال می‌شود.');
    } catch {
      setError('خواندن فایل ناموفق بود.');
    }
  }

  function toggleVoiceInput() {
    setError('');
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const Recognition = getSpeechConstructor();
    if (!Recognition) {
      setError('تبدیل گفتار به متن در این مرورگر پشتیبانی نمی‌شود. می‌توانی از ورودی متنی استفاده کنی.');
      return;
    }
    try {
      const recognition = new Recognition();
      recognition.lang = 'fa-IR';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.onresult = event => {
        const transcripts: string[] = [];
        for (let index = 0; index < event.results.length; index++) {
          const result = event.results[index];
          if (result?.[0]?.transcript) transcripts.push(result[0].transcript);
        }
        setDraft(transcripts.join(' ').trim());
      };
      recognition.onerror = event => {
        setError(event.error === 'not-allowed' ? 'مجوز میکروفون را در مرورگر فعال کن.' : 'تشخیص گفتار کامل نشد؛ دوباره تلاش کن.');
        setListening(false);
      };
      recognition.onend = () => setListening(false);
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    } catch {
      setError('میکروفون فعلاً در دسترس نیست.');
      setListening(false);
    }
  }

  function speak(text: string) {
    if (!('speechSynthesis' in window)) {
      setError('خواندن پاسخ با صدا در این مرورگر پشتیبانی نمی‌شود.');
      return;
    }
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'fa-IR';
    utterance.rate = 0.96;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  async function sendMessage(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    const content = draft.trim();
    if ((!content && !attached) || sending) return;
    if (!activeProvider || !configuredConfigs.some(item => item.provider === activeProvider)) {
      setError('هنوز یک پرووایدر فعال نشده است. مالک یا مدیر مجموعه باید ابتدا API key را در تنظیمات دستیار ثبت کند.');
      if (isAdmin) setSettingsOpen(true);
      return;
    }
    const outgoing: ChatMessage = { role: 'user', content: content || 'لطفاً فایل پیوست‌شده را بررسی و خلاصه کن.', ...(attached ? { attachmentName: attached.name } : {}) };
    const next = [...messages, outgoing];
    setMessages(next);
    setDraft('');
    setSending(true);
    setError('');
    setNotice('');
    try {
      const response = await api.post<{ content: string; provider: ProviderId; model: string }>('/api/ai/chat', {
        companyId,
        messages: next.slice(-12).map(message => ({ role: message.role, content: message.content })),
        attachment: attached,
      });
      setMessages(current => [...current, { role: 'assistant', content: response.content }]);
      setAttached(null);
    } catch (caught) {
      // Keep the user's message on screen so the request can be retried or copied.
      setError(caught instanceof Error ? caught.message : 'دستیار پاسخ نداد؛ اتصال یا تنظیمات پرووایدر را بررسی کن.');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  return <>
    <button type="button" className="ai-assistant-launcher" aria-label="بازکردن دستیار هوش مصنوعی" onClick={openPanel}>
      <span className="ai-launcher-orb"><Sparkles size={20}/></span>
      <span className="ai-launcher-label"><b>دستیار مدار</b><small>تحلیل و راهنمایی</small></span>
    </button>
    {open && <div className="ai-assistant-layer" dir="rtl">
      <section className="ai-assistant-window" role="dialog" aria-modal="true" aria-labelledby="ai-assistant-title">
        <header className="ai-assistant-header">
          <span className="ai-assistant-mark"><Sparkles size={22}/></span>
          <div className="ai-assistant-title">
            <b id="ai-assistant-title">دستیار مدار</b>
            <small><span className="ai-presence-dot"/> {activeProvider ? providerMeta[activeProvider].label : 'آماده‌ی راهنمایی'} · {roleTitles[role]}</small>
          </div>
          {isAdmin && <button type="button" className="ai-icon-button" onClick={() => { setSettingsOpen(value => !value); setError(''); setNotice(''); if (!configs.length) void loadProviders(); }} aria-label="تنظیمات اتصال هوش مصنوعی" title="تنظیمات پرووایدر"><Settings2 size={18}/></button>}
          <button type="button" className="ai-icon-button" onClick={() => { setOpen(false); setSettingsOpen(false); recognitionRef.current?.stop(); }} aria-label="بستن دستیار"><X size={19}/></button>
        </header>
        {settingsOpen && isAdmin ? <div className="ai-settings-panel">
          <div className="ai-settings-title"><div><b>اتصال مدل‌های هوش مصنوعی</b><small>کلید فقط به API امن مدار فرستاده می‌شود و در پاسخ به مرورگر برنمی‌گردد.</small></div><ShieldCheck size={20}/></div>
          {loadingConfigs ? <div className="ai-loading"><LoaderCircle size={18}/> در حال خواندن تنظیمات</div> : <>
            <div className="ai-provider-grid">{(Object.keys(providerMeta) as ProviderId[]).map(provider => {
              const meta = providerMeta[provider];
              const config = configs.find(item => item.provider === provider);
              return <button type="button" key={provider} onClick={() => { setSelectedProvider(provider); setModel(config?.model || meta.defaultModel); setApiKey(''); setNotice(''); setError(''); }} className={'ai-provider-card'+(selectedProvider===provider?' selected':'')}>
                <span className="ai-provider-brand">{meta.brand}</span><span><b>{meta.label}</b><small>{config?.configured?'کلید ذخیره شده':meta.detail}</small></span>{config?.isDefault&&<span className="ai-default-mark"><Check size={13}/> فعال</span>}
              </button>;
            })}</div>
            <form className="ai-provider-form" onSubmit={event => { event.preventDefault(); void saveProvider(true); }}>
              <label>مدل
                <input dir="ltr" value={model} onChange={event => setModel(event.target.value)} maxLength={120} placeholder={providerMeta[selectedProvider].defaultModel}/>
              </label>
              <label>کلید API {configs.some(item=>item.provider===selectedProvider&&item.configured)&&<small>برای نگه‌داشتن کلید فعلی، این کادر را خالی بگذار.</small>}
                <input dir="ltr" type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} maxLength={512} placeholder={configs.some(item=>item.provider===selectedProvider&&item.configured)?'کلید ذخیره شده است':'API key را وارد کن'} />
              </label>
              <button className="ai-primary-button" type="submit" disabled={savingKey || loadingConfigs}>{savingKey?<LoaderCircle size={16} className="ai-spin"/>:<KeyRound size={16}/>} ذخیره و فعال‌سازی</button>
              {configs.some(item=>item.provider===selectedProvider&&item.configured)&&<button type="button" className="ai-secondary-button" onClick={()=>void saveProvider(false)} disabled={savingKey}>ذخیره مدل بدون تغییر پرووایدر فعال</button>}
            </form>
          </>}
          <p className="ai-privacy-note"><ShieldCheck size={15}/> کلیدها رمزنگاری‌شده در سمت سرور نگهداری می‌شوند. متن گفتگو و فایل‌های پیوست برای ارائه‌دهنده‌ی مدل انتخابی ارسال می‌شوند؛ اطلاعات حساس را فقط در صورت مجاز بودن به‌اشتراک بگذار.</p>
        </div> : <>
          <div className="ai-conversation">
            {messages.length===0 ? <div className="ai-welcome">
              <span className="ai-welcome-orb"><Sparkles size={25}/></span>
              <h3>سلام{userName ? ' '+userName : ''}، از کجا شروع کنیم؟</h3>
              <p>برای تحلیل عملیات، پیگیری ریسک‌ها، برنامه‌ریزی کارها و پرسش درباره‌ی روند کسب‌وکار از من کمک بگیر.</p>
              <div className="ai-suggestions">
                {['وضعیت کلی عملیات را تحلیل کن','کارهای معوق و ریسک‌های فوری چیست؟','برای هفته‌ی آینده برنامه‌ی اجرایی بچین'].map(text=><button type="button" key={text} onClick={()=>setDraft(text)}>{text}<ArrowDown size={14}/></button>)}
              </div>
              {configuredConfigs.length===0&&<small className="ai-setup-hint">برای پاسخ واقعی، مالک یا مدیر باید یک پرووایدر را در تنظیمات وصل کند.</small>}
            </div> : messages.map((message,index)=><article className={'ai-message '+message.role} key={index}>
              <div className="ai-message-avatar">{message.role==='assistant'?<Sparkles size={15}/>:<span>{(userName||'شما').slice(0,1)}</span>}</div>
              <div className="ai-message-body"><div className="ai-message-role">{message.role==='assistant'?'دستیار مدار':'شما'}</div><p>{message.content}</p>{message.attachmentName&&<small className="ai-message-attachment"><FileText size={13}/>{message.attachmentName}</small>}
                {message.role==='assistant'&&<button className="ai-speak-button" type="button" onClick={()=>speak(message.content)}>{speaking?<VolumeX size={14}/>:<Volume2 size={14}/>} {speaking?'توقف پخش':'خواندن پاسخ با صدا'}</button>}
              </div>
            </article>)}
            {sending&&<div className="ai-thinking"><span><Sparkles size={16}/></span><div><b>در حال تحلیل اطلاعات</b><small>دستیار در حال آماده‌کردن پاسخ است…</small></div><LoaderCircle size={17} className="ai-spin"/></div>}
            <div ref={messageEndRef}/>
          </div>
          {error&&<div className="ai-feedback error" role="alert">{error}</div>}
          {notice&&<div className="ai-feedback notice" role="status">{notice}</div>}
          <form className="ai-composer" onSubmit={event=>void sendMessage(event)}>
            {attached&&<div className="ai-attachment-chip"><FileText size={15}/><span>{attached.name}</span><button type="button" onClick={()=>setAttached(null)} aria-label="حذف فایل"><X size={14}/></button></div>}
            <textarea ref={inputRef} value={draft} onChange={event=>setDraft(event.target.value)} placeholder="از مدار سؤال بپرس…" rows={2} maxLength={6000} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void sendMessage();}}} aria-label="پیام به دستیار"/>
            <div className="ai-composer-actions">
              <div className="ai-composer-tools">
                <button type="button" onClick={()=>fileRef.current?.click()} title="پیوست فایل" aria-label="پیوست فایل"><Plus size={18}/></button>
                <input ref={fileRef} className="sr-only" type="file" accept=".txt,.csv,.md,.json,.vcf,text/plain,text/csv" onChange={event=>{const file=event.target.files?.[0];if(file)void handleFile(file);event.currentTarget.value='';}} />
                <button type="button" className={listening?'recording':''} onClick={toggleVoiceInput} title={listening?'پایان گفتار':'تبدیل گفتار فارسی به متن'} aria-label={listening?'توقف ضبط گفتار':'شروع گفتار'}>{listening?<MicOff size={18}/>:<Mic size={18}/>}</button>
              </div>
              <small>{listening?'در حال شنیدن…':activeProvider?providerMeta[activeProvider].label:'پرووایدر تنظیم نشده'}</small>
              <button className="ai-send-button" type="submit" disabled={sending||(!draft.trim()&&!attached)} aria-label="ارسال پیام">{sending?<LoaderCircle size={17} className="ai-spin"/>:<Send size={17}/>}</button>
            </div>
            <p className="ai-compose-disclaimer">پاسخ‌ها باید با رکوردهای مدار بررسی شوند. دستیار بدون تأیید کاربر عملیات مالی یا تغییر داده اجرا نمی‌کند.</p>
          </form>
        </>}
      </section>
    </div>}
  </>;
}
