/**
 * Normalizes an Indonesian WhatsApp number into Fonnte's canonical format:
 * country code "62" + subscriber number, no "+", no leading "0", no spaces/dashes.
 *
 * Examples:
 *  "08123456789"      -> "628123456789"
 *  "+62 812-3456-789" -> "628123456789"
 *  "62812 3456 789"   -> "628123456789"
 *  "812-3456-789"     -> "628123456789"
 *  "8123456789@s.whatsapp.net" -> "628123456789"
 */
export function normalizePhoneNumber(raw: string): string {
  if (!raw) return "";

  // Fonnte's webhook sometimes sends the sender as "628xxx" or with a WA suffix.
  let value = raw.split("@")[0].trim();

  // Strip everything that isn't a digit (spaces, dashes, parentheses, "+", etc.)
  value = value.replace(/\D/g, "");

  if (value.startsWith("0")) {
    value = "62" + value.slice(1);
  } else if (value.startsWith("620")) {
    // Defensive: someone typed 62 + 0 + number by mistake.
    value = "62" + value.slice(3);
  } else if (!value.startsWith("62")) {
    // No country code and no leading zero, e.g. "8123456789"
    value = "62" + value;
  }

  return value;
}

/** Formats a normalized number back into a human-friendly display form. */
export function formatPhoneForDisplay(normalized: string): string {
  if (!normalized.startsWith("62")) return normalized;
  return "0" + normalized.slice(2);
}
