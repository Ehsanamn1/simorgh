import type { SVGProps } from 'react';

function SimorghMark(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false" {...props}>
    <path d="M7 18C15 10 26 8 37 13C41 15 44 18 47 21" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity=".32"/>
    <path d="M6 29C15 21 27 20 38 26C41 28 43 30 45 32" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity=".5"/>
    <path d="M8 40C17 32 27 32 36 37C38 39 40 40 42 42" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity=".68"/>
    <path d="M14 52C23 45 31 36 39 22C43 14 50 10 56 15C61 19 58 25 52 29L47 32C42 41 35 49 24 55C20 55 17 54 14 52Z" fill="currentColor" opacity=".95"/>
    <path d="M39 22L51 15M39 22L49 33M29 39L37 48" stroke="var(--obs-accent, #6EB9AC)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="39" cy="22" r="3.3" fill="var(--obs-accent, #6EB9AC)" stroke="var(--obs-bg, #0B1012)" strokeWidth="1.4"/>
    <circle cx="51" cy="15" r="3" fill="var(--obs-accent-2, #709AA8)" stroke="var(--obs-bg, #0B1012)" strokeWidth="1.3"/>
    <circle cx="49" cy="33" r="3" fill="var(--obs-accent-2, #709AA8)" stroke="var(--obs-bg, #0B1012)" strokeWidth="1.3"/>
    <circle cx="37" cy="48" r="3" fill="var(--obs-accent, #6EB9AC)" stroke="var(--obs-bg, #0B1012)" strokeWidth="1.3"/>
  </svg>;
}

export function SimorghLogo({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  return <div className={`brand-lockup simorgh-lockup ${compact ? 'compact' : ''} ${className}`}>
    <span className="brand-symbol"><SimorghMark/></span>
    {!compact && <span className="brand-words"><b>سیمرغ</b><small>سامانه‌ی هوشمند عملیات مزرعه</small></span>}
  </div>;
}
