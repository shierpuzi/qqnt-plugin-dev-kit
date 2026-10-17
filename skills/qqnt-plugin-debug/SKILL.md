---
name: qqnt-plugin-debug
description: >
  Debug a QQNT / LiteLoaderQQNT plugin on a live client: bundled dsh-debug-logger (console, exception,
  window-creation and IPC logs with 5 MB rotation), element picker (Ctrl+Shift+C, Ctrl multi-select,
  auto-copy) to see which element draws a box, eval.txt REPL running JS in every window, DOM hit-test and
  visibility probes, IPC capture, real mouse input, and the measured pitfalls catalogue. Triggers: 插件不生效,
  插件调试, QQNT 插件排错, eval.txt, 元素选择器, debug QQ plugin, background plugin 点不到, 改设置要重启.
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

**Version scope.** `[measured]` facts were verified on **QQ NT 9.9.33-52230 + LiteLoaderQQNT 5.2.1 + Electron 40
(Chromium 144) + Windows** (2026-10). Elsewhere, re-probe first.

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

**Since v1.4.0 the plugin has two injects**: `main.js` (this logger) and `renderer.js` — **the element picker**
(§3.0). Copy the **whole directory**; copying only `main.js` silently loses the picker. `main.js` itself did not
change in v1.4.0, so the log still self-reports `loaded v1.3` — that mismatch is expected, go by the manifest.

Output lands in `<profile>\data\dsh-debug-logger\`:

| File | Content |
|---|---|
| `console.log` | every window's console output (VERBOSE filtered) + main-process `console.error/warn` |
| `errors.log` | only warn/error/assert/exception lines — **read this first** |
| `eval-result.log` | results of the `eval.txt` REPL |
| `eval.txt` | **input**: JS written here is executed in **every** window |
| element picker | `renderer.js` (v1.4.0) — `Ctrl+Shift+C` to pick UI elements; see §3.0 |

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
- **`eval.txt` runs in *every* window at once — a state-changing script therefore runs N times, concurrently**
  **[measured]**: one run wrote config in window A while window B wrote a different value, the values overwrote each
  other, and the read-back could not be trusted. If a script must change state, make it **identify its own window
  explicitly** and no-op everywhere else, or only let the one target window act:

  ```js
  // explicit window identity — the sidebar only exists in the main window [measured]
  // (IIFE so the same snippet is safe whether or not your executor allows top-level return)
  (() => {
    if (!document.querySelector(".sidebar__nav")) return { skip: true, at: location.href };
    /* … mutation that must happen exactly once … */
  })()
  ```

  Remember this rule cuts both ways: the identity check above is for *deciding where to run a mutation*. It is
  **not** a liveness test — see pitfall 14.
- Anything that **clicks, sets a value, calls an IPC method, navigates, or changes QQ state** must be **removed from
  `eval.txt` immediately after it runs** — do not keep it "for next time".
- Why this is not optional **[measured]**: the plugin used to replay existing `eval.txt` content on every QQ start;
  a leftover link-clicking self-test navigated QQ's first window to a test URL, so the main UI never came up and QQ
  hung twice (Windows AppHang). The plugin now treats pre-existing content as already executed and only runs on a
  real file **write** — but a state-changing script left in the file is still one careless restart away from
  trouble.
- Before finishing a session: clear `eval.txt`.

**Prototype-then-package loop (no restart per iteration)** **[measured]**:

1. Write the renderer logic you intend to ship into `eval.txt` — it runs in the main window within a second.
2. Verify it with a **read-only** probe (does the node exist, right size, right parent? §3 probe 5).
3. When it looks right, copy the same file to `<profile>\plugins\<slug>\renderer.js` with a `manifest.json`
   (`injects.renderer`), restart QQ once, and confirm your own log line in `console.log`.
4. **Clear `eval.txt`** so the prototype cannot replay.

**Hot-replacing an already-installed UI plugin** **[measured]**: version the nodes you inject (`btn.dataset.ver`),
make `install()` remove any older marker, and paste the new source into `eval.txt` — the running client swaps to the
new version in ~1 s with no restart. Only restart QQ once the code is final (that is also when you verify the
packaged plugin, not just the prototype).

**Updating an imported ESM module: restart QQ, don't chase the cache** **[measured]**. `import()` caches the module
by URL, so a changed file on disk keeps returning the old module. The obvious workaround — a cache-busting query
string, `import("local://profile/plugins/my-plugin/x.js?v=" + Date.now())` — **fails in sandboxed windows**: in an
`about:blank` window it throws `Access to script … blocked by CORS policy … only supported for protocol schemes:
cacheimg, chrome, …`. `local://` assets are simply not usable there. For a module you genuinely need to iterate on,
the reliable loop is: edit → **restart QQ** → verify. Keep the fast iteration for the *implementation* (paste it into
`eval.txt`, which is re-evaluated per write and is not affected by the ESM cache) and save the restart for the
packaged file.

