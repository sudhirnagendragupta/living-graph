import { VerificationVerdict, RelocationResponse } from './types.js';

/**
 * Models asked for JSON don't always deliver clean JSON — code fences, or
 * plain prose are common. Try progressively looser extraction before giving up.
 * Shared across every VLM backend (NVIDIA NIM, Anthropic, ...) since the
 * tolerant-parsing problem is about model behavior, not the provider.
 */
export function extractJsonCandidate<T>(rawContent: string): T | null {
  const codeBlockMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()) as T; } catch { /* fall through */ }
  }

  const firstBrace = rawContent.indexOf('{');
  const lastBrace = rawContent.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(rawContent.substring(firstBrace, lastBrace + 1)) as T; } catch { /* fall through */ }
  }

  return null;
}

/**
 * Some models ignore "respond only with JSON" and write a markdown-labeled
 * report instead (e.g. "**Verified:** False\n**Confidence:** 0.8\n**Reasoning:** ...").
 * Extract the labeled fields directly when present, before falling back to keyword guessing.
 * Without this, the naive keyword heuristic below sees "verified" appear anywhere
 * in the text and concludes verified:true — even when the model literally wrote
 * "Verified: False" right next to it.
 */
export function extractMarkdownVerdict(rawContent: string): VerificationVerdict | null {
  const verifiedMatch = rawContent.match(/\*{0,2}verified\*{0,2}\s*:?\**\s*(true|false)/i);
  if (!verifiedMatch) return null;

  const confidenceMatch = rawContent.match(/\*{0,2}confidence\*{0,2}\s*:?\**\s*([0-9]*\.?[0-9]+)/i);
  const reasoningMatch = rawContent.match(/\*{0,2}reasoning\*{0,2}\s*:?\**\s*([\s\S]+)/i);

  let confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;
  if (confidence > 1) confidence = confidence / 100; // model may have written e.g. "80" meaning 80%

  return {
    verified: verifiedMatch[1].toLowerCase() === 'true',
    confidence,
    detectedElements: [],
    reasoning: (reasoningMatch ? reasoningMatch[1] : rawContent).trim().slice(0, 300),
  };
}

export function parseModelJson<T>(rawContent: string, fallback: T): T {
  const extracted = extractJsonCandidate<T>(rawContent);
  if (extracted) return extracted;

  const markdownVerdict = extractMarkdownVerdict(rawContent);
  if (markdownVerdict) return markdownVerdict as unknown as T;

  // Last-resort keyword heuristic — conservative: an explicit negative signal
  // always wins over the mere presence of the word "verified" elsewhere in the text.
  const lower = rawContent.toLowerCase();
  const hasNegative = /verified\s*:?\**\s*false|not verified|does not match|failed|unsuccessful/.test(lower);
  const hasPositive = lower.includes('verified') || lower.includes('success') || lower.includes('matches');
  const verified = hasPositive && !hasNegative;

  return {
    ...(fallback as Record<string, unknown>),
    verified,
    confidence: 0.6,
    reasoning: rawContent.substring(0, 300),
  } as T;
}

/**
 * Relocation responses have no safe semantic fallback. If the model's response
 * can't be parsed as JSON, honestly report "not found".
 */
export function parseRelocationJson(rawContent: string): RelocationResponse {
  const extracted = extractJsonCandidate<RelocationResponse>(rawContent);
  if (extracted) return extracted;
  return { found: false, selector: '', role: '', label: '', reasoning: `Model response was not parseable JSON: ${rawContent.substring(0, 200)}` };
}

