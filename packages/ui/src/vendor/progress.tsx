// Generated from packages/react/src/progress.tsx. Regenerate in CyberUI with pnpm registry:build; after installation, edit this file freely.
'use client';
import { type DOMProps } from "./shared.js";
import { type ProgressVariant } from "./progress-variant.js";
import { useId } from 'react';
import s from "./progress.module.css";
export interface ProgressProps extends DOMProps {
    value: number;
    variant?: ProgressVariant;
    segments?: number;
    label?: string;
    showValue?: boolean;
}
export function Progress({ value, variant = 'segments', segments = 20, label = 'Progress', showValue, className, style, ...props }: ProgressProps) {
    const v = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
    const id = useId().replace(/:/g, '');
    const total = Math.min(100, Math.max(1, segments));
    const wave = Array.from({ length: 501 }, (_, i) => { const p = (i % 72) / 72; const y = 22 - (p > .36 && p < .48 ? Math.sin((p - .36) / .12 * Math.PI) * 18 : p > .48 && p < .57 ? -Math.sin((p - .48) / .09 * Math.PI) * 10 : Math.sin(p * Math.PI * 5) * 2); return `${i},${y.toFixed(1)}`; }).join(' ');
    return <div {...props} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} className={className} style={style}>
    {showValue && <div style={{ display: 'flex', justifyContent: 'space-between', font: '12px var(--cyber-font-mono)', marginBottom: 10 }} aria-hidden><span>{label}</span><span>{v}%</span></div>}
    {variant === 'segments' ? <div className={s.progress ?? ""} aria-hidden>{Array.from({ length: total }, (_, i) => <span key={i} className={s.progressCell ?? ""} data-filled={i < Math.round(v / 100 * total)}/>)}</div> :
            variant === 'ascii' ? <div className={s.progressAscii ?? ""} aria-hidden>[<span>{'#'.repeat(Math.round(v / 5))}</span><span>{'·'.repeat(20 - Math.round(v / 5))}</span>]</div> :
                <svg viewBox="0 0 500 44" preserveAspectRatio="none" className={s.progressWave ?? ""} aria-hidden>
        <defs><clipPath id={id}><rect width={v * 5} height="44"/></clipPath></defs>
        {variant === 'heartbeat' ? <><polyline points={wave} fill="none" stroke="var(--cyber-muted)" strokeWidth="1" strokeDasharray="1 2"/><polyline points={wave} fill="none" stroke="var(--cyber-accent)" strokeWidth="2" clipPath={`url(#${id})`}/></> :
                        variant === 'scanline' ? <><path d="M0 32H500" stroke="var(--cyber-muted)"/>{Array.from({ length: 11 }, (_, i) => <path key={i} d={`M${i * 50} 28v9`} stroke="var(--cyber-muted)"/>)}<path d={`M0 32H${v * 5}`} stroke="var(--cyber-accent)" strokeWidth="4"/></> :
                            Array.from({ length: 64 }, (_, i) => { const h = 10 + Math.abs(Math.sin(i * .9) * Math.cos(i * .37)) * 30; return <rect key={i} x={i * 7.85} y={44 - h} width="5" height={h} fill={i / 64 < v / 100 ? 'var(--cyber-accent)' : 'var(--cyber-line)'}/>; })}
        <path d={`M${Math.min(498, v * 5)} 1V43`} stroke="var(--cyber-ink)" strokeWidth="2"/>
      </svg>}
  </div>;
}
