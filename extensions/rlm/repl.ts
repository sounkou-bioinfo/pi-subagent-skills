import { grepText, chunkText } from "./utils.js";

export type ReplContext =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "files";
      root: string;
      files: Array<{ path: string; text: string }>;
    };

export async function evalInRepl(code: string, context: ReplContext): Promise<string> {
  const AsyncFunction = Object.getPrototypeOf(async function () {
    // noop
  }).constructor as new (...args: string[]) => (...fnArgs: unknown[]) => Promise<unknown>;

  const helpers = createHelpers(context);
  const names = Object.keys(helpers);
  const values = Object.values(helpers);

  try {
    const fn = new AsyncFunction(...names, `"use strict";\n${code}`);
    const result = await fn(...values);
    return formatResult(result);
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    return `repl error: ${message}`;
  }
}

function createHelpers(context: ReplContext): Record<string, unknown> {
  if (context.kind === "text") {
    const lines = context.text.split(/\r?\n/);
    return {
      context: {
        kind: "text",
        chars: context.text.length,
        text: context.text,
        lines,
      },
      contextText: context.text,
      contextLines: () => [...lines],
      grepText: (pattern: string, limit = 20) => grepText(context.text, pattern, limit),
      chunkText: (size = 40000) => chunkText(context.text, size),
    };
  }

  return {
    context: {
      kind: "files",
      root: context.root,
      fileCount: context.files.length,
      totalChars: context.files.reduce((sum, file) => sum + file.text.length, 0),
      files: context.files.map((file) => ({ path: file.path, chars: file.text.length })),
    },
    listFiles: (pattern?: string) => filterFilePaths(context.files.map((file) => file.path), pattern),
    readFile: (path: string) => getFile(context.files, path)?.text ?? null,
    peekFile: (path: string, start = 0, end = 2000) => {
      const text = getFile(context.files, path)?.text ?? "";
      const s = Math.max(0, Math.min(start, text.length));
      const e = Math.max(s, Math.min(end, text.length));
      return text.slice(s, e);
    },
    grepFiles: (pattern: string, limit = 20) => grepFiles(context.files, pattern, limit),
    chunkFiles: (maxChars = 40000) => chunkFiles(context.files, maxChars),
  };
}

function formatResult(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getFile(files: Array<{ path: string; text: string }>, path: string) {
  return files.find((file) => file.path === path);
}

function filterFilePaths(paths: string[], pattern?: string): string[] {
  if (!pattern) return paths;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
  return paths.filter((path) => regex.test(path));
}

function grepFiles(files: Array<{ path: string; text: string }>, pattern: string, limit: number): string[] {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
  const matches: string[] = [];
  for (const file of files) {
    if (matches.length >= limit) break;
    if (regex.test(file.path)) matches.push(`${file.path}:<path>`);
    const lines = file.text.split(/\r?\n/);
    for (let i = 0; i < lines.length && matches.length < limit; i++) {
      if (regex.test(lines[i])) matches.push(`${file.path}:${i + 1}: ${lines[i]}`);
    }
  }
  return matches;
}

function chunkFiles(files: Array<{ path: string; text: string }>, maxChars: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;
  for (const file of files) {
    const cost = file.text.length + file.path.length + 32;
    if (current.length > 0 && currentChars + cost > maxChars) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(file.path);
    currentChars += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
