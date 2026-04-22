import { dirname, join } from "node:path";
import { TextEncoder, TextDecoder } from "node:util";
import type { WebR } from "webr";
import { rLoadCodeForContext, type ReplContext } from "./repl.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const defaultWebRRepo = "https://repo.r-wasm.org/";
const rlmSignalPrefix = "__PI_RLM_SIGNAL__";

export interface WebRCallResult {
  result?: string;
  error?: string;
  contextKind?: string;
  strategy?: string;
}

export interface EvalWithWebROptions {
  scopeId?: string;
  artifactDir?: string;
  callRlm?: (task: string, subcontext: unknown, contextKind?: string) => Promise<WebRCallResult>;
  maxRecursiveCalls?: number;
}

export async function evalWithWebR(
  code: string,
  context: Extract<ReplContext, { kind: "text" | "csv" | "parquet" }>,
  optionsOrScopeId: EvalWithWebROptions | string = "default",
  legacyArtifactDir?: string,
): Promise<string> {
  const options: EvalWithWebROptions =
    typeof optionsOrScopeId === "string"
      ? { scopeId: optionsOrScopeId, artifactDir: legacyArtifactDir }
      : optionsOrScopeId;
  const scopeId = options.scopeId ?? "default";
  const artifactDir = options.artifactDir;
  const callRlm = options.callRlm;
  const maxRecursiveCalls = Math.max(1, options.maxRecursiveCalls ?? 8);

  const webR = await createWebR();
  const tempPaths: string[] = [];

  try {
    const prepared = await prepareContext(webR, context, scopeId);
    tempPaths.push(...prepared.tempPaths);
    const webRArtifactDir = `/tmp/pi-rlm-artifacts-${sanitizeScopeId(scopeId)}`;
    if (artifactDir) await ensureWebRDir(webR, webRArtifactDir);

    const callResults: WebRCallResult[] = [];
    for (let step = 0; step <= maxRecursiveCalls; step++) {
      const wrapped = buildWrappedCode({
        code,
        context,
        prepared,
        artifactDir: artifactDir ? webRArtifactDir : "",
        callResults,
      });
      const rawResult = await webR.evalRString(wrapped);
      const signal = parseRlmSignal(rawResult);
      if (!signal) return await appendArtifactSummary(webR, webRArtifactDir, artifactDir, rawResult);
      if (signal.kind === "final") {
        return await appendArtifactSummary(webR, webRArtifactDir, artifactDir, formatSignalPayload(signal.payload));
      }
      if (signal.kind !== "call") {
        return `webR error: unsupported RLM signal kind ${signal.kind}`;
      }
      if (!callRlm) {
        return "webR error: rlm_call() is not available in this context";
      }
      if (step === maxRecursiveCalls) {
        return `webR error: rlm_call() exceeded maxRecursiveCalls=${maxRecursiveCalls}`;
      }
      const payload = isRecord(signal.payload) ? signal.payload : {};
      const task = typeof payload.task === "string" ? payload.task : "";
      if (!task) return "webR error: rlm_call() requested without a task";
      const child = await callRlm(task, payload.subcontext, typeof payload.context_kind === "string" ? payload.context_kind : undefined);
      callResults.push(child);
    }

    return `webR error: rlm_call() exceeded maxRecursiveCalls=${maxRecursiveCalls}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `webR error: ${message}`;
  } finally {
    for (const tempPath of tempPaths) {
      try {
        await webR.FS.unlink(tempPath);
      } catch {
        // ignore cleanup failures
      }
    }
    try {
      webR.close();
    } catch {
      // ignore shutdown failures
    }
  }
}

function buildWrappedCode(input: {
  code: string;
  context: Extract<ReplContext, { kind: "text" | "csv" | "parquet" }>;
  prepared: { setup: string[]; tempPaths: string[]; loadBody?: string };
  artifactDir: string;
  callResults: WebRCallResult[];
}): string {
  return [
    ...input.prepared.setup,
    `artifact_dir <- ${toRStringLiteral(input.artifactDir)}`,
    `options(repos = c(CRAN = ${toRStringLiteral(defaultWebRRepo)}))`,
    'install_webr_packages <- function(packages, repos = getOption("repos")[["CRAN"]]) {',
    '  packages <- as.character(packages)',
    '  if (!length(packages)) return(invisible(character()))',
    '  if (!requireNamespace("webr", quietly = TRUE)) stop("The webR support package is not available")',
    '  webr::install(packages, repos = repos)',
    '  invisible(packages)',
    '}',
    'save_plot <- function(filename, expr, device = c("png", "pdf", "svg"), width = 800, height = 600, pointsize = 12, bg = "white", ...) {',
    '  if (!nzchar(artifact_dir)) stop("artifact_dir is not configured")',
    '  device <- match.arg(device)',
    '  path <- file.path(artifact_dir, filename)',
    '  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)',
    '  if (device == "png") {',
    '    grDevices::png(path, width = width, height = height, pointsize = pointsize, bg = bg, ...)',
    '  } else if (device == "pdf") {',
    '    grDevices::pdf(path, width = width / 72, height = height / 72, pointsize = pointsize, bg = bg, ...)',
    '  } else if (device == "svg") {',
    '    grDevices::svg(path, width = width / 72, height = height / 72, pointsize = pointsize, bg = bg, ...)',
    '  }',
    '  on.exit(try(grDevices::dev.off(), silent = TRUE), add = TRUE)',
    '  eval(substitute(expr), envir = parent.frame())',
    '  filename',
    '}',
    'context_lines <- function() strsplit(context_text, "\\n", fixed = TRUE)[[1]]',
    'context_grep <- function(pattern, limit = 20) {',
    '  hits <- grep(pattern, context_lines(), value = TRUE, ignore.case = TRUE, perl = TRUE)',
    '  utils::head(hits, limit)',
    '}',
    'context_chunks <- function(n = 40000) {',
    '  if (!nzchar(context_text)) return(list())',
    '  starts <- seq.int(1, nchar(context_text), by = n)',
    '  lapply(starts, function(s) substr(context_text, s, min(nchar(context_text), s + n - 1)))',
    '}',
    `context_r_load_code <- function() ${toRStringLiteral(rLoadCodeForContext(input.context))}`,
    'context_load <- function() {',
    input.prepared.loadBody ?? rLoadCodeForContext(input.context),
    '}',
    `if (!requireNamespace("jsonlite", quietly = TRUE)) try(install_webr_packages("jsonlite"), silent = TRUE)`,
    'if (!requireNamespace("jsonlite", quietly = TRUE)) stop("jsonlite is required for rlm_call()/FINAL() support in webR")',
    `.pi_rlm_prefetched_json <- ${toRStringLiteral(JSON.stringify(input.callResults))}`,
    '.pi_rlm_prefetched <- jsonlite::fromJSON(.pi_rlm_prefetched_json, simplifyVector = FALSE)',
    'if (is.null(.pi_rlm_prefetched)) .pi_rlm_prefetched <- list()',
    '.pi_rlm_call_index <- 0L',
    '.pi_rlm_signal <- function(kind, payload) {',
    '  json <- jsonlite::toJSON(list(kind = kind, payload = payload), auto_unbox = TRUE, null = "null", dataframe = "rows", force = TRUE)',
    `  stop(paste0(${toRStringLiteral(rlmSignalPrefix)}, json), call. = FALSE)`,
    '}',
    'rlm_call <- function(task, subcontext = NULL, context_kind = NULL) {',
    '  .pi_rlm_call_index <<- .pi_rlm_call_index + 1L',
    '  idx <- .pi_rlm_call_index',
    '  if (length(.pi_rlm_prefetched) >= idx && !is.null(.pi_rlm_prefetched[[idx]])) return(.pi_rlm_prefetched[[idx]])',
    '  .pi_rlm_signal("call", list(task = as.character(task)[1], context_kind = if (is.null(context_kind)) NULL else as.character(context_kind)[1], subcontext = subcontext))',
    '}',
    'FINAL <- function(x) .pi_rlm_signal("final", x)',
    'FINAL_VAR <- function(name) {',
    '  key <- as.character(name)[1]',
    '  if (!nzchar(key)) stop("FINAL_VAR requires a variable name")',
    '  FINAL(get(key, envir = parent.frame()))',
    '}',
    '.pi_rlm_user_value <- tryCatch(local({',
    input.code,
    '}), error = function(e) {',
    '  msg <- conditionMessage(e)',
    `  if (startsWith(msg, ${toRStringLiteral(rlmSignalPrefix)})) return(msg)`,
    '  stop(e)',
    '})',
    'if (is.character(.pi_rlm_user_value) && length(.pi_rlm_user_value) == 1 && startsWith(.pi_rlm_user_value, ' + toRStringLiteral(rlmSignalPrefix) + ')) {',
    '  .pi_rlm_user_value',
    '} else if (length(.pi_rlm_user_value) == 0) {',
    '  ""',
    '} else {',
    '  paste(as.character(.pi_rlm_user_value), collapse = "\\n")',
    '}',
  ].join("\n");
}

async function appendArtifactSummary(webR: WebR, sourceRoot: string, artifactDir: string | undefined, result: string): Promise<string> {
  if (!artifactDir) return result;
  const newArtifacts = await exportWebRArtifacts(webR, sourceRoot, artifactDir);
  if (newArtifacts.length === 0) return result;
  return [result, "", `artifacts_created:\n${newArtifacts.map((file) => `- ${file}`).join("\n")}`].filter(Boolean).join("\n");
}

async function prepareContext(webR: WebR, context: Extract<ReplContext, { kind: "text" | "csv" | "parquet" }>, scopeId: string): Promise<{ setup: string[]; tempPaths: string[]; loadBody?: string }> {
  if (context.kind === "parquet") {
    const parquetPath = `/tmp/pi-rlm-context-${sanitizeScopeId(scopeId)}.parquet`;
    const bytes = await readBytes(context.path);
    await webR.FS.writeFile(parquetPath, bytes);
    return {
      tempPaths: [parquetPath],
      setup: [
        `context_path <- ${toRStringLiteral(parquetPath)}`,
        `context_text <- ${toRStringLiteral(context.rows.map((row) => JSON.stringify(row)).join("\n"))}`,
        `context <- list(kind = "parquet", path = context_path, columns = c(${context.columns.map((column) => toRStringLiteral(column)).join(", ")}))`,
      ],
      loadBody: parquetLoadBody(context.columns, context.rows),
    };
  }

  const contextPath = `/tmp/pi-rlm-context-${sanitizeScopeId(scopeId)}.txt`;
  const contextText = context.text;
  await webR.FS.writeFile(contextPath, encoder.encode(contextText));
  return {
    tempPaths: [contextPath],
    setup: [
      `context_path <- ${toRStringLiteral(contextPath)}`,
      'context_text <- paste(readLines(context_path, warn = FALSE, encoding = "UTF-8"), collapse = "\\n")',
      context.kind === "csv"
        ? `context <- list(kind = "csv", path = context_path, text = context_text, columns = c(${context.columns.map((column) => toRStringLiteral(column)).join(", ")}))`
        : 'context <- list(kind = "text", path = context_path, text = context_text)',
    ],
  };
}

function parquetLoadBody(columns: string[], rows: Array<Record<string, unknown>>): string {
  const inlineDataFrame = toRDataFrame(columns, rows);
  return [
    'if (requireNamespace("arrow", quietly = TRUE)) {',
    '  return(arrow::read_parquet(context$path))',
    '} else if (requireNamespace("duckdb", quietly = TRUE) && requireNamespace("DBI", quietly = TRUE)) {',
    '  con <- DBI::dbConnect(duckdb::duckdb(), dbdir = ":memory:")',
    '  on.exit(DBI::dbDisconnect(con, shutdown = TRUE), add = TRUE)',
    '  return(DBI::dbGetQuery(con, paste0("SELECT * FROM read_parquet(", shQuote(context$path), ")")))',
    '}',
    inlineDataFrame,
  ].join("\n");
}

function toRDataFrame(columns: string[], rows: Array<Record<string, unknown>>): string {
  const assignments = columns.map((column) => `${toRName(column)} = ${toRVectorLiteral(rows.map((row) => row[column]))}`);
  if (assignments.length === 0) return "data.frame()";
  return `data.frame(${assignments.join(", ")}, check.names = FALSE, stringsAsFactors = FALSE)`;
}

function toRName(name: string): string {
  return /^[A-Za-z.][A-Za-z0-9._]*$/.test(name) ? name : `\`${name.replace(/`/g, "\\`")}\``;
}

