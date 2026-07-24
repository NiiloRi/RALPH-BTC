'use client';

/**
 * Shared chart UI — moved verbatim from RiskDashboard.tsx so the valuation
 * model tabs (PowerLawChart, S2FChart, DifficultyChart) can reuse them.
 * Purely presentational: behavior lives in the caller.
 *
 * NOTE: `C` mirrors the --chart-* tokens in globals.css. SVG presentation
 * attributes don't resolve CSS var(), which is why these live in TS.
 * Keep the two in sync.
 */

export const C = {
  price: '#aab4c4',           // BTC price — desaturated cool blue-gray
  risk: '#f47c6a',            // risk — warm coral (softer than pure red)
  riskCombined: 'rgba(244, 124, 106, 0.62)',
  adjusted: '#a855f7',        // cycle-adjusted (Layer-1) identity color
  halving: 'rgba(167, 139, 250, 0.38)',
  halvingLabel: 'rgba(196, 181, 253, 0.75)',
  grid: 'rgba(232, 230, 225, 0.05)',
  axisText: '#7d7a73',
  axisLine: '#2c2c30',
  brushStroke: '#3a3a40',
  brushFill: '#141417',
} as const;

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border p-0.5"
      style={{ borderColor: 'var(--control-border)', background: 'var(--control-bg)' }}
    >
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className="ctl rounded px-2.5 py-1 text-[12px] font-medium transition-colors whitespace-nowrap"
            style={{
              background: on ? 'var(--control-bg-active)' : 'transparent',
              color: on ? 'var(--control-text-active)' : 'var(--control-text)',
              boxShadow: on ? 'inset 0 0 0 1px rgba(232,230,225,0.14)' : 'none',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  title,
  accent,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  title?: string;
  accent?: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="ctl flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors disabled:cursor-not-allowed"
      style={{
        borderColor: checked ? (accent ?? 'rgba(232,230,225,0.22)') : 'var(--control-border)',
        background: checked ? 'var(--control-bg-active)' : 'var(--control-bg)',
        color: disabled
          ? 'var(--faint)'
          : checked
            ? (accent ?? 'var(--control-text-active)')
            : 'var(--control-text)',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span
        aria-hidden
        className="inline-block w-1.5 h-1.5 rounded-full transition-colors"
        style={{ background: checked ? (accent ?? '#e8e6e1') : 'var(--faint)' }}
      />
      {label}
    </button>
  );
}
