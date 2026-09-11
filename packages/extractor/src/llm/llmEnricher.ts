import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import * as path from 'path';
import * as fs from 'fs';
import {
  GraphNode,
  GraphEdge,
  StateNode,
  StateTransitionEdge,
  RawWorkflow,
  EnrichedWorkflow,
  EnrichedStep,
} from '../types.js';
import { formatSemanticNarration, cleanWorkflowTitle } from '../semanticNarration.js';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const MAX_SNIPPET_LINES = 50;
const MAX_ENRICHMENT_PASSES = 2;

interface LLMEnrichmentResponse {
  enrichedWorkflows: Array<{
    id: string;
    title: string;
    description: string;
    difficulty: 'beginner' | 'intermediate' | 'advanced';
    priority: 'P0' | 'P1' | 'P2';
    persona?: string;
    steps: Array<{ edgeId: string; narration: string }>;
    branchCondition?: string;
  }>;
  missedWorkflows: Array<{
    stateNodeId: string;
    hint: string;
  }>;
}

/**
 * LLMEnricher calls Gemini to:
 *   1. Name each raw workflow with a human-facing title
 *   2. Write a 1-sentence description of the user goal
 *   3. Write step narrations (action → observable outcome)
 *   4. Assign difficulty, priority, persona
 *   5. Detect state nodes not covered by any raw workflow (missed workflows)
 *
 * Runs in at most 2 passes. On the second pass, only newly recovered workflows are sent.
 * Degrades gracefully if GEMINI_API_KEY is absent.
 */
