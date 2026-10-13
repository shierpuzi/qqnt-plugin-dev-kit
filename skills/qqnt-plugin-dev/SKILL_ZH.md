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

# QQNT / LiteLoaderQQNT 插件开发与调试

所需的一切都**在这个 skill 目录里** —— 不需要联网获取。已在
**QQ NT 9.9.33-52230 (x64) + LiteLoaderQQNT fork 5.2.1 + Electron 40 + Windows** 上验证（2026-10）。标有
**[实测]** 的结论是在真实客户端上验证过的；在其它 QQ 版本上，请用 §5 的探针重新验证。

本 skill 目录的结构：

```text
SKILL.md                      this file (English)
SKILL_ZH.md                   same content, Chinese
README.md                     install notes
plugins/dsh-debug-logger/     the debug plugin, bundled — copy it into <profile>\plugins\ to install
```

---

## 0. 强制免责声明 —— 动手之前先给用户发一次

每个会话发一次，在第一个 QQNT 插件任务时发出，必要时翻译成用户的语言：

> **免责声明。** 本工作（工具包、补丁、文档）仅供**教育用途，以及研究软件架构与 JavaScript 注入技术之用**。使用它即表示你接受：
> - **不得违反软件保护相关法律**；不得对腾讯 QQ 进行逆向工程、修改或分发其修改版本。不得制作或传播意图**侵入或非法控制计算机信息系统**的程序。
> - **不得侵犯腾讯的权利**，包括 QQ 客户端的著作权与技术保护措施。
> - **不得用于商业用途**；不得损害腾讯的合法权益。
> - 你必须确保自己对 QQ 客户端的使用是**获得正当授权的**（包括遵守腾讯的服务条款）。
> - 本文中任何触及 QQ 自身文件的内容，其记录目的是**解释机制并保留回滚能力**，而不是帮助绕过官方授权。
> - 作者对误用及其后果**不承担任何责任**。**全部风险由用户自行承担。**
>
> 在中国大陆，下列行为可能构成刑事犯罪 —— 请避免任何与之相似的做法：① 提供用于侵入、非法控制计算机信息系统的程序、工具（刑法第 285 条第 3 款）；② 侵犯著作权，包括规避技术措施（第 217 条）；③ 破坏计算机信息系统（第 286 条）。

同时，在同一条消息里还要说明：**插件工作需要用户配合** —— 大多数事实只有在他正在运行的客户端上才能观察到，所以要预期若干轮简短测试（§11）。

---

## 1. 三条铁律

1. **先查 QQ 自带的原生设置。** 真实案例：要让链接在系统浏览器中打开，答案是 设置 → 通用/其他 → **"使用系统默认浏览器打开网页"**（控件 `.q-switch[role=switch]`）。在有人去看那个本来就存在的开关之前，已经写了四版插件。
2. **确认该动作确实经过 JS 层。** **[实测]** QQ 的"打开内置浏览器"*以及*内置浏览器工具栏的"用默认浏览器打开"图标，都是**原生外壳（`QQNT.dll`）**行为：包住 59 个已注册的 `ipcMain` invoke 处理器 + 15 个 `on` 通道，命中 **0 次**；`shell.openExternal` 从未被调用；`loadURL` / `will-navigate` / `will-redirect` / `did-start-navigation` 从未触发。插件**只能**观察这类动作，或者改变 JS 层自己拥有的东西。
3. **动 QQ 自身文件前先备份，并且搞清楚校验机制。** 在 9.9.33 上，`<app>` 下的文件由存放在 `<app>\application.json` 里的 **RSA 签名**校验；只改 `<app>\package.json`，QQ 就会弹出"文件已损坏"对话框并退出。可行路线是对 `<QQNT>\versions\<ver>\QQNT.dll` 偏移 **0x510197** 打签名补丁（§2.4）。

---

## 2. 环境地图（去测量，不要想当然）

### 2.1 路径

