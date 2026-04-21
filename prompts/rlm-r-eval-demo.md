---
description: Exercise the RLM tool with a counting-style task that should prefer r_eval
argument-hint: "[extra instructions]"
---
Use the `rlm` tool with:

- `task`: `How many lines mention apple? Use r_eval if helpful. $@`
- `context`:

```text
apple
banana
apple pie
pear
```

- `mode`: `auto`

Then report the final answer and mention whether `r_eval` was used.