export class LLMEnricher {
  private apiKey: string | null;
  private genAI: GoogleGenerativeAI | null;

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY ?? null;
    if (this.apiKey) {
      this.genAI = new GoogleGenerativeAI(this.apiKey);
    } else {
      this.genAI = null;
      console.warn('[LLMEnricher] GEMINI_API_KEY not set — skipping enrichment. Workflows will use raw IDs as titles.');
    }
  }

  public async enrich(
    rawWorkflows: RawWorkflow[],
    routeNodes: Record<string, GraphNode>,
    stateNodes: Record<string, StateNode>,
    allEdges: GraphEdge[],
    stateEdges: StateTransitionEdge[],
    sourceDir: string
  ): Promise<EnrichedWorkflow[]> {
    if (!this.genAI || rawWorkflows.length === 0) {
      return this.promoteFallback(rawWorkflows, allEdges, stateEdges);
    }

    const allStepEdges = this.buildEdgeMap(allEdges, stateEdges);
    const snippets = this.collectSourceSnippets(stateNodes, sourceDir);

    // Pass 1: enrich all raw workflows
    let enriched = await this.callGemini(
      rawWorkflows,
      routeNodes,
      stateNodes,
      allEdges,
      stateEdges,
      snippets,
      allStepEdges
    );

    // Pass 2: recover missed workflows flagged by the model
    if (enriched.missed.length > 0 && enriched.missed.length < 10) {
      const recovered = await this.recoverMissed(
        enriched.missed,
        stateNodes,
        routeNodes,
        allEdges,
        stateEdges,
        snippets,
        allStepEdges
      );
      enriched.workflows.push(...recovered);
    }

    return enriched.workflows;
  }

  // ─── Gemini call ──────────────────────────────────────────────────────────

  private async callGemini(
    rawWorkflows: RawWorkflow[],
    routeNodes: Record<string, GraphNode>,
    stateNodes: Record<string, StateNode>,
    allEdges: GraphEdge[],
    stateEdges: StateTransitionEdge[],
    snippets: Record<string, string>,
    edgeMap: Map<string, GraphEdge | StateTransitionEdge>
  ): Promise<{ workflows: EnrichedWorkflow[]; missed: Array<{ stateNodeId: string; hint: string }> }> {
    const model = this.genAI!.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.3,
      },
    });

    const payload = {
      routeNodes: Object.values(routeNodes).map((n) => ({
        id: n.id,
        route: n.route,
        title: n.title,
        interactiveElements: n.interactiveElements.slice(0, 10),
      })),
      stateNodes: Object.values(stateNodes).map((sn) => ({
        id: sn.id,
        kind: sn.kind,
        stateName: sn.stateName,
        setterName: sn.setterName,
        initialValue: sn.initialValue,
        possibleValues: sn.possibleValues,
        parentRouteNodeId: sn.parentRouteNodeId,
        sourceFile: sn.sourceFile,
        branchCondition: sn.branchCondition,
      })),
      navigationEdges: allEdges.slice(0, 30).map((e) => ({
        id: e.id,
        from: e.sourceNodeId,
        to: e.targetNodeId,
        label: e.action.targetLabel,
        selector: e.action.targetSelector,
        branchCondition: e.branchCondition,
      })),
      stateEdges: stateEdges.slice(0, 60).map((e) => ({
        id: e.id,
        stateNodeId: e.sourceStateId,
        label: e.triggerLabel,
        selector: e.triggerSelector,
        branchCondition: e.branchCondition,
      })),
      rawWorkflows,
      sourceSnippets: snippets,
    };

    const systemPrompt = `You are a product education expert analyzing a React web application's state machine graph.
You will receive a structured JSON payload describing the app's screens (routeNodes), intra-page states (stateNodes), navigation edges, and candidate workflows (rawWorkflows).

Your tasks:
1. For each rawWorkflow, produce a human-facing title describing the USER GOAL (not the variable name).
2. Write a 1-sentence description of what the user accomplishes.
3. Write step narrations for each candidateEdgeId: frame each as "action → observable outcome" (e.g. "Click Delete to open the confirmation dialog — this is a safeguarded, irreversible action").
4. Assign difficulty: 'beginner' (1-2 clicks), 'intermediate' (3-5 steps), 'advanced' (complex forms, multi-step).
5. Assign priority: 'P0' (auth, data loss risk), 'P1' (core workflow), 'P2' (preference/settings).
6. Infer persona from context (e.g. 'Support Agent', 'Admin', 'Developer').
7. Review ALL stateNodes. Any stateNode NOT covered by a rawWorkflow that represents a meaningful user action: add it to missedWorkflows with a hint.

Return ONLY valid JSON matching this schema exactly. Do not include markdown fences:
{
  "enrichedWorkflows": [
    {
      "id": "raw workflow id",
      "title": "Human-facing goal title",
      "description": "One-sentence user accomplishment",
      "difficulty": "beginner | intermediate | advanced",
      "priority": "P0 | P1 | P2",
      "persona": "Target user persona",
      "steps": [
        {
          "edgeId": "edge id",
          "narration": "Action and observable outcome"
        }
      ]
    }
  ],
  "missedWorkflows": [
    {
      "stateNodeId": "uncovered stateNode id",
      "hint": "Description of the missed workflow"
    }
  ]
}`;

    const prompt = `${systemPrompt}\n\nPayload:\n${JSON.stringify(payload, null, 2)}`;

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = JSON.parse(text) as any;

      const rawList: any[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.enrichedWorkflows)
        ? parsed.enrichedWorkflows
        : Array.isArray(parsed.workflows)
        ? parsed.workflows
        : [];

      const workflows = rawList.map((ew) =>
        this.buildEnrichedWorkflow(ew, rawWorkflows, edgeMap, stateEdges)
      );

      const missed = Array.isArray(parsed.missedWorkflows)
        ? parsed.missedWorkflows
        : [];

      return { workflows: workflows.length > 0 ? workflows : this.promoteFallback(rawWorkflows, allEdges, stateEdges), missed };
    } catch (err) {
      console.error('[LLMEnricher] Gemini call failed:', err);
      return {
        workflows: this.promoteFallback(rawWorkflows, allEdges, stateEdges),
        missed: [],
      };
    }
  }

  private async recoverMissed(
    missed: Array<{ stateNodeId: string; hint: string }>,
    stateNodes: Record<string, StateNode>,
    routeNodes: Record<string, GraphNode>,
    allEdges: GraphEdge[],
    stateEdges: StateTransitionEdge[],
    snippets: Record<string, string>,
    edgeMap: Map<string, GraphEdge | StateTransitionEdge>
  ): Promise<EnrichedWorkflow[]> {
    // Build synthetic RawWorkflows from the missed hints
    const recoveredRaw: RawWorkflow[] = missed
      .map(({ stateNodeId, hint }) => {
        const sn = stateNodes[stateNodeId];
        if (!sn) return null;
        const candidateEdges = stateEdges
          .filter((e) => e.sourceStateId === stateNodeId || e.targetStateId === stateNodeId)
          .filter((e) => e.triggerSelector?.length > 0);
        if (candidateEdges.length === 0) return null;

        return {
          id: `wf_recovered_${stateNodeId}`,
          pattern: sn.kind,
          parentNodeId: sn.parentRouteNodeId,
          candidateEdgeIds: candidateEdges.map((e) => e.id),
          stateNodeIds: [stateNodeId],
          branchCondition: sn.branchCondition,
        } as RawWorkflow;
      })
      .filter((r): r is RawWorkflow => r !== null);

    if (recoveredRaw.length === 0) return [];

    const result = await this.callGemini(
      recoveredRaw,
      routeNodes,
      stateNodes,
      allEdges,
      stateEdges,
      snippets,
      edgeMap
    );
    return result.workflows;
  }

  // ─── Result building ──────────────────────────────────────────────────────

  private buildEnrichedWorkflow(
    ew: LLMEnrichmentResponse['enrichedWorkflows'][0],
    rawWorkflows: RawWorkflow[],
    edgeMap: Map<string, GraphEdge | StateTransitionEdge>,
    stateEdges: StateTransitionEdge[]
  ): EnrichedWorkflow {
    const raw = rawWorkflows.find((r) => r.id === ew.id);
    const candidateEdgeIds = raw?.candidateEdgeIds ?? [];

    const steps: EnrichedStep[] = (ew.steps ?? candidateEdgeIds.map((id) => ({ edgeId: id, narration: '' }))).map(
      (step) => {
        const edge = edgeMap.get(step.edgeId);
        return {
          edgeId: step.edgeId,
          narration: step.narration,
          playwrightCode: edge
            ? ('playwrightCode' in edge ? edge.playwrightCode : '')
            : '',
        };
      }
    );

    // Determine start/end node
    const firstEdgeId = candidateEdgeIds[0];
    const lastEdgeId = candidateEdgeIds[candidateEdgeIds.length - 1];
    const firstEdge = edgeMap.get(firstEdgeId);
    const lastEdge = edgeMap.get(lastEdgeId);

    const startNodeId = firstEdge
      ? ('sourceNodeId' in firstEdge ? firstEdge.sourceNodeId : firstEdge.sourceStateId)
      : raw?.parentNodeId ?? 'unknown';
    const endNodeId = lastEdge
      ? ('targetNodeId' in lastEdge ? lastEdge.targetNodeId : lastEdge.targetStateId)
      : raw?.parentNodeId ?? 'unknown';

    return {
      id: ew.id,
      title: ew.title,
      description: ew.description,
      difficulty: ew.difficulty,
      priority: ew.priority,
      persona: ew.persona,
      startNodeId,
      endNodeId,
      edgeIds: steps.map((s) => s.edgeId),
      steps,
      branchCondition: ew.branchCondition ?? raw?.branchCondition,
    };
  }

  // ─── Fallback (no API key) ────────────────────────────────────────────────

  private promoteFallback(
    rawWorkflows: RawWorkflow[],
    allEdges: GraphEdge[],
    stateEdges: StateTransitionEdge[]
  ): EnrichedWorkflow[] {
    const edgeMap = this.buildEdgeMap(allEdges, stateEdges);

    return rawWorkflows.map((raw) => {
      const steps: EnrichedStep[] = raw.candidateEdgeIds.map((edgeId) => {
        const edge = edgeMap.get(edgeId);
        const edgeNarration = edge?.narration?.trim();
        const fallbackNarration = edge
          ? formatSemanticNarration(
              'action' in edge ? edge.action?.type : 'click',
              'action' in edge ? edge.action?.targetLabel : (edge as StateTransitionEdge).triggerLabel,
              'action' in edge ? edge.action?.targetSelector : (edge as StateTransitionEdge).triggerSelector,
              edgeId
            )
          : `Proceed with step ${edgeId}.`;

        return {
          edgeId,
          narration: edgeNarration || fallbackNarration,
          playwrightCode: edge ? ('playwrightCode' in edge ? edge.playwrightCode : '') : '',
        };
      });

      const firstEdgeId = raw.candidateEdgeIds[0];
      const lastEdgeId = raw.candidateEdgeIds[raw.candidateEdgeIds.length - 1];
      const firstEdge = edgeMap.get(firstEdgeId);
      const lastEdge = edgeMap.get(lastEdgeId);

      const title = cleanWorkflowTitle(raw.id);

      return {
        id: raw.id,
        title,
        description: `${raw.pattern} workflow on ${raw.parentNodeId}`,
        difficulty: 'beginner' as const,
        priority: 'P2' as const,
        startNodeId: firstEdge
          ? ('sourceNodeId' in firstEdge ? firstEdge.sourceNodeId : firstEdge.sourceStateId)
          : raw.parentNodeId,
        endNodeId: lastEdge
          ? ('targetNodeId' in lastEdge ? lastEdge.targetNodeId : lastEdge.targetStateId)
          : raw.parentNodeId,
        edgeIds: steps.map((s) => s.edgeId),
        steps,
        branchCondition: raw.branchCondition,
      };
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private buildEdgeMap(
    allEdges: GraphEdge[],
    stateEdges: StateTransitionEdge[]
  ): Map<string, GraphEdge | StateTransitionEdge> {
    const map = new Map<string, GraphEdge | StateTransitionEdge>();
    for (const e of allEdges) map.set(e.id, e);
    for (const e of stateEdges) map.set(e.id, e);
    return map;
  }

  private collectSourceSnippets(
    stateNodes: Record<string, StateNode>,
    sourceDir: string
  ): Record<string, string> {
    const snippets: Record<string, string> = {};
    const seen = new Set<string>();

    for (const sn of Object.values(stateNodes)) {
      if (seen.has(sn.sourceFile)) continue;
      seen.add(sn.sourceFile);

      // Find the file
      const candidates = this.findFile(sourceDir, sn.sourceFile);
      if (!candidates) continue;

      try {
        const lines = fs.readFileSync(candidates, 'utf-8').split('\n');
        // Find the useState line and grab ±25 lines around it
        const stateLineIdx = lines.findIndex(
          (l) => l.includes(sn.stateName) && l.includes('useState')
        );
        const start = Math.max(0, stateLineIdx - 5);
        const end = Math.min(lines.length, stateLineIdx + MAX_SNIPPET_LINES);
        snippets[sn.sourceFile] = lines.slice(start, end).join('\n');
      } catch {
        // skip unreadable files
      }
    }

    return snippets;
  }

  private findFile(sourceDir: string, basename: string): string | null {
    const walk = (dir: string): string | null => {
      if (!fs.existsSync(dir)) return null;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
          const found = walk(full);
          if (found) return found;
        } else if (entry.isFile() && entry.name === basename) {
          return full;
        }
      }
      return null;
    };
    return walk(sourceDir);
  }
}
