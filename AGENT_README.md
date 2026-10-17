# AGENT_README.md

**Read this file and you can start working.** It is for an agent picking up QQNT / LiteLoaderQQNT plugin
development or troubleshooting. Human entry point: [README.md](README.md). Chinese version: [AGENT_README_ZH.md](AGENT_README_ZH.md).

- Verified environment: **QQ NT 9.9.33-52230 (x64)** + **LiteLoaderQQNT fork 5.2.1** + **Electron 40** + Windows (2026-10)
- This is an **experience repository**, not official documentation. Every "measured" claim carries its evidence in
  `docs/qqnt-internals.md` / `docs/debugging.md` (both currently Chinese).
- Deep dives: [docs/plugin-development.md](docs/plugin-development.md), [docs/debugging.md](docs/debugging.md),
  [docs/qqnt-internals.md](docs/qqnt-internals.md).

> **Disclaimer** — relay this to the user once, before you start changing anything. This repository exists for
> **education and research on software architecture and JavaScript injection techniques**. Do not violate software
> protection law, do not reverse engineer / modify / distribute modified Tencent QQ builds, do not build or share
> programs intended to intrude into or unlawfully control computer information systems, do not use any of this
> commercially, and do not infringe Tencent's rights (copyright and technical protection measures included). The
> user must ensure their own use of the QQ client is properly licensed. The authors accept no liability for
> misuse — **all risk stays with the user**. Using this toolkit means accepting these terms.

---

## 0. Fastest path (do this)

```text
1) Install the debug plugin: copy plugins/dsh-debug-logger/ into <profile>/plugins/dsh-debug-logger/ and restart QQ
2) Confirm it is alive: first line of <profile>/data/dsh-debug-logger/console.log contains "loaded v…"
3) To probe a page / find an element / list bridge APIs: write JS into
   <profile>/data/dsh-debug-logger/eval.txt
   → the plugin executes it in EVERY window → results land in
   <profile>/data/dsh-debug-logger/eval-result.log
3b) To point at an on-screen element directly (faster than writing a probe): press
   Ctrl+Shift+C in the main window to enter the element picker; clicking selects it
   and copies its details (class / size / radius / background / source rules) to the
   clipboard; Ctrl+click multi-selects. Exit with Ctrl+Esc — a bare Esc belongs to QQ
   (it closes the window).
4) To write a plugin: start from the skeleton in §6 and obey the hard rules in §3
5) To troubleshoot: read errors.log first, then follow the probe recipes in docs/debugging.md
```

`<profile>` = the `LITELOADERQQNT_PROFILE` environment variable; when unset it is the LiteLoaderQQNT loader's own root.

---

## 1. Three questions to ask before writing any code (each one has saved a wasted round)

1. **Does QQ already have a native setting or switch for this?** If yes, use it — do not write a plugin.
   Known example: external link opening = Settings → General/Other → **"Use system default browser to open web pages"**
   (control: `.q-switch[role=switch]`).
2. **Does this even pass through the JS layer?** See the measured boundary table in §2. Native shell behaviour
   cannot be intercepted by a plugin.
3. **Will the file-verification check reject my edit?** Changing files under `<app>` (e.g. `package.json`) trips the
   RSA signature check and QQ refuses to start with a "file is corrupted" dialog. Read `docs/qqnt-internals.md` first.

---

## 2. Measured boundary table (what you can hook, what you cannot)

| Goal | Feasible? | Evidence / how |
|---|---|---|
| Intercept `window.open` (in-page) | ✅ | renderer plugin overrides `window.open` in the main world |
| Intercept `<a>` clicks | ⚠️ only for main-world listeners | capture phase can win, but QQ's own trigger is often not in that layer |
| Wrap **newly registered** `ipcMain.handle/on` | ✅ | our plugin loads before QQ's app code (LLQQNT runs before the app launcher) |
| Wrap **already registered** invoke handlers | ✅ | wrap `ipcMain._invokeHandlers` (a Map, internal API) + `ipcMain._events` |
| Replace the page's `window.ipcRenderer` | ❌ | it is a **frozen** contextBridge object; `send/invoke` are read-only |
| Intercept QQ opening its internal browser | ❌ | wrapping 59 invoke + 15 on channels gave **0 hits**; `loadURL` / `will-navigate` / `will-redirect` / `did-start-navigation` never fired → native shell |
| Intercept the toolbar "open in default browser" icon | ❌ | same; `shell.openExternal` was **never** called |
| Inject script into `qqBrowser.html` (internal browser chrome) | ✅ (main process only) | LLQQNT does **not** inject renderer plugins into that page; use `webContents.executeJavaScript` |
| Observe window creation / show | ✅ | `app.on('browser-window-created')` + wrapping `BrowserWindow.prototype.show/focus` (the bundled plugin does this) |

