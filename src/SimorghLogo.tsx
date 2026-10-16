import type { SVGProps } from 'react';

function SimorghMark(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 100 84" fill="none" aria-hidden="true" focusable="false" {...props}>
    <path d="M8 22C23 10 41 13 56 28C40 22 25 22 8 22Z" fill="currentColor" opacity=".46"/>
    <path d="M7 36C22 25 38 27 53 40C37 35 22 35 7 36Z" fill="currentColor" opacity=".66"/>
    <path d="M10 50C23 40 36 41 48 52C35 49 22 49 10 50Z" fill="currentColor" opacity=".86"/>
    <path d="M19 64C33 48 47 36 60 19C64 11 73 7 81 12C90 17 88 27 80 32L72 36C66 51 54 64 39 72C31 70 24 67 19 64Z" fill="currentColor" opacity=".94"/>
    <path d="M25 63C38 51 50 40 62 24" stroke="#0B1012" strokeOpacity=".48" strokeWidth="2" strokeLinecap="round"/>
    <path d="M43 67C52 54 62 45 76 38" stroke="#0B1012" strokeOpacity=".36" strokeWidth="2" strokeLinecap="round"/>
    <path d="M62 24L76 17M62 24L71 39M43 43L54 56" stroke="var(--obs-accent, #6EB9AC)" strokeWidth="2.8" strokeLinecap="round"/>
    <circle cx="62" cy="24" r="4.2" fill="var(--obs-accent, #6EB9AC)" stroke="var(--obs-bg, #0B1012)" strokeWidth="1.5"/>
    <circle cx="76" cy="17" r="3.5" fill="var(--obs-accent-2, #709AA8)" stroke="var(--obs-bg, #0B1012)" strokeWidth="1.4"/>
    <circle cx="71" cy="39" r="3.5" fill="var(--obs-accent-2, #709AA8)" stroke="var(--obs-bg, #0B1012)" strokeWidth="1.4"/>
    <circle cx="54" cy="56" r="3.5" fill="var(--obs-accent, #6EB9AC)" stroke="var(--obs-bg, #0B1012)" strokeWidth="1.4"/>
  </svg>;
}

export function SimorghLogo({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  return <div className={`brand-lockup simorgh-lockup ${compact ? 'compact' : ''} ${className}`}>
    <span className="brand-symbol"><SimorghMark/></span>
    {!compact && <span className="brand-words"><b>سیمرغ</b><small>مدیریت مزرعه و عملیات</small></span>}
  </div>;
}