| 符号 | 含义 |
|---|---|
| `<QQNT>` | QQ 安装根目录，例如 `C:\Program Files\Tencent\QQNT` |
| `<app>` | Electron 应用根目录：**当存在 `versions` 目录时**为 `<QQNT>\versions\<ver>\resources\app`，否则为 `<QQNT>\resources\app` |
| `<profile>` | LiteLoader 数据根目录：环境变量 `LITELOADERQQNT_PROFILE`，否则为加载器自身的根目录 |
| 插件目录 | `<profile>\plugins\<slug>\` |
| 插件数据 | `<profile>\data\<slug>\` |
| 加载器配置 | `<profile>\data\LiteLoader\config.json`（`disabled_plugins` 列出被禁用的 slug） |

空壳陷阱 **[实测]**：`<QQNT>\resources\app` 可能存在，但里面只有若干零散的 `LiteLoaderQQNT\` 文件夹，没有 `application.asar` / `package.json`。用 `application.asar` 是否存在来判断真正的应用根目录：

```powershell
Get-ChildItem "<QQNT>\versions" -Directory | ForEach-Object {
  $p = Join-Path $_.FullName "resources\app\application.asar"; if (Test-Path $p) { $_.Name }
}
```

### 2.2 加载器是如何安装的 **[实测]**

创建 `<app>\app_launcher\<any-name>.js`，内容只有：

```js
require(String.raw`C:/Program Files/Tencent/LiteLoaderQQNT-5.2.1`);
```

并把 `<app>\package.json` 的 `main` 指向 `./app_launcher/<any-name>.js`。LLQQNT 自身先作为应用入口被加载，然后它加载插件，然后它 require 真正的应用启动器 —— 正是这个顺序，让插件能在 QQ 注册自己的处理器**之前**包住 `ipcMain` 的注册。

### 2.3 为什么改应用文件会导致启动失败 **[实测]**

`<app>\application.json` 为每个文件保存一个 **256 字节的 RSA 签名**（base64，344 字符）：
`application.asar`、`wrapper.node`、`major.node`、`package.json`。`<QQNT>\versions\<ver>\version.json` 则单独为 `QQNT.dll` 签名。改过 `package.json` 后，启动器会打印该文件的 **SHA-256** 并以 `error code v2:-8` 退出，同时显示「文件已损坏, 请重新安装QQ。」。

### 2.4 真正有效的签名补丁 **[实测]**

先备份 `QQNT.dll`（约 200 MB），然后给 `<QQNT>\versions\<ver>\QQNT.dll` 里的一处调用打补丁：

```text
offset 0x510197   original: 48 89 CE 48 8B 11 4C 8B 41 08 49 29 D0 48 8B 49 18 E8
                  patched:  48 89 CE 48 8B 11 4C 8B 41 08 49 29 D0 48 8B 49 18 B8 01 00 00 00
```

（`call <compare>` → `mov eax,1`，也就是"比较永远成立"。）旧的 `dbghelp.dll` 代理方案在这个版本上**已经失效** —— 它通过 MinHook 对 `QQNT.dll` 做字节模式 hook，而它的特征码已不再匹配（该 DLL 里带有 `Sig not found!` / `MH Hook Patch failed!` 字符串）。

### 2.5 更新会移动应用根目录 **[实测]**

QQ 会自我热更新：`versions\` 下会多出 `<old>-<new>.zip` 以及一个解包暂存目录（`diff.json`、`*.patch`、`raw_files\`）。更新之后，真正生效的应用根目录是**新的** `versions\<ver>\resources\app`，因此 stub 和签名补丁都必须重新应用。`versions\config.json` 记录 `curVersion` / `readyVersion`。

---

## 3. 插件结构

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

- `type` 取值为 `extension | theme | framework`；加载器**不**按它过滤 **[实测]**。
- `dependencies` 只决定**加载顺序** —— 它**不**会安装依赖 **[实测]**。
- 两个目录使用相同的 `slug` → 只有一个会被加载（目录扫描最后遇到的那个）**[实测]**。

### 3.2 三种注入

| 注入 | 运行于 | 有 Node 吗？ | 能碰什么 | 典型用途 |
|---|---|---|---|---|
| `main` | Electron 主进程 | 有（`require('electron')`） | `ipcMain`、`webContents`、`BrowserWindow`、`shell`、`app` | hook、窗口控制、原生桥接 |
| `preload` | 渲染进程的隔离 preload 世界 | 有（`require('electron')`） | `contextBridge`、`ipcRenderer` | 向页面暴露 API |
| `renderer` | 页面**主世界**，通过 `local://` 以 ESM 加载 | 没有 | DOM、`window.LiteLoader.api.*` | UI、CSS、点击处理 |

