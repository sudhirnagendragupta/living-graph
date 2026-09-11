# Living Graph

### Living Learning Assets from Code: The Self-Healing Triad of Autonomous Agent Trajectories, Deterministic E2E Tests, and Studio Video Tutorials

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6.svg)](https://www.typescriptlang.org)
[![Playwright](https://img.shields.io/badge/Playwright-Automation-2EAD33.svg)](https://playwright.dev)
[![Claude](https://img.shields.io/badge/Claude-Sonnet%205%20%7C%20Computer%20Use-D97757.svg)](https://www.anthropic.com)
[![Gemini](https://img.shields.io/badge/Gemini-2.5%20Flash%20%7C%203.1%20TTS-4285F4.svg)](https://ai.google.dev)
[![NVIDIA](https://img.shields.io/badge/NVIDIA-Nemotron%20Nano%202%20VL-76B900.svg)](https://build.nvidia.com)

**Author:** [Sudhir Gupta](https://guptasudhir.com) · [LinkedIn](https://www.linkedin.com/in/product-manager-sudhir-gupta/)

---

## The Enterprise Problem

Enterprise software ships fast. Training materials do not.

Every UI change — a button relocated, a wizard step added, a navigation restructured — silently invalidates a layer of learning assets that took weeks to produce: onboarding guides, support documentation, compliance training, customer walkthroughs, internal knowledge bases. The people responsible for those assets — L&D teams, technical writers, product education specialists — have no systematic way to know what broke, what changed, and what can be left alone.

At the same time, QA and engineering teams spend up to 40% of their sprints manually rewriting broken Playwright/Cypress end-to-end test scripts after routine UI redesigns.

**Living Graph solves this at the architectural level**, with two complementary engines rather than one:

- For **known, recurring workflows**, it treats the codebase as ground truth, extracts a precise state machine graph from React/TypeScript source, and permanently couples a video tutorial + a deterministic Playwright test to the exact codebase state that produced them — self-healing both when the UI drifts.
- For **open-ended goals no static analysis could enumerate in advance** ("invite a new teammate"), it drives the browser live via Claude's native computer-use tool — no pre-computed script, deciding one action at a time from the actual screen.

```
Your codebase  ──►  AST Graph Extraction  ──►  Scripted Walker + VLM  ──►  The Triad:
(React / TS)        (@living-graph/extractor)   (@living-graph/walker)       1. Studio Video (.mp4)
                          │                           │                     2. Playwright Test (.spec.ts)
                          ▼                           ▼                     3. Cloud Diff (New/Changed)
                    Topological Diff          Self-Healing Engine
                 (New / Changed / Stable)   (Claude Sonnet 5 / Nemotron)

Plain-English goal  ─────────►  Claude computer-use tool  ─────────►  Live browser actions
("invite a teammate")           (@living-graph/walker,                (click/type/scroll by
                                  ComputerUseWalker)                    pixel coordinate)
```

---

## What the System Does

### 1. Static AST Graph Extraction (`@living-graph/extractor`)
Point the CLI at any React/TypeScript codebase. The extractor:
- Scans your source files using the TypeScript Compiler API (`ts-morph`) — **no source code leaves your machine**.
- Prioritizes human-authored visible JSX text and `aria-label` attributes over developer `data-testid` selectors, sanitizing dynamic template interpolations (`${...}`).
- Discovers every URL route, intra-page state (modals, tabs, wizards, bulk selection, filters), and user-triggered transition.
- Classifies each state into a semantic pattern: `modal`, `tab`, `wizard_step`, `bulk_select`, `filter`, `toggle`.
- Builds a directed graph: nodes are screens and states, edges are user actions.
- Sends the **graph structure only** (not source code) to **Gemini 2.5 Flash** or **NVIDIA NIM** to enrich each workflow with human-readable titles, step narrations, and difficulty ratings.

### 2. Scripted Walking & Self-Healing (`@living-graph/walker` & `@living-graph/verifier`)
For workflows the extractor already found, the CLI drives a headless Playwright browser through the discovered trajectory:
- **Dual-Keyframe Alignment**: Captures the **pre-action keyframe** (`step_${i+1}_${edge.id}.png`) prior to action execution so human tutorial viewers see the target element *before* it is clicked or filled. Captures the **post-action keyframe** (`step_${i+1}_result_${edge.id}.png`) immediately after execution.
- Verifies visual invariants on the post-action screen with **Claude Sonnet 5** (preferred) or **NVIDIA Nemotron Nano 2 VL** (`nvidia/nemotron-nano-12b-v2-vl`).
- If a UI redesign broke selectors (e.g. Deskly v1 $\to$ v2), the VLM visually relocates the missing elements and heals the execution path.
- Generates a clean, deterministic TypeScript Playwright test spec (`.spec.ts`) ready for CI.

### 3. Agentic Goal-Driven Walking (`@living-graph/walker`, `ComputerUseWalker`) — NEW
For goals that don't map to a pre-extracted workflow — "invite a new teammate named Jane Doe with email jane@example.com" — there is no static analysis step at all:
- The CLI's `agentic-walk` command hands Claude a goal and a live screenshot, using Claude's own native **computer-use tool** (`computer_toolset_20260801`).
- Claude issues real UI actions — `left_click`, `type`, `key`, `scroll`, `left_click_drag` — by pixel coordinate, in a real multi-turn tool-use loop.
- Each action executes directly against a live Playwright page; a fresh screenshot goes back to Claude after every turn so it can see the result before deciding the next step.
- The walker stops itself once Claude believes the goal is achieved (or reports it can't proceed), with a full before/after screenshot trail written to disk.
- This mode is **Claude-only** — it replaced an earlier custom scheme (a numbered list of DOM elements the model picked from by index) with the model's own trained interaction mode, gaining scrolling, dragging, and keyboard shortcuts the old scheme never supported. It does not (yet) freeze a run into a deterministic `.spec.ts` — that's the scripted walker's job, above.

### 4. Studio Video Walkthroughs (`@living-graph/renderer`)
Synthesizes professional narrated video tutorials using:
- Intent-driven semantic narration templates (`formatSemanticNarration`) and clean action titles (`formatStepTitle`) that strip code noise and developer IDs.
- **Google Cloud Gemini 3.1 Flash TTS** (`gemini-3.1-flash-tts-preview`) or **ElevenLabs API** for natural human voiceover narration.
- Native macOS `say` or calibrated synthetic audio fallback for zero-cost offline runs.
- High-performance FFmpeg video compositing with step titles and audio alignment.

### 5. Topic Bundling & Incremental Cloud Accumulation
Packages generated graphs, metadata, and pre-action screenshots into a ready-to-upload ZIP bundle:
```
<topic-slug>_<timestamp>.zip
├── graph.json           # full state machine graph
├── manifest.json        # topic metadata
├── selected_topics.json # workflow coverage
└── screenshots/         # high-res pre-action keyframe captures
    ├── step_01_<edgeId>.png
    └── ...
```
Upload bundles to **Living Graph Cloud** (or push via `npx living-graph record --push`) to track topic evolution across versions (`New`, `Changed`, `Stable`, `Removed`). Each uploaded bundle **accumulates into your project library**, allowing teams to independently record and maintain different topics over time without overwriting existing assets.

---

## API Keys

Living Graph works immediately out of the box, but a VLM key is required for walking:

- **`ANTHROPIC_API_KEY` — Required for walking, self-healing, and agentic goals.** Preferred VLM backend (Claude Sonnet), and the *only* backend for `agentic-walk` (Claude's native computer-use tool has no NVIDIA equivalent). `createVerifierClient()` uses `AnthropicClient` when this is set; falls back to `NVIDIA_API_KEY` (NVIDIA NIM) otherwise for the scripted triad only, and throws if neither is present. Set `ANTHROPIC_MODEL` in `.env` to pin a specific Claude Sonnet release (defaults to `claude-sonnet-5`).
- **`GEMINI_API_KEY` — Optional.** Enables Gemini 2.5 Flash for LLM topic synthesis and Gemini 3.1 Flash TTS for narrated video production. Without it, topic discovery falls back to graph-derived stubs built from the extracted workflow graph (works for any codebase), and voiceover falls back to macOS `say` or synthetic silence on Linux/CI.

---

## Quickstart

### Prerequisites
- Node.js 20+
- FFmpeg (for video rendering)

### 1. Clone & Build

```bash
git clone https://github.com/sudhirnagendragupta/living-graph.git
cd living-graph
npm install
npm run build
```

### 2. Run against Demo App (Deskly)

```bash
# Terminal 1: Start the reference SaaS demo app
npm run dev:deskly

# Terminal 2: Extract the state machine graph from source
npm run cli -- extract --src=apps/deskly/src

# Terminal 2: Record and walk workflows (creates bundle.zip)
npm run cli -- record --url http://localhost:5173
```

### 3. Run against Your Own Codebase

```bash
# Point the extractor at your React app's source directory
npx living-graph extract --src=/path/to/your/app/src -o graph.json

# Walk and generate learning asset bundles against your running app
npx living-graph record --url http://localhost:3000 --src=/path/to/your/app/src
```

### 4. Drive an open-ended goal directly (no extraction step)

```bash
# Requires ANTHROPIC_API_KEY — Claude's computer-use tool drives the browser live
npx living-graph agentic-walk \
  --goal "Invite a new teammate named Jane Doe with email jane@example.com" \
  --url http://localhost:5173 \
  --start-path /dashboard
```

---

## Repository Layout

```
living-graph/
├── apps/
│   └── deskly/          # Reference SaaS demo app (React 18 + Vite + Tailwind)
├── packages/
│   ├── cli/             # Developer CLI: extract, diff, record, dispatch, agentic-walk
│   ├── extractor/       # TypeScript Compiler API AST scanner & state machine builder
│   ├── walker/          # Scripted AutonomousWalker (triad) + ComputerUseWalker (agentic)
│   ├── verifier/        # VLM client for the triad: Claude Sonnet 5 / Nemotron (verifyStep, relocateAction)
│   └── renderer/        # Gemini 3.1 TTS, ElevenLabs voiceover & FFmpeg compositor
├── LICENSE              # Apache License 2.0
└── package.json         # Monorepo workspaces manifest
```

---

## Design Principles

1. **Source code is the ground truth.** The extractor inspects source code locally to discover routes and state machines. No proprietary source code leaves your machine.
2. **Deterministic CI Tests + Broadcast Human Videos, for the workflows you know about.** The scripted triad produces both machine-executable Playwright specs and human-facing video tutorials for every extracted workflow.
3. **Native agentic execution for the goals you don't.** Rather than building a custom scheme to compensate for a model's limitations, `agentic-walk` uses Claude's own trained computer-use tool directly — the model acts on the real screen the way it was trained to, no DOM-grounding workaround in between.
4. **Self-Healing on UI Drift.** When redesigns break UI selectors, vision models visually relocate elements and re-establish passing test specs and videos.
5. **Clean-Slate Open Ecosystem.** Full CLI, extractor, autonomous walker, verifier, and renderer packages are open-source.

---

## License

Living Graph is licensed under the [Apache License 2.0](LICENSE).
