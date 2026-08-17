/**
 * Normalise a Philippine mobile number to E.164.
 *
 * Twilio and Vapi both require E.164 ("+639171234567"), but nobody types a
 * number that way — they type "09171234567" the way it appears on a phone.
 * Accept whatever shape is natural and convert it, rather than making the
 * person do it.
 *
 * Returns null when the input can't be a PH mobile, so callers can block the
 * call instead of handing Twilio something it will reject mid-flight.
 */
export function normalizePhPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");

  let local: string | null = null;
  if (digits.length === 12 && digits.startsWith("63")) {
    local = digits.slice(2); // 639171234567
  } else if (digits.length === 11 && digits.startsWith("0")) {
    local = digits.slice(1); // 09171234567
  } else if (digits.length === 10) {
    local = digits; // 9171234567
  }

  // PH mobile numbers are always 10 digits starting with 9.
  if (!local || !/^9\d{9}$/.test(local)) return null;
  return `+63${local}`;
}
