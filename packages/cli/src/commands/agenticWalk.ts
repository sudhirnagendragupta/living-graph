import { ComputerUseWalker } from '@living-graph/walker';

export interface AgenticWalkOptions {
  url?: string;
  goal: string;
  startPath?: string;
  maxSteps?: string;
}

export async function agenticWalkCommand(options: AgenticWalkOptions): Promise<void> {
  const targetUrl = (options.url || 'http://localhost:5173').replace(/\/$/, '');
  const maxTurns = options.maxSteps ? parseInt(options.maxSteps, 10) : 12;

  console.log('\n======================================================');
  console.log('   LIVING GRAPH CLI: AGENTIC WALKER (COMPUTER-USE)');
  console.log('======================================================\n');
  console.log(`Target URL:  ${targetUrl}`);
  console.log(`Goal:        ${options.goal}`);
  console.log(`Turn budget: ${maxTurns}`);

  const walker = new ComputerUseWalker(targetUrl);

  const result = await walker.walkGoal(options.goal, {
    startPath: options.startPath,
    maxTurns,
  });

  console.log('Summary:');
  console.log(` • Success:      ${result.success}`);
  console.log(` • Stop reason:  ${result.stopReason}`);
  console.log(` • Actions run:  ${result.totalActions}`);
  console.log(` • Final message: ${result.finalMessage || '(none)'}`);
  console.log('');
  result.traces.forEach((t) => {
    console.log(` [${t.turnIndex}] ${t.toolName}(${JSON.stringify(t.input)})${t.isError ? ` — ERROR: ${t.note}` : ''}`);
    console.log(`     screenshot: ${t.screenshotPath}`);
  });

  if (!result.success) {
    process.exit(1);
  }
}
