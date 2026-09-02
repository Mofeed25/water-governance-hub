export const MIN_READING_OCR_CONFIDENCE = 0.9;

/**
 * Canonicalization is intentionally limited to transport-safe formatting.
 * It does not perform fuzzy matching, digit substitution, or partial matching.
 */
export function canonicalizeMeterSerial(value: string): string {
  return value.trim().toUpperCase();
}

export function exactMeterIdentityMatch(extracted: string, registered: string): boolean {
  const a = canonicalizeMeterSerial(extracted);
  const b = canonicalizeMeterSerial(registered);
  return a.length > 0 && a === b;
}

export function normalizeOcrDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[^0-9.]/g, "");
}

export function parseCurrentReading(value: string): number | null {
  const normalized = normalizeOcrDigits(value);
  if (!normalized || (normalized.match(/\./g) ?? []).length > 1) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function acceptOcrReading(confidence: number | null | undefined): boolean {
  return typeof confidence === "number" && Number.isFinite(confidence) && confidence >= MIN_READING_OCR_CONFIDENCE;
}
