---
name: qqnt-plugin-debug
description: >
  Debug a QQNT / LiteLoaderQQNT plugin on a live client: bundled dsh-debug-logger (console, exception,
  window-creation and IPC logs with 5 MB rotation), an element picker (Ctrl+Shift+C) that turns the thing the
  user points at into text, eval.txt REPL running JS in every window, DOM hit-test and visibility probes, IPC
  capture, real mouse input, and the measured pitfalls catalogue. Triggers: 界面哪个地方不对, 哪个控件要改,
  哪个按钮要调, 这块要优化, 这里要加东西, 我指的那个元素, 元素选择器, 插件不生效, 插件调试, QQNT 插件排错, eval.txt.
license: MIT
---

# QQNT —— 在运行中的客户端上调试插件

四个同系列 skill 之一：`qqnt-plugin-dev`（编写插件）、**`qqnt-plugin-debug`**（本 skill —— 让它跑起来）、
`qqnt-loader-install`（安装/打补丁）、`qqnt-capability-limits`（哪些东西根本够得着）。

**相对路径一律相对于本 skill 的 base directory 解析** —— 内置插件位于**本 skill 目录**下的
`plugins/dsh-debug-logger/`（Codex 会在加载时给出该技能的绝对目录）。无需任何网络拉取。

---

## 0. 免责声明 —— 开始前先发一次

**时机：** 在**当前对话**中第一次处理 QQNT 插件任务时发一次；新对话要重新发。

> **免责声明。** 本工作**仅用于软件架构与 JavaScript 注入技术的教育与研究**。使用即表示你接受：
> **不得违反软件保护法律**（不得对腾讯 QQ 构建版进行逆向工程、修改或分发修改后的版本）；不得构建或分享意在
> **侵入或非法控制计算机信息系统**的程序；不得侵犯腾讯的权利，包括著作权与技术保护措施；**不得用于商业用途**；
> 确保你对 QQ 客户端的使用**已获得正当授权**。作者对误用**不承担任何责任** —— **一切风险由使用者自负**。
> 在中国大陆，下列行为可能构成犯罪：① 提供侵入、非法控制计算机信息系统的程序、工具（刑法第 285 条第 3 款）；
> ② 侵犯著作权，包括规避技术保护措施（刑法第 217 条）；③ 破坏计算机信息系统（刑法第 286 条）。

**版本范围。** `[实测]` 事实验证于 **QQ NT 9.9.33-52230 + LiteLoaderQQNT 5.2.1 + Electron 40
（Chromium 144）+ Windows**（2026-10）。其它环境请先重新探测。

**提前告诉用户：这会分成几轮短交互** —— 见 §7。

---

## 1. 安装内置调试插件

```powershell
# <skill_dir> = 该技能的绝对目录（存放本 SKILL.md 的文件夹）
Copy-Item "<skill_dir>\plugins\dsh-debug-logger" "<profile>\plugins\dsh-debug-logger" -Recurse
```

然后**重启 QQ**（插件只在启动时加载一次）。验证：

- `<profile>\data\dsh-debug-logger\console.log` 的首行包含 `loaded v…`，或
- QQ 的设置列表里出现该插件（“DSH 调试日志”）。

**从 v1.4.0 起插件有两个 inject**：`main.js`（日志本体）与 `renderer.js` —— **元素选择器**（§3.0）。
必须复制**整个目录**；只拷 `main.js` 会静默丢掉选择器。v1.4.0 **没有改动 `main.js`**，所以日志首行仍自报
`loaded v1.3` —— 这个不一致是预期的，以 `manifest.json` 为准。

