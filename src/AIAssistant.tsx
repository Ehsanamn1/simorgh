import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition';
import { SpeechSynthesis } from '@capgo/capacitor-speech-synthesis';
import { ArrowDown, Check, FileText, Headphones, KeyRound, LoaderCircle, Mic, MicOff, Plus, Send, Settings2, ShieldCheck, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import type { AppRole } from './lib/types';
import { api } from './lib/apiClient';

type ProviderId = 'openai' | 'gemini' | 'deepseek' | 'anthropic';
type ProviderConfig = { provider: ProviderId; model: string; isDefault: boolean; configured: boolean; updatedAt: string | null };
type ChatMessage = { role: 'user' | 'assistant'; content: string; attachmentName?: string };
type AssistantAttachment = { name: string; text?: string; base64?: string; mimeType?: string };
type AIAssistantProps = { companyId: string; role: AppRole; userName?: string };

const providerMeta: Record<ProviderId, { label: string; brand: string; defaultModel: string; detail: string }> = {
  openai: { label: 'OpenAI · GPT', brand: 'GPT', defaultModel: 'gpt-6-luna', detail: 'پاسخ‌گویی و تحلیل عمومی' },
  gemini: { label: 'Google · Gemini', brand: 'G', defaultModel: 'gemini-4-argon', detail: 'تحلیل چندمرحله‌ای و فایل' },
  deepseek: { label: 'DeepSeek', brand: 'DS', defaultModel: 'deepseek-v4-flash', detail: 'تحلیل اقتصادی و متنی' },
  anthropic: { label: 'Anthropic · Claude', brand: 'C', defaultModel: 'claude-sonnet-5', detail: 'برنامه‌ریزی و بررسی اسناد' },
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
function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return window.btoa(binary);
}

type SpeechRecognitionLike = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
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
  const [testingProvider, setTestingProvider] = useState(false);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false);
  const voiceTurnPendingRef = useRef(false);
  const voiceRestartTimerRef = useRef<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attached, setAttached] = useState<AssistantAttachment | null>(null);
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
    voiceModeRef.current = false;
    if (voiceRestartTimerRef.current !== null) window.clearTimeout(voiceRestartTimerRef.current);
    if (Capacitor.isNativePlatform()) {
      void SpeechRecognition.stop().catch(() => {});
      void SpeechSynthesis.cancel().catch(() => {});
    } else {
      recognitionRef.current?.stop();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    }
  }, []);

  const loadProviders = useCallback(async () => {
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
  }, [companyId]);

  useEffect(() => {
    if (open && configs.length === 0 && !loadingConfigs && !error) void loadProviders();
  }, [open, configs.length, loadingConfigs, error, loadProviders]);

  function openPanel() {
    setOpen(true);
    setError('');
    setNotice('');
  }

  async function testProvider() {
    setTestingProvider(true);
    setError('');
    setNotice('');
    try {
      if (!configs.some(item => item.provider === selectedProvider && item.configured) && !apiKey.trim()) {
        throw new Error('برای تست اولیه، API key را وارد کن. این تست کلید را ذخیره نمی‌کند.');
      }
      const result = await api.post<{ ok: boolean; provider: ProviderId; model: string; message: string }>('/api/ai/provider-test', {
        companyId,
        provider: selectedProvider,
        model: model.trim() || providerMeta[selectedProvider].defaultModel,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setNotice(result.message || 'اتصال پرووایدر موفق بود.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تست اتصال پرووایدر ناموفق بود.');
    } finally {
      setTestingProvider(false);
    }
  }

  async function saveProvider() {
    setSavingKey(true);
    setError('');
    setNotice('');
    try {
      const existing = configs.find(item => item.provider === selectedProvider && item.configured);
      if (!existing && !apiKey.trim()) throw new Error('برای اتصال اولیه، API key این پرووایدر را وارد کن.');
      if (apiKey && apiKey.length < 12) throw new Error('کلید API کوتاه به نظر می‌رسد؛ مقدار کامل کلید را وارد کن.');
      await api.put('/api/ai/providers', {
        companyId, provider: selectedProvider, model: model.trim() || providerMeta[selectedProvider].defaultModel,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), isDefault: true,
      });
      setApiKey('');
      setNotice('پرووایدر ذخیره و فعال شد.');
      await loadProviders();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ذخیره‌ی تنظیمات ناموفق بود.');
    } finally {
      setSavingKey(false);
    }
  }

  async function handleFile(file: File) {
    setError('');
    setNotice('');
    const extension = file.name.toLocaleLowerCase('en-US').split('.').pop() || '';
    const textExtensions = new Set(['txt','csv','tsv','md','markdown','json','vcf','xml','html','log','sql','js','mjs','ts','tsx','py','css','yaml','yml','toml','ini']);
    const officeMime: Record<string,string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      rtf: 'application/rtf',
      odt: 'application/vnd.oasis.opendocument.text',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    const isText = textExtensions.has(extension);
    const mimeType = officeMime[extension] || file.type || 'application/octet-stream';
    const isOfficeInput = Object.prototype.hasOwnProperty.call(officeMime, extension);
    if (!isText && !isOfficeInput) {
      setError('قالب‌های پشتیبانی‌شده: فایل‌های متنی و کد، CSV/TSV، PDF، Word، Excel، PowerPoint و RTF/ODT.');
      return;
    }
    if (isText && file.size > 1024 * 1024) {
      setError('فایل متنی برای ارسال به دستیار باید حداکثر ۱ مگابایت باشد.');
      return;
    }
    if (isOfficeInput && file.size > 6 * 1024 * 1024) {
      setError('حجم PDF یا سند Office باید حداکثر ۶ مگابایت باشد.');
      return;
    }
    try {
      if (isText) {
        const text = await file.text();
        setAttached({ name: file.name, text: text.slice(0, 24000), mimeType });
        setNotice('فایل خوانده شد و همراه پیام بعدی برای تحلیل ارسال می‌شود.');
      } else {
        const base64 = encodeBase64(await file.arrayBuffer());
        setAttached({ name: file.name, base64, mimeType });
        setNotice(extension === 'pdf'
          ? 'PDF آماده است؛ مدل‌های OpenAI، Gemini و Claude از آن پشتیبانی می‌کنند.'
          : 'سند آماده است؛ برای اسناد Office فعلاً از OpenAI استفاده کن. برای Gemini یا Claude، سند را به PDF تبدیل کن.');
      }
    } catch {
      setError('خواندن فایل ناموفق بود.');
    }
  }

  async function startVoiceRecognition(autoSend: boolean) {
    setError('');
    if (Capacitor.isNativePlatform()) {
      try {
        const permission = await SpeechRecognition.requestPermissions();
        if (permission.speechRecognition !== 'granted') {
          throw new Error('برای استفاده از دستیار صوتی، دسترسی میکروفون و تشخیص گفتار را در تنظیمات دستگاه فعال کن.');
        }
        const availability = await SpeechRecognition.available();
        if (!availability.available) {
          throw new Error('سرویس تشخیص گفتار روی این دستگاه در دسترس نیست. زبان گفتار دستگاه را بررسی کن یا از ورودی متنی استفاده کن.');
        }
        setListening(true);
        const result = await SpeechRecognition.start({
          language: 'fa-IR',
          maxResults: 1,
          partialResults: false,
          popup: false,
          addPunctuation: true,
          contextualStrings: ['مدار', 'تأمین‌کننده', 'سفارش', 'تسویه', 'موجودی', 'ارسال', 'راننده', 'مزرعه', 'تولید'],
        });
        const transcript = result.matches?.[0]?.trim() || '';
        setListening(false);
        if (transcript) {
          setDraft(transcript);
          setError('');
          if (autoSend && voiceModeRef.current && !voiceTurnPendingRef.current) {
            voiceTurnPendingRef.current = true;
            await sendMessage(undefined, transcript);
          }
        } else if (autoSend && voiceModeRef.current && !voiceTurnPendingRef.current) {
          if (voiceRestartTimerRef.current !== null) window.clearTimeout(voiceRestartTimerRef.current);
          voiceRestartTimerRef.current = window.setTimeout(() => {
            voiceRestartTimerRef.current = null;
            if (voiceModeRef.current && !voiceTurnPendingRef.current) void startVoiceRecognition(true);
          }, 500);
        }
      } catch (caught) {
        setListening(false);
        const message = caught instanceof Error ? caught.message : '';
        setError(message.includes('دسترسی') || message.includes('در دسترس') ? message : 'شروع تشخیص گفتار ناموفق بود. اجازه‌ی میکروفون و پشتیبانی زبان فارسی را بررسی کن.');
        if (autoSend) {
          voiceModeRef.current = false;
          setVoiceMode(false);
          voiceTurnPendingRef.current = false;
        }
      }
      return;
    }

    const Recognition = getSpeechConstructor();
    if (!Recognition) {
      setError('تبدیل گفتار به متن در این مرورگر پشتیبانی نمی‌شود. از ورودی متنی استفاده کن یا مرورگر سازگار با میکروفون را باز کن.');
      if (autoSend) {
        voiceModeRef.current = false;
        setVoiceMode(false);
        voiceTurnPendingRef.current = false;
      }
      setListening(false);
      return;
    }
    try {
      const recognition = new Recognition();
      recognition.lang = 'fa-IR';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.onresult = event => {
        const finalParts: string[] = [];
        const interimParts: string[] = [];
        for (let index = 0; index < event.results.length; index++) {
          const result = event.results[index];
          const transcript = result?.[0]?.transcript?.trim();
          if (!transcript) continue;
          if (result.isFinal) finalParts.push(transcript);
          else interimParts.push(transcript);
        }
        setDraft([...finalParts, ...interimParts].join(' ').trim());
        if (autoSend && finalParts.length > 0 && !voiceTurnPendingRef.current && voiceModeRef.current) {
          const finalText = finalParts.join(' ').trim();
          if (finalText) {
            voiceTurnPendingRef.current = true;
            setDraft(finalText);
            void sendMessage(undefined, finalText);
          }
        }
      };
      recognition.onerror = event => {
        setError(event.error === 'not-allowed' ? 'مجوز میکروفون را در مرورگر فعال کن.' : 'تشخیص گفتار کامل نشد؛ دوباره تلاش کن.');
        setListening(false);
        if (autoSend) {
          voiceModeRef.current = false;
          setVoiceMode(false);
          voiceTurnPendingRef.current = false;
        }
      };
      recognition.onend = () => {
        setListening(false);
        if (autoSend && voiceModeRef.current && !voiceTurnPendingRef.current) {
          if (voiceRestartTimerRef.current !== null) window.clearTimeout(voiceRestartTimerRef.current);
          voiceRestartTimerRef.current = window.setTimeout(() => {
            voiceRestartTimerRef.current = null;
            if (voiceModeRef.current && !voiceTurnPendingRef.current) void startVoiceRecognition(true);
          }, 450);
        }
      };
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
      setError('');
    } catch {
      setError('میکروفون فعلاً در دسترس نیست.');
      setListening(false);
      if (autoSend) {
        voiceModeRef.current = false;
        setVoiceMode(false);
        voiceTurnPendingRef.current = false;
      }
    }
  }

  function toggleVoiceInput() {
    setError('');
    if (listening) {
      if (Capacitor.isNativePlatform()) {
        void SpeechRecognition.stop().catch(() => {});
      } else {
        recognitionRef.current?.stop();
        setListening(false);
      }
      return;
    }
    if (voiceModeRef.current) return;
    void startVoiceRecognition(false);
  }

  function startVoiceConversation() {
    setError('');
    setNotice('');
    if (!activeProvider || !configuredConfigs.some(item => item.provider === activeProvider)) {
      setError('برای مکالمه صوتی ابتدا باید مالک یا مدیر یک پرووایدر را در تنظیمات دستیار فعال کند.');
      if (isAdmin) setSettingsOpen(true);
      return;
    }
    if (voiceModeRef.current) return;
    voiceModeRef.current = true;
    voiceTurnPendingRef.current = false;
    setVoiceMode(true);
    startVoiceRecognition(true);
  }

  function stopVoiceConversation() {
    voiceModeRef.current = false;
    voiceTurnPendingRef.current = false;
    setVoiceMode(false);
    if (voiceRestartTimerRef.current !== null) window.clearTimeout(voiceRestartTimerRef.current);
    voiceRestartTimerRef.current = null;
    if (Capacitor.isNativePlatform()) {
      void SpeechRecognition.stop().catch(() => {});
      void SpeechSynthesis.cancel().catch(() => {});
    } else {
      recognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
    }
    setListening(false);
    setSpeaking(false);
  }

  function speak(text: string, resumeVoice = false) {
    if (Capacitor.isNativePlatform()) {
      void (async () => {
        if (speaking && !resumeVoice) {
          await SpeechSynthesis.cancel();
          setSpeaking(false);
          return;
        }
        await SpeechSynthesis.cancel();
        setSpeaking(true);
        let utteranceId = '';
        let ended = false;
        let endListener: { remove: () => Promise<void> } | null = null;
        let errorListener: { remove: () => Promise<void> } | null = null;
        const finishSpeech = () => {
          if (ended) return;
          ended = true;
          void endListener?.remove();
          void errorListener?.remove();
          setSpeaking(false);
          if (resumeVoice && voiceModeRef.current) {
            voiceTurnPendingRef.current = false;
            void startVoiceRecognition(true);
          }
        };
        endListener = await SpeechSynthesis.addListener('end', event => {
          if (utteranceId && event.utteranceId === utteranceId) finishSpeech();
        });
        errorListener = await SpeechSynthesis.addListener('error', event => {
          if (utteranceId && event.utteranceId === utteranceId) finishSpeech();
        });
        try {
          const result = await SpeechSynthesis.speak({
            text,
            language: 'fa-IR',
            rate: 0.96,
            pitch: 1,
            volume: 1,
            queueStrategy: 'Flush',
          });
          utteranceId = result.utteranceId;
        } catch (caught) {
          finishSpeech();
          throw caught;
        }
      })().catch(caught => {
        setSpeaking(false);
        setError(caught instanceof Error ? caught.message : 'خواندن پاسخ با صدای دستگاه انجام نشد.');
        if (resumeVoice) stopVoiceConversation();
      });
      return;
    }
    if (!('speechSynthesis' in window)) {
      setError('خواندن پاسخ با صدا در این مرورگر پشتیبانی نمی‌شود.');
      if (resumeVoice) stopVoiceConversation();
      return;
    }
    if (speaking && !resumeVoice) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'fa-IR';
    utterance.rate = 0.96;
    const finishSpeech = () => {
      setSpeaking(false);
      if (resumeVoice && voiceModeRef.current) {
        voiceTurnPendingRef.current = false;
        void startVoiceRecognition(true);
      }
    };
    utterance.onend = finishSpeech;
    utterance.onerror = finishSpeech;
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  async function sendMessage(event?: { preventDefault: () => void }, overrideContent?: string) {
    event?.preventDefault();
    const content = overrideContent === undefined ? draft.trim() : overrideContent.trim();
    if ((!content && !attached) || sending) return;
    if (!activeProvider || !configuredConfigs.some(item => item.provider === activeProvider)) {
      setError('هنوز یک پرووایدر فعال نشده است. مالک یا مدیر مجموعه باید ابتدا API key را در تنظیمات دستیار ثبت کند.');
      if (isAdmin) setSettingsOpen(true);
      return;
    }
    if (attached?.base64 && activeProvider === 'deepseek') {
      setError('DeepSeek در مسیر فعلی فایل باینری را پردازش نمی‌کند. برای PDF از OpenAI، Gemini یا Claude استفاده کن.');
      return;
    }
    if (attached?.base64 && activeProvider !== 'openai' && attached.mimeType !== 'application/pdf') {
      setError('اسناد Office فعلاً فقط با OpenAI پشتیبانی می‌شوند. برای Gemini یا Claude، سند را به PDF تبدیل کن.');
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
      if (voiceModeRef.current) speak(response.content, true);
    } catch (caught) {
      // Keep the user's message on screen so the request can be retried or copied.
      setError(caught instanceof Error ? caught.message : 'دستیار پاسخ نداد؛ اتصال یا تنظیمات پرووایدر را بررسی کن.');
      if (voiceModeRef.current) speak('پاسخ دریافت نشد. دوباره بگو تا تلاش کنم.', true);
    } finally {
      setSending(false);
      if (!voiceModeRef.current) inputRef.current?.focus();
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
            <form className="ai-provider-form" onSubmit={event => { event.preventDefault(); void saveProvider(); }}>
              <label>مدل
                <input dir="ltr" value={model} onChange={event => setModel(event.target.value)} maxLength={120} placeholder={providerMeta[selectedProvider].defaultModel}/>
              </label>
              <label>کلید API {configs.some(item=>item.provider===selectedProvider&&item.configured)&&<small>برای نگه‌داشتن کلید فعلی، این کادر را خالی بگذار.</small>}
                <input dir="ltr" type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} maxLength={512} placeholder={configs.some(item=>item.provider===selectedProvider&&item.configured)?'کلید ذخیره شده است':'API key را وارد کن'} />
              </label>
              <div className="ai-provider-actions">
                <button className="ai-primary-button" type="submit" disabled={savingKey || testingProvider || loadingConfigs}>{savingKey?<LoaderCircle size={16} className="ai-spin"/>:<KeyRound size={16}/>} ذخیره و فعال‌سازی</button>
                <button className="ai-secondary-button" type="button" onClick={()=>void testProvider()} disabled={savingKey || testingProvider || loadingConfigs}>{testingProvider?<LoaderCircle size={16} className="ai-spin"/>:<ShieldCheck size={16}/>} تست اتصال بدون ذخیره</button>
              </div>
              
            </form>
          </>}
          {error&&<div className="ai-feedback error" role="alert">{error}</div>}
          {notice&&<div className="ai-feedback notice" role="status">{notice}</div>}
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
                <input ref={fileRef} className="sr-only" type="file" accept=".txt,.csv,.tsv,.md,.markdown,.json,.vcf,.xml,.html,.log,.sql,.js,.mjs,.ts,.tsx,.py,.css,.yaml,.yml,.toml,.ini,.pdf,.doc,.docx,.rtf,.odt,.ppt,.pptx,.xls,.xlsx,text/plain,text/csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event=>{const file=event.target.files?.[0];if(file)void handleFile(file);event.currentTarget.value='';}} />
                <button type="button" className={listening&&!voiceMode?'recording':''} onClick={toggleVoiceInput} disabled={voiceMode} title={listening&&!voiceMode?'پایان گفتار':'تبدیل گفتار فارسی به متن'} aria-label={listening&&!voiceMode?'توقف ضبط گفتار':'شروع گفتار'}>{listening&&!voiceMode?<MicOff size={18}/>:<Mic size={18}/>}</button>
                <button type="button" className={voiceMode?'recording':''} onClick={()=>voiceMode?stopVoiceConversation():startVoiceConversation()} title={voiceMode?'پایان مکالمه صوتی':'شروع مکالمه صوتی خودکار'} aria-label={voiceMode?'توقف مکالمه صوتی':'شروع مکالمه صوتی خودکار'}>{voiceMode?<MicOff size={18}/>:<Headphones size={18}/>}</button>
              </div>
              <small>{voiceMode?'مکالمه صوتی فعال':listening?'در حال شنیدن…':activeProvider?providerMeta[activeProvider].label:'پرووایدر تنظیم نشده'}</small>
              <button className="ai-send-button" type="submit" disabled={sending||(!draft.trim()&&!attached)} aria-label="ارسال پیام">{sending?<LoaderCircle size={17} className="ai-spin"/>:<Send size={17}/>}</button>
            </div>
            <p className="ai-compose-disclaimer">پاسخ‌ها باید با رکوردهای مدار بررسی شوند. دستیار بدون تأیید کاربر عملیات مالی یا تغییر داده اجرا نمی‌کند.</p>
          </form>
        </>}
      </section>
    </div>}
  </>;
}