renderer 插件**不会**被注入到 `app://./renderer/qqBrowser.html`（内置浏览器外壳页）—— 要注入那里，得从 main 侧用 `webContents.executeJavaScript` **[实测]**。

### 3.3 钩子与 API

- main：`exports.onBrowserWindowCreated(win)`、`exports.onBrowserWindowCreating()`、全局 `LiteLoader`
  （`path.{root,data,profile,plugins}`、`package.qqnt.version`、`api.config.get/set`、`api.plugin.*`）。
- renderer：`window.LiteLoader.api.openExternal(url)`、`openPath(path)`、`config.get/set`、`plugin.*`。
- 页面还暴露了 QQ 自己的桥接对象，其中包括一个**被冻结的** `window.ipcRenderer`（`send`/`invoke`/`on`）—— 你无法从主世界替换它 **[实测]**；请在 preload 侧包一层。

### 3.4 最小可用插件

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

## 4. 内嵌调试工具包 —— `plugins/dsh-debug-logger/`

**安装**（无需联网）：把本 skill 的 `plugins/dsh-debug-logger/` 复制到
`<profile>\plugins\dsh-debug-logger\`，然后**重启 QQ**。验证：
`<profile>\data\dsh-debug-logger\console.log` 的第一行包含 `loaded v…`，或者 QQ 的设置列表里出现该插件。

它写入 `<profile>\data\dsh-debug-logger\` 的内容：

| 文件 | 内容 |
|---|---|
| `console.log` | 每个窗口的 console（VERBOSE 已被过滤掉）+ 主进程的 `console.error/warn` |
| `errors.log` | 只保留匹配 warn/error/assert/exception 的行 —— **先读这个** |
| `eval-result.log` | `eval.txt` REPL（见下）的结果 |
| `eval.txt` | **输入**：你写在这里的 JS 会在**每个**窗口中执行 |

它还会捕获 `preload-error`、`uncaughtException` / `unhandledRejection`、`render-process-gone`、
`did-fail-load`、`web-contents-created`、窗口 `CREATED`、`SHOW/show|showInactive|focus|restore|moveTop`（带调用栈），以及 —— 若启用 —— 一份过滤后的 `ipcMain` 通道日志。

**轮转**：任何超过 **5 MB** 的日志文件都会被重写为只保留最后 **2 MB**，从行边界开始，并加上前缀
`[已截断，仅保留最近 2 MB]`。

**eval REPL 才是主力工具**：把一段 JS 表达式写进 `eval.txt` → 约 1 秒内在每个窗口执行，其结果以 `--- [<url>] => <json>` 追加到 `eval-result.log`。必须知道的语义：

- 插件在启动时会把已存在的 `eval.txt` 内容记为*已执行*，所以**它不会重放陈旧负载**。只有对文件的**写入**才触发执行。
- **不要**把会改状态的脚本留在 `eval.txt` 里 —— 旧版本会在每次 QQ 启动时重放它们，把 QQ 的第一个窗口导航到测试 URL，并两次把 QQ 卡死（AppHang）**[实测]**。用完就清空。
- 在 `<profile>\data\LiteLoader\config.json` 里设置 `disabled_plugins`（或使用设置界面）来禁用该插件。

---

## 5. 探针配方（写进 `eval.txt`）

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

**用可观测的结果来判断"是否生效"** —— 匹配用 `querySelectorAll(sel).length`，效果用
`getBoundingClientRect()` —— **绝不**用"选择器看起来对不对"来判断。有一次真实会话仅凭属性名推断就断定某插件已死；探针 5 表明它其实工作正常 **[实测]**。

---

## 6. 抓 IPC

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

如果你预期出现的通道始终没有出现，那这个动作很可能是**原生**的（§1.2）—— 不要再找 IPC 钩子了。

---

## 7. 真实鼠标输入（合成点击常被忽略）

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

屏幕坐标 = 窗口的 `GetWindowRect`（Win32）+ 元素在页面中的 `getBoundingClientRect()`，在
DPI 缩放为 1 时成立（Electron 渲染进程参数 `--device-scale-factor=1`）。**[实测]** `window.screenX/screenY` 可能是过期的 —— 点击前重新读一次 `GetWindowRect`。可以通过调用
`document.elementFromPoint(x - winLeft, y - winTop)` 并检查 `matches(":hover")`，来验证光标是否落在了目标元素上。

---

## 8. 能力 / 边界表 **[实测]**

| 目标 | 结论 |
|---|---|
| 改页面样式 / 注入 CSS | ✅ renderer 插件（主世界） |
| 覆盖 `window.open` | ✅ renderer 插件 |
| 拦截 `<a>` 点击 | ⚠️ 只对主世界的监听器有效；QQ 自己的触发器常在别处 —— 先探测 |
| 自己的配置/数据 | ✅ `LiteLoader.api.config.get/set` → `<profile>\data\<slug>\` |
| 打开浏览器 / 文件夹 | ✅ main 侧 `shell.*`、`LiteLoader.api.openExternal/openPath` |
| 观察窗口创建 / 显示 | ✅ `app.on('browser-window-created')`，包 `BrowserWindow.prototype.show/focus` |
| 阻止 QQ 打开内置浏览器，或它的"外部打开"图标 | ❌ 原生外壳（§1.2） |
| 替换页面里的 `window.ipcRenderer` | ❌ 被冻结的 contextBridge 对象 |
| 注入 `qqBrowser.html` | ✅ 只能用主进程 `webContents.executeJavaScript` |
| 阻止 QQ 更新 / 编辑它的文件 | ⚠️ RSA 校验；先警告用户、给出回滚、做好备份 |

---

## 9. 坑清单

1. **原生优先**：写代码前先查 QQ 自带设置（§1.1）。
2. **原生行为无法 hook**：先测量再设计（§1.2）。
3. **绝不要留下可重放的自测负载**：`eval.txt` 的重放两次卡死 QQ（§4）。
4. **不要推断有效性** —— 既要探测存在性，*也*要探测实际效果（§5）。
5. **选择器/属性会随版本漂移**：9.9.33 上 `.nav-item` 用的是 `aria-label`（**不是** `title`），且
   `.sidebar__nav` / `.sidebar__menu` / `.sidebar-nav` 同时存在 **[实测]** —— 每次更新后都要重新探测。
6. **重复 `slug`**：只有一个插件目录会被加载（§3.1）。
7. **`dependencies` 不安装任何东西**（§3.1）。
8. **共享 preload 噪声**：在辅助窗口里，每个插件都会打 `Cannot bind an API on top of an existing property on the window
   object`，而加载器自己的 `src/preload/module.js` 在 `screenshot.html` 中失败
   （`Cannot read properties of undefined (reading 'path')`）—— 这不是你的 bug **[实测]**。
9. **renderer 插件到不了 `qqBrowser.html`** —— 从 main 侧注入（§3.2）。
10. **假设有 DOM 的主进程插件会崩**：一个从**主**进程调用 `document.body.click()` 的插件，在每次菜单关闭时都抛
    `ReferenceError: document is not defined`，导致 QQ 的菜单状态错乱（菜单需要点三次；悬停闪烁：9 秒内先是
    `INFO [object Object]×4` 重复 6 次，紧接着 `UNCAUGHT_EXCEPTION`）**[实测]**。修法：改在 renderer/preload 世界里做。
11. **满屏覆盖层会抢点击**：某背景插件的 `<video id="background-video">` 以 `pointer-events: auto`（z-index -999）盖住
    整个窗口；`document.elementFromPoint(30,596)` 返回的是 video 而不是"更多"按钮，导致该按钮要点约 3 次。给那一层设置
    `pointer-events: none` 后修复 **[实测]**。同一个插件还把它 `<video>` 追加进一个隐藏容器（祖先是 `display:none`），
    所以它的背景从未显示出来；并且把它的工具栏按钮注入到第一个 `.func-menu`，而在 9.9.33 上那是
    *折叠的个人资料卡菜单*，不是可见的底栏 **[实测]**。
12. **辅助窗口可能先于你存在**：QQ 会预先创建一个 `qqBrowser` 窗口和池化的 `hiddenWindow`；要 hook
    `app.on('web-contents-created')`，**并且**在插件加载时遍历 `webContents.getAllWebContents()`。
13. **每次 QQ 更新之后**：新的应用根目录，stub + 签名补丁都必须重新应用（§2.5）。

---

## 10. 原生设置优先的实操（链接那个案子是怎么解决的）

目标是"所有链接都在系统浏览器中打开"。四版插件设计都失败了，因为 QQ 的链接打开是原生行为。
真正可用的答案是 QQ 的一个设置。如何从外部找到并拨动它：

```js
// in the Settings window (via the eval REPL): locate a labelled switch and read its state
(() => { const KEY = "使用系统默认浏览器打开网页";
  const leaf = [...document.querySelectorAll("*")].find(e => e.children.length === 0 && (e.textContent||"").trim() === KEY);
  if (!leaf) return "not this page";
  const item = leaf.closest(".panel-main") || leaf.parentElement.parentElement;
  const sw = item.querySelector(".q-switch[role=switch]");
  return sw ? { checked: sw.getAttribute("aria-checked") } : "no switch"; })()
