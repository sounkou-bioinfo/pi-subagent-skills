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

### Extension

- `subagent` — delegate a task to one or more specialized agents with isolated context windows

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

## Notes

- Packaged agents are available out of the box.
- User agents from `~/.pi/agent/agents` can also be used.
- Project agents from `.pi/agents` require explicit opt-in and confirmation.
