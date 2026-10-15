import React from 'react';

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

export default class RuntimeErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Simorgh application failed to render', error, info.componentStack);
    document.getElementById('app-boot-screen')?.remove();
    document.documentElement.dataset.simorghReady = 'error';
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return <main className="sim-runtime-error" dir="rtl">
      <div className="sim-runtime-error-card">
        <span className="sim-runtime-error-mark" aria-hidden="true">S</span>
        <span className="sim-runtime-error-eyebrow">SIMORGH / RECOVERY</span>
        <h1>اپ به‌درستی راه‌اندازی نشد</h1>
        <p>این بار به‌جای صفحه‌ی سیاه، خطای اجرای رابط شناسایی شده است. ابتدا بارگذاری تازه را امتحان کن؛ اطلاعات شرکت تغییری نکرده است.</p>
        <button type="button" onClick={() => window.location.reload()}>بارگذاری دوباره</button>
        <small>اگر خطا ادامه داشت، ابزارهای توسعه‌ی مرورگر را باز کن و اولین خطای قرمز کنسول را بررسی کن.</small>
      </div>
    </main>;
  }
}
