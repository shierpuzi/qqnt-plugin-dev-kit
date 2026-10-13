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

# QQNT —— 在运行中的客户端上调试插件

四个同系列 skill 之一：`qqnt-plugin-dev`（编写插件）、**`qqnt-plugin-debug`**（本 skill —— 让它跑起来）、
`qqnt-loader-install`（安装/打补丁）、`qqnt-capability-limits`（哪些东西根本够得着）。

**相对路径一律相对于本 skill 的 base directory 解析** —— 内置插件位于**本 skill 目录**下的
`plugins/dsh-debug-logger/`（DSH 会在 `skill_resources` 块中打印 base directory）。无需任何网络拉取。

---

## 0. 免责声明 —— 开始前先发一次

**时机：** 在**当前对话**中第一次处理 QQNT 插件任务时发一次；新对话要重新发。

> **免责声明。** 本工作**仅用于软件架构与 JavaScript 注入技术的教育与研究**。使用即表示你接受：
> **不得违反软件保护法律**（不得对腾讯 QQ 构建版进行逆向工程、修改或分发修改后的版本）；不得构建或分享意在
> **侵入或非法控制计算机信息系统**的程序；不得侵犯腾讯的权利，包括著作权与技术保护措施；**不得用于商业用途**；
> 确保你对 QQ 客户端的使用**已获得正当授权**。作者对误用**不承担任何责任** —— **一切风险由使用者自负**。
> 在中国大陆，下列行为可能构成犯罪：① 提供侵入、非法控制计算机信息系统的程序、工具（刑法第 285 条第 3 款）；
> ② 侵犯著作权，包括规避技术保护措施（刑法第 217 条）；③ 破坏计算机信息系统（刑法第 286 条）。

**版本范围。** `[实测]` 事实验证于 **QQ NT 9.9.33-52230 + LiteLoaderQQNT 5.2.1 + Electron 40 +
Windows**（2026-10）。其它环境请先重新探测。

**提前告诉用户：这会分成几轮短交互** —— 见 §7。

---

## 1. 安装内置调试插件

```powershell
# <skill_dir> = the base directory DSH reported for this skill
Copy-Item "<skill_dir>\plugins\dsh-debug-logger" "<profile>\plugins\dsh-debug-logger" -Recurse
```

然后**重启 QQ**（插件只在启动时加载一次）。验证：

- `<profile>\data\dsh-debug-logger\console.log` 的首行包含 `loaded v…`，或
- QQ 的设置列表里出现该插件（“DSH 调试日志”）。