输出落在 `<profile>\data\dsh-debug-logger\`：

| 文件 | 内容 |
|---|---|
| `console.log` | 每个窗口的 console 输出（VERBOSE 已过滤）+ 主进程的 `console.error/warn` |
| `errors.log` | 只含 warn/error/assert/exception 行 —— **先读这个** |
| `eval-result.log` | `eval.txt` REPL 的执行结果 |
| `eval.txt` | **输入**：写在这里的 JS 会在**每个**窗口中执行 |
| 元素选择器 | `renderer.js`（v1.4.0）—— `Ctrl+Shift+C` 把界面元素点出来，见 §3.0 |

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
- **`eval.txt` 会在*每个*窗口同时执行 —— 因此变更性脚本会并发跑 N 次** **[实测]**：一次运行中窗口 A 写了配置，
  窗口 B 又写了另一个值，两者互相覆盖，读回值已经不可信。如果脚本必须改状态，就让它**显式识别自己是哪个窗口**
  并在其它窗口直接跳过，或者只让目标窗口动手：

  ```js
  // 显式窗口身份 —— 侧栏只存在于主窗口 [实测]
  // （用 IIFE，这样无论你的执行器是否允许顶层 return，这段代码都安全）
  (() => {
    if (!document.querySelector(".sidebar__nav")) return { skip: true, at: location.href };
    /* … 必须且只能执行一次的变更 … */
  })()
  ```

  注意这条规则是双向的：上面的身份判断是用来*决定在哪里执行变更*的。它**不是**存活探针 —— 见坑 14。
- 任何**点击、赋值、调用 IPC 方法、导航或改变 QQ 状态**的代码，必须在跑完后**立刻从
  `eval.txt` 中删除** —— 不要“留着下次用”。
- 为什么这不是可选项 **[实测]**：该插件过去每次 QQ 启动都会重放 `eval.txt` 里已有的内容；
  一个残留的“点链接”自测把 QQ 的首个窗口导航到了测试 URL，导致主界面始终起不来，QQ
  卡死两次（Windows AppHang）。插件现在把预先存在的内容视为已执行，只在文件被真实**写入**时运行 —— 但留在文件里的变更性脚本，距离一次疏忽的重启仍然只差一步。
- 结束一次会话前：清空 `eval.txt`。

**原型 → 打包 循环（每轮迭代不用重启）** **[实测]**：

1. 把准备发布的那段 renderer 逻辑写进 `eval.txt` —— 一秒内在主窗口跑起来。
2. 用**只读**探针验证（节点在不在、尺寸对不对、父节点对不对？见 §3 探针 5）。
3. 看起来对了，就把同一个文件复制到 `<profile>\plugins\<slug>\renderer.js`，配一个 `manifest.json`
   （`injects.renderer`），重启一次 QQ，在 `console.log` 里确认自己的日志行。
4. **清空 `eval.txt`**，别让原型被重放。

**热替换已装好的 UI 插件** **[实测]**：给注入的节点打版本标记（`btn.dataset.ver`），让 `install()` 先移除旧的标记节点，再把新代码贴进 `eval.txt` —— 运行中的客户端约 1 秒内换到新版本，不用重启。等代码定稿后再重启一次 QQ（那也是验证**打包版**而不是原型的时候）。

**要更新一个被 `import` 的 ESM 模块：重启 QQ，别跟缓存较劲** **[实测]**。`import()` 按 URL 缓存模块，所以磁盘上的
文件改了、拿回来的还是旧模块。最直觉的绕法 —— 加查询串破缓存
`import("local://profile/plugins/my-plugin/x.js?v=" + Date.now())` —— 在沙箱窗口里**会失败**：在 `about:blank`
窗口里它抛出 `Access to script … blocked by CORS policy … only supported for protocol schemes: cacheimg, chrome, …`。
`local://` 资源在那类窗口里根本不可用。对一个确实需要反复迭代的模块，可靠循环是：改文件 → **重启 QQ** → 验证。
把「快速迭代」留给*实现本身*（贴进 `eval.txt`，它每次写入都会重新求值，不受 ESM 缓存影响），把重启留给打包好的文件。

## 3. 探针（只读 —— 写进 `eval.txt`）

### 3.0 元素选择器 —— 交给用户去点，别替他写探针 **[实测]**

`renderer.js`（v1.4.0）是一个类 Chrome DevTools 的拾取器，用来一次点击回答「这个框是谁画的、它叫什么、多大、
圆角多少、命中了哪些规则」。**它是给坐在键盘前的人做的，不是给你（agent）驱动的工具**：点一下就把完整详情
（类名 / 尺寸 / 圆角 / 背景 / **命中的 CSS 来源规则**）自动复制到剪贴板，并弹一个气泡提示。这正是它的用意 ——
**用户负责指，答案以文本形式交到你手里**。

**所以默认动作是：让用户去用它，然后把结果贴回来 —— 不要自己重写一个探针代替它。** 这就是 §7 用在元素问题上：

> 「在主界面按 `Ctrl+Shift+C`，点那个看着不对的东西，然后把剪贴板里的内容贴给我（它会自动复制）。」

这一轮问答就能替你省掉好几轮"照着截图猜选择器"。自己写 `elementFromPoint` / 命中测试探针反而是慢路径，而且
**常常是错的**：拾取器给的是*命中的 CSS 来源规则*，原始命中测试给不出这个。

**你也可以直接从日志文件里读，连用户粘贴都不需要 **[实测]** —— 每次选中都会往
`<profile>/data/dsh-debug-logger/console.log` 追加一行带前缀 `[dsh-picker:json]` 的 JSON，抓最后一行即可：

```powershell
Select-String -Path "<profile>\data\dsh-debug-logger\console.log" -Pattern "dsh-picker:json" | Select-Object -Last 1
```

