---
description: Exercise RLM over parquet context with repl_eval and R loader snippets
argument-hint: "[replace the placeholder parquet path in the prompt]"
---
Use the `rlm` tool with:

- `task`: `The context is parquet. Inspect the parsed rows with repl_eval. Also call rLoadCode(), include it under an rLoadCode field in the repl_eval result, and mention the generated R loading approach. $@`
- `contextKind`: `parquet`
- `contextPath`: `path/to/data.parquet`
- `mode`: `auto`

Then report the final answer, whether `repl_eval` was used, and summarize the suggested R loading code.
