# skills/ — the QQNT plugin skill family

Four small, **self-contained** DSH skills. They are split (ponytail-style: core + focused companions) so each one
fits the description budget and only loads when the task matches:

| Skill directory | Loads when the task is about |
|---|---|
| `qqnt-plugin-dev/` | writing / changing a plugin: manifest v4, the three worlds, hooks/APIs, recipes, delivery |
| `qqnt-plugin-debug/` | making it work on a live client: bundled logger, `eval.txt` REPL, probes, IPC capture, real mouse, 13 pitfalls, ask-the-user loop |
| `qqnt-loader-install/` | installing / repairing the loader, QQ's file verification, the `QQNT.dll` signature patch (verify → derive → update) |
| `qqnt-capability-limits/` | deciding whether a feature is reachable from a plugin at all (native vs JS boundary, native-settings-first) |

Each directory has `SKILL.md` (English, loaded by DSH) and `SKILL_ZH.md` (Chinese, reference only).

**Codex users: see [`for_codex/`](for_codex/README.md)** — the same four modules repackaged for the Codex
desktop app (`~/.codex/skills/`): the Chinese body becomes the loadable `SKILL.md`, the English body is kept
as `SKILL_EN.md`, and the Codex-rejected angle brackets plus DSH-specific tool wording are fixed. DSH scans
this root at depth 1, so the nested `for_codex/` directory is never picked up as a duplicate skill — both
families coexist in one checkout.

## Install

```text
<DSH_HOME>/skills/qqnt-plugin-dev/SKILL.md
<DSH_HOME>/skills/qqnt-plugin-debug/SKILL.md
<DSH_HOME>/skills/qqnt-loader-install/SKILL.md
<DSH_HOME>/skills/qqnt-capability-limits/SKILL.md
<DSH_HOME>/skills/qqnt-plugin-debug/plugins/dsh-debug-logger/{manifest.json,main.js}
```

- Copy **all four directories**; they cross-reference each other by skill name (never by path).
- **Start a new session** afterwards — the catalog is built per session.
- Verify: the session skill list should show all four, and asking "how do I debug a QQNT plugin?" should load
  `qqnt-plugin-debug`.

The debug module also **bundles the debug plugin** at `qqnt-plugin-debug/plugins/dsh-debug-logger/` — a byte-identical
copy of [`../plugins/dsh-debug-logger/`](../plugins/dsh-debug-logger/). Keep both in sync if you edit the plugin; the
skill installs standalone without fetching anything.

## Authoring constraints (verified against the DSH source, 2026-10)

- **A skill directory is discovered only through `SKILL.md`** (`@deepseek-ai/dsh-skill-filesystem/lib/index.js:553`),
  so a sibling `SKILL_ZH.md` is inert. **But** at the *skills root* any `*.md` file is discovered (`:559`) — never
  drop a stray markdown file there.
- **Only `description` reaches the catalog** (`@deepseek-ai/dsh-tool-skill/lib/index.js:768-771`, formatted at
  `:1020`). `whenToUse` is parsed but never surfaced; `argument-hint` is not parsed for skills at all (it exists for
  *commands* only: `CommandSpec.argumentHint`). Keep the frontmatter to `name`, `description` (+ `license` for
  provenance) and put every trigger phrase inside `description`.
- **`description` budget: stay ≤ 500 characters.** Upstream is
  `DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 500`; a local patch may raise it to 900, but nothing here relies on that
  (current sizes: dev 493, debug 483, loader-install 471, capability-limits 489).
- **Self-contained**: no network fetch, no dependency on another skill being installed. Relative paths mentioned in a
  skill resolve against the base directory DSH reports in that skill's `<skill_resources>` block.
- Keep each module focused; if a module outgrows one topic, split it again rather than growing the description.
- **Disclaimer source of truth**: the full human-readable legal notice lives in [../README.md](../README.md) under 免责声明. Each module inlines a compact version (§0) so it stays self-contained; if the notice changes, update the root README first, then mirror it into the modules.
