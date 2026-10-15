import type { SVGProps } from 'react';

function SimorghSymbol(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 100 84" fill="none" role="img" aria-label="نشان سیمرغ" focusable="false" {...props}>
    <path d="M10 24C29 21 47 29 60 43C43 36 28 37 12 42L10 24Z" fill="currentColor" opacity=".96"/>
    <path d="M7 39C26 34 44 42 56 54C39 49 24 53 10 58L7 39Z" fill="currentColor" opacity=".78"/>
    <path d="M12 55C28 49 42 57 50 66C36 64 25 68 17 74L12 55Z" fill="currentColor" opacity=".56"/>
    <path d="M40 60C52 50 61 39 67 26C71 17 79 10 87 13C94 15 97 22 94 28C92 33 87 36 81 36L77 36L77 46L88 44L82 53L74 54C68 67 59 74 48 77C44 72 41 66 40 60Z" fill="currentColor"/>
    <path d="M23 17L37 24M17 31L32 37M20 47L34 51" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".4"/>
    <path d="M38 69C50 71 61 65 69 55" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity=".7"/>
    <circle cx="85" cy="21" r="3" fill="#0B1012"/>
    <circle cx="85" cy="21" r="5.5" stroke="currentColor" strokeWidth="1.5" opacity=".65"/>
  </svg>;
}

export function SimorghLogo({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  return <div className={"brand-lockup simorgh-lockup " + (compact ? 'compact ' : '') + className} aria-label="سیمرغ، مدیریت یکپارچه‌ی مزرعه و عملیات">
    <span className="brand-symbol"><SimorghSymbol/></span>
    {!compact && <span className="brand-words"><b>سیمرغ</b><small>مدیریت یکپارچه‌ی مزرعه و عملیات</small></span>}
  </div>;
}
