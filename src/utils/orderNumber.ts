/**
 * Formats a numeric, auto-incrementing database id into KETUPAT's public
 * order number format: KTP-00001, KTP-00002, ...
 * The "#" prefix shown to customers is added only when rendering messages.
 */
export function formatOrderNumber(id: number): string {
  return `KTP-${String(id).padStart(5, "0")}`;
}

/** Extracts the numeric id from an order number, accepting "#KTP-00001" or "KTP-00001". */
export function parseOrderNumber(input: string): number | null {
  const match = input.trim().toUpperCase().match(/KTP-?(\d+)/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isNaN(n) ? null : n;
}
