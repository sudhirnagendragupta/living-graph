/**
 * `payload.value` on a fill/select edge is the raw source text of the
 * setter's argument (e.g. from `setEmail(e.target.value)` it's literally
 * the string "e.target.value") — useful when it's a hardcoded literal
 * (`setPriority('high')` -> "'high'"), useless otherwise. Extract the
 * literal only when the source text is actually a quoted string.
 */
export function extractLiteralValue(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^['"`](.*)['"`]$/s);
  return match ? match[1] : null;
}

/**
 * A generic literal like "sample value" doesn't look like a real email or
 * password to a vision model — it can correctly notice "sample value"
 * isn't a valid email address and mark the step unverified even though the
 * field genuinely got filled. Infer a more realistic-looking value from
 * whatever hints are available (selector text, narration/label).
 *
 * Shared between AutonomousWalker (normal fill execution) and
 * AutonomousHealer (a healed edge that turns out to be a fill target needs
 * the exact same realistic-value inference, not a second, drifting copy).
 */
export function inferFillValue(selector: string, narration: string): string {
  const hay = `${selector} ${narration}`.toLowerCase();
  if (/email/.test(hay)) return 'jordan.taylor@example.com';
  if (/password/.test(hay)) return 'SecurePass!2024';
  if (/(search|filter|query)/.test(hay)) return 'search term';
  if (/name/.test(hay)) return 'Jordan Taylor';
  if (/phone/.test(hay)) return '555-0182';
  if (/(url|link|website)/.test(hay)) return 'https://example.com';
  if (/date/.test(hay)) return '2026-01-15';
  if (/(number|amount|qty|quantity)/.test(hay)) return '5';
  return 'sample value';
}