function toRVectorLiteral(values: unknown[]): string {
  return `c(${values.map(toRValueLiteral).join(", ")})`;
}

function toRValueLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NA";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NA_real_";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "bigint") return `${value}`;
  return toRStringLiteral(String(value));
}

async function readBytes(path: string): Promise<Uint8Array> {
  const fs = await import("node:fs/promises");
  return fs.readFile(path);
}

async function exportWebRArtifacts(webR: WebR, sourceRoot: string, destRoot: string): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const files = await listWebRFiles(webR, sourceRoot);
  const copied: string[] = [];
  for (const rel of files) {
    const sourcePath = `${sourceRoot}/${rel}`;
    const destPath = join(destRoot, rel);
    const bytes = await webR.FS.readFile(sourcePath);
    await fs.mkdir(dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, bytes);
    copied.push(rel);
  }
  return copied.sort();
}

async function listWebRFiles(webR: WebR, root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix = ""): Promise<void> {
    let node;
    try {
      node = await webR.FS.lookupPath(dir);
    } catch {
      return;
    }
    for (const entry of Object.values(node.contents ?? {})) {
      const full = `${dir}/${entry.name}`;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFolder) await walk(full, rel);
      else out.push(rel);
    }
  }
  await walk(root);
  return out;
}

async function ensureWebRDir(webR: WebR, path: string): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    try {
      await webR.FS.lookupPath(current);
    } catch {
      await webR.FS.mkdir(current);
    }
  }
}

function parseRlmSignal(result: string): { kind: string; payload: unknown } | null {
  if (!result.startsWith(rlmSignalPrefix)) return null;
  try {
    const parsed = JSON.parse(result.slice(rlmSignalPrefix.length));
    return isRecord(parsed) && typeof parsed.kind === "string" ? { kind: parsed.kind, payload: parsed.payload } : null;
  } catch {
    return null;
  }
}

function formatSignalPayload(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeScopeId(scopeId: string): string {
  return scopeId.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function toRStringLiteral(value: string): string {
  return JSON.stringify(value);
}

async function createWebR(): Promise<WebR> {
  const mod = await import("webr");
  const webR = new mod.WebR({ interactive: false });
  await webR.init();
  return webR;
}

export function decodeBytes(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}
