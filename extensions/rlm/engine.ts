import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeWithCli } from "./backends.js";
import { plannerPrompt, solverPrompt, synthesisPrompt } from "./prompts.js";
import type { RlmAction, RlmNode, RlmObservation, RlmRunResult, RunArtifacts, StartRunInput } from "./types.js";
import { chunkText, extractFirstJsonObject, grepText, normalizeTask, safeJsonParse, shortText } from "./utils.js";
import { evalWithWebR } from "./webr.js";

interface EngineInput extends StartRunInput {
  runId: string;
}

interface EngineState {
  nodeCounter: number;
  nodesVisited: number;
  maxDepthSeen: number;
}

class NodeEnvironment {
  constructor(readonly text: string, readonly maxChunkChars: number, readonly grepLimit: number) {}

  describe(): string {
    return `chars=${this.text.length}; capabilities=peek,grep,sample_chunks,map_chunks,decompose,r_eval,solve; webr_ready=true`;
  }

  peek(start: number, end: number): string {
    const s = Math.max(0, Math.min(start, this.text.length));
    const e = Math.max(s, Math.min(end, this.text.length));
    return this.text.slice(s, e);
  }

  grep(pattern: string): string[] {
    return grepText(this.text, pattern, this.grepLimit);
  }

  chunk(size?: number): string[] {
    return chunkText(this.text, Math.max(500, Math.min(size ?? this.maxChunkChars, this.maxChunkChars)));
  }

  sampleChunks(size?: number, sampleCount = 3): string[] {
    const chunks = this.chunk(size);
    if (chunks.length <= sampleCount) return chunks;
    const picks = [0, Math.floor(chunks.length / 2), chunks.length - 1]
      .slice(0, sampleCount)
      .map((index) => chunks[index]);
    return picks;
  }
}

type ProgressFn = (line: string) => void;

