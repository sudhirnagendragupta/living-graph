export * from './types.js';
export * from './nimClient.js';
export * from './anthropicClient.js';

import { CloudNimClient } from './nimClient.js';
import { AnthropicClient } from './anthropicClient.js';
import { IVerifierClient } from './types.js';

/**
 * Factory to create the appropriate verifier client based on environment
 * variables. Anthropic (Claude) is preferred when ANTHROPIC_API_KEY is set —
 * it's the primary supported backend. Falls back to NVIDIA NIM when only
 * NVIDIA_API_KEY is set. Throws with a clear message if neither is present —
 * no mocks, no silent fallbacks.
 */
export function createVerifierClient(): IVerifierClient {
  if (process.env.ANTHROPIC_API_KEY) {
    return new AnthropicClient();
  }
  if (process.env.NVIDIA_API_KEY) {
    return new CloudNimClient();
  }
  throw new Error(
    '[createVerifierClient] No VLM API key found. Set ANTHROPIC_API_KEY (preferred, Claude) or NVIDIA_API_KEY (NVIDIA NIM) in your environment or .env file.'
  );
}
