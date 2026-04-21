# pi-subagent-skills

A Pi package that bundles:

- a `subagent` extension for delegating work to isolated Pi subprocesses
- packaged default agents (`scout`, `planner`, `worker`, `reviewer`)
- prompt templates for common multi-agent flows
- skills that teach the main agent when and how to use subagents

## Upstream credit

This package is not presented as wholly original.

Primary upstream reference:

- [`badlogic/pi-mono` subagent example](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/subagent) — direct structural and behavioral inspiration for the bundled `subagent` extension pattern

## Install

From GitHub:

```bash
pi install git:github.com/sounkou-bioinfo/pi-subagent-skills
```

Pin a ref if desired:

```bash
pi install git:github.com/sounkou-bioinfo/pi-subagent-skills@main
```

From a local checkout:

```bash
git clone https://github.com/sounkou-bioinfo/pi-subagent-skills.git
cd pi-subagent-skills
pi install .
```

## Included resources

### Extensions

- `subagent` — delegate a task to one or more specialized agents with isolated context windows
- `rlm` — recursive long-context orchestration with a Node-based REPL environment plus webR for text/tabular work

### Packaged agents

- `scout` — fast repo recon (`openai-codex/gpt-5.3-codex-spark` by default)
- `planner` — implementation planning only (`openai-codex/gpt-5.4` by default)
- `worker` — executes changes (`openai-codex/gpt-5.4` by default)
- `reviewer` — reviews and sanity-checks results (`openai-codex/gpt-5.4` by default)

### Skills

- `subagent-orchestration`
- `parallel-codebase-recon`
- `plan-implement-review`

### Prompt templates

- `/implement`
- `/scout-and-plan`
- `/parallel-recon`
- `/rlm-r-eval-demo`

## Usage examples

Single delegation:

```text
Use the subagent tool with the scout agent to locate authentication code.
```

Parallel delegation:

```text
Use the subagent tool to run two scouts in parallel: one for routing, one for database access.
```

Chain:

```text
Use the subagent tool in a chain: scout -> planner -> worker -> reviewer.
```

RLM over inline context:

```text
Use the rlm tool with task="How many lines mention apple?" and context="apple\nbanana\napple pie".
```

RLM can inspect text or file-tree context via structured actions such as:

- `peek`
- `grep`
- `sample_chunks`
- `map_chunks`
- `decompose`
- `repl_eval` (generic Node/JS REPL over the context object)
- `r_eval` (via webR for text context)
- `solve`
- `final`

For counting, aggregation, and line-oriented summarization, the planner may prefer `r_eval`.
For codebases or file-tree context (`contextKind="files"` with a directory `contextPath`), the planner may prefer `repl_eval` with helpers like `listFiles()`, `readFile()`, `peekFile()`, and `grepFiles()`.
Completed runs now also surface a top-level `strategy:` line such as `repl_eval -> final` or `r_eval -> final` so CLI/json output makes the execution path easier to verify.

## Notes

- Packaged agents are available out of the box.
- User agents from `~/.pi/agent/agents` can also be used.
- Project agents from `.pi/agents` require explicit opt-in and confirmation.
