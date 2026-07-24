/**
 * Projection date generator for the valuation-model charts.
 *
 * Weekly forward dates from the last real observation to `endDate`, with
 * `mustInclude` dates spliced in (deduped, sorted) and the final row forced
 * to be exactly `endDate`.
 *
 * WHY mustInclude exists: the charts use a category X axis of date strings,
 * so a <ReferenceLine x="2028-04-16"> only renders if some data row carries
 * exactly that date string. The generator guarantees the estimated-halving
 * date is a row, so the marker always lands on the chart.
 */

const MS_PER_DAY = 86_400_000;

function iso(ms: number): string {
  return new Date(ms).toISOString().split('T')[0];
}

/**
 * @param stepDays row spacing in days (default 7). Charts with a CATEGORY
 * x-axis should pass their historical downsampling step here — every row
 * takes equal horizontal width, so a density mismatch between history and
 * projection would visibly kink the curves at the boundary.
 */
export function projectionDates(
  lastDataDate: string,
  endDate: string,
  mustInclude: string[] = [],
  stepDays = 7
): string[] {
  const lastMs = new Date(lastDataDate).getTime();
  const endMs = new Date(endDate).getTime();
  if (!Number.isFinite(lastMs) || !Number.isFinite(endMs) || endMs <= lastMs) return [];
  const step = Math.max(1, Math.round(stepDays));

  const dates = new Set<string>();
  for (let ms = lastMs + step * MS_PER_DAY; ms < endMs; ms += step * MS_PER_DAY) {
    dates.add(iso(ms));
  }
  dates.add(iso(endMs)); // final row exactly endDate
  for (const d of mustInclude) {
    const ms = new Date(d).getTime();
    if (Number.isFinite(ms) && ms > lastMs && ms <= endMs) dates.add(iso(ms));
  }
  return Array.from(dates).sort();
}

/** ISO date `days` days after `date`. */
export function addDays(date: string, days: number): string {
  return iso(new Date(date).getTime() + days * MS_PER_DAY);
}
