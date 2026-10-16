---
name: qqnt-plugin-dev
description: >
  Write, modify or review a LiteLoaderQQNT / QQNT plugin for the QQ NT client on Windows: manifest v4, what
  the main / preload / renderer worlds each can touch, hooks and LiteLoader APIs, a minimum working plugin, recipes,
  and the pre-delivery checklist. Carries the mandatory disclaimer and the iron rules (check QQ's own native
  settings first; confirm the JS layer is even involved). Triggers: LiteLoaderQQNT, LLQQNT, QQNT 插件,
  LiteLoader 插件, write a QQNT plugin, QQ 插件 manifest, 设置不生效, 开关点不动.
license: MIT
---

# QQNT / LiteLoaderQQNT — writing a plugin

One of four sibling skills; pick by task:

| Skill | Use it for |
|---|---|
| **`qqnt-plugin-dev`** (this one) | writing / changing a plugin: anatomy, APIs, recipes, delivery |
| `qqnt-plugin-debug` | making it work on a live client: bundled logger, `eval.txt` REPL, probes, IPC capture, pitfalls |
| `qqnt-loader-install` | installing / repairing the loader, file verification, the `QQNT.dll` signature patch |
| `qqnt-capability-limits` | deciding whether a feature is reachable from a plugin at all |