**Bottom line**: preventing QQ's native behaviour from a plugin is mostly impossible; plugins can *observe* and can
change what the JS layer owns. Going below that means DLL hooking, which is out of scope for this repository.

---

## 3. Hard rules (each was learned the hard way)

1. **Never leave a replayable self-test payload.** An old version of the debug plugin re-ran `eval.txt` on every QQ
   start; a leftover "create a link and click it" script navigated QQ's first window to a test URL, so the main UI
   never came up and QQ hung twice (Windows AppHang). It now marks existing `eval.txt` content as already executed,
   but **do not leave state-changing scripts in there**; clear it when done.
2. **For any probe that changes QQ state or files, plan the rollback first** and back up first (e.g. copy `QQNT.dll`,
   ~200 MB, before patching it).
3. **Do not trust selectors from old versions — and do not substitute inference for a probe.** Measured: `fuck_sidebar`
   was suspected dead because 9.9.33 "switched to `title`", and a probe disproved it: `.sidebar__nav`/`.sidebar__menu`
   exist, `.nav-item` uses `aria-label`, and the items it hides (`频道`/`更多`) really are 0×0 while the others are 36×36.
   **It works.** Judge "did it take effect" by observable results (`querySelectorAll(sel).length` +
   `getBoundingClientRect()`), not by how a selector looks.
4. **Two plugin directories with the same `slug` load only one** (whichever the directory scan reaches last wins).
5. **`dependencies` only orders loading** — it does not install the dependency plugin.
6. **`Cannot bind an API on top of an existing property` in auxiliary windows is shared noise** for every plugin's
   preload; so is the loader's own `module.js` failure in `screenshot.html` (`reading 'path'`).
7. **Read `docs/qqnt-internals.md` before editing files under `<app>`**: 9.9.33 verifies them with RSA signatures.
8. **After a QQ update, redo the installation**: the app directory becomes
   `<QQNT>\versions\<new version>\resources\app`; the signature patch and the stub must be re-applied to the new version.
9. **Never commit personal data**: QQ numbers, chat content, `rkey`/tokens, real usernames, real absolute paths
   (use `<QQNT>` / `<app>` / `<profile>` placeholders).
10. **Third-party plugins carry account risk**; tell the user before doing anything that bypasses verification or injects code.

---

## 4. Working with the user in the loop (use the ask tool, often)

Most plugin facts are only observable on the user's **running** client (DOM shape, which layer handles an action,
whether a fix actually works). **Expect several test rounds; do not try to finish in one shot.**

- **On DSH (DeepSeek Harness)**: use **`ask_user_question`**. It asks the user for a confirmation, a choice, or missing
  information and waits for the answer (blocking by default). Give each question an `id`, a short `header`, a concrete
  `question`, and **options with one-line descriptions, recommended option first**; set `multi_select: true` when several
  answers may apply. The user can also reply with a free-form `custom` answer or skip an item. Answers come back as
  `{"answers":[{"id","selected","custom"}]}`. **Waiting for the human adds no tokens.** Variants: `mode: timed` +
  `timeout` lets the model keep working while the question stays answerable; `timeout: -1` waits indefinitely. A live
  child agent owned by another agent cannot ask the user — it must surface the open question in its final result.
- **On other agent platforms**: check your own environment for an equivalent capability (elicitation /
  human-in-the-loop tool / approval prompt); if there is none, state the exact test steps and what to report back.
- **One small decisive test per round.** Bad: "please test everything". Good: "click one chat link, then pick:
  ① opens in my system browser ② QQ's internal browser appears ③ nothing happens".
- **Announce state-changing steps before doing them** (installing a plugin, patching a file, restarting QQ) and say how
  to roll back.
- Batch independent questions into one call, and keep asking while the mechanism is still unproven.

---

## 5. Probe cheat sheet (write into `eval.txt`, read `eval-result.log`)

