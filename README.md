# pi-subagent-skills

A Pi package that bundles:

- a `subagent` extension for delegating work to isolated Pi subprocesses
- packaged default agents (`scout`, `planner`, `worker`, `reviewer`)
- prompt templates for common multi-agent flows
- skills that teach the main agent when and how to use subagents

## Upstream credit

This package builds on ideas from upstream Pi ecosystem work and is intentionally not presented as wholly original.

Primary upstream references:

- [`manojlds/pi-rlm`](https://github.com/manojlds/pi-rlm) — inspiration for packaging a reusable Pi workflow/orchestration repository
- [`badlogic/pi-mono` subagent example](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/subagent) — direct structural and behavioral inspiration for the bundled `subagent` extension pattern

This repository adapts those ideas into a package-centered skill + subagent workflow for local use.

## Install

```bash
pi install /root/pi-subagent-skills
```

Or from a git remote once you publish it:

```bash
pi install git:github.com/you/pi-subagent-skills
```

## Included resources

### Extension

- `subagent` — delegate a task to one or more specialized agents with isolated context windows

### Packaged agents

- `scout` — fast repo recon
- `planner` — implementation planning only
- `worker` — executes changes
- `reviewer` — reviews and sanity-checks results

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