输出落在 `<profile>\data\dsh-debug-logger\`：

| 文件 | 内容 |
|---|---|
| `console.log` | 每个窗口的 console 输出（VERBOSE 已过滤）+ 主进程的 `console.error/warn` |
| `errors.log` | 只含 warn/error/assert/exception 行 —— **先读这个** |
| `eval-result.log` | `eval.txt` REPL 的执行结果 |
| `eval.txt` | **输入**：写在这里的 JS 会在**每个**窗口中执行 |

它还会捕获 `preload-error`、`uncaughtException` / `unhandledRejection`、`render-process-gone`、
`did-fail-load`、`web-contents-created`、窗口 `CREATED` 以及
`SHOW/show|showInactive|focus|restore|moveTop`（含调用栈），外加一个可选的、经过过滤的 `ipcMain` 频道日志。

**轮转：** 任何超过 **5 MB** 的日志文件会被重写，从行边界保留最后 **2 MB**，并加上前缀
`[已截断，仅保留最近 2 MB]`。如果某个日志里有你需要的证据，**先把它拷出来再让它轮转**。

在 `<profile>\data\LiteLoader\config.json` 的 `disabled_plugins` 中加入 `dsh-debug-logger` 即可禁用它（或使用
QQ 的插件设置）。

## 2. `eval.txt` REPL —— 以及只读/变更性分界

往 `eval.txt` 写一条 JS 表达式；约 1 s 内它会在**每个**窗口里执行，结果以 `--- [<url>] => <json>` 追加到
`eval-result.log`。

**只读 vs. 变更性 —— 防止客户端卡死的规则：**

- §3 的探针都是**只读的**（它们只检查 DOM/bridge 并返回数据）。把它们留在
  `eval.txt` 里是安全的。
- 任何**点击、赋值、调用 IPC 方法、导航或改变 QQ 状态**的代码，必须在跑完后**立刻从
  `eval.txt` 中删除** —— 不要“留着下次用”。
- 为什么这不是可选项 **[实测]**：该插件过去每次 QQ 启动都会重放 `eval.txt` 里已有的内容；
  一个残留的“点链接”自测把 QQ 的首个窗口导航到了测试 URL，导致主界面始终起不来，QQ
  卡死两次（Windows AppHang）。插件现在把预先存在的内容视为已执行，只在文件被真实**写入**时运行 —— 但留在文件里的变更性脚本，距离一次疏忽的重启仍然只差一步。
- 结束一次会话前：清空 `eval.txt`。

## 3. 探针（只读 —— 写进 `eval.txt`）

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

**用可观测的结果判断“是否生效”** —— 用 `querySelectorAll(sel).length` 判断是否命中，用
`getBoundingClientRect()` 判断效果 —— **绝不**凭选择器*看起来*对不对下结论。一次真实会话曾凭属性名的推测判定插件
已死；探针 5 证明它一直工作正常 **[实测]**。

## 4. 抓取 IPC

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

一个有用的校准 **[实测]**：QQ 自身打开链接的动作**不经过** 59 个 invoke + 15 个 `on` 频道中的任何一个，所以如果你
期待的频道始终没有出现，该行为大概率是原生实现的 —— 去看 `qqnt-capability-limits`，而不是继续深挖。

**这类代码放哪里：** 调试插件只在渲染进程窗口中求值。要给**主进程**装探针，就把它写进一个一次性小插件的
`main.js`（或临时写进调试插件自己的 `main.js`）并重启 QQ —— 捕获到的行会进 `console.log`，因为主进程的
`console.error` 已被捕获。

## 5. 真实鼠标输入（合成点击常被忽略）**[实测]**

QQ 会忽略或错误处理某些合成的 `click()` 调用 —— 它的触发逻辑往往位于 preload 的 isolated world 或原生代码里。
当用户的真实点击有效、而你脚本化的点击无效时，注入真实输入：

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

屏幕坐标 = 窗口的 `GetWindowRect` + 元素在页面中的 `getBoundingClientRect()`，在 DPI 缩放为 1 时成立。
`window.screenX/screenY` 可能已**过期** —— 点击前重新读一次 `GetWindowRect`。用
`document.elementFromPoint(x - winLeft, y - winTop)` 和 `.matches(":hover")` 确认光标落在了你瞄准的位置。

## 6. 坑清单（全部 `[实测]`）

1. **原生优先**：写代码之前先检查 QQ 自己的设置（`qqnt-capability-limits`）。
2. **绝不要在 `eval.txt` 里留下可重放的自测载荷**（§2）。
3. **不要凭推测判断有效性** —— 既探测存在性，也探测效果（§3 探针 5）。
4. **选择器/属性会随版本漂移**：9.9.33 上 `.nav-item` 用的是 `aria-label`（**不是** `title`），而且
   `.sidebar__nav` / `.sidebar__menu` / `.sidebar-nav` 同时共存。每次 QQ 更新后都要重新探测。
5. **`slug` 重复**：两个插件文件夹使用同一个 slug → 只有一个会加载（扫描时后到的那个）。
6. **`dependencies` 不安装任何东西** —— 它只决定加载顺序。
7. **共享 preload 的噪声不是你的 bug**：每个插件在辅助窗口里都会打印
   `Cannot bind an API on top of an existing property on the window object`，而加载器自己的
   `src/preload/module.js` 会在 `screenshot.html` 中失败（`Cannot read properties of undefined (reading 'path')`）。
8. **渲染进程插件永远够不到 `qqBrowser.html`**（QQ 内置浏览器的 chrome 页）—— 要从主进程用
   `executeJavaScript` 注入。
9. **主进程代码没有 DOM**：一个从**主进程**调用 `document.body.click()` 的插件在每次菜单关闭时抛出
   `ReferenceError: document is not defined`，并把 QQ 的菜单状态搞乱（菜单需要点三次；悬停进入循环闪烁 ——
   9 s 内出现 6 次 `INFO [object Object]×4` 紧接着 `UNCAUGHT_EXCEPTION`）。DOM 操作要在渲染进程/preload 世界里做。
10. **全屏覆盖层会偷走点击**：一个背景插件的 `<video id="background-video">` 以 `pointer-events: auto`
    （z-index -999）盖住整个窗口，于是 `elementFromPoint` 返回的是这个 video 而不是“更多”按钮，那个按钮需要点约 3 次。
    在该层上设 `pointer-events: none` 后修复。同一个插件还把它的 `<video>` 追加进一个 `display:none` 容器
    （所以背景从来没显示过），并把工具栏按钮注入到第一个 `.func-menu` —— 而在 9.9.33 上那是**收起状态的个人卡片菜单**，
    不是可见的底栏。
11. **辅助窗口可能先于你的插件存在**：QQ 会预创建一个 `qqBrowser` 窗口和若干池化的 `hiddenWindow` ——
    既要 hook `app.on('web-contents-created')`，**也要**在加载时遍历 `webContents.getAllWebContents()`。
12. **让证据抗轮转**：在 5 MB→2 MB 轮转把你关心的行丢掉之前，先把 `console.log` / `errors.log` 拷出来。
13. **沉默的插件不等于坏掉的插件**：`setInterval` + `querySelector` 这类写法会把选择器未命中完全吞掉。
    永远把“是否命中”的计数和“是否改变了什么”的测量放在一起。

## 7. 与用户配合（问询）—— 多用问询工具

大多数事实只有在你用户**正在运行**的客户端上才能观察到。**预期会有好几轮短交互；不要试图一次做完。**

- **在 DSH（DeepSeek Harness）上**：调用 **`ask_user_question`** —— 它用于请求确认、让用户做选择或补齐缺失信息，
  并**等待**回答（默认阻塞）。每个问题提供 `id`、简短的 `header`、具体的 `question`，以及**带一句话说明的
  `options`，推荐项放第一位**；当可能多选时设 `multi_select: true`。用户也可以用 `custom` 自由作答，或跳过某一项。
  答案以 `{"answers":[{"id","selected","custom"}]}` 返回。**等待人类回答不消耗 token。** 变体：
  `mode: timed` + `timeout` 让你在问题仍可回答的同时继续干活；`timeout: -1` 无限期等待。由其它 agent 拥有的
  存活子 agent **不能**提问 —— 它必须把未决问题写进自己的最终结果，由主 agent/Lead 来问。
- **在其它 agent 平台上**：检查你自己的环境里有没有等价能力（elicitation / human-in-the-loop 工具 /
  审批提示）；如果没有，就写出确切的测试步骤以及需要回报什么。
- **一轮一个小而决定性的测试。** 不是“请把所有东西测一遍”，而是：“点一个聊天里的链接，然后选
  ① 用我的系统浏览器打开 ② 出现 QQ 内置浏览器 ③ 什么都没发生”。
- **变更性步骤先说再做**（安装插件、改文件、重启 QQ），并说明回滚方式。
- 把相互独立的问题合并到一次调用里，并且在机制尚未被证实前持续发问。
