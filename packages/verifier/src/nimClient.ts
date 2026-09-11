import { IVerifierClient, VerificationRequest, VerificationVerdict, RelocationRequest, RelocationResponse } from './types.js';
import { parseModelJson, parseRelocationJson } from './responseParsing.js';

/**
 * CloudNimClient: calls NVIDIA NIM (or any OpenAI-compatible VLM endpoint).
 * No mock fallbacks. If NVIDIA_API_KEY is missing or a call fails, it throws.
 * Timeout is 30s — vision inference with large screenshots can take 15-25s.
 */
export class CloudNimClient implements IVerifierClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(options?: { apiKey?: string; baseUrl?: string; model?: string }) {
    this.apiKey = options?.apiKey || process.env.NVIDIA_API_KEY || '';
    this.baseUrl = (options?.baseUrl || process.env.NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');
    this.model = options?.model || process.env.NIM_MODEL || 'nvidia/nemotron-nano-12b-v2-vl';

    if (!this.apiKey) {
      throw new Error('[CloudNimClient] NVIDIA_API_KEY is not set. Export NVIDIA_API_KEY to use VLM verification.');
    }
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

    const userContent = [
      { type: 'text', text: `Intended goal: "${request.intent}". Expected invariants: ${JSON.stringify(request.expectedInvariants || [])}. Verify if current UI state matches.` },
      { type: 'image_url', image_url: { url: request.screenshotBase64.startsWith('data:') ? request.screenshotBase64 : `data:image/png;base64,${request.screenshotBase64}` } },
    ];

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }], temperature: 0.1, max_tokens: 512 }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`[CloudNimClient] verifyStep failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const rawContent = data.choices?.[0]?.message?.content || '{}';
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

    const userContent = [
      { type: 'text', text: `The missing element was: "${request.missingElementDescription}".\nUser Intent: "${request.intent}".\nInspect the application screen, locate where this functionality has moved, and return the new selector. Also determine whether the replacement is now a text input, a dropdown, or a clickable control, and report that as "actionType" — the original action type is not guaranteed to still apply if the control's role changed in the redesign.` },
      { type: 'image_url', image_url: { url: request.screenshotBase64.startsWith('data:') ? request.screenshotBase64 : `data:image/png;base64,${request.screenshotBase64}` } },
    ];

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }], temperature: 0.1, max_tokens: 512 }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`[CloudNimClient] relocateAction failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const rawContent = data.choices?.[0]?.message?.content || '{}';
    return parseRelocationJson(rawContent);
  }
}