export async function runRlmEngine(input: EngineInput, signal?: AbortSignal, progress?: ProgressFn): Promise<RlmRunResult> {
  const startedAt = Date.now();
  const artifacts = await createArtifacts(input.runId);
  const log = createEventLogger(artifacts.eventsPath);
  const state: EngineState = { nodeCounter: 0, nodesVisited: 0, maxDepthSeen: 0 };
  const context = await resolveContext(input);

  log("run_start", { runId: input.runId, task: input.task, contextChars: context.length, input });
  progress?.(`RLM run ${input.runId} started; context=${context.length} chars`);

  try {
    const root = await runNode({ task: input.task, depth: 0, lineage: [], parentId: undefined, text: context });
    const finalOutput = root.result ?? "(no final output)";
    await fs.writeFile(artifacts.treePath, JSON.stringify(root, null, 2), "utf8");
    await fs.writeFile(artifacts.outputPath, finalOutput, "utf8");
    const durationMs = Date.now() - startedAt;
    const result: RlmRunResult = {
      runId: input.runId,
      backend: input.backend,
      final: finalOutput,
      root,
      artifacts,
      stats: { nodesVisited: state.nodesVisited, maxDepthSeen: state.maxDepthSeen, durationMs },
    };
    log("run_end", { runId: input.runId, durationMs, nodesVisited: state.nodesVisited, maxDepthSeen: state.maxDepthSeen });
    return result;
  } finally {
    await log.flush();
  }

  async function runNode(params: { task: string; depth: number; lineage: string[]; parentId?: string; text: string }): Promise<RlmNode> {
    const nodeId = `n${++state.nodeCounter}`;
    state.nodesVisited += 1;
    state.maxDepthSeen = Math.max(state.maxDepthSeen, params.depth);
    const env = new NodeEnvironment(params.text, input.maxChunkChars, input.grepLimit);
    const node: RlmNode = {
      id: nodeId,
      depth: params.depth,
      task: params.task,
      contextChars: params.text.length,
      status: "running",
      startedAt: Date.now(),
      observations: [],
      children: [],
    };
    log("node_start", { nodeId, parentId: params.parentId ?? null, depth: params.depth, task: params.task, env: env.describe() });
    progress?.(`[${nodeId}] depth=${params.depth} ${shortText(params.task, 80)}`);

    try {
      if (signal?.aborted) throw new Error("RLM run cancelled");
      const forcedSolveReason = getForcedSolveReason(params, input, state);
      if (forcedSolveReason) {
        node.decision = { action: "solve", reason: forcedSolveReason };
        node.result = await solveNode(node, params.text);
        node.status = "completed";
        node.finishedAt = Date.now();
        log("node_end", { nodeId, action: "solve", reason: forcedSolveReason, chars: node.result.length });
        return node;
      }

      for (let iteration = 1; iteration <= input.maxIterations; iteration++) {
        const action = await planNode(node, env, params.text, iteration);
        node.decision = { action: action.action, reason: action.reason };
        log("node_action", { nodeId, iteration, action });

        if (action.action === "final") {
          node.result = action.answer || "";
          node.status = "completed";
          node.finishedAt = Date.now();
          return node;
        }

        if (action.action === "solve") {
          node.result = await solveNode(node, params.text);
          node.status = "completed";
          node.finishedAt = Date.now();
          return node;
        }

        if (action.action === "peek") {
          const start = action.start ?? 0;
          const end = action.end ?? Math.min(params.text.length, start + 4000);
          const peeked = env.peek(start, end);
          addObservation(node, "peek", `peek(${start},${end}) =>\n${shortText(peeked, 6000)}`);
          continue;
        }

        if (action.action === "grep") {
          const pattern = action.pattern ?? "";
          const matches = env.grep(pattern);
          addObservation(node, "grep", `grep(${pattern}) =>\n${matches.join("\n") || "(no matches)"}`);
          continue;
        }

        if (action.action === "sample_chunks") {
          const chunks = env.sampleChunks(action.chunkSize);
          const preview = chunks
            .map((chunk, index) => `chunk_sample_${index + 1}:\n${shortText(chunk, 2000)}`)
            .join("\n\n");
          addObservation(node, "note", `sample_chunks(${action.chunkSize ?? input.maxChunkChars}) =>\n${preview || "(no chunks)"}`);
          continue;
        }

        if (action.action === "r_eval") {
          const code = action.code?.trim();
          if (!code) {
            addObservation(node, "note", "r_eval requested without code");
            continue;
          }
          const output = await evalWithWebR(code, params.text, `${input.runId}-${nodeId}`);
          addObservation(node, "note", `r_eval =>\n${shortText(output, 6000)}`);
          continue;
        }

        if (action.action === "decompose") {
          const subtasks = (action.subtasks ?? []).filter(Boolean).slice(0, input.maxBranching);
          if (subtasks.length >= 2) {
            const childResults = await mapConcurrent(subtasks, input.concurrency, (subtask) => runNode({
              task: subtask,
              depth: params.depth + 1,
              lineage: [...params.lineage, normalizeTask(params.task)],
              parentId: nodeId,
              text: params.text,
            }));
            node.children.push(...childResults);
            node.result = await synthesizeNode(node, childResults.map((c) => c.result || c.error || ""));
            node.status = "completed";
            node.finishedAt = Date.now();
            return node;
          }
          addObservation(node, "note", "decompose requested but returned fewer than two valid subtasks");
          continue;
        }

        if (action.action === "map_chunks") {
          const chunks = env.chunk(action.chunkSize).slice(0, input.maxBranching);
          if (chunks.length >= 2) {
            const childTask = action.subtaskPrompt || params.task;
            const childResults = await mapConcurrent(chunks, input.concurrency, (chunk, index) => runNode({
              task: `${childTask}\n\nChunk ${index + 1}/${chunks.length}: focus only on this chunk and report relevant findings for the original task.`,
              depth: params.depth + 1,
              lineage: [...params.lineage, normalizeTask(params.task)],
              parentId: nodeId,
              text: chunk,
            }));
            node.children.push(...childResults);
            node.result = await synthesizeNode(node, childResults.map((c) => c.result || c.error || ""));
            node.status = "completed";
            node.finishedAt = Date.now();
            return node;
          }
          addObservation(node, "note", "map_chunks produced fewer than two chunks; continuing");
          continue;
        }
      }

      node.decision = { action: "solve", reason: "maxIterations reached" };
      node.result = await solveNode(node, params.text);
      node.status = "completed";
      node.finishedAt = Date.now();
      return node;
    } catch (error) {
      node.status = signal?.aborted ? "cancelled" : "failed";
      node.error = error instanceof Error ? error.message : String(error);
      node.finishedAt = Date.now();
      log("node_error", { nodeId, error: node.error });
      return node;
    }
  }

  async function planNode(node: RlmNode, env: NodeEnvironment, text: string, iteration: number): Promise<RlmAction> {
    const observationSummary = node.observations.map((o) => `- [${o.kind}] ${shortText(o.text, 1200)}`).join("\n");
    const prompt = plannerPrompt({
      task: node.task,
      nodeId: node.id,
      depth: node.depth,
      maxDepth: input.maxDepth,
      mode: input.mode,
      contextChars: text.length,
      observationSummary,
      remainingNodeBudget: Math.max(0, input.maxNodes - state.nodesVisited),
      maxBranching: input.maxBranching,
      maxChunkChars: input.maxChunkChars,
      grepLimit: input.grepLimit,
    });
    const result = await completeWithCli({
      model: input.model,
      systemPrompt: prompt,
      prompt: `Iteration ${iteration}. Return JSON only.`,
      cwd: input.cwd,
      piBin: input.piBin,
      signal,
    });
    if (result.exitCode !== 0) throw new Error(result.stderr || `planner exited with code ${result.exitCode}`);
    const jsonText = extractFirstJsonObject(result.text) ?? result.text.trim();
    const parsed = safeJsonParse<RlmAction>(jsonText);
    if (!parsed?.action || !parsed.reason) throw new Error(`Invalid planner JSON: ${result.text}`);
    return parsed;
  }

  async function solveNode(node: RlmNode, text: string): Promise<string> {
    const observations = node.observations.map((o) => `[${o.kind}] ${o.text}`).join("\n\n");
    const result = await completeWithCli({
      model: node.depth === 0 ? input.model : input.subModel,
      systemPrompt: "You are a recursive language model worker. Use only the provided context subset and observations.",
      prompt: solverPrompt({ task: node.task, context: text, observations }),
      cwd: input.cwd,
      piBin: input.piBin,
      signal,
    });
    if (result.exitCode !== 0) throw new Error(result.stderr || `solver exited with code ${result.exitCode}`);
    return result.text.trim();
  }

  async function synthesizeNode(node: RlmNode, childResults: string[]): Promise<string> {
    const result = await completeWithCli({
      model: input.model,
      systemPrompt: "You are synthesizing child RLM results into a final answer.",
      prompt: synthesisPrompt({ task: node.task, childResults }),
      cwd: input.cwd,
      piBin: input.piBin,
      signal,
    });
    if (result.exitCode !== 0) throw new Error(result.stderr || `synthesizer exited with code ${result.exitCode}`);
    return result.text.trim();
  }
}

