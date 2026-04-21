import { shortText } from "./utils.js";

export function plannerPrompt(input: {
  task: string;
  nodeId: string;
  depth: number;
  maxDepth: number;
  mode: "auto" | "solve" | "decompose";
  contextKind: "text" | "files" | "csv" | "json";
  contextChars: number;
  observationSummary: string;
  remainingNodeBudget: number;
  maxBranching: number;
  maxChunkChars: number;
  grepLimit: number;
  environmentSummary: string;
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
    `Context kind: ${input.contextKind}`,
    `Context characters available in environment: ${input.contextChars}`,
    `Remaining node budget: ${input.remainingNodeBudget}`,
    `Max branching: ${input.maxBranching}`,
    `Suggested max chunk chars: ${input.maxChunkChars}`,
    `Suggested grep result limit: ${input.grepLimit}`,
    "",
    "Environment capabilities:",
    `- summary: ${input.environmentSummary}`,
    "- peek(start,end): inspect a range from text or from the file manifest",
    "- grep(pattern,limit): inspect matching lines or file hits",
    "- sample_chunks(chunkSize): inspect lightweight chunk previews",
    "- map_chunks(chunkSize, subtaskPrompt): recursively solve over chunks of the context",
    "- decompose(subtasks): recursively ask different questions over the same current context",
    "- repl_eval(code): run JavaScript in a REPL with a context object and helpers; use this for codebases/files/json/csv or arbitrary structured inspection",
    "- Inside repl_eval you can use callRlm(task, subcontext) to launch recursive subcalls over derived subcontexts",
    "- r_eval(code): run R/webR code over text/csv context; use this for tabular and line-oriented text analysis",
    "- solve: solve directly over the current context subset",
    "- final: return final answer if confident",
    "",
    "Observation summary from previous inspections:",
    input.observationSummary || "(none yet)",
    "",
    "Return JSON with exactly this shape:",
    '{"action":"final|solve|decompose|peek|grep|sample_chunks|map_chunks|repl_eval|r_eval","reason":"...","answer":"... optional","subtasks":["..."],"start":0,"end":1000,"pattern":"...","chunkSize":20000,"subtaskPrompt":"...","code":"..."}',
    "",
    "Rules:",
    "- Use final only if you can answer now.",
    "- Use solve if the current context subset is sufficient and should be sent to a model call.",
    "- Use peek, grep, sample_chunks, repl_eval, or r_eval before solve when you still need evidence.",
    "- Use sample_chunks when you want compact previews before deciding how to recurse.",
    "- Use map_chunks when the task should be applied across the whole context in partitions.",
    "- Use decompose when the task naturally splits into distinct questions over the same context.",
    "- Use repl_eval when the context is a codebase/files tree or when you need arbitrary programmatic inspection over the context object.",
    "- Use repl_eval for json/csv when you want to work directly with parsed objects rather than raw text.",
    "- In repl_eval, write JavaScript that returns a value (for example `return listFiles().length`).",
    "- Use callRlm(task, subcontext) inside repl_eval when you need a recursive model call over a derived subset/object/chunk.",
    "- Use r_eval for tabular counting, line filtering, aggregation, or regex-style work that R can express cleanly over text or csv.",
    "- In r_eval, make the final expression evaluate to the value you want returned.",
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
