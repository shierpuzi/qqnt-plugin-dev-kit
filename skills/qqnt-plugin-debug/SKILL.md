---
name: qqnt-plugin-debug
description: >
  Debug a QQNT / LiteLoaderQQNT plugin against a live QQ client: install the bundled dsh-debug-logger (console,
  exception, window-creation and IPC logs with 5 MB rotation), drive its eval.txt REPL that runs JS in every window,
  run DOM hit-test and visibility probes, capture IPC channels including already-registered handlers, inject real
  mouse input, and work through the measured pitfalls catalogue. Triggers: 插件不生效, 插件调试, QQNT 插件排错,
  eval.txt, debug QQ plugin, background plugin 点不到.
license: MIT
---

# QQNT — debugging a plugin on a live client

One of four sibling skills: `qqnt-plugin-dev` (writing one), **`qqnt-plugin-debug`** (this one — making it work),
`qqnt-loader-install` (installing/patching), `qqnt-capability-limits` (what is reachable at all).

**Resolve relative paths against this skill's base directory** — the bundled plugin lives at
`plugins/dsh-debug-logger/` inside **this skill's directory** (DSH prints the base directory in the
`skill_resources` block). No network fetch is needed.

---

## 0. Disclaimer — send once, before you start

**When:** once, at the first QQNT-plugin task **in the current conversation**; a new conversation gets it again.

> **Disclaimer.** This work is provided for **education and research on software architecture and JavaScript
> injection techniques only**. By using it you accept: **do not violate software protection law** (no
> reverse-engineering, modifying or distributing modified Tencent QQ builds); do not build or share programs
> intended to **intrude into or unlawfully control computer information systems**; do not infringe Tencent's rights,
> including copyright and technical protection measures; **no commercial use**; ensure your own use of the QQ client
> is **properly licensed**. The authors **accept no liability** for misuse — **all risk stays with the user**.
> In mainland China these can be criminal offences: ① providing programs/tools for intruding into or unlawfully
> controlling computer information systems (Criminal Law art. 285 §3); ② copyright infringement, including
> circumventing technical protection measures (art. 217); ③ disrupting computer information systems (art. 286).

**Version scope.** `[measured]` facts were verified on **QQ NT 9.9.33-52230 + LiteLoaderQQNT 5.2.1 + Electron 40 +
Windows** (2026-10). Elsewhere, re-probe first.

**Tell the user, up front, that this will take several short rounds** — see §7.

---

## 1. Install the bundled debug plugin

```powershell
# <skill_dir> = the base directory DSH reported for this skill
Copy-Item "<skill_dir>\plugins\dsh-debug-logger" "<profile>\plugins\dsh-debug-logger" -Recurse
```

Then **restart QQ** (plugins load once at startup). Verify:

- first line of `<profile>\data\dsh-debug-logger\console.log` contains `loaded v…`, or
- QQ's settings list shows the plugin ("DSH 调试日志").

Output lands in `<profile>\data\dsh-debug-logger\`:

| File | Content |
|---|---|
| `console.log` | every window's console output (VERBOSE filtered) + main-process `console.error/warn` |
| `errors.log` | only warn/error/assert/exception lines — **read this first** |
| `eval-result.log` | results of the `eval.txt` REPL |
| `eval.txt` | **input**: JS written here is executed in **every** window |

It also captures `preload-error`, `uncaughtException` / `unhandledRejection`, `render-process-gone`,
`did-fail-load`, `web-contents-created`, window `CREATED` and
`SHOW/show|showInactive|focus|restore|moveTop` (with call stacks), plus an optional filtered `ipcMain` channel log.

**Rotation:** any log file over **5 MB** is rewritten keeping the last **2 MB** from a line boundary, prefixed with
`[已截断，仅保留最近 2 MB]`. **Copy a log out before it rotates** if it holds the evidence you need.

Disable it by adding `dsh-debug-logger` to `disabled_plugins` in `<profile>\data\LiteLoader\config.json` (or use
QQ's plugin settings).

## 2. The `eval.txt` REPL — and the read-only rule

Write one JS expression into `eval.txt`; within ~1 s it runs in **every** window and the result is appended to
`eval-result.log` as `--- [<url>] => <json>`.

**Read-only vs. state-changing — the rule that prevents a wedged client:**

- The probes in §3 are **read-only** (they inspect the DOM/bridge and return data). They are safe to leave in
  `eval.txt`.
- Anything that **clicks, sets a value, calls an IPC method, navigates, or changes QQ state** must be **removed from
  `eval.txt` immediately after it runs** — do not keep it "for next time".
- Why this is not optional **[measured]**: the plugin used to replay existing `eval.txt` content on every QQ start;
  a leftover link-clicking self-test navigated QQ's first window to a test URL, so the main UI never came up and QQ
  hung twice (Windows AppHang). The plugin now treats pre-existing content as already executed and only runs on a
  real file **write** — but a state-changing script left in the file is still one careless restart away from
  trouble.
- Before finishing a session: clear `eval.txt`.

## 3. Probes (read-only — write into `eval.txt`)

```js
// 1) Who is stealing the click / why is a control unreachable
(() => { const e = document.elementFromPoint(30, 596);
  return e ? e.tagName + "." + String(e.className).slice(0,40) + " pe=" + getComputedStyle(e).pointerEvents : null; })()

