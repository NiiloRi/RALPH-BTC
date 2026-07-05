/**
 * Canonical risk bands and personal action labels
 *
 * SINGLE SOURCE OF TRUTH for risk interpretation across the app.
 * Previously the gauge label, the action signal, and the legend each used
 * their own (conflicting) thresholds — e.g. 42.4% displayed "Neutral" and
 * "Moderate Buy" simultaneously. All three now derive from this module.
 *
 * Design:
 * - 5 canonical BANDS (0-20/20-40/40-60/60-80/80-100) drive the level label
 *   and the legend. These match getRiskLevel() in model.ts.
 * - A finer ACTION ladder exists for the personal action label, but every
 *   action boundary is aligned INSIDE a band boundary, so the action can
 *   never contradict the band (no more "Neutral" + "Moderate Buy").
 * - These are PERSONAL decision-support labels for private use, not advice.
 *   Thresholds are heuristic conventions (quintiles of the calibrated score),
 *   not validated trade signals — treat them as a vocabulary, not a system.
 */

export type RiskBandLevel =
  | 'low'
  | 'moderate-low'
  | 'neutral'
  | 'moderate-high'
  | 'high';

export interface RiskBand {
  /** Inclusive lower bound [0,1] */
  min: number;
  /** Exclusive upper bound [0,1] (last band inclusive) */
  max: number;
  level: RiskBandLevel;
  /** Display name, e.g. "Moderate-Low" */
  label: string;
  /** Personal action word shown in the legend */
  action: string;
  /** Tailwind-agnostic hex color */
  color: string;
}

/** The 5 canonical bands (must stay aligned with model.getRiskLevel). */
export const RISK_BANDS: RiskBand[] = [
  { min: 0.0, max: 0.2, level: 'low', label: 'Low Risk', action: 'Accumulate', color: '#22c55e' },
  { min: 0.2, max: 0.4, level: 'moderate-low', label: 'Moderate-Low', action: 'DCA', color: '#84cc16' },
  { min: 0.4, max: 0.6, level: 'neutral', label: 'Neutral', action: 'Hold', color: '#eab308' },
  { min: 0.6, max: 0.8, level: 'moderate-high', label: 'Moderate-High', action: 'Take Profits', color: '#f97316' },
  { min: 0.8, max: 1.0, level: 'high', label: 'High Risk', action: 'Caution', color: '#dc2626' },
];

export interface RiskAction {
  /** Inclusive lower bound; aligned within a single band */
  min: number;
  max: number;
  text: string;
  emoji: string;
  desc: string;
}

/**
 * Finer personal action ladder. Every boundary here coincides with or nests
 * inside a RISK_BANDS boundary — verified by tests.
 */
export const RISK_ACTIONS: RiskAction[] = [
  { min: 0.0, max: 0.1, text: 'Strong Buy Zone', emoji: '🟢', desc: 'Historically excellent accumulation area' },
  { min: 0.1, max: 0.2, text: 'Buy Zone', emoji: '🟢', desc: 'Low risk, favorable accumulation' },
  { min: 0.2, max: 0.4, text: 'DCA / Moderate Buy', emoji: '🟡', desc: 'Acceptable entry, keep position sizing normal' },
  { min: 0.4, max: 0.6, text: 'Hold / Neutral', emoji: '🟡', desc: 'No strong signal, stay patient' },
  { min: 0.6, max: 0.8, text: 'Take Profits', emoji: '🟠', desc: 'Elevated risk, consider trimming into strength' },
  { min: 0.8, max: 0.9, text: 'High Risk – Reduce', emoji: '🔴', desc: 'Reduce exposure, protect gains' },
  { min: 0.9, max: 1.0, text: 'Extreme Risk', emoji: '🔴', desc: 'Historically near cycle top' },
];

/** Clamp helper */
function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  return Math.max(0, Math.min(1, x));
}

/** Get the canonical band for a risk value. */
export function getRiskBand(risk: number): RiskBand {
  const r = clamp01(risk);
  return (
    RISK_BANDS.find(b => r >= b.min && (r < b.max || (b.max === 1 && r <= 1))) ??
    RISK_BANDS[2]
  );
}

/** Get the personal action for a risk value (always consistent with its band). */
export function getRiskAction(risk: number): RiskAction {
  const r = clamp01(risk);
  return (
    RISK_ACTIONS.find(a => r >= a.min && (r < a.max || (a.max === 1 && r <= 1))) ??
    RISK_ACTIONS[3]
  );
}

/**
 * Confidence-aware action text. When model confidence is not high, the
 * action label is qualified so it cannot be read as a firm signal.
 */
export function qualifyAction(
  action: RiskAction,
  confidenceLevel?: 'low' | 'medium' | 'high'
): { text: string; qualifier: string | null } {
  if (confidenceLevel === 'low') {
    return { text: action.text, qualifier: 'low confidence — components disagree or data incomplete' };
  }
  if (confidenceLevel === 'medium') {
    return { text: action.text, qualifier: 'medium confidence' };
  }
  return { text: action.text, qualifier: null };
}