```

翻转它的方式是：在 `.q-switch` 元素上依次派发 `pointerdown`/`mousedown`/`pointerup`/`mouseup`/`click`，然后
重读 `aria-checked`（一次调用里它就从 `false → true`）**[实测]**。告诉用户你改了哪个设置，以及如何改回去。

---

## 11. 与用户配合 —— 常用问询工具

大多数插件事实只能在用户**正在运行的**客户端上观察到。**要预期若干轮简短测试；不要试图一把做完。**

- **在 DSH（DeepSeek Harness）上**：调用 **`ask_user_question`** —— 它用于请求确认、做出选择或补齐缺失信息，
  并**等待**回答（默认阻塞）。每个问题提供 `id`、简短的 `header`、具体的 `question`，以及**带一行说明的
  options，推荐项放第一个**；当可能多选时设置 `multi_select: true`。用户也可以自由作答（`custom`）或跳过某一项。
  回答以 `{"answers":[{"id","selected","custom"}]}` 形式返回。**等待人类回答不消耗 token。** 变体：
  `mode: timed` + `timeout` 让模型在问题仍可回答的同时继续工作；`timeout: -1` 无限期等待。由另一个 agent
  拥有的存活子 agent **不能**提问 —— 它必须把未决问题写进自己的最终结果，好让主 agent/Lead 去问。
- **在其它 agent 平台上**：在你自己的环境里找一个等价能力（elicitation / human-in-the-loop 工具 /
  审批提示）；如果没有，就把确切的测试步骤和需要回报的内容写出来。
- **每轮一个小而决定性的测试。** 不是"请把所有东西都测一遍"，而是："点一个聊天里的链接，然后选
  ① 在我的系统浏览器中打开 ② 出现 QQ 的内置浏览器 ③ 什么也没发生"。
- **在动手前先说明会改变状态的步骤**（安装插件、打补丁、重启 QQ），并说明回滚方式。
- 把彼此独立的问题合并到一次调用里，并且在机制被证实之前持续提问。

---

## 12. 交付纪律

- 绝不写入个人数据（QQ 号、聊天内容、`rkey`/token、真实用户名、真实绝对路径 → 使用
  `<QQNT>` / `<app>` / `<profile>` 占位符）。
- 如果某份调试日志承载着你需要的证据，在它被轮转掉之前先复制出来（5 MB / 2 MB 上限）。
- 对任何绕过校验、注入代码或改动 QQ 文件的操作：先说明风险和回滚方式。
- 汇报**哪些是实测、哪些是推断**，以及涉及的准确 QQ 与加载器版本。

**交付前自检清单**

- [ ] 插件确实加载了（写入 `<profile>\data\<slug>\`，或出现在设置中）
- [ ] `errors.log` 里没有你引入的**新**错误（注意共享 preload 噪声）
- [ ] 你在其它插件里改动的任何东西，都用探针 1/3/4/5 针对*当前* DOM 验证过
- [ ] `eval.txt` 里没有留下可重放的自测负载
- [ ] 仓库、日志或截图中没有个人数据
- [ ] 任何对 QQ 自身文件的改动：已告知用户风险和回滚路径
- [ ] 已请用户验证用户可见的结果（§11）
- [ ] 上述一切之前，先检查过原生设置（§1.1）

---

**适用范围 / 可移植性**：本文是为 **DSH（DeepSeek Harness）** 的 agent 行为（工具名称、
`ask_user_question` 接缝、`eval.txt` 工作流）编写并实测的。它**未**在其它 agent 平台上测试过 ——
请先在你自己的环境里验证与平台相关的部分。
