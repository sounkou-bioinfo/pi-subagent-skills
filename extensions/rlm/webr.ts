import { TextEncoder, TextDecoder } from "node:util";
import type { WebR } from "webr";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function evalWithWebR(code: string, contextText: string, scopeId = "default"): Promise<string> {
  const webR = await createWebR();
  const contextPath = `/tmp/pi-rlm-context-${sanitizeScopeId(scopeId)}.txt`;
  await webR.FS.writeFile(contextPath, encoder.encode(contextText));
  const wrapped = [
    `context_path <- ${toRStringLiteral(contextPath)}`,
    'context_text <- paste(readLines(context_path, warn = FALSE, encoding = "UTF-8"), collapse = "\\n")',
    'context_lines <- function() strsplit(context_text, "\\n", fixed = TRUE)[[1]]',
    'context_grep <- function(pattern, limit = 20) {',
    '  hits <- grep(pattern, context_lines(), value = TRUE, ignore.case = TRUE, perl = TRUE)',
    '  utils::head(hits, limit)',
    '}',
    'context_chunks <- function(n = 40000) {',
    '  starts <- seq.int(1, nchar(context_text), by = n)',
    '  lapply(starts, function(s) substr(context_text, s, min(nchar(context_text), s + n - 1)))',
    '}',
    '.pi_rlm_user_value <- local({',
    code,
    '})',
    'if (length(.pi_rlm_user_value) == 0) "" else paste(as.character(.pi_rlm_user_value), collapse = "\\n")',
  ].join("\n");

  try {
    const result = await webR.evalRString(wrapped);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `webR error: ${message}`;
  } finally {
    try {
      await webR.FS.unlink(contextPath);
    } catch {
      // ignore cleanup failures
    }
    try {
      webR.close();
    } catch {
      // ignore shutdown failures
    }
  }
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