// 2) Which "bridge objects" a page exposes (QQ puts its own APIs on window)
(() => { const out = [];
  for (const k of Object.keys(window)) { const v = window[k];
    if (!v || typeof v !== "object") continue;
    const fns = Object.keys(v).filter(f => { try { return typeof v[f] === "function"; } catch(e){ return false; } });
    if (fns.length) out.push(k + ": " + fns.slice(0,12).join(",")); }
  return out.slice(0, 40); })()

// 3) DOM overview of one window (class / title / aria)
(() => [...document.querySelectorAll("[title],[aria-label]")].slice(0,20)
  .map(e => ({ tag: e.tagName, cls: String(e.className).slice(0,40), t: e.getAttribute("title") })))()

// 4) Visibility / pointer state ("invisible" or "unclickable" bugs)
(() => { const e = document.querySelector("#background-video"); if (!e) return "no el";
  const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
  return { display: cs.display, pe: cs.pointerEvents, z: cs.zIndex, w: Math.round(r.width), h: Math.round(r.height) }; })()

// 5) Existence + effect of a selector — the correct way to judge "did it work"
(() => [...document.querySelectorAll(".nav-item[aria-label]")].map(e => e.getAttribute("aria-label") + ":" +
  [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)].join("x")))()

// 6) QQ internal-browser structure (chrome page + its tabs)
(() => ({ url: location.href.slice(0,60),
  tabs: [...document.querySelectorAll("#qqb-tabs .tab")].map(t => (t.querySelector(".tab-content")||{}).textContent),
  defaultBrowserBtn: !!document.getElementById("qqb-default-browser-button") }))()
```

**Judge "did it take effect" by observable results** — `querySelectorAll(sel).length` for matching,
`getBoundingClientRect()` for the effect — **never** by whether a selector *looks* right. A real session concluded a
plugin was dead from an attribute-name inference; probe 5 proved it was working correctly **[measured]**.

## 4. Capturing IPC

```js
// a) handlers registered AFTER your plugin loads — wrap the registration APIs
const { ipcMain } = require("electron");
for (const m of ["handle", "on"]) {
    const orig = ipcMain[m].bind(ipcMain);
    ipcMain[m] = (channel, fn) => orig(channel, typeof fn === "function"
        ? function (...a) { console.error("[ipc] " + m + " " + channel); return fn.apply(this, a); } : fn);
}
// b) handlers already registered BEFORE you (Electron internals — verify per version)
for (const [ch, fn] of Array.from((ipcMain._invokeHandlers || new Map()).entries()))
    ipcMain._invokeHandlers.set(ch, function (...a) { console.error("[ipc] invoke " + ch); return fn.apply(this, a); });
