# skills/qqnt-plugin-dev

A DSH skill that fixes the QQNT / LiteLoaderQQNT plugin development and debugging workflow so an agent loads it
automatically when a related task appears.

## Files

| File | Language | Purpose |
|---|---|---|
| `SKILL.md` | **English** | The skill DSH loads (frontmatter + workflow). Includes the **mandatory disclaimer** the agent must relay to the user, and the user-in-the-loop ("ask the user") testing rules. |
| `SKILL_zh.md` | 中文 | Same content in Chinese (kept for reference; DSH ignores it). |
| `README.md` | English | This file. |

## How to install

Copy the whole `qqnt-plugin-dev/` directory into the DSH skills directory:

```text
<DSH_HOME>/skills/qqnt-plugin-dev/SKILL.md
```

- `<DSH_HOME>` is usually the DeepSeek Harness data directory (for example
  `…\DeepSeek_Harness_Portable\data\.dsh`); skills live in `skills/` underneath it.
- **Start a new session** after copying — the skill list is loaded per session.
- Verify: in a new session, ask "how do I debug a QQNT plugin?" and the agent should reference `qqnt-plugin-dev`.

## Reference material it points to

All of these live in this repository (clone it and read them by relative path):

| File | Purpose |
|---|---|
| [`../../agent_readme.md`](../../agent_readme.md) | Agent quick start, hard rules, measured boundary table (English) |
| [`../../agent_readme_zh.md`](../../agent_readme_zh.md) | Same, Chinese |
| [`../../docs/plugin-development.md`](../../docs/plugin-development.md) | Full plugin development guide (Chinese) |
| [`../../docs/debugging.md`](../../docs/debugging.md) | Black-box debugging methodology and case studies (Chinese) |
| [`../../docs/qqnt-internals.md`](../../docs/qqnt-internals.md) | Measured QQ 9.9.33 internals (Chinese) |
| [`../../plugins/dsh-debug-logger/`](../../plugins/dsh-debug-logger/) | The debug plugin (installable; see its `README.md`) |

If the skill is copied standalone, fetch the same files from
`https://github.com/shierpuzi/qqnt-plugin-dev-kit` or take them along.

## Scope and portability

- Verified environment: QQ NT **9.9.33-52230** (x64) + LiteLoaderQQNT fork **5.2.1** + Electron 40 + Windows (2026-10).
  On other QQ versions the directory layout, the verification mechanism and DOM selectors may all differ — re-probe
  first (`docs/debugging.md`).
- **Adapted and tested for DSH (DeepSeek Harness)**: tool names, the `ask_user_question` seam, and the `eval.txt`
  debugging workflow are DSH-specific. It has **not** been tested on other agent platforms; verify the platform-specific
  parts in your own environment before relying on them.