function addObservation(node: RlmNode, kind: RlmObservation["kind"], text: string): void {
  node.observations.push({ kind, text });
  if (node.observations.length > 12) node.observations = node.observations.slice(-12);
}

function getForcedSolveReason(
  params: { task: string; depth: number; lineage: string[]; text: string },
  input: StartRunInput,
  state: EngineState,
): string | undefined {
  if (input.mode === "solve") return "mode=solve";
  if (params.depth >= input.maxDepth) return "maxDepth reached";
  if (state.nodesVisited >= input.maxNodes) return "maxNodes reached";
  if (params.lineage.includes(normalizeTask(params.task))) return "cycle detected";
  if (params.text.length <= Math.min(12000, input.maxChunkChars) && !shouldPreferREval(params.task)) {
    return "context subset already small";
  }
  return undefined;
}

function shouldPreferREval(task: string): boolean {
  return /\b(count|how many|sum|total|average|mean|median|min|max|frequency|frequencies|distribution|lines mention|rows mention|group by|tabulate)\b/i.test(task);
}

async function resolveContext(input: StartRunInput): Promise<string> {
  if (input.context !== undefined) return input.context;
  if (input.contextPath) return fs.readFile(input.contextPath, "utf8");
  return "";
}

async function createArtifacts(runId: string): Promise<RunArtifacts> {
  const dir = join(tmpdir(), "pi-rlm-runs", runId);
  await fs.mkdir(dir, { recursive: true });
  return {
    dir,
    eventsPath: join(dir, "events.jsonl"),
    treePath: join(dir, "tree.json"),
    outputPath: join(dir, "output.md"),
  };
}

function createEventLogger(eventsPath: string) {
  const writes: Promise<void>[] = [];
  const log = (type: string, details: Record<string, unknown>) => {
    const line = JSON.stringify({ ts: Date.now(), type, ...details }) + "\n";
    writes.push(fs.appendFile(eventsPath, line, "utf8"));
  };
  log.flush = async () => {
    await Promise.allSettled(writes);
  };
  return log as ((type: string, details: Record<string, unknown>) => void) & { flush: () => Promise<void> };
}

async function mapConcurrent<TIn, TOut>(items: TIn[], concurrency: number, fn: (item: TIn, index: number) => Promise<TOut>): Promise<TOut[]> {
  if (items.length === 0) return [];
  const results: TOut[] = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.max(1, Math.min(concurrency, items.length))).fill(null).map(async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
