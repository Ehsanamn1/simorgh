import type { SVGProps } from 'react';

function SimorghBirdMark(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 100 84" fill="none" aria-hidden="true" focusable="false" {...props}>
    <path d="M7 20c14 0 26 3 40 10l8 7-17-1C27 34 17 31 9 28Z" fill="currentColor" opacity=".94"/>
    <path d="M5 32c13 0 24 3 36 9l10 7-17 1C23 46 14 43 7 41Z" fill="currentColor" opacity=".94"/>
    <path d="M9 46c10 0 18 2 28 8l10 8-14 1C22 59 14 55 10 53Z" fill="currentColor" opacity=".94"/>
    <path d="M20 60c12-8 25-10 37-5 7 3 12 8 16 14-13 10-28 11-41 4-6-3-10-7-12-13Z" fill="currentColor"/>
    <path d="M40 58c8-9 15-18 20-28C65 18 72 9 82 10c8 1 12 8 9 15-2 5-6 8-12 9l-7 1-1 11 13-1-7 9-10 1c-3 9-8 16-15 20-6-4-10-9-12-17Z" fill="currentColor"/>
    <path d="M23 69c-3 5-8 8-15 8 9 5 19 4 28-3l-4-6Z" fill="currentColor"/>
    <path d="m83 20 14-5-8 13-5 0Z" fill="currentColor"/>
    <circle cx="82" cy="17" r="2.1" fill="#0B1012"/>
  </svg>;
}

export function SimorghLogo({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  return <div className={`brand-lockup simorgh-lockup ${compact ? 'compact' : ''} ${className}`}>
    <span className="brand-symbol"><SimorghBirdMark/></span>
    {!compact && <span className="brand-words"><b>Simorgh</b><small>Obsidian Intelligence</small></span>}
  </div>;
}