**在信任这行之前必须知道的坑 **[实测]**：本插件是通过 `wc.on("console-message")` 转发渲染进程 console 的，
而 Chromium 传给该事件的 message 是**已经序列化过的字符串** —— 直接 `console.log(对象)` 在日志里只会变成字面的
`[object Object]`（人可读的 `[dsh-picker]` 那两行**不含字段**）。所以选择器**额外**打了一行 `JSON.stringify` 的结果。
你自己写任何日志转发时，同样要处理这一点。

只在用户没法操作时才退回自己写探针（没有图形界面、无人值守运行），并且 §2 的只读铁律依然适用。

| 操作 | 效果 |
|---|---|
| `Ctrl+Shift+C` | 进入/切换拾取模式（也可在插件设置页点「开始抓取」） |
| 鼠标划过 | 蓝框高亮 + 顶部标签显示 `选择器 宽x高 r=圆角` |
| 点击 | 选中；把类名、尺寸、圆角、背景和**命中的 CSS 来源规则**输出到 console |
| **按住 `Ctrl` 点击** | 多选（再次 Ctrl 点击同一元素 = 反选） |
| 选中之后 | 详情**自动复制到剪贴板**，并弹气泡确认 |
| `Ctrl+Shift+X` | 再复制一次最近选中的内容 |
| `Ctrl+Shift+B` | 拖框：列出框内元素（输出到 console） |
| `Ctrl+Esc` | 逐级退出：拾取 → 拖框 → 关工具 |

**退出键必须是 `Ctrl+Esc` 而不是 `Esc`** **[实测]**：QQ 自己用 `Esc` **关窗口**，占用它就意味着「想退出调试
反而把窗口关了」。同一个功能里还有第二个坑：`KeyboardEvent.key` 的值是 `"Escape"`，而用户和配置习惯写
`"Esc"` —— 早期版本直接做字符串比较，于是 `Ctrl+Esc` **永远匹配不上**，退出键看起来完全没反应（提示条一直挂在
屏幕上关不掉）。所以必须做按键别名归一化（`esc`/`escape`、`del`/`delete`、`space`）。

**可自定义、无需重启**：QQ 设置 → 插件 → DSH 调试日志 → 自定义快捷键 —— 点一下输入框直接按组合键即可
（单独按 `Esc` 取消录制）；也可以用代码 `window.__dshPicker.setHotkeys({ pick: "F8" })` / `getHotkeys()`。
改完立即生效，走的是与配置同步同一条 `storage` 事件通道。

如果你要自己重做这套交互，两个实测坑必须先知道：

1. **剪贴板是双路径兜底。** `navigator.clipboard.writeText` 在 QQ 窗口里会抛
   `NotAllowedError: Document is not focused`（Electron 40 要求文档有焦点），所以拾取器先试 Clipboard API，
   失败**立刻**退到 `document.execCommand("copy")` —— **实测后者在失焦窗口里有效**。不要假设单条路径够用。
2. **`local://profile/...` 与 `local:///...` 是两个不同的模块实例。** 如果你在 `eval.txt` 探针里自己
   `import()` 拾取器，拿到的是**第二份实例**，它有自己的状态 —— 它会另外建一层覆盖层并操作那一层，而屏幕上
   正在跑的那个纹丝不动。要用页面**自己的**实例 `window.__dshPicker`（存活标志是
   `window.__dshPickerOn` / `__dshPickerBooted`）。

覆盖层卫生，与任何全屏层一样（见坑 10）：默认 `pointer-events: none`，**只在**拾取/拖框时 `auto` 并立刻恢复；
拖框模式拖完一次自动退出 —— 否则覆盖层会吞掉 QQ 的全部点击，用户只看到界面莫名其妙点不动。

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
14. **选择器不存在 ≠ 窗口已死 —— 绝不要用元素存在性做存活探针** **[实测]**。曾用
    `if (!document.querySelector(".sidebar__nav")) return {skip:true}` 来判断「这个窗口没响应」；但 QQ 路由切到
    `#/main/message` 时侧栏会短暂卸载，于是**健康**窗口也报 `skip`。这个假读数让我**两次**错误地宣布主窗口被卡死。
    要判断窗口是否存活，应让*窗口自己*打日志（`console.error("[probe] here", …)`），再看 `console.log` 里有没有出现
    那一行 —— 那才是来自窗口内部的**正向**信号。元素不存在只能说明你查看的那一瞬间 DOM 的状态。
15. **`eval.txt` 会在每个窗口并发执行** —— 变更性脚本会跑 N 次，窗口之间还可能互相覆盖写入（§2）。给脚本加显式的
    窗口身份守卫，或把它限制在单个窗口。如果读回值自相矛盾，先怀疑这一点，再怀疑 QQ。
16. **`local://` 在沙箱窗口里不可用** —— 在 `about:blank` 窗口里
    `import("local://profile/…/x.js?v=" + Date.now())` 会因 CORS 策略报错（§2）。要更新 ESM 模块，重启 QQ。