## 3. Probes (read-only — write into `eval.txt`)

### 3.0 The element picker — hand it to the user, do not write a probe for it **[measured]**

`renderer.js` (v1.4.0) is a Chrome-DevTools-class picker that answers "who draws this box, what is it called,
how big is it, what is its border-radius, which rules matched it" in one click. **It was built for a human at the
keyboard, not for you to drive**: one click auto-copies the full details (class / size / radius / background /
matched CSS source rules) to the clipboard and shows a toast. That is the point — the user does the pointing, the
answer arrives as text you can read.

**So the default move is: ask the user to use it, then paste what they got — do not reimplement it in a probe.**
This is §7 applied to element questions:

> "Press `Ctrl+Shift+C` in the main window, click the thing that looks wrong, and paste what lands on your
> clipboard (it's copied automatically)."

That single exchange replaces several rounds of you guessing selectors from a screenshot. Writing your own
`elementFromPoint` / hit-test probe instead is the slow path **and** often wrong: the picker reports the
*matched CSS source rules*, which a raw hit-test cannot.

Only fall back to your own probe when the user cannot run it (no GUI access, unattended run) — and §2's
read-only rule still applies.

| Action | Effect |
|---|---|
| `Ctrl+Shift+C` | enter / toggle pick mode (also from the plugin's settings page) |
| hover | blue outline + a tag showing `selector WxH r=radius` |
| click | select; prints class, size, radius, background and **the matched CSS source rules** to the console |
| **hold `Ctrl` + click** | multi-select (Ctrl-click the same element again = deselect) |
| after a selection | details are **auto-copied to the clipboard** and a toast confirms it |
| `Ctrl+Shift+X` | copy the last selection again |
| `Ctrl+Shift+B` | rubber-band box: list the elements inside it (to console) |
| `Ctrl+Esc` | step out, one level at a time: pick → box → tool off |

**The exit key must be `Ctrl+Esc`, not `Esc`** **[measured]**: QQ binds `Esc` to *closing the window*, so taking
it means "I tried to quit the debugger and lost my window". Second trap in the same feature: `KeyboardEvent.key`
is the string `"Escape"` while users and configs write `"Esc"` — an early build compared the strings directly, so
`Ctrl+Esc` **never matched** and the exit key looked completely dead (hint bar stuck on screen). Always normalize
key aliases (`esc`/`escape`, `del`/`delete`, `space`).

**Rebindable, no restart**: QQ settings → plugins → DSH 调试日志 → 自定义快捷键 — click the field and press the
combo (`Esc` alone cancels recording); or from code `window.__dshPicker.setHotkeys({ pick: "F8" })` /
`getHotkeys()`. Changes apply immediately through the same `storage` event used for config sync.

Two measured traps if you re-implement any of this yourself:

1. **Clipboard is a two-path fallback.** `navigator.clipboard.writeText` throws
   `NotAllowedError: Document is not focused` in QQ windows (Electron 40 requires the document to have focus), so
   the picker tries the Clipboard API and falls back to `document.execCommand("copy")` — **measured to work in an
   unfocused window**. Retry-on-failure, never assume one path.
2. **`local://profile/...` and `local:///...` are two different module instances.** If you `import()` the picker
   from an `eval.txt` probe you get a *second* instance with its own state — it builds *another* overlay and
   operates it, while the one on screen does nothing. Use the page's own instance, `window.__dshPicker`
   (`window.__dshPickerOn` / `__dshPickerBooted` are the liveness flags).

Overlay hygiene, same as any full-window layer (pitfall 10): `pointer-events: none` by default, `auto` **only**
while picking/boxing and restored immediately, and box mode exits itself after one drag — otherwise the overlay
eats every click in QQ and the UI looks frozen for no visible reason.

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
14. **A missing selector is not a dead window — never use element existence as a liveness probe** **[measured]**.
    A guard like `if (!document.querySelector(".sidebar__nav")) return {skip:true}` was used to detect "this window
    is unresponsive"; but QQ's router briefly unmounts the sidebar when it navigates to `#/main/message`, so a
    perfectly **healthy** window reported `skip`. That false reading caused the main window to be declared frozen
    **twice**. To judge whether a window is alive, make *the window itself* log (`console.error("[probe] here", …)`)
    and check whether the line appears in `console.log` — that is a positive signal from inside the window. Element
    absence is only evidence about the DOM, and only at the instant you looked.
15. **`eval.txt` executes in every window concurrently** — a state-changing script runs N times and windows can
    overwrite each other's writes (§2). Give the script an explicit window-identity guard, or restrict it to one
    window. If a read-back contradicts itself, suspect this before suspecting QQ.
16. **`local://` does not work in sandboxed windows** — `import("local://profile/…/x.js?v=" + Date.now())` in an
    `about:blank` window dies on a CORS policy error (§2). For an updated ESM module, restart QQ.
17. **A non-zero rect does not mean an element is visible — virtual lists keep hidden `measure` copies**
    **[measured]**. QQ's virtual list (`.viewport-list`) keeps a **measuring copy** inside
    `.viewport-list__measure` that carries the **same** `.recent-contact-item` class: `visibility: hidden` (still
    occupying space, `getBoundingClientRect()` fully non-zero) and **full row width** — measured 1029×72 @ (56,92)
    next to the real row's 304×72 @ (64,100). It therefore slips past **every** geometric guard you would
    normally write: min-size (`>10px`), size ceiling (`MAX_TARGET = 2000`, and 1029 < 2000 never trips it),
    `Number.isFinite` NaN checks, and the off-viewport filter — it sits inside the viewport. Symptom when you
    iterate elements by geometry: a **giant rounded frame** that never scrolls with the list. Always add a
    visibility guard, and pay for it only once: read `getComputedStyle(el)` in the same pass you already use for
    `borderTopLeftRadius`, then `if (cs.visibility === "hidden") continue;`. Read the element's **own**
    `visibility` (a child of a hidden parent that is itself `visibility: visible` really is visible;
    `display: none` gives a zero rect and is already caught by min-size). Probe: list every match's
    `w / h / left / visibility / parent.className` and look for the entries whose width dwarfs its siblings.
    This is the debug module's own origin story — see `examples/lens-skin/LESSONS.md` §19.
18. **A missing rule is not a broken rule — check that the selector *matches* before blaming precedence**
    **[measured]**. In the Lens skin, every rule was written as `body.q-theme-tokens-light …`, so on the dark
    theme (`q-theme-tokens-dark`) **nothing matched at all** and the whole skin silently vanished — which reads
    like "the plugin is dead", not like a CSS bug. Measure matching (`querySelectorAll(sel).length`) and the
    computed value under **both** themes before touching specificity. Same family of bug: QQ's native row
    background lives on a **child** (`.recent-contact-item--top .item__content`, painted from `--overlay_top`
    with `border-radius: 0`), so rounding the parent alone leaves the child's square corners "peeking out" —
    use the picker (§3.0) to confirm *which* element actually paints the box, then round both.

## 7. Work with the user in the loop — use the ask tool, often

Most facts are only observable on the user's **running** client. **Expect several short rounds; do not try to finish
in one shot.**

**Do not declare success from your own probe readings.** Your probes answer "did the DOM change", not "does it work
for a human"; **one real action by the user routinely finds what a probe cannot** (a switch that never repaints, a
sound that never plays, a click that lands but does nothing the user cares about). Reporting "done" off a green probe
is how a broken plugin gets shipped — ask the user to perform the action and report what they actually saw, and treat
their observation as the verdict, not your instrument's.

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
- **Element questions: send the user to the picker (§3.0), don't probe for them.** It auto-copies to the clipboard
  and toasts, so the round-trip is one sentence each way: "按 `Ctrl+Shift+C`，点那个看着不对的东西，把剪贴板里的内容贴给我".
  The user's paste is the evidence — it includes the matched CSS source rules, which no hit-test probe produces.
- **Announce state-changing steps before doing them** (installing a plugin, patching a file, restarting QQ) and state
  the rollback.
- Batch independent questions into one call, and keep asking while the mechanism is still unproven.
