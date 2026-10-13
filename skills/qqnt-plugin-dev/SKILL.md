---
name: qqnt-plugin-dev
description: >
  Build, debug and repair LiteLoaderQQNT / QQNT plugins for the QQ NT client on Windows. Self-contained: manifest v4,
  main/preload/renderer worlds, LiteLoader APIs, a bundled debug plugin (window/IPC/exception logs, rotation,
  eval.txt REPL in every window), DOM/IPC probes, real-mouse injection, the QQNT.dll signature patch, measured
  pitfalls, and the ask-the-user test loop. Triggers: LiteLoaderQQNT, LLQQNT, QQNT plugin, 插件开发, 插件调试,
  内置浏览器, qqBrowser, lite-tools, NapCat, LLOneBot.

argument-hint: "[task: e.g. 'debug why plugin X is inert' | 'write a plugin that ...']"
license: MIT
---

# QQNT / LiteLoaderQQNT plugin development & debugging

Everything needed is **in this skill directory** — no network fetch required. Verified on
**QQ NT 9.9.33-52230 (x64) + LiteLoaderQQNT fork 5.2.1 + Electron 40 + Windows** (2026-10). Claims marked
**[measured]** were verified on a live client; on other QQ versions re-verify with the probes in §5.

Layout of this skill directory:

```text
SKILL.md                      this file (English)
SKILL_ZH.md                   same content, Chinese
README.md                     install notes
plugins/dsh-debug-logger/     the debug plugin, bundled — copy it into <profile>\plugins\ to install
```

---

## 0. Mandatory disclaimer — send this to the user once, before you start

Send once per session, at the first QQNT-plugin task, translated into the user's language if needed:

> **Disclaimer.** This work (toolkit, patches, documentation) is provided for **education and research on software
> architecture and JavaScript injection techniques only**. By using it you accept:
> - **Do not violate software protection law**; do not reverse-engineer, modify or distribute modified Tencent QQ
>   builds. Do not build or share programs intended to **intrude into or unlawfully control computer information
>   systems**.
> - **Do not infringe Tencent's rights**, including copyright and technical protection measures on the QQ client.
> - **No commercial use**; do not harm Tencent's lawful interests.
> - You must ensure your own use of the QQ client is **properly licensed** (including Tencent's terms of service).
> - Anything here that touches QQ's own files is documented to **explain the mechanism and allow rollback**, not to
>   help bypass official authorisation.
> - The authors **accept no liability** for misuse or its consequences. **All risk stays with the user.**
>
> In mainland China these can be criminal offences — avoid anything resembling them: ① providing programs or tools
> for intruding into or unlawfully controlling computer information systems (Criminal Law art. 285 §3); ② copyright
> infringement, including circumventing technical protection measures (art. 217); ③ disrupting computer information
> systems (art. 286).

Also say, in the same message, that **plugin work needs the user's cooperation**: most facts are only observable on
their running client, so expect several short test rounds (§11).

---

## 1. Three iron rules

1. **Check QQ's own native settings first.** Real case: to open links in the system browser the answer was
   Settings → General/Other → **"Use system default browser to open web pages"** (control `.q-switch[role=switch]`).
   Four plugin iterations were written before anyone checked a switch that already existed.
2. **Confirm the action even passes through the JS layer.** **[measured]** QQ's "open internal browser" *and* the
   internal browser toolbar's "open in default browser" icon are **native shell (`QQNT.dll`)** behaviour: wrapping
   59 already-registered `ipcMain` invoke handlers + 15 `on` channels produced **0 hits**; `shell.openExternal` was
   never called; `loadURL` / `will-navigate` / `will-redirect` / `did-start-navigation` never fired. A plugin can
   only *observe* such actions, or change what the JS layer owns.
3. **Back up before touching QQ's own files, and know the verification mechanism.** On 9.9.33 the files under
   `<app>` are verified by **RSA signatures** stored in `<app>\application.json`; editing `<app>\package.json` alone
   makes QQ show a "file is corrupted" dialog and exit. The workable route is the signature patch on
   `<QQNT>\versions\<ver>\QQNT.dll` at offset **0x510197** (§2.4).

---

## 2. Environment map (measure it, don't assume it)

### 2.1 Paths

| Symbol | Meaning |
|---|---|
| `<QQNT>` | QQ install root, e.g. `C:\Program Files\Tencent\QQNT` |
| `<app>` | the Electron app root: `<QQNT>\versions\<ver>\resources\app` **when a `versions` directory exists**, else `<QQNT>\resources\app` |
| `<profile>` | LiteLoader data root: env `LITELOADERQQNT_PROFILE`, else the loader's own root |
| plugin dir | `<profile>\plugins\<slug>\` |
| plugin data | `<profile>\data\<slug>\` |
| loader config | `<profile>\data\LiteLoader\config.json` (`disabled_plugins` lists disabled slugs) |

Empty-shell trap **[measured]**: `<QQNT>\resources\app` can exist while containing only stray `LiteLoaderQQNT\`
folders, with no `application.asar` / `package.json`. Judge the real app root by `application.asar` presence:

```powershell
Get-ChildItem "<QQNT>\versions" -Directory | ForEach-Object {
  $p = Join-Path $_.FullName "resources\app\application.asar"; if (Test-Path $p) { $_.Name }
}
```

### 2.2 How the loader is installed **[measured]**

Create `<app>\app_launcher\<any-name>.js` containing only:

```js
require(String.raw`C:/Program Files/Tencent/LiteLoaderQQNT-5.2.1`);
```

and point `<app>\package.json`'s `main` at `./app_launcher/<any-name>.js`. LLQQNT itself is loaded as the app
entry, then it loads plugins, then it requires the real app launcher — that ordering is why a plugin can wrap
`ipcMain` registrations *before* QQ registers its own.

### 2.3 Why editing app files breaks startup **[measured]**

`<app>\application.json` holds one **256-byte RSA signature** (base64, 344 chars) per file:
`application.asar`, `wrapper.node`, `major.node`, `package.json`. `<QQNT>\versions\<ver>\version.json` separately
signs `QQNT.dll`. After editing `package.json`, the launcher prints that file's **SHA-256** and exits with
`error code v2:-8`, showing 「文件已损坏, 请重新安装QQ。」.

### 2.4 The signature patch that works **[measured]**

Back up `QQNT.dll` (~200 MB) first, then patch one call in `<QQNT>\versions\<ver>\QQNT.dll`:

```text
offset 0x510197   original: 48 89 CE 48 8B 11 4C 8B 41 08 49 29 D0 48 8B 49 18 E8
                  patched:  48 89 CE 48 8B 11 4C 8B 41 08 49 29 D0 48 8B 49 18 B8 01 00 00 00
```

(`call <compare>` → `mov eax,1`, i.e. "the comparison always matches".) The old `dbghelp.dll` proxy approach
**no longer works** on this version — it byte-pattern-hooks `QQNT.dll` via MinHook and its signatures no longer
match (the DLL carries the strings `Sig not found!` / `MH Hook Patch failed!`).

### 2.5 Updates move the app root **[measured]**

QQ hot-updates itself: `versions\` gains `<old>-<new>.zip` plus an unpacked staging directory (`diff.json`,
`*.patch`, `raw_files\`). After the update the live app root is the **new** `versions\<ver>\resources\app`, so the
stub and the signature patch must be applied again. `versions\config.json` tracks `curVersion` / `readyVersion`.

---

## 3. Plugin anatomy

### 3.1 manifest.json (v4)

```json
{
  "manifest_version": 4,
  "name": "My Plugin",
  "slug": "my-plugin",
  "description": "what it does",
  "version": "1.0.0",
  "authors": [{ "name": "you" }],
  "platform": ["win32"],
  "type": "extension",
  "dependencies": ["other-slug"],
  "injects": { "main": "./main.js", "preload": "./preload.js", "renderer": "./renderer.js" }
}
```

- `type` is `extension | theme | framework`; the loader does **not** filter by it **[measured]**.
- `dependencies` only fixes **load order** — it does **not** install the dependency **[measured]**.
- Two directories with the same `slug` → only one loads (whichever the directory scan reaches last) **[measured]**.

### 3.2 The three injections

| Inject | Runs in | Has Node? | Can touch | Typical use |
|---|---|---|---|---|
| `main` | Electron main process | yes (`require('electron')`) | `ipcMain`, `webContents`, `BrowserWindow`, `shell`, `app` | hooking, window control, native bridges |
| `preload` | renderer's isolated preload world | yes (`require('electron')`) | `contextBridge`, `ipcRenderer` | exposing APIs to the page |
| `renderer` | page **main world**, loaded as ESM via `local://` | no | the DOM, `window.LiteLoader.api.*` | UI, CSS, click handling |

Renderer plugins are **not** injected into `app://./renderer/qqBrowser.html` (the internal browser chrome) — inject
there with `webContents.executeJavaScript` from main instead **[measured]**.

### 3.3 Hooks & APIs

- main: `exports.onBrowserWindowCreated(win)`, `exports.onBrowserWindowCreating()`, global `LiteLoader`
  (`path.{root,data,profile,plugins}`, `package.qqnt.version`, `api.config.get/set`, `api.plugin.*`).
- renderer: `window.LiteLoader.api.openExternal(url)`, `openPath(path)`, `config.get/set`, `plugin.*`.
- The page also exposes QQ's own bridge, including a **frozen** `window.ipcRenderer` (`send`/`invoke`/`on`) — you
  cannot replace it from the main world **[measured]**; wrap on the preload side instead.

### 3.4 Minimum viable plugin

```js
// main.js
const { ipcMain, shell } = require("electron");
exports.onBrowserWindowCreated = (win) => {
    console.error("[my-plugin] window", win.id);           // shows up in the debug plugin's log
};
ipcMain.on("my-plugin:open", (e, url) => shell.openExternal(url));
```

```js
// preload.js
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("myPlugin", { open: (u) => ipcRenderer.send("my-plugin:open", u) });
```

```js
// renderer.js  (ESM, page main world)
console.error("[my-plugin] loaded in", location.href);
document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href^='http']");
    if (a) { e.preventDefault(); e.stopImmediatePropagation(); window.myPlugin.open(a.href); }
}, true);
```

---

## 4. Bundled debug toolkit — `plugins/dsh-debug-logger/`

**Install** (no network needed): copy this skill's `plugins/dsh-debug-logger/` into
`<profile>\plugins\dsh-debug-logger\`, then **restart QQ**. Verify: first line of
`<profile>\data\dsh-debug-logger\console.log` contains `loaded v…`, or QQ's settings list shows the plugin.

What it writes into `<profile>\data\dsh-debug-logger\`:

| File | Content |
|---|---|
| `console.log` | every window's console (VERBOSE filtered out) + main-process `console.error/warn` |
| `errors.log` | only lines matching warn/error/assert/exception — **read this first** |
| `eval-result.log` | results of the `eval.txt` REPL (below) |
| `eval.txt` | **input**: JS you write here is executed in **every** window |

It also captures `preload-error`, `uncaughtException` / `unhandledRejection`, `render-process-gone`,
`did-fail-load`, `web-contents-created`, window `CREATED`, `SHOW/show|showInactive|focus|restore|moveTop` (with call
stacks), and — if enabled — a filtered `ipcMain` channel log.

**Rotation**: any log file over **5 MB** is rewritten keeping the last **2 MB**, from a line boundary, prefixed with
`[已截断，仅保留最近 2 MB]`.

**The eval REPL is the main tool**: write a JS expression into `eval.txt` → within ~1 s it runs in every window and
its result is appended to `eval-result.log` as `--- [<url>] => <json>`. Semantics you must know:

- The plugin records existing `eval.txt` content as *already executed* at startup, so **it will not replay stale
  payloads**. Only a file **write** triggers execution.
- Do **not** leave state-changing scripts in `eval.txt` — an older version replayed them on every QQ start, navigated
  QQ's first window to a test URL and hung QQ twice (AppHang) **[measured]**. Clear it when done.
- Set `disabled_plugins` in `<profile>\data\LiteLoader\config.json` (or use Settings) to disable the plugin.

---

## 5. Probe recipes (write into `eval.txt`)

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

// 4) Visibility / pointer state ("invisible" and "unclickable" bugs)
(() => { const e = document.querySelector("#background-video"); if (!e) return "no el";
  const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
  return { display: cs.display, pe: cs.pointerEvents, z: cs.zIndex, w: Math.round(r.width), h: Math.round(r.height) }; })()

// 5) Existence + effect of a selector (the correct way to judge "did it work")
(() => [...document.querySelectorAll(".nav-item[aria-label]")].map(e => e.getAttribute("aria-label") + ":" +
  [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)].join("x")))()

// 6) QQ internal-browser structure (chrome page + its tabs)
(() => ({ url: location.href.slice(0,60),
  tabs: [...document.querySelectorAll("#qqb-tabs .tab")].map(t => (t.querySelector(".tab-content")||{}).textContent),
  defaultBrowserBtn: !!document.getElementById("qqb-default-browser-button") }))()
```

**Judge "did it take effect" by observable results** — `querySelectorAll(sel).length` for matching and
`getBoundingClientRect()` for the effect — **never** by whether a selector *looks* right. A real session concluded a
plugin was dead from an attribute-name inference; probe 5 showed it was working correctly **[measured]**.

---

## 6. Capturing IPC

```js
// a) handlers registered AFTER you (wrap the registration APIs at plugin load)
const { ipcMain } = require("electron");
for (const m of ["handle", "on"]) {
    const orig = ipcMain[m].bind(ipcMain);
    ipcMain[m] = (channel, fn) => orig(channel, typeof fn === "function"
        ? function (...a) { console.error("[ipc] " + m + " " + channel); return fn.apply(this, a); } : fn);
}
// b) handlers registered BEFORE you (Electron internals — verify per version)
for (const [ch, fn] of Array.from((ipcMain._invokeHandlers || new Map()).entries()))
    ipcMain._invokeHandlers.set(ch, function (...a) { console.error("[ipc] invoke " + ch); return fn.apply(this, a); });
for (const ch of Object.keys(ipcMain._events || {})) {
    const cur = ipcMain._events[ch], arr = Array.isArray(cur) ? cur : [cur];
    ipcMain._events[ch] = Array.isArray(cur)
        ? arr.map(f => (...a) => (console.error("[ipc] on " + ch), f.apply(ipcMain, a)))
        : ((...a) => (console.error("[ipc] on " + ch), arr[0].apply(ipcMain, a)));
}
```

If a channel you expect never appears, the action is probably **native** (§1.2) — stop looking for an IPC hook.

---

## 7. Real mouse input (synthetic clicks are often ignored)

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

Screen coordinates = the window's `GetWindowRect` (Win32) + the element's page `getBoundingClientRect()`, valid at
DPI scale 1 (Electron's renderer arg `--device-scale-factor=1`). **[measured]** `window.screenX/screenY` can be
stale — re-read `GetWindowRect` right before clicking. Verify the cursor landed on the intended element by calling
`document.elementFromPoint(x - winLeft, y - winTop)` and checking `matches(":hover")`.

---

## 8. Capability / boundary table **[measured]**

| Goal | Verdict |
|---|---|
| Restyle pages / inject CSS | ✅ renderer plugin (main world) |
| Override `window.open` | ✅ renderer plugin |
| Intercept `<a>` clicks | ⚠️ only for main-world listeners; QQ's own trigger is often elsewhere — probe first |
| Own config/data | ✅ `LiteLoader.api.config.get/set` → `<profile>\data\<slug>\` |
| Open a browser / folder | ✅ main side `shell.*`, `LiteLoader.api.openExternal/openPath` |
| Observe window create / show | ✅ `app.on('browser-window-created')`, wrap `BrowserWindow.prototype.show/focus` |
| Stop QQ opening its internal browser, or its "open externally" icon | ❌ native shell (§1.2) |
| Replace the page's `window.ipcRenderer` | ❌ frozen contextBridge object |
| Inject into `qqBrowser.html` | ✅ main-process `webContents.executeJavaScript` only |
| Stop QQ updates / edit its files | ⚠️ RSA verification; warn the user, give rollback, back up |

---

## 9. Pitfalls catalogue

1. **Native-first**: check QQ's own settings before writing code (§1.1).
2. **Native behaviour is unhookable**: measure before designing (§1.2).
3. **Never leave replayable self-test payloads**: `eval.txt` replay hung QQ twice (§4).
4. **Don't infer effectiveness** — probe existence *and* effect (§5).
5. **Selectors/attributes drift between versions**: `.nav-item` uses `aria-label` on 9.9.33 (**not** `title`), and
   `.sidebar__nav` / `.sidebar__menu` / `.sidebar-nav` all coexist **[measured]** — re-probe after every update.
6. **Duplicate `slug`**: only one plugin directory loads (§3.1).
7. **`dependencies` doesn't install anything** (§3.1).
8. **Shared preload noise**: every plugin logs `Cannot bind an API on top of an existing property on the window
   object` in auxiliary windows, and the loader's own `src/preload/module.js` fails in `screenshot.html`
   (`Cannot read properties of undefined (reading 'path')`) — not your bug **[measured]**.
9. **Renderer plugins don't reach `qqBrowser.html`** — inject from main (§3.2).
10. **Main-process plugins that assume a DOM break**: a plugin calling `document.body.click()` from the **main**
    process threw `ReferenceError: document is not defined` on every menu close, desyncing QQ's menu state (menu
    needed three clicks; hovering flickered: 6 repeats of `INFO [object Object]×4` immediately followed by
    `UNCAUGHT_EXCEPTION` inside 9 s) **[measured]**. Fix: do it in the renderer/preload world instead.
11. **Full-bleed overlay layers steal clicks**: a background plugin's `<video id="background-video">` covered the
    whole window with `pointer-events: auto` (z-index -999); `document.elementFromPoint(30,596)` returned the video
    instead of the "more" button, so the button needed ~3 clicks. Setting `pointer-events: none` on that layer fixed
    it **[measured]**. The same plugin appended its `<video>` into a hidden container (`display:none` ancestor) so its
    background never showed, and injected its toolbar button into the first `.func-menu`, which on 9.9.33 is the
    *collapsed profile-card menu* rather than the visible bottom bar **[measured]**.
12. **Aux windows can exist before you**: QQ pre-creates a `qqBrowser` window and pooled `hiddenWindow`; hook
    `app.on('web-contents-created')` **and** iterate `webContents.getAllWebContents()` at plugin load.
13. **After every QQ update**: new app root, stub + signature patch must be re-applied (§2.5).

---

## 10. Native-setting-first in practice (how the link case was solved)

Goal was "all links open in the system browser". Four plugin designs failed because QQ's link opening is native.
The working answer was a QQ setting. How to find and flip one from the outside:

```js
// in the Settings window (via the eval REPL): locate a labelled switch and read its state
(() => { const KEY = "使用系统默认浏览器打开网页";
  const leaf = [...document.querySelectorAll("*")].find(e => e.children.length === 0 && (e.textContent||"").trim() === KEY);
  if (!leaf) return "not this page";
  const item = leaf.closest(".panel-main") || leaf.parentElement.parentElement;
  const sw = item.querySelector(".q-switch[role=switch]");
  return sw ? { checked: sw.getAttribute("aria-checked") } : "no switch"; })()
```

Flip it by dispatching `pointerdown`/`mousedown`/`pointerup`/`mouseup`/`click` on the `.q-switch` element, then
re-read `aria-checked` (it changed `false → true` in one call) **[measured]**. Tell the user which setting you changed
and how to revert it.

---

## 11. Work with the user in the loop — use the ask tool, often

Most plugin facts are only observable on the user's **running** client. **Expect several short rounds; do not try to
finish in one shot.**

- **On DSH (DeepSeek Harness)**: call **`ask_user_question`** — it asks for a confirmation, a choice, or missing
  information and **waits** for the answer (blocking by default). Per question supply `id`, a short `header`, a
  concrete `question`, and **options with one-line descriptions, recommended option first**; set
  `multi_select: true` when several may apply. The user may also answer free-form (`custom`) or skip an item. Answers
  return as `{"answers":[{"id","selected","custom"}]}`. **Waiting for the human adds no tokens.** Variants:
  `mode: timed` + `timeout` frees the model to continue while the question stays answerable; `timeout: -1` waits
  indefinitely. A live child agent owned by another agent **cannot** ask — it must surface the open question in its
  final result, so the main agent/Lead asks.
- **On other agent platforms**: check your own environment for an equivalent (elicitation / human-in-the-loop tool /
  approval prompt); if there is none, write the exact test steps and what to report back.
- **One small decisive test per round.** Not "please test everything" but: "click one chat link, then pick
  ① opens in my system browser ② QQ's internal browser appears ③ nothing happens".
- **Announce state-changing steps before doing them** (installing a plugin, patching a file, restarting QQ) and state
  the rollback.
- Batch independent questions into one call, and keep asking while the mechanism is unproven.

---

## 12. Delivery discipline

- Never write personal data (QQ numbers, chat content, `rkey`/tokens, real usernames, real absolute paths → use
  `<QQNT>` / `<app>` / `<profile>` placeholders).
- Copy a debug log before it rotates away (5 MB / 2 MB limit) if it holds the evidence you need.
- For anything that bypasses verification, injects code, or edits QQ's files: state the risk and the rollback first.
- Report **what was measured vs. what is inferred**, plus the exact QQ and loader versions involved.

**Pre-delivery checklist**

- [ ] The plugin really loaded (writes to `<profile>\data\<slug>\`, or appears in Settings)
- [ ] `errors.log` has no **new** error you introduced (mind the shared preload noise)
- [ ] Anything you changed in another plugin was validated with probes 1/3/4/5 against the *current* DOM
- [ ] No replayable self-test payload left in `eval.txt`
- [ ] No personal data in the repo, logs or screenshots
- [ ] Any change to QQ's own files: the user was told the risk and the rollback path
- [ ] The user has been asked to verify the user-visible result (§11)
- [ ] Native settings were checked before any of the above (§1.1)

---

**Scope / portability**: written and tested for **DSH (DeepSeek Harness)** agent behaviour (tool names, the
`ask_user_question` seam, the `eval.txt` workflow). It has **not** been tested on other agent platforms — verify
platform-specific parts in your own environment first.