17. **矩形非零 ≠ 元素可见 —— 虚拟列表里藏着隐藏的测量副本** **[实测]**。QQ 的虚拟列表（`.viewport-list`）在
    `.viewport-list__measure` 里留了一份**测量副本**，它带着**同一个** `.recent-contact-item` 类：
    `visibility: hidden`（仍占位，`getBoundingClientRect()` 完全非零），而且宽度是**整行宽** —— 实测
    1029×72 @ (56,92)，旁边的真实行是 304×72 @ (64,100)。于是它躲过了你通常会写的**每一道**几何守卫：
    最小尺寸（`>10px`）、尺寸上限（`MAX_TARGET = 2000`，1029 < 2000 永远触发不了）、`Number.isFinite` 的 NaN
    检查、视口外过滤（它就在视口内）。按几何遍历元素时的症状：一个**不会随列表滚动的巨型圆角框**。必须补一道
    可见性守卫，而且要**顺便复用本来就要做的那次样式读取**：在同一轮里读 `getComputedStyle(el)` 拿
    `borderTopLeftRadius`，然后 `if (cs.visibility === "hidden") continue;`。只读元素**自己的** `visibility`
    （父级隐藏而自身 `visibility: visible` 的元素确实可见；`display: none` 是零矩形，已被最小尺寸挡掉）。
    探针：列出所有命中项的 `w / h / left / visibility / parent.className`，宽度明显大于同级兄弟的那个就是它。
    这也是调试模块自身踩过的坑 —— 见 `examples/lens-skin/LESSONS.md` 第 19 条。
18. **规则没匹配 ≠ 规则被覆盖 —— 先证明选择器能命中，再怀疑优先级** **[实测]**。Lens 皮肤里所有规则都写成
    `body.q-theme-tokens-light …`，于是暗色主题（`q-theme-tokens-dark`）下**一条都匹配不上**，整套皮肤静默消失 ——
    看起来像「插件死了」，而不是 CSS bug。动优先级之前，先用 `querySelectorAll(sel).length` 量命中，并在**两种主题
    下各测一次**计算值。同一族的问题：QQ 的原生行背景画在**子元素**上
    （`.recent-contact-item--top .item__content`，用 `--overlay_top` 上色且 `border-radius: 0`），所以只给父元素加
    圆角，子元素的方角会"露"出来 —— 用选择器（§3.0）先确认**到底是谁在画这块底**，然后父子一起收边。

## 7. 与用户配合（问询）—— 多用问询工具

大多数事实只有在你用户**正在运行**的客户端上才能观察到。**预期会有好几轮短交互；不要试图一次做完。**

**不要用自己的探针读数宣布完成。** 你的探针回答的是「DOM 变了吗」，不是「人用起来行不行」；
**用户的一次真实操作经常能发现探针测不出的问题**（开关永远不重绘、声音根本不出、点击落下了但用户在意的事情没发生）。
凭一个绿色探针就汇报「完成」，正是坏插件被发出去的方式 —— 请让用户执行那个动作并描述他**实际看到**了什么，
把用户的观察当作结论，而不是你仪器的读数。

- **在 Codex 上**：当本次会话提供 **`request_user_input`** 工具时，优先用它。它一次呈现 1–3 个问题，
  每个问题 2–3 个互斥选项 —— 把推荐项放第一位，并给它的标签加上 `(Recommended)` 后缀；客户端会自动
  追加一个自由填写的 **Other** 选项。**只有单选，没有多选。** 提问**就是阻塞的**：只有用户作答后，本轮
  才会继续；Codex 侧没有观察到非阻塞（带过期时间）的形态，别指望提问后还能继续干活。**能不能用取决于模式**：
  只有 Plan 模式能真正调用；Default 模式下即使它仍出现在工具列表里，调用也会直接失败（返回
  `request_user_input is unavailable in Default mode`），而不是弹出选项。**不要因为它在列表里就以为能问。**
  调用失败或工具确实不存在时，退回到**一次只问一个**简洁的纯文本问题（绝不要写成选择题形式），并附上确切的
  测试步骤与需要回报的内容。
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
- **元素问题：把用户送去用拾取器（§3.0），不要替他探。** 它会自动复制到剪贴板并弹气泡，所以一个来回各一句话即可：
  「按 `Ctrl+Shift+C`，点那个看着不对的东西，把剪贴板里的内容贴给我」。用户贴回来的就是证据 —— 里面包含**命中的
  CSS 来源规则**，这是命中测试探针给不出的。
- **变更性步骤先说再做**（安装插件、改文件、重启 QQ），并说明回滚方式。
- 把相互独立的问题合并到一次调用里，并且在机制尚未被证实前持续发问。
