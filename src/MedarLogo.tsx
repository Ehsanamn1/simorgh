import type { SVGProps } from 'react';

function SahraMark(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 100 100" fill="none" role="img" aria-label="نشان صحرا" focusable="false" {...props}>
    <path d="M43 12 15 40 43 68 57 54 43 40 34 49 43 58 48 53 44 49 43 50" stroke="#F3ECE6" strokeWidth="6.5" strokeLinejoin="miter" strokeLinecap="square"/>
    <path d="M57 12 85 40 57 68 43 54 57 40 66 49 57 58 52 53 56 49 57 50" stroke="#B58A68" strokeWidth="6.5" strokeLinejoin="miter" strokeLinecap="square"/>
    <path d="M43 68 57 82 71 68 57 54" stroke="#F3ECE6" strokeWidth="6.5" strokeLinejoin="miter" strokeLinecap="square"/>
  </svg>;
}

export function MedarLogo({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  return <div className={`brand-lockup sahra-lockup ${compact ? 'compact' : ''} ${className}`}>
    <span className="brand-symbol"><SahraMark/></span>
    {!compact && <span className="brand-words"><b>صحرا</b><small>SAHRA VALUE CHAIN LEADERS</small></span>}
  </div>;
}
