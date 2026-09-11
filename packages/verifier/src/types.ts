export interface VerificationRequest {
  screenshotBase64: string;
  intent: string;
  expectedInvariants?: string[];
  currentRoute?: string;
}

export interface HealedAction {
  actionType: 'click' | 'fill' | 'select';
  suggestedSelector: string;
  targetDescription: string;
  confidence: number;
}

export interface VerificationVerdict {
  verified: boolean;
  confidence: number;
  detectedElements: string[];
  reasoning: string;
  healedAction?: HealedAction;
}

export interface RelocationRequest {
  screenshotBase64: string;
  missingElementDescription: string;
  intent: string;
}

export interface RelocationResponse {
  found: boolean;
  selector: string;
  role: string;
  label: string;
  reasoning: string;
  /**
   * What kind of action the relocated element needs, if the VLM can tell
   * from the screenshot (an <input> vs a <button>, say). Optional — older
   * verifier implementations or a low-confidence relocation may omit it,
   * in which case the caller should fall back to the original edge's own
   * action type rather than assuming 'click'.
   */
  actionType?: 'click' | 'fill' | 'select';
  /** For a 'fill'/'select' actionType: a realistic value to enter, if the VLM inferred one from visible placeholder/label text. */
  suggestedValue?: string;
}

export interface IVerifierClient {
  verifyStep(request: VerificationRequest): Promise<VerificationVerdict>;
  relocateAction(request: RelocationRequest): Promise<RelocationResponse>;
}
