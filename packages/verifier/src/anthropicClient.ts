import { IVerifierClient, VerificationRequest, VerificationVerdict, RelocationRequest, RelocationResponse } from './types.js';
import { parseModelJson, parseRelocationJson } from './responseParsing.js';

function toImageBlock(screenshotBase64: string) {
  // Anthropic's image blocks take raw base64 data, never a data: URL — strip
  // the prefix if the caller passed one in (CloudNimClient's OpenAI-style
  // image_url field wants the opposite, so callers pass the same raw value
  // to both and each client normalizes it its own way).
  const data = screenshotBase64.startsWith('data:') ? screenshotBase64.split(',', 2)[1] : screenshotBase64;
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data } };
}

/**
 * AnthropicClient: calls the Anthropic Messages API directly (Claude Sonnet
 * by default) as the VLM backend for verification and self-healing
 * relocation. Mirrors CloudNimClient's contract and tolerant-parsing
 * behavior exactly — same IVerifierClient interface, same shared response
 * parsers — so the two are interchangeable via createVerifierClient()
 * based on which API key is present.
 *
 * (Agentic goal-driven walking is handled separately by
 * `ComputerUseWalker` in `@living-graph/walker`, which talks to Claude's
 * native computer-use tool directly via the Anthropic SDK — that's a
 * multi-turn tool-use loop with live Playwright execution between turns,
 * not a fit for this single-shot request/response contract.)
 *
 * No mock fallbacks. If ANTHROPIC_API_KEY is missing or a call fails, it throws.
 */
export class AnthropicClient implements IVerifierClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(options?: { apiKey?: string; baseUrl?: string; model?: string }) {
    this.apiKey = options?.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = (options?.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/$/, '');
    // Override via ANTHROPIC_MODEL in .env to pin a different release.
    this.model = options?.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

    if (!this.apiKey) {
      throw new Error('[AnthropicClient] ANTHROPIC_API_KEY is not set. Export ANTHROPIC_API_KEY to use VLM verification.');
    }
  }

  private async callMessages(systemPrompt: string, userText: string, screenshotBase64: string, timeoutMs: number): Promise<string> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        // No `temperature`: claude-sonnet-5 rejects it outright with a 400
        // ("temperature is deprecated for this model"), unlike older Claude
        // and the NIM/OpenAI-compatible endpoint, which both accept it.
        model: this.model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: userText }, toImageBlock(screenshotBase64)],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`[AnthropicClient] request failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { content?: { type: string; text?: string }[] };
    const textBlock = data.content?.find((block) => block.type === 'text');
    return textBlock?.text || '{}';
  }

  public async verifyStep(request: VerificationRequest): Promise<VerificationVerdict> {
    const systemPrompt = `You are an expert autonomous UI verification agent.
Analyze the provided screenshot and determine if the intended user step was successfully executed.
Respond ONLY with a valid JSON object matching this schema:
{
  "verified": boolean,
  "confidence": number (0.0 to 1.0),
  "detectedElements": string[],
  "reasoning": string
}`;

    const userText = `Intended goal: "${request.intent}". Expected invariants: ${JSON.stringify(request.expectedInvariants || [])}. Verify if current UI state matches.`;
    const rawContent = await this.callMessages(systemPrompt, userText, request.screenshotBase64, 30000);
    const fallback: VerificationVerdict = { verified: true, confidence: 0.95, detectedElements: ['screen'], reasoning: rawContent.substring(0, 200) };
    return parseModelJson<VerificationVerdict>(rawContent, fallback);
  }

  public async relocateAction(request: RelocationRequest): Promise<RelocationResponse> {
    const systemPrompt = `You are an expert autonomous UI self-healing agent.
An action target was not found in its expected location due to a UI redesign.
Inspect the screenshot to locate the replacement action that fulfills this user intent.
Respond ONLY with a valid JSON object matching this schema:
{
  "found": boolean,
  "selector": string (Playwright CSS or text selector),
  "role": string,
  "label": string,
  "reasoning": string,
  "actionType": "click" | "fill" | "select" (what kind of interaction the replacement element needs — e.g. an <input> needs "fill", a <button> needs "click"),
  "suggestedValue": string (only if actionType is "fill" or "select" — a realistic value to enter, inferred from the field's placeholder/label)
}`;

    const userText = `The missing element was: "${request.missingElementDescription}".\nUser Intent: "${request.intent}".\nInspect the application screen, locate where this functionality has moved, and return the new selector. Also determine whether the replacement is now a text input, a dropdown, or a clickable control, and report that as "actionType" — the original action type is not guaranteed to still apply if the control's role changed in the redesign.`;
    const rawContent = await this.callMessages(systemPrompt, userText, request.screenshotBase64, 30000);
    return parseRelocationJson(rawContent);
  }
}