Paths written `<like this>` are placeholders. **Resolve relative paths against this skill's base directory**
(DSH prints it in the `skill_resources` block of this skill's content). Everything is bundled locally — no fetch.

---

## 0. Disclaimer — send this to the user once, before you start

**When:** once, at the first QQNT-plugin task **in the current conversation** — first check the conversation above: **if the notice already appears there, do not repeat it.** Follow-up questions in the same
conversation do **not** re-trigger it. A **new conversation** gets it again. Translate it if the user writes another
language.

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

Say in the same message that **plugin work needs the user's cooperation**: most facts are only observable on their
running client, so expect several short test rounds (the *debug* skill covers the ask-the-user loop).

**Before writing any code, load `qqnt-capability-limits`.** It answers the two questions that decide whether this
plugin should exist at all: does QQ already have a native setting for it, and is the behaviour even reachable from
the JS layer. Skipping it is how an afternoon gets spent on something QQ already does.
**Version scope.** Everything marked `[measured]` was verified on **QQ NT 9.9.33-52230 + LiteLoaderQQNT 5.2.1 +
Electron 40 (Chromium 144) + Windows** (2026-10). On any other version, treat every `[measured]` claim as a hypothesis and
re-verify with probes before acting on it.

---

## 1. Iron rules (the two that belong to design time)

1. **Check QQ's own native settings first.** A feature the user wants may already exist as a switch — and then no
   plugin is needed. Real case: "open links in the system browser" was Settings → General/Other →
   *Use system default browser to open web pages*. Four plugin versions were written before anyone looked.
   (`qqnt-capability-limits` has the how-to.)
2. **Confirm the JS layer is even involved** before designing an interception. QQ's own link opening and its
   internal browser are native shell behaviour; a plugin can only observe them. Evidence and the decision
   procedure: `qqnt-capability-limits`.

A third rule — *back up before touching QQ's own files* — belongs to `qqnt-loader-install`.

---

## 2. Where plugins live

| Symbol | Meaning |
|---|---|
| `<profile>` | LiteLoader data root: env `LITELOADERQQNT_PROFILE`, else the loader's own root |
| plugin dir | `<profile>\plugins\<slug>\` |
| plugin data | `<profile>\data\<slug>\` (your config/state) |
| loader config | `<profile>\data\LiteLoader\config.json` — `disabled_plugins` lists disabled slugs |
| `<QQNT>` / `<app>` | QQ install root / the Electron app root (`qqnt-loader-install` shows how to find it) |

A plugin folder is picked up by directory name and manifest `slug`; there is no registry. Editing any plugin file
(main/preload/renderer) needs a **QQ restart** — they are loaded once at startup.

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
  "authors": [{ "name": "you", "link": "https://github.com/you" }],
  "platform": ["win32"],
  "type": "extension",
  "dependencies": ["other-slug"],
  "injects": { "main": "./main.js", "preload": "./preload.js", "renderer": "./renderer.js" }
}
```

- `type` is `extension | theme | framework`; the loader does **not** filter by it **[measured]**.
- **`authors` entries need `name` *and* `link`** **[measured]** — the loader's own `manifest.schema.json`
  (shipped in the LiteLoaderQQNT release folder next to its `package.json`; read it there, because the copy deployed
  under `<app>\LiteLoaderQQNT\` may hold only `src/`) declares `authors.items.required = ["name","link"]`.
  Omitting `link` still loads, but it is out of schema and QQ's plugin list renders each author as a clickable
  link, so the entry is dead.
- **`repository` is what the plugin list links to** **[measured]** (`manifest.repository.{repo,branch}` →
  `https://github.com/<repo>/tree/<branch>`); add it if this plugin will ever be listed:
  `"repository": { "repo": "you/my-plugin", "branch": "main", "release": { "tag": "1.0.0", "url": "my-plugin.zip" } }`.
  `branch` is required once `repository` is present; under `release`, `tag` is required and `url` is the **release
  asset file name** (leave it out to download the tag's source archive).
- `dependencies` fixes **load order only** — it does **not** install the dependency **[measured]**.
- Two folders with the same `slug` → only one loads (whichever the scan reaches last) **[measured]**. Check for
  duplicates before debugging a "dead" plugin.
- `injects` entries are optional; omit the worlds you do not need.

### 3.2 The three worlds

| Inject | Runs in | Node? | Can touch | Use for |
|---|---|---|---|---|
| `main` | Electron main process | yes — `require('electron')` | `ipcMain`, `webContents`, `BrowserWindow`, `shell`, `app` | hooks, window/IPC work, native bridges |
| `preload` | renderer's isolated preload world | yes | `contextBridge`, `ipcRenderer` | exposing a safe API to the page |
| `renderer` | page **main world**, ESM via `local://` | no | the DOM, `window.LiteLoader.api.*` | UI, CSS, click handling |

Two measured gotchas:

- Renderer plugins are **not** injected into `app://./renderer/qqBrowser.html` (QQ's internal browser chrome).
  Inject there from `main` with `webContents.executeJavaScript`.
- The page exposes QQ's own `window.ipcRenderer`, but it is a **frozen** contextBridge object — you cannot wrap it
  from the main world. Wrap on the **preload** side instead.

### 3.3 Hooks and APIs

- main: `exports.onBrowserWindowCreated(win)`, `exports.onBrowserWindowCreating()`, global `LiteLoader`
  (`path.{root,data,profile,plugins}`, `package.qqnt.version`, `api.config.get/set`, `api.plugin.*`).
- renderer: `window.LiteLoader.api.openExternal(url)`, `openPath(path)`, `config.get/set`, `plugin.*`.
- config lives in `<profile>\data\<slug>\`; read it through `LiteLoader.api.config` so paths stay correct.

### 3.4 Minimum viable plugin

```js
// main.js — window + IPC reach
const { ipcMain, shell } = require("electron");
exports.onBrowserWindowCreated = (win) => { console.error("[my-plugin] window", win.id); };
ipcMain.on("my-plugin:open", (e, url) => shell.openExternal(url));
```

```js
// preload.js — safe bridge
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("myPlugin", { open: (u) => ipcRenderer.send("my-plugin:open", u) });
```

```js
// renderer.js — DOM work (ESM, page main world)
console.error("[my-plugin] loaded in", location.href);
document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href^='http']");
    if (a) { e.preventDefault(); e.stopImmediatePropagation(); window.myPlugin.open(a.href); }
}, true);
```

### 3.5 Recipes

- **Inject CSS**: renderer plugin, append a `<style>` on load; re-append if QQ swaps the DOM subtree.
- **Load your own CSS/image asset from the plugin folder** **[measured]**: ship the file inside the plugin and
  reference it over the loader's `local://` scheme — `local://profile/<path relative to profile>/x.css` (the case
  that matters: your plugin dir lives under `<profile>\plugins\`) or `local:///<absolute path>`. Derive the relative
  path instead of hardcoding a drive letter or user name, by measuring your plugin dir against the profile root:

  ```js
  // renderer.js — absolute paths using only loader-provided roots [measured]
  const me = LiteLoader.plugins["my-plugin"].path.plugin;      // <profile>\plugins\my-plugin
  const prof = LiteLoader.path.profile;                        // <profile>
  const rel = me.slice(prof.length).replace(/\\/g, "/").replace(/^\//, "");  // plugins/my-plugin
  const cssUrl = `local://profile/${rel}/style.css`;
  const imgUrl = `local://profile/${rel}/icon.png`;
  ```
- **A settings page**: renderer `onSettingWindowCreated` (loader API) + `LiteLoader.api.config.get/set` for storage
  — see §3.7, it has the measured switch markup, config validation and the cross-window sync that makes a change
  take effect without restarting QQ.
- **Intercept a click**: capture-phase listener on `document`, then `preventDefault()` +
  `stopImmediatePropagation()`. Measured caveat: some QQ handlers do not live in the main world, so a capture
  listener may lose — probe before promising it works.
- **React to a new window**: `app.on('web-contents-created')` **and** loop `webContents.getAllWebContents()` at load,
  because QQ pre-creates pooled windows before your plugin runs.
- **Open something externally**: `LiteLoader.api.openExternal(url)` / `openPath(path)` in the renderer, or
  `shell.openExternal` / `shell.openPath` in main.

---

### 3.6 Worked example: a button in the left sidebar **[measured]**

Measured on 9.9.33: the left rail is `.sidebar__nav` (`display:flex; flex-direction:column; align-items:center`,
about 52 px wide) holding ~8 `.nav-item` children (36×36; hidden ones measure 0×0). Append **your own clone** of a
visible `.nav-item` so QQ's styling and hover come for free — and remember a `cloneNode` copies classes but **not**
event listeners, so the clone is yours alone:

```js
(() => {
  if (window.__demoLoaded || location.hash.indexOf("/main") < 0) return;
  window.__demoLoaded = true;
  let n = parseInt(localStorage.getItem("demo:n") || "0", 10) || 0;   // survives QQ restarts [measured]
  function install() {
    const nav = document.querySelector(".sidebar__nav");
    if (!nav) return false;
    if (nav.querySelector(".demo-btn")) return true;
    const tpl = [...nav.querySelectorAll(".nav-item")].find(e => e.getBoundingClientRect().height > 0);
    const btn = tpl ? tpl.cloneNode(true) : document.createElement("div");
    if (!tpl) btn.className = "nav-item";
    btn.classList.remove("nav-item-more");
    btn.classList.add("demo-btn");
    btn.setAttribute("aria-label", "demo +1");
    btn.textContent = "＋1";
    btn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopImmediatePropagation();     // keeps QQ's rail-level handlers out
      n++; localStorage.setItem("demo:n", String(n));
      btn.title = "共点击了 " + n + " 次";
    }, true);
    nav.appendChild(btn);
    return true;
  }
  if (!install()) { const t = setInterval(() => { if (install()) clearInterval(t); }, 500); setTimeout(() => clearInterval(t), 60000); }
})()
```

**Extending it into a real toy** (all measured on 9.9.33):

- **Icon**: nav-item icons are inline `<svg>` **without** `currentColor`; use `currentColor` in your own SVG and it
  follows the theme automatically (measured `color: rgb(4,30,42)` on the light theme).
- **Sound with no asset file**: a real user click is a valid gesture, so `new (window.AudioContext)()` inside the
  click handler works. A short triangle-wave sweep plus a band-passed noise burst reads as a wooden knock — nothing
  to download or ship.
- **Audio nodes do not follow a plain number field** **[measured]**: `master.gain.value` is read once, when you build
  the graph. If your config has a `volume` field, change the node in its setter *and* on load — or make `volume` a
  getter/setter pair that mirrors into `gain.value` — otherwise the slider moves, the config saves, and the sound
  never changes. Symptom to recognise: "the setting saves but nothing happens" that is **not** the §3.8 window bug.
- **Persistent badge**: QQ's own unread badge classes are `q-badge q-badge__red`; a plain absolutely-positioned
  `<span>` inside your cloned `.nav-item` is simpler and theme-independent (measured 23×13 px at the top-right).
- **Long press to reset**: `pointerdown` + a 700 ms timer, cleared on `pointerup` / `pointercancel` / `pointerleave`;
  suppress the click that follows with a timestamp check (`Date.now() - lastLongPress < 600`).
- **Hot-replace while iterating**: mark injected nodes with a version (`btn.dataset.ver = "v2"`), have `install()`
  remove any older marker, then paste the new source into `eval.txt` — the running client swaps in about a second
  with **no restart**.
A complete working plugin built this way is in the repository at `examples/merit-counter/` (button in the rail,
click pops “+1 ・ 共点击了 N 次”, count persisted). Prototype it in the debug skill's `eval.txt` REPL first — no
restart per iteration — then package it as a renderer plugin.

### 3.7 Settings page — the three measured traps

`onSettingWindowCreated(view)` hands you a container for your own panel (the loader clones its settings tab entry and
calls it with `view`). Everything below was measured on 9.9.33 and is what turns a "clicked but nothing happens"
report into a working switch.

**Trap 1 — QQ's switch is driven by the class `is-active`, not `aria-checked`** **[measured]**. `.q-switch` gets its
on/off appearance from the class; setting only `aria-checked` produces a switch whose *value* is right and whose
*paint* is permanently off — the user concludes the switch is broken. Correct markup and toggle:

```js
// markup: <div class="q-switch"><span class="q-switch__handle"></span></div>
const sw = view.querySelector(".my-switch .q-switch");
sw.classList.toggle("is-active", on);   // ← this is what actually paints the switch [measured]
sw.setAttribute("aria-checked", String(on));  // keep it, for accessibility and for reading state back
```

**Trap 2 — `config.get` merges the disk value over your defaults and does not validate it** **[measured]**: the
loader returns `Object.assign({}, default, savedFromDisk)`. A hand-edited or corrupted `config.json` therefore wins
silently, and a `null` field coerced with `Number()` becomes `0` — which is how a "volume 0 / muted plugin" gets
diagnosed for an hour. Validate on every read:

```js
const raw = await LiteLoader.api.config.get("my-plugin", { volume: 60, on: true });
const cfg = {
    volume: Number.isFinite(+raw.volume) ? Math.min(100, Math.max(0, +raw.volume)) : 60,
    on: raw.on === true
};
```

**Trap 3 — the setting saves to disk and still "needs a restart"**: that is §3.8, and it is a *window* problem, not
a config problem. Weigh that first: a config write that succeeds plus a UI that does not move is nearly always
cross-window, not a write failure.

### 3.8 Cross-window sync — the biggest measured trap

**Every QQ window is a separate JS context** **[measured]** — the main window and the settings window share no
memory, and `window.dispatchEvent` does **not** cross the boundary. Symptoms: "the setting only applies after
restarting QQ", even though the value on disk is already correct. Measured here as `webcontentsid=2` for the main
window vs `=6` for settings.

`localStorage` **is** shared per origin, and its `storage` event does cross windows **[measured]** — with one
catch: **it does not fire in the window that wrote the value.** So the writer must notify itself, and the cleanest
place is one `saveConfig()` that every code path goes through — do not leave individual call sites to remember the
broadcast:

```js
// renderer.js — one broadcast point, no missed call sites [measured]
const CH = "my-plugin:config";
function saveConfig(cfg) {
    LiteLoader.api.config.set("my-plugin", cfg);
    localStorage.setItem(CH, JSON.stringify({ ...cfg, _ts: Date.now() }));  // other windows: 'storage'
    window.dispatchEvent(new CustomEvent(CH, { detail: cfg }));             // this window only
}
window.addEventListener("storage", (e) => {
    if (e.key === CH && e.newValue) applyConfig(JSON.parse(e.newValue));
});
window.addEventListener(CH, (e) => applyConfig(e.detail));
```

If you genuinely need the main process in the loop (or want it to work in a context where `localStorage` is
unavailable), relaying the same message over `ipcRenderer` from the preload world is the natural fallback — that
route is **inferred**, not measured; verify it before relying on it. Try `localStorage` first: it needs no bridge
and no main-process code.

### 3.9 Animation and overlays — two rules that cost a day

- **Animate with `scale` / `translate` / `opacity` independent properties, never by overwriting the `transform`
  shorthand** **[measured]**: QQ's own overlay layers use `transform` for centring, so a rule that resets
  `transform: translateX(...)` yanks the layer out of place instead of nudging your element.
- **Never write a global element rule such as `button { … }`** **[measured]**: one override aimed at QQ's whole app
  froze the UI when opening a profile card by clicking an avatar. Scope every rule to a container you own. Related:
  QQ's **send button is not a `<button>`** — it is a set of nested `div`s, and the background is painted by the
  outermost **`.send-btn-wrap`**; style that, not the inner node you first find.

## 4. Delivery discipline

- Never write personal data (QQ numbers, chat content, `rkey`/tokens, real usernames, real absolute paths → use
  `<QQNT>` / `<app>` / `<profile>` placeholders). Same for anything you commit or paste into a report.
- Report **what was measured vs. what is inferred**, plus the exact QQ and loader versions involved.
- Anything that bypasses verification, injects code or edits QQ's files: state the risk and the rollback first
  (`qqnt-loader-install`).

**Pre-delivery checklist**

- [ ] The plugin really loaded (writes to `<profile>\data\<slug>\`, or appears in QQ's settings list)
- [ ] `errors.log` has no **new** error you introduced (mind the shared preload noise — see the *debug* skill)
- [ ] Anything you changed in another plugin was validated against the **current** DOM, not memory
- [ ] No replayable self-test payload left in the debug plugin's `eval.txt`
- [ ] No personal data in code, logs, screenshots or the repo
- [ ] Changes to QQ's own files: the user was told the risk and the rollback path
- [ ] The user has been asked to verify the user-visible result
- [ ] Native settings were checked before any of the above
