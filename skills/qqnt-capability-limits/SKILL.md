---
name: qqnt-capability-limits
description: >
  Decide whether a QQ NT feature can be changed by a LiteLoaderQQNT plugin at all, before writing one. Covers the
  measured native-shell vs JS boundary (what ipcMain hooks, navigation hooks and window.open can and cannot
  intercept), why QQ's internal browser and its "open in default browser" toolbar button are unreachable from a
  plugin, and how to find and flip QQ's own native setting instead. Triggers: 为什么插件拦不住, 内置浏览器,
  qqBrowser, QQ 原生设置, can a plugin hook this, QQNT plugin limitations, 拖窗口.
license: MIT
---

# QQNT — what a plugin can and cannot do

One of four sibling skills: `qqnt-plugin-dev` (writing one), `qqnt-plugin-debug` (making it work),
`qqnt-loader-install` (installing/patching), **`qqnt-capability-limits`** (this one — decide *before* coding).

**Resolve relative paths against this skill's base directory** (DSH prints it in the `skill_resources` block).

---

## 0. Disclaimer — send once, before you start

**When:** once, at the first QQNT-plugin task **in the current conversation** — first check the conversation above: **if the notice already appears there, do not repeat it.** A new conversation gets it again.

> **Disclaimer.** This work is provided for **education and research on software architecture and JavaScript
> injection techniques only**. By using it you accept: **do not violate software protection law** (no
> reverse-engineering, modifying or distributing modified Tencent QQ builds); do not build or share programs
> intended to **intrude into or unlawfully control computer information systems**; do not infringe Tencent's rights,
> including copyright and technical protection measures; **no commercial use**; ensure your own use of the QQ client
> is **properly licensed**. The authors **accept no liability** for misuse — **all risk stays with the user**.
> In mainland China these can be criminal offences: ① providing programs/tools for intruding into or unlawfully
> controlling computer information systems (Criminal Law art. 285 §3); ② copyright infringement, including
> circumventing technical protection measures (art. 217); ③ disrupting computer information systems (art. 286).

**Version scope.** Everything marked `[measured]` was verified on **QQ NT 9.9.33-52230 + LiteLoaderQQNT 5.2.1 +
Electron 40 (Chromium 144) + Windows** (2026-10). On another version, re-verify before relying on it.

---

## 1. Native-first: look for a QQ setting before writing code

The user's goal is often already a QQ option. Real case **[measured]**: "make all links open in my browser" —
four plugin iterations failed (see §2), while QQ itself has
**Settings → General/Other → *Use system default browser to open web pages*** (`.q-switch[role=switch]`); flipping it
solved the task natively.

