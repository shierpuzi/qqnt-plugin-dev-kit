---
name: qqnt-plugin-dev
description: >
  Develop, debug, or repair LiteLoaderQQNT / QQNT plugins for the QQ NT desktop client on Windows
  (verified on QQ NT 9.9.33-52230 + LiteLoaderQQNT fork 5.2.1 + Electron 40). Covers plugin anatomy and
  manifest v4, main/preload/renderer injection and their execution worlds, LiteLoader APIs, the bundled
  dsh-debug-logger black-box toolkit (console/preload-error/uncaught-exception capture, window creation and
  show tracing, 5 MB log rotation, and an eval.txt "mini devtools" channel that runs JS in every window),
  DOM hit-testing probes, capturing IPC channels (including already-registered Electron handlers), real
  mouse-event injection, the QQ file-verification / QQNT.dll signature patch needed to install the loader,
  and a catalogue of measured pitfalls (renderer plugins are NOT injected into qqBrowser.html; the page's
  window.ipcRenderer is a frozen contextBridge object; duplicate slugs; stale eval payload replay causing QQ
  AppHangs; QQ's link opening and its "open in default browser" toolbar button are native shell behaviour a
  plugin cannot intercept). Also covers the user-in-the-loop testing workflow (use the ask/confirm tool
  frequently; on DSH that is ask_user_question). Use whenever a task mentions LiteLoaderQQNT, LLQQNT, QQNT
  plugin, 插件开发/调试, QQ 插件, 内置浏览器, lite-tools, NapCat, LLOneBot, qqBrowser, 背景插件, 防撤回插件,
  or asks to add / fix / debug a feature inside the QQ desktop client.
argument-hint: "[task: e.g. 'debug why plugin X is inert' | 'write a plugin that ...']"
license: MIT
---

# QQNT / LiteLoaderQQNT plugin development & debugging

This skill distils one real plugin-development and troubleshooting session. **Read §1 before touching anything** —
those three rules each save hours.

Reference repository (clone it locally and read the files by relative path):
`https://github.com/shierpuzi/qqnt-plugin-dev-kit`

| What you want | Read |
|---|---|
| Agent quick start, hard rules, measured boundary table | `agent_readme.md` (English) / `agent_readme_zh.md` (中文) |
| Write a plugin from scratch (manifest, injections, APIs, recipes) | `docs/plugin-development.md` |
| Black-box debugging methodology (logs, probes, IPC capture, real mouse, case studies) | `docs/debugging.md` |
| QQ 9.9.33 layout / verification / loader install / native-vs-JS boundary | `docs/qqnt-internals.md` |
| The debug plugin itself (installable) | `plugins/dsh-debug-logger/` (see its `README.md`) |
| Counter-example: why a plugin cannot stop the internal browser | `examples/open-in-browser/` |

> **Note (scope / portability)**: this skill is written and tested for **DSH (DeepSeek Harness)** agent behaviour —
> tool names, the `ask_user_question` seam, and the `eval.txt` debugging workflow. It has **not** been tested on other
> agent platforms. Treat every platform-specific instruction as "verify in your environment first, then adapt".

---

## 0. Mandatory disclaimer — send this to the user once, before you start

Send it once per session, at the start of the first QQNT-plugin task, translated into the user's language if needed:

> **Disclaimer.** This work (the plugin toolkit, patches and documentation) is provided for **education and research
> on software architecture and JavaScript injection techniques only**. By using it you accept the following:
> - **Do not violate software protection law**; do not reverse-engineer, modify or distribute modified Tencent QQ
>   builds. Do not build, provide or share programs intended to **intrude into or unlawfully control computer
>   information systems**.
> - **Do not infringe Tencent's rights**, including copyright and technical protection measures on the QQ client.
> - **No commercial use** and no activity that harms Tencent's lawful interests.
> - You must make sure your own use of the QQ client is **properly licensed** (including Tencent's terms of service).
> - Anything here that touches QQ's own files is documented **to explain the mechanism and to allow rollback**, not to
>   help bypass official authorisation.
> - The authors **accept no liability** for any misuse or consequence. **All risk is yours.**
>
> In mainland China the following can be criminal offences — avoid any behaviour that resembles them: ① providing
> programs or tools for intruding into or unlawfully controlling computer information systems (Criminal Law art. 285
> §3); ② copyright infringement, including circumventing technical protection measures (art. 217); ③ disrupting
> computer information systems (art. 286).

Also tell the user, in the same message, that **plugin work needs their cooperation**: most facts are only observable
on their running client, so expect several short test rounds (§5).

---

## 1. Three iron rules

1. **Check QQ's own native settings first.** Real example: to send links to the system browser, the answer was
   Settings → General/Other → **"Use system default browser to open web pages"** (control `.q-switch[role=switch]`).
   Four plugin iterations were written before anyone checked.
2. **Confirm the action even passes through the JS layer.** Measured: QQ's "open internal browser" *and* the internal
   browser toolbar's "open in default browser" icon are **native shell (`QQNT.dll`)** behaviour — wrapping 59 already
   registered `ipcMain` invoke handlers + 15 `on` channels produced **0 hits**, `shell.openExternal` was never called,
   and `loadURL` / `will-navigate` / `will-redirect` / `did-start-navigation` never fired. **A plugin cannot intercept
   native behaviour** — it can only observe it, or change what the JS layer owns.
3. **Back up before touching QQ's own files, and check the verification mechanism.** On 9.9.33, files under `<app>`
   are verified by **RSA signatures** in `<app>\application.json`; editing `<app>\package.json` alone makes QQ show
   "file is corrupted" and exit. The workable route is the signature patch on
   `<QQNT>\versions\<ver>\QQNT.dll` at offset **0x510197**
   (`48 89 CE 48 8B 11 4C 8B 41 08 49 29 D0 48 8B 49 18 E8` → same prefix + `B8 01 00 00 00`).

---

## 2. Standard workflow

```text
① Survey the installation
   - QQ version/arch: directory names under <QQNT>\versions\ ;  <app> = <QQNT>\versions\<ver>\resources\app
   - Loader: <app>\package.json "main" points at which stub; the stub's require(<absolute loader path>)
   - Plugin dir: <profile>/plugins/   (<profile> = env LITELOADERQQNT_PROFILE, else the loader root)
   - Duplicate slugs? Anything already disabled in <profile>/data/LiteLoader/config.json (disabled_plugins)?

② Install the debug plugin (from this repo)
   - copy plugins/dsh-debug-logger/ → <profile>/plugins/dsh-debug-logger/ → restart QQ
   - verify: first line of <profile>/data/dsh-debug-logger/console.log is "loaded v…",
     or the QQ settings list shows "DSH 调试日志"

③ Observe first, edit second
   - errors.log for real faults (remember: "Cannot bind an API on top of an existing property" in auxiliary
     windows is shared preload noise, not your bug)
   - to probe a page: write JS into <profile>/data/dsh-debug-logger/eval.txt
     → executed in every window → results in eval-result.log
   - probe recipes: §3

④ Write / fix the plugin
   - skeleton and recipes: docs/plugin-development.md
   - before changing another plugin's selectors, prove the target DOM matches with probes (§3)

⑤ Verify with the user
   - restart QQ → check errors.log for NEW errors you introduced → have the user exercise the feature
   - run the pre-delivery checklist in agent_readme.md §8
```

Timing notes: plugin files (main/preload/renderer) are all read at startup — **restart QQ after editing**. After a QQ
update the app directory moves to a new version directory, so both the loader stub and the signature patch must be redone.

---

## 3. Probe cheat sheet (write into `eval.txt`)

```js
// who is stealing the click / why a control is unreachable
(() => { const e = document.elementFromPoint(30, 596);
  return e ? e.tagName + "." + String(e.className).slice(0,40) + " pe=" + getComputedStyle(e).pointerEvents : null; })()

// which "bridge objects" a page exposes (QQ puts its own APIs on window)
(() => { const out = [];
  for (const k of Object.keys(window)) { const v = window[k];
    if (!v || typeof v !== "object") continue;
    const fns = Object.keys(v).filter(f => { try { return typeof v[f] === "function"; } catch(e){ return false; } });
    if (fns.length) out.push(k + ": " + fns.slice(0,12).join(",")); }
  return out.slice(0, 40); })()

// visibility / pointer state of one element ("invisible" or "unclickable" bugs)
(() => { const e = document.querySelector("#background-video"); if (!e) return "no el";
  const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
  return { display: cs.display, pe: cs.pointerEvents, z: cs.zIndex, w: Math.round(r.width), h: Math.round(r.height) }; })()
```

Key points:

- **Judge "did it work" by observable results** (`querySelectorAll(sel).length`, `getBoundingClientRect()`), never by
  whether a selector *looks* right. A real session concluded a plugin was dead from an attribute-name inference; the
  probe showed it was working correctly.
- **Synthetic `click` does not trigger some QQ handlers** (their trigger often lives in the preload's isolated world or
  in native code). For real input use Win32 `SetCursorPos` + `mouse_event`; screen coordinates = window
  `GetWindowRect` + page `getBoundingClientRect` (DPI scale 1). `window.screenX/screenY` can be stale.
- **IPC capture**: wrapping `ipcMain.handle/on` only catches handlers registered *after* you; for already-registered
  ones wrap `ipcMain._invokeHandlers` (Map) and `ipcMain._events` (internal APIs — verify per Electron version).
- **Never leave a replayable self-test payload**: a leftover link-clicking script in `eval.txt` was replayed on every
  QQ start, navigated the first window to a test URL, and hung QQ twice. The plugin now ignores stale content, but do
  not leave state-changing scripts behind, and clear `eval.txt` when done.

---

## 4. Capability / boundary cheat sheet

| Goal | Verdict |
|---|---|
| Restyle pages / inject CSS | ✅ renderer plugin (main world) |
| Intercept `window.open` | ✅ renderer plugin override |
| Intercept `<a>` clicks | ⚠️ only for main-world listeners; probe first |
| Own config/data | ✅ `LiteLoader.api.config.get/set` → `<profile>/data/<slug>/` |
| Open a window / system browser / a folder | ✅ main side `shell.*`, `LiteLoader.api.openExternal/openPath` |
| Observe when a window is created / shown | ✅ `app.on('browser-window-created')` + wrap `BrowserWindow.prototype.show/focus` |
| Stop QQ opening its internal browser, or its own "open externally" icon | ❌ native shell (evidence in §1.2) |
| Replace the page's `window.ipcRenderer` | ❌ frozen contextBridge object |
| Inject into `app://./renderer/qqBrowser.html` | ✅ but **only** via main-process `webContents.executeJavaScript` (LLQQNT does not inject renderer plugins there) |
| Stop QQ updates / edit its files | ⚠️ RSA signature verification; never do it silently — warn the user and give the rollback |

---

## 5. Work with the user in the loop — use the ask tool, often

Plugin facts are only observable on the user's **running** client. **Expect several short test rounds; do not try to
finish in one shot.**

- **On DSH**: call **`ask_user_question`**. It asks for a confirmation, a choice, or missing information and waits for
  the answer (blocking by default). Per question provide `id`, a short `header`, a concrete `question`, and
  **options with one-line descriptions, recommended option first**; set `multi_select: true` when several may apply.
  The user may also give a free-form `custom` answer, or skip. Answers return as
  `{"answers":[{"id","selected","custom"}]}`. **Waiting for the human adds no tokens.** Variants: `mode: timed` +
  `timeout` frees the model to continue while the question stays answerable; `timeout: -1` waits indefinitely. A live
  child agent owned by another agent cannot ask — it must surface the open question in its final result.
- **On other agent platforms**: check your own environment for an equivalent (elicitation / human-in-the-loop tool /
  approval prompt). If none exists, write the exact test steps and what to report back.
- **One small decisive test per round.** Not "please test everything" but "click one chat link, then pick:
  ① opens in my system browser ② QQ's internal browser appears ③ nothing happens".
- **Announce state-changing steps before doing them** (installing a plugin, patching a file, restarting QQ) and state
  the rollback.
- Batch independent questions into one call, and keep asking while the mechanism is unproven.

---

## 6. Delivery discipline

- Never write personal data (QQ numbers, chat content, `rkey`/tokens, real usernames, real absolute paths → use
  `<QQNT>` / `<app>` / `<profile>` placeholders).
- For any state-changing probe or script: back up, plan the rollback, clean up afterwards.
- For anything that bypasses verification, injects code, or edits QQ's files: state the risk and the rollback first.
- When reporting, always state **what was measured vs. what is inferred**, and the exact QQ version + loader version
  the result applies to.