for (const ch of Object.keys(ipcMain._events || {})) {
    const cur = ipcMain._events[ch], arr = Array.isArray(cur) ? cur : [cur];
    ipcMain._events[ch] = Array.isArray(cur)
        ? arr.map(f => (...a) => (console.error("[ipc] on " + ch), f.apply(ipcMain, a)))
        : ((...a) => (console.error("[ipc] on " + ch), arr[0].apply(ipcMain, a)));
}
```

A useful calibration **[measured]**: QQ's own link-opening touches **none** of 59 invoke + 15 `on` channels, so if a
channel you expect never appears the action is probably native — see `qqnt-capability-limits` instead of digging
further.

**Where to put such code:** the debug plugin only evaluates in renderer windows. To instrument the **main process**,
write it into a small throwaway plugin's `main.js` (or temporarily into the debug plugin's own `main.js`) and
restart QQ — the captured lines land in `console.log` because the main process's `console.error` is captured.

## 5. Real mouse input (synthetic clicks are often ignored) **[measured]**

QQ ignores or mishandles some synthetic `click()` calls — its trigger often lives in the preload's isolated world or
in native code. When the user's real click works but your scripted one does not, inject real input:

```powershell
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class M {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  public static void Click(int x, int y) { SetCursorPos(x,y); System.Threading.Thread.Sleep(150);
    mouse_event(0x0002,0,0,0,IntPtr.Zero); System.Threading.Thread.Sleep(60); mouse_event(0x0004,0,0,0,IntPtr.Zero); }
}
"@
```

Screen coordinates = the window's `GetWindowRect` + the element's page `getBoundingClientRect()`, valid at DPI scale
1. `window.screenX/screenY` can be **stale** — re-read `GetWindowRect` right before clicking. Confirm the cursor
landed where you aimed with `document.elementFromPoint(x - winLeft, y - winTop)` and `.matches(":hover")`.

## 6. Pitfalls catalogue (all `[measured]`)

1. **Native-first**: check QQ's own settings before writing code (`qqnt-capability-limits`).
2. **Never leave replayable self-test payloads** in `eval.txt` (§2).
3. **Don't infer effectiveness** — probe existence *and* effect (§3, probe 5).
4. **Selectors/attributes drift between versions**: `.nav-item` uses `aria-label` on 9.9.33 (**not** `title`), and
   `.sidebar__nav` / `.sidebar__menu` / `.sidebar-nav` all coexist. Re-probe after every QQ update.
5. **Duplicate `slug`**: two plugin folders with the same slug → only one loads (whichever the scan reaches last).
6. **`dependencies` doesn't install anything** — it only orders loading.
7. **Shared preload noise is not your bug**: every plugin logs
   `Cannot bind an API on top of an existing property on the window object` in auxiliary windows, and the loader's
   own `src/preload/module.js` fails in `screenshot.html` (`Cannot read properties of undefined (reading 'path')`).
8. **Renderer plugins never reach `qqBrowser.html`** (QQ's internal browser chrome) — inject from main with
   `executeJavaScript`.
9. **Main-process code has no DOM**: a plugin calling `document.body.click()` from **main** threw
   `ReferenceError: document is not defined` on every menu close and desynced QQ's menu state (the menu needed three
   clicks; hovering flickered in a loop — 6 repeats of `INFO [object Object]×4` immediately followed by
   `UNCAUGHT_EXCEPTION` within 9 s). Do DOM work in the renderer/preload world.
10. **Full-bleed overlay layers steal clicks**: a background plugin's `<video id="background-video">` covered the
    window with `pointer-events: auto` (z-index -999), so `elementFromPoint` returned the video instead of the "more"
    button and that button needed ~3 clicks. `pointer-events: none` on the layer fixed it. The same plugin appended
    its `<video>` into a `display:none` container (so the background never showed) and injected its toolbar button
    into the first `.func-menu`, which on 9.9.33 is the *collapsed profile-card menu*, not the visible bottom bar.
11. **Aux windows can exist before your plugin**: QQ pre-creates a `qqBrowser` window and pooled `hiddenWindow`s —
    hook `app.on('web-contents-created')` **and** iterate `webContents.getAllWebContents()` at load.
12. **Rotate-proof your evidence**: copy `console.log` / `errors.log` out before the 5 MB→2 MB rotation drops the
    lines you care about.
13. **A silent plugin is not a broken plugin**: `setInterval` + `querySelector` patterns swallow a selector miss
    completely. Always pair a "did it match" count with a "did it change anything" measurement.

## 7. Work with the user in the loop — use the ask tool, often

Most facts are only observable on the user's **running** client. **Expect several short rounds; do not try to finish
in one shot.**

- **On DSH (DeepSeek Harness)**: call **`ask_user_question`** — it asks for a confirmation, a choice, or missing
  information and **waits** for the answer (blocking by default). Per question supply `id`, a short `header`, a
  concrete `question`, and **options with one-line descriptions, recommended option first**; set
  `multi_select: true` when several may apply. The user may also answer free-form (`custom`) or skip an item. Answers
  come back as `{"answers":[{"id","selected","custom"}]}`. **Waiting for the human adds no tokens.** Variants:
  `mode: timed` + `timeout` lets you keep working while the question stays answerable; `timeout: -1` waits
  indefinitely. A live child agent owned by another agent **cannot** ask — it must surface the open question in its
  final result, so the main agent/Lead asks.
- **On other agent platforms**: check your own environment for an equivalent (elicitation / human-in-the-loop tool /
  approval prompt); if there is none, write the exact test steps and what to report back.
- **One small decisive test per round.** Not "please test everything" but: "click one chat link, then pick
  ① opens in my system browser ② QQ's internal browser appears ③ nothing happens".
- **Announce state-changing steps before doing them** (installing a plugin, patching a file, restarting QQ) and state
  the rollback.
- Batch independent questions into one call, and keep asking while the mechanism is still unproven.
