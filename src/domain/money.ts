/** Integer paise helpers. Never use floats for stored money. */

/** Percent (e.g. 0.5, 18) → basis points (50, 1800) without float drift. */
export const toBps = (percent: number): number => Math.round(percent * 100);

/** amount × bps / 10 000, rounded half-up (amounts are non-negative integers). */
export function applyBps(amountPaise: number, bps: number): number {
  if (!Number.isInteger(amountPaise) || amountPaise < 0)
    throw new Error("amountPaise must be a non-negative integer");
  return Math.floor((amountPaise * bps + 5000) / 10000);
}

export const percentOf = (amountPaise: number, percent: number) =>
  applyBps(amountPaise, toBps(percent));

export function formatInr(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

/** Paise → rupee decimal string for gateways ("590.00"). */
export function paiseToRupeeString(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Indian financial year label (April–March): 2026-11-02 → "2026-27". */
export function financialYear(d: Date): string {
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export const invoiceNumber = (fy: string, seq: number) =>
  `FF/${fy}/${String(seq).padStart(6, "0")}`;