Finding and flipping such a switch, from the Settings window (via the debug skill's `eval.txt` REPL):

```js
// 1) locate the labelled switch and read its state
(() => { const KEY = "使用系统默认浏览器打开网页";                       // ← the label text you are looking for
  const leaf = [...document.querySelectorAll("*")].find(e => e.children.length === 0 && (e.textContent||"").trim() === KEY);
  if (!leaf) return "not on this page";
  const item = leaf.closest(".panel-main") || leaf.parentElement.parentElement;
  const sw = item.querySelector(".q-switch[role=switch]");
  return sw ? { checked: sw.getAttribute("aria-checked"), painted: sw.classList.contains("is-active") } : "no switch"; })()
```

```js
// 2) flip it (dispatch the same events a real click produces), then re-read aria-checked
(() => { const sw = document.querySelector(".q-switch[role=switch]"); if (!sw) return "not found";
  for (const ev of ["pointerdown","mousedown","pointerup","mouseup","click"]) {
    const E = ev.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent;
    sw.dispatchEvent(new E(ev, { bubbles: true, cancelable: true, view: window, button: 0 })); }
  return { after: sw.getAttribute("aria-checked") }; })()
```

**[measured]** Those `.q-switch` components are ordinary page DOM, and their *painted* on/off state comes from the
class **`is-active`**, not from `aria-checked`: setting only `aria-checked` leaves the switch looking permanently
off while its value is already right. Read both, and if you build a switch of your own use
`classList.toggle("is-active", on)` (`qqnt-plugin-dev` §3.7 has the markup and the other settings-page traps).
A plugin can also mount its own panel in the settings window through the loader's `onSettingWindowCreated` hook.

Always tell the user **which setting you changed and how to revert it**.

---

## 2. The measured boundary: QQ's native shell is unreachable from JS

**[measured]** for "open a link in QQ's internal browser" and for the internal browser's own
"open in default browser" toolbar button:

- Wrapping **59 already-registered `ipcMain` invoke handlers + 15 `on` channels** and clicking both → **0 hits**.
- `shell.openExternal` was **never** called, even when the button successfully opened the system browser.
- `webContents.loadURL`, `will-navigate`, `will-redirect`, `did-start-navigation` **never fired** for the internal
  browser's page load.
- `window.ipcRenderer` in the page is a **frozen** contextBridge object; it cannot be wrapped either.

Conclusion: those actions are implemented inside the **native shell (`QQNT.dll`)**. A plugin can *observe* them
(and clean up afterwards), but it cannot intercept or prevent them. Post-hoc workarounds (let QQ's page appear,
then drive QQ's own toolbar button) are slow and racy **[measured]** — do not promise them as a fix.

### 2.1 The third case: observable but not interceptable — native window dragging **[measured]**

Some native behaviour cannot be *caught* as an event, yet leaves a signal a plugin **can** read. Native window
dragging (`app-region: drag`, measured on the 1061×40 top bar and the 52×581 left rail) is the reference example:

| Question | Measured answer |
|---|---|
| Does the renderer receive pointer events while dragging? | **No** — `pointerdown` / `pointermove` / `pointerup` counts are **all 0**. `app-region: drag` hands the drag to the OS before the page sees it. |
| Is the renderer still running during the drag? | **Yes** — over a 12 s drag: **239 heartbeats**, worst stall **0 ms**, and the window moved **214 px**, read correctly. |

So **you cannot intercept the drag**, but you *can* observe it: poll `window.screenX` / `window.screenY` and derive
velocity from the deltas — that is enough to drive "dragging-the-window" sound or visual feedback, which a pointer
listener can never do here. Treat this as a third category on the boundary:

- ❌ **not interceptable** — no pointer/preventDefault route
- ✅ **observable** — a polling signal still exists

When a feature looks "unreachable", check for such a signal before reporting a flat no: the honest verdict is
"can't intercept, can observe", and that often still ships the user's goal.

---

## 3. Capability table **[measured]**

| Goal | Verdict |
|---|---|
| Restyle pages / inject CSS | ✅ renderer plugin (main world) |
| Override `window.open` | ✅ renderer plugin |
| Intercept `<a>` clicks | ⚠️ only for main-world listeners; QQ's own trigger is often elsewhere — probe first |
| Own config/data | ✅ `LiteLoader.api.config.get/set` → `<profile>\data\<slug>\` |
| Open a browser / folder | ✅ `LiteLoader.api.openExternal/openPath` (renderer), `shell.*` (main) |
| Observe window create / show | ✅ `app.on('browser-window-created')`, wrap `BrowserWindow.prototype.show/focus` |
| Wrap newly registered `ipcMain` handlers | ✅ plugin main code runs before QQ's app code |
| Wrap already-registered invite handlers | ✅ via `ipcMain._invokeHandlers` / `_events` (internal APIs) |
| Stop QQ opening its internal browser, or its "open externally" icon | ❌ native shell (§2) |
| React to a **native window drag** (feedback/sound while the user moves the window) | ⚠️ not interceptable — no pointer events; poll `window.screenX/screenY` instead (§2.1) |
| Replace the page's `window.ipcRenderer` | ❌ frozen contextBridge object |
| Inject into `qqBrowser.html` (internal browser chrome) | ✅ main-process `webContents.executeJavaScript` only |
| Change QQ's own settings | ✅ by driving the settings UI (`.q-switch`, §1) — not by writing its config blindly |
| Add your own panel to QQ's settings window | ✅ `onSettingWindowCreated` (loader hook), own DOM inside it (`qqnt-plugin-dev` §3.7) |
| Stop QQ updates / edit its files silently | ⚠️ RSA-verified; warn the user, give rollback (`qqnt-loader-install`) |

---

## 4. Decision procedure: "can I hook this?" (5 minutes, before any design)

1. **Is there a QQ setting for it?** Search the settings text (§1's locator with the user's wording). If yes — done.
2. **Observe first.** With the debug skill's logger running, ask the user to trigger the action once, then check
   `errors.log` / `console.log` for activity. Nothing at all is a strong hint it is native.
3. **Probe the JS surfaces** (all read-only): wrap `ipcMain` registrations **and** the internal handler maps
   (`qqnt-plugin-debug` has the code), then repeat the action.
4. **Try the DOM layer** if the action is UI-side: capture-phase click listener, and check whether QQ's handler is in
   the main world (`elementFromPoint` + `getEventListeners` are not available; instead log whether your
   `preventDefault()` actually stopped it).
5. **If 2-4 are silent → it is native.** Report that honestly and offer either the post-hoc workaround (state its
   latency/raciness) or the native setting. Do **not** spend a second design round guessing.
