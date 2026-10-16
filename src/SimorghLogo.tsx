import type { SVGProps } from 'react';

function MedarMark(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" focusable="false" {...props}>
    <path d="M18 66C11 47 20 25 40 18C58 11 78 21 82 40C86 58 74 75 56 81" stroke="currentColor" strokeOpacity=".34" strokeWidth="7" strokeLinecap="round"/>
    <path d="M27 67C21 52 29 36 44 31C57 27 70 36 71 49C72 61 62 70 51 71" stroke="currentColor" strokeOpacity=".65" strokeWidth="7" strokeLinecap="round"/>
    <path d="M23 76 48 51 75 25" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M48 51 72 62" stroke="var(--obs-accent, #82BDB1)" strokeWidth="6" strokeLinecap="round"/>
    <circle cx="23" cy="76" r="6" fill="var(--obs-accent, #82BDB1)"/>
    <circle cx="48" cy="51" r="6" fill="currentColor"/>
    <circle cx="75" cy="25" r="6" fill="var(--obs-accent, #82BDB1)"/>
    <circle cx="72" cy="62" r="5" fill="var(--obs-accent, #82BDB1)"/>
  </svg>;
}

export function SimorghLogo({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  return <div className={`brand-lockup simorgh-lockup ${compact ? 'compact' : ''} ${className}`}>
    <span className="brand-symbol"><MedarMark/></span>
    {!compact && <span className="brand-words"><b>مدار</b><small>مدیریت مزرعه و عملیات</small></span>}
  </div>;
}
