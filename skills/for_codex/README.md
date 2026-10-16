# skills/for_codex/ — the QQNT plugin skill family, adapted for Codex

Same four modules as the DSH family one level up, repackaged for the **Codex** desktop app
(`~/.codex/skills/<name>/`). Content, evidence and the mandatory disclaimer are unchanged —
only the packaging and the agent-facing tool mapping are adapted.

| Skill directory | Loads when the task is about |
|---|---|
| `qqnt-plugin-dev/` | writing / changing a plugin: manifest v4, the three worlds, hooks/APIs, recipes, delivery |
| `qqnt-plugin-debug/` | making it work on a live client: bundled logger, `eval.txt` REPL, probes, IPC capture, real mouse, 16 pitfalls, ask-the-user loop |
| `qqnt-loader-install/` | installing / repairing the loader, QQ's file verification, the `QQNT.dll` signature patch (verify → derive → update) |
| `qqnt-capability-limits/` | deciding whether a feature is reachable from a plugin at all (native vs JS boundary, native-settings-first) |

## What differs from the DSH family

- **`SKILL.md` is the Chinese body.** Codex only loads `SKILL.md`, so the Chinese version
  (formerly `SKILL_ZH.md`) is promoted to the loadable file and the English body is kept
  alongside as `SKILL_EN.md`. Frontmatter `name` / `description` are identical in both.
- **No angle brackets in `description`.** Codex's validator rejects `<` / `>` in that field,
  so `qqnt-loader-install` describes the app root in plain words instead of `versions\<ver>\resources\app`.
  Codex's own description limit is **1024 characters** (not the DSH catalog limit of 500);
  the plain-word rewrite brings that one description to 507, which is fine here.
- **Base-directory wording.** `skill_resources` is a DSH concept; the wording now says Codex
  reports the skill's absolute directory at load time.
- **Ask-the-user section covers both.** `qqnt-plugin-debug` §7 documents
  `request_user_input` (Codex: 1–3 questions, 2–3 recommended-first options, free-form
  **Other** appended by the client, **single-select only — no multi-select**, blocking, and no
  observed expiry/non-blocking variant) and keeps the upstream DSH `ask_user_question` branch
  verbatim for readers still on that harness (that one does have `multi_select: true`,
  `mode: timed` + `timeout`). When the tool is not offered, the fallback is **one** plain-text question.

## Install (Codex)

```text
~/.codex/skills/qqnt-plugin-dev/SKILL.md
~/.codex/skills/qqnt-plugin-debug/SKILL.md
~/.codex/skills/qqnt-loader-install/SKILL.md
~/.codex/skills/qqnt-capability-limits/SKILL.md
~/.codex/skills/qqnt-plugin-debug/SKILL_EN.md            (optional English reference)
~/.codex/skills/qqnt-plugin-debug/plugins/dsh-debug-logger/{manifest.json,main.js}
```

- Copy **all four directories**; they cross-reference each other by skill name (never by path).
- Do **not** copy a stray `*.md` into the skills root itself.
- **Start a new session** afterwards — the catalog is built per session.
- Verify with the skill-creator validator:
  `python ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py <skill_dir>`
  (on Windows set `PYTHONUTF8=1` first, or the GBK codec will throw).

The debug module also **bundles the debug plugin** at
`qqnt-plugin-debug/plugins/dsh-debug-logger/` — a byte-identical copy of
[`../../plugins/dsh-debug-logger/`](../../plugins/dsh-debug-logger/). Keep copies in sync when you edit the plugin.

## Relationship to the sibling DSH skills

`skills/qqnt-*/` stays as-is for DSH users (it keeps `SKILL.md` = English and `SKILL_ZH.md` = reference).
`skills/for_codex/` is the Codex variant. DSH scans the skills root at **depth 1**, so this nested
directory is never picked up as a duplicate skill — the two families coexist in one checkout.

The full disclaimer lives in [`../../README.md`](../../README.md); each module inlines a compact version in §0.