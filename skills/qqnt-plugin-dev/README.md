# skills/qqnt-plugin-dev

A self-contained DSH skill for QQNT / LiteLoaderQQNT plugin development and debugging.

## Files

| File | Language | Purpose |
|---|---|---|
| `SKILL.md` | **English** | The skill DSH loads. **Self-contained**: the environment map, plugin anatomy, probes, IPC capture, boundary table, 13 measured pitfalls, the user-in-the-loop workflow and the mandatory disclaimer are all inline — no network fetch needed. |
| `SKILL_ZH.md` | 中文 | Same content in Chinese (reference only; DSH loads `SKILL.md`). |
| `README.md` | English | This file. |
| `plugins/dsh-debug-logger/` | — | The debug plugin, **bundled inside this skill**, so an installed skill is complete offline. |

`plugins/dsh-debug-logger/` here is a byte-identical copy of the repository's
[`../../plugins/dsh-debug-logger/`](../../plugins/dsh-debug-logger/) — keep both in sync if you edit the plugin.

## How to install

Copy the whole `qqnt-plugin-dev/` directory into the DSH skills directory:

```text
<DSH_HOME>/skills/qqnt-plugin-dev/SKILL.md
<DSH_HOME>/skills/qqnt-plugin-dev/SKILL_ZH.md
<DSH_HOME>/skills/qqnt-plugin-dev/plugins/dsh-debug-logger/{manifest.json,main.js}
```

- `<DSH_HOME>` is usually the DeepSeek Harness data directory (for example
  `…\DeepSeek_Harness_Portable\data\.dsh`); skills live in `skills/` underneath it.
- **Start a new session** after copying — the skill list is loaded per session.
- Verify: in a new session ask "how do I debug a QQNT plugin?" and the agent should reference `qqnt-plugin-dev`.

## Constraints for skill authors

- The frontmatter **`description` must stay within 500 characters**: `@deepseek-ai/dsh-tool-skill` ships
  `DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 500` upstream (a local patch may raise it to 900, but do not rely on
  that). This skill's description is 481 characters.
- `SKILL.md` keeps the exact filename DSH loads; the Chinese variant must be a different filename (`SKILL_ZH.md`).
- Keep the skill **self-contained**: do not make the agent fetch external URLs to obtain the facts it needs.

## Scope and portability

- Verified environment: QQ NT **9.9.33-52230** (x64) + LiteLoaderQQNT fork **5.2.1** + Electron 40 + Windows (2026-10).
  On other QQ versions the directory layout, the verification mechanism and DOM selectors may differ — re-probe
  first with the recipes inside `SKILL.md`.
- **Adapted and tested for DSH (DeepSeek Harness)**: tool names, the `ask_user_question` seam and the `eval.txt`
  workflow are DSH-specific. It has **not** been tested on other agent platforms; verify platform-specific parts in
  your own environment before relying on them.