```js
// 1) Who is stealing the click / why is a control unreachable
(() => { const e = document.elementFromPoint(30, 596);
  return e ? e.tagName + "." + String(e.className).slice(0,40) + " pe=" + getComputedStyle(e).pointerEvents : null; })()

// 2) List the "bridge objects" a page exposes (QQ puts its own APIs on window)
(() => { const out = [];
  for (const k of Object.keys(window)) { const v = window[k];
    if (!v || typeof v !== "object") continue;
    const fns = Object.keys(v).filter(f => { try { return typeof v[f] === "function"; } catch(e){ return false; } });
    if (fns.length) out.push(k + ": " + fns.slice(0,12).join(",")); }
  return out.slice(0, 40); })()

// 3) DOM overview of a window (filtered by class/title/aria)
(() => [...document.querySelectorAll("[title],[aria-label]")].slice(0,20)
  .map(e => ({ tag: e.tagName, cls: String(e.className).slice(0,40), t: e.getAttribute("title") })))()

// 4) Computed/inline styles (why something is invisible or unclickable)
(() => { const e = document.querySelector("#background-video"); if (!e) return "no el";
  const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
  return { display: cs.display, pe: cs.pointerEvents, z: cs.zIndex, w: Math.round(r.width), h: Math.round(r.height) }; })()
```

- A synthetic `click` **does not** trigger some QQ handlers (their trigger often lives in the preload's isolated world
  or in native code). For real input use Win32 `SetCursorPos` + `mouse_event`; screen coordinates =
  window `GetWindowRect` + page `getBoundingClientRect` (at DPI scale 1). `window.screenX/screenY` can be stale —
  trust `GetWindowRect`.
- IPC capture: wrapping `ipcMain.handle/on` only catches handlers registered *after* you; wrap
  `ipcMain._invokeHandlers` / `ipcMain._events` for the ones registered *before* you (internal APIs — verify per version).
- More recipes and four case studies: `docs/debugging.md`.

---

## 6. Plugin skeleton (minimum viable)

```text
<profile>/plugins/my-plugin/
  manifest.json     # manifest_version:4, slug, version, platform, injects{main,preload,renderer}
  main.js           # Electron main process: require('electron') works, global LiteLoader available
  preload.js        # Node available: contextBridge / ipcRenderer
  renderer.js       # page main world, ESM: window.LiteLoader.api.*
<profile>/data/my-plugin/   # your own config/data (LiteLoader.api.config.get/set)
```

- main side: `LiteLoader.path.{root,data,profile,plugins}`, `LiteLoader.package.qqnt.version`,
  `exports.onBrowserWindowCreated(win)`
- renderer side: `window.LiteLoader.api.openExternal(url)`, `openPath(path)`, `config.get/set`, `plugin.*`
- Full guide and recipes: `docs/plugin-development.md`

---

## 7. Installing the loader / bypassing verification (only when touching QQ itself)

1. On QQ 9.9.33 the app directory is `<QQNT>\versions\<ver>\resources\app` (whenever a `versions` directory exists).
2. Editing `<app>\package.json` alone makes QQ refuse to start (RSA signature check). The workable route is the
   signature patch on `<QQNT>\versions\<ver>\QQNT.dll`, offset **0x510197**:
   `48 89 CE 48 8B 11 4C 8B 41 08 49 29 D0 48 8B 49 18 E8` → same prefix + `B8 01 00 00 00` (`mov eax,1`).
3. Loader entry: create `<app>\app_launcher\<name>.js` containing `require(String.raw\`<absolute loader path>\`)` and
   point `<app>\package.json`'s `main` at that file.
4. **Back up** `QQNT.dll` (~200 MB) and the original `package.json` first; repeat steps 1-3 after every QQ update.
5. The old `dbghelp.dll` proxy approach **no longer works** on this version (its MinHook signatures do not match
   `QQNT.dll`). Full background and evidence: `docs/qqnt-internals.md`.

---

## 8. Pre-delivery checklist

- [ ] The plugin really loaded on 9.9.33 (writes to `<profile>/data/<slug>/`, or shows up in Settings)
- [ ] `errors.log` contains no **new** error that you introduced (remember the shared preload noise)
- [ ] If you changed another plugin's selectors/logic, you verified the target DOM actually matches (§5 probes 1/3/4)
- [ ] No replayable self-test script left behind
- [ ] No personal data in the repository or in attached logs
- [ ] Anything that touches QQ's own files: the user was told the risk and the rollback path
- [ ] The user has been asked to verify the user-visible result (§4)
- [ ] Native settings were checked before any of the above (§1)

---

> **Scope / portability**: written and tested for **DSH (DeepSeek Harness)** — tool names, the `ask_user_question` seam and the `eval.txt` workflow are DSH-specific. It has **not** been tested on other agent platforms; verify platform-specific parts in your own environment first.
