import { shortText } from "./utils.js";

export function plannerPrompt(input: {
  task: string;
  nodeId: string;
  depth: number;
  maxDepth: number;
  mode: "auto" | "solve" | "decompose";
  contextChars: number;
  observationSummary: string;
  remainingNodeBudget: number;
  maxBranching: number;
  maxChunkChars: number;
  grepLimit: number;
}): string {
  return [
    "You are the controller for a recursive language model (RLM).",
    "The long context is stored outside your prompt. You never see all of it unless you intentionally inspect subsets.",
    "Choose exactly one next action in JSON only.",
    "",
    `Node: ${input.nodeId}`,
    `Depth: ${input.depth}/${input.maxDepth}`,
    `Mode: ${input.mode}`,
    `Task: ${input.task}`,
    `Context characters available in environment: ${input.contextChars}`,
    `Remaining node budget: ${input.remainingNodeBudget}`,
    `Max branching: ${input.maxBranching}`,
    `Suggested max chunk chars: ${input.maxChunkChars}`,
    `Suggested grep result limit: ${input.grepLimit}`,
    "",
    "Environment capabilities (Node + webR-ready environment):",
    "- peek(start,end): inspect a substring range",
    "- grep(pattern,limit): inspect matching lines",
    "- sample_chunks(chunkSize): inspect lightweight chunk previews",
    "- map_chunks(chunkSize, subtaskPrompt): recursively solve over chunks of the context",
    "- decompose(subtasks): recursively ask different questions over the same current context",
    "- r_eval(code): run R/webR code over context_text, context_lines(), context_grep(), context_chunks()",
    "- solve: solve directly over the current context subset",
    "- final: return final answer if confident",
    "",
    "Observation summary from previous inspections:",
    input.observationSummary || "(none yet)",
    "",
    "Return JSON with exactly this shape:",
    '{"action":"final|solve|decompose|peek|grep|sample_chunks|map_chunks|r_eval","reason":"...","answer":"... optional","subtasks":["..."],"start":0,"end":1000,"pattern":"...","chunkSize":20000,"subtaskPrompt":"...","code":"..."}',
    "",
    "Rules:",
    "- Use final only if you can answer now.",
    "- Use solve if the current context subset is sufficient and should be sent to a model call.",
    "- Use peek, grep, sample_chunks, or r_eval before solve when you still need evidence.",
    "- Use sample_chunks when you want compact previews before deciding how to recurse.",
    "- Use map_chunks when the task should be applied across the whole context in partitions.",
    "- Use decompose when the task naturally splits into distinct questions over the same context.",
    "- Use r_eval for tabular counting, line filtering, aggregation, or regex-style work that R can express cleanly.",
    "- Do not emit markdown fences.",
    "- JSON only.",
  ].join("\n");
}

export function solverPrompt(input: {
  task: string;
  context: string;
  observations: string;
}): string {
  return [
    "Answer the task using the provided context subset.",
    "Be concise but complete. If evidence is insufficient, say so plainly.",
    "",
    `Task: ${input.task}`,
    "",
    "Prior observations:",
    input.observations || "(none)",
    "",
    "Context subset:",
    input.context,
  ].join("\n");
}

export function synthesisPrompt(input: {
  task: string;
  childResults: string[];
}): string {
  const joined = input.childResults.map((r, i) => `Child ${i + 1}:\n${shortText(r, 12000)}`).join("\n\n");
  return [
    "Synthesize recursive child results into one final answer for the original task.",
    `Task: ${input.task}`,
    "",
    "Child results:",
    joined || "(none)",
    "",
    "Return only the synthesized answer.",
  ].join("\n");
}
