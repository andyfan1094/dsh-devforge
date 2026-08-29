# dsh-devforge

Spec-driven service forge for DeepSeek Harness (dual-face plugin).

- **Standards library**: versioned markdown standards under `standards/`, announced to agents via system prompt + `devforge_standards` tool.
- **One-click service forge**: `devforge_jobs` tool / panel spawns a constrained subagent (ctx.agents.create) with mounted standards; live status in the panel.
- **SSH-style panel**: sidebar entry + center-column panel (Standards / Jobs / New Service), loopback-fenced API.

## Install

```sh
dsh plugin --profile web add link:D:/项目/dsh-plugins/dsh-devforge
```

License: MIT.
