# 黑盒调试 QQ 插件：方法论与案例复盘

> **适用范围与版本：实测于 QQ NT 9.9.33-52230 + LiteLoaderQQNT 5.2.1 (2026-10)**
> 没有 devtools、没有源码、文档缺失时的完整排查方法。所有结论标注证据：**哪条日志、哪个探针、哪次计数**。

相关文档：

| 想知道什么 | 去哪 |
|---|---|
| 调试插件怎么装、能抓什么、日志字段与轮转详解 | [`../plugins/dsh-debug-logger/README.md`](../plugins/dsh-debug-logger/README.md)（**本文不重复安装步骤**） |
| QQ 9.9.33 目录/校验/加载器/原生与 JS 边界 | [qqnt-internals.md](qqnt-internals.md) |
| 从零写插件（manifest v4 / 三种注入 / API） | [plugin-development.md](plugin-development.md) |
| 最短上手路径 / 硬规则速查 | [`../AGENT_README_ZH.md`](../AGENT_README_ZH.md) |

---

## 1. 方法论总览：先观测，再改代码

```text
① 装调试插件（plugins/dsh-debug-logger/）          → 见该插件 README §3
② 确认活着：console.log 首行 "loaded v…"
③ 看 errors.log：有没有你引入的报错（辅助窗口的公共噪声见 qqnt-internals.md §6.3）
④ 要问页面的事实 → 探针（写 eval.txt，看 eval-result.log）   ← 本方法论的主体
⑤ 要问主进程的事实 → 探针 + 包 IPC / 包 BrowserWindow / 包 shell
⑥ 只在拿到证据后才改插件代码；改完重启 QQ 复验
```

**为什么必须"先观测"**：QQ 升级会静默改 class、`aria-label`、事件触发层。凭旧版经验写选择器，最典型的后果是**插件完全静默失效、且不报任何错**（见 §8.4）。跑一次探针的成本，远低于盲改四轮。

三条最容易踩的坑（本文后面都有专节）：

1. **合成 `click` 不触发 QQ 的某些处理器**（§3.3 ⑥ / §5）。
2. **`eval.txt` 里留下的脚本会被重放**，能把 QQ 搞死（§7）。
3. **探针在所有窗口都执行**，不写窗口判断就会拿到一堆无关结果（§3.1）。

---

## 2. 工具：`plugins/dsh-debug-logger`

本仓库自带、**实际在用**的排查插件。它把三类信息落盘，是本文所有探测的基础设施：

| 能力 | 一句话 |
|---|---|
| 主进程 + 所有渲染进程 `console` | 带来源 URL 与行号；跳过 `VERBOSE` 噪声 |
| `preload-error` / `uncaughtException` / `unhandledRejection` | 插件加载失败、未捕获异常，这是排障第一现场 |
| 窗口追踪（带**调用栈**） | `browser-window-created` + 包 `BrowserWindow.prototype.show/showInactive/focus/restore/moveTop` —— 专抓"自己弹出来的窗口" |
| 可选 IPC 频道记录 | 包装 `ipcMain.emit`，只记频道名命中 `/chat|aio|window|show|open|session|switch|focus|activate|recent|contact/i` 的调用，同一 `频道+来源 URL` 1.5 秒去重 |
| 迷你 devtools（eval 通道） | §3 |
| **元素选择器**（v1.4 新增） | **§2.1** —— 不用写探针，直接点出屏幕上的元素 |

日志目录 `<profile>/data/dsh-debug-logger/`，四个文件（`console.log` / `errors.log` / `eval-result.log` / `eval.txt`），每个输出文件**超过 5 MB 就截断、只保留尾部 2 MB**（从整行边界开始，并在开头插入 `[已截断，仅保留最近 2 MB]`）。

> 字段含义、行格式、IPC 关键词白名单、安装与停用步骤：**全部以 [`../plugins/dsh-debug-logger/README.md`](../plugins/dsh-debug-logger/README.md) 为准**，本文不复制。
> 轮转有个实用后果：**要长期留证就先复制走**。本次调试中 `native-menu` 那段异常日志就是被轮转丢掉了，导致无法事后复核（§8.3）。

### 2.1 元素选择器：先"点出来"，再决定要不要写探针

v1.4 起插件带一个类 Chrome DevTools 的元素选择器。**排障顺序建议先用它**：写探针要先假设"该问什么"，而点火柴看不如直接照亮 —— 多数"这个框是谁画的"问题，点一下就清楚了。

| 操作 | 效果 |
|---|---|
| 主界面 `Ctrl+Shift+C` | 进入/切换拾取模式（设置页也提供「开始抓取」按钮） |
| 鼠标划过 | 蓝框高亮 + 顶部显示 `选择器 宽x高 r=圆角` |
| 点击 | 选中，并把类名 / 尺寸 / 圆角 / 背景 / **样式来源规则**（哪个样式表、哪条选择器）输出到 console |
| `Ctrl`+点击 | 多选（再次 `Ctrl` 点击同一元素 = 反选） |
| 选中后 | 详情**自动复制到剪贴板** + 气泡提示 |
| `Ctrl+Shift+X` | 再复制一次 |
| `Ctrl+Esc` | 逐级退出（拾取 → 框选 → 关工具） |

三个实测要点（都是踩出来的）：

1. **退出键是 `Ctrl+Esc`，不是 `Esc`**。QQ 自己用 `Esc` 关窗口；占用它会变成"想退出调试反而把窗口关了"。另一个更隐蔽的坑：`KeyboardEvent.key` 的实际值是 `"Escape"`，而配置里习惯写 `"Esc"` —— **直接做字符串比较会永远匹配不上**，必须过一层键名别名（`Esc→escape`、`Del→delete`、`Space→" "` 等）。
2. **剪贴板要走双路径**。`navigator.clipboard.writeText` 在 QQ 里会抛 `NotAllowedError: Document is not focused`（Electron 要求文档有焦点）。所以要退到 `document.execCommand("copy")` —— 实测该退路对失焦窗口有效。
3. **`local://profile/...` 与 `local:///E:/...` 是两个不同的模块实例**。用 `eval.txt` 写探针时，请用页面自己的实例（如 `window.__dshPicker`）而不要自己 `import`：否则你操作的是另一份状态，还可能多建一层覆盖层，把结论带偏。

> 选择器的完整用法与自定义快捷键接口见 [`../plugins/dsh-debug-logger/README.md`](../plugins/dsh-debug-logger/README.md) §5。

---

## 3. 迷你 devtools（eval 通道）

### 3.1 怎么工作（实测）

```text
你写 <profile>/data/dsh-debug-logger/eval.txt
   ↓ 插件每秒轮询一次（setInterval 1000ms）
   ↓ 内容变化才执行（与上次执行过的内容比较，去掉首尾空白）
webContents.getAllWebContents().forEach(wc => wc.executeJavaScript(code, true))
   ↓ 每个窗口一条结果
追加到 <profile>/data/dsh-debug-logger/eval-result.log
   格式：--- [<窗口 url>] => <返回值 JSON，最长 4000 字符>
   失败：--- [<窗口 url>] EXEC_FAIL <错误信息>
```

关键点：

- **执行时机是"内容变化"**，不是"文件时间戳"。所以**要重复执行同一段代码，必须让内容真的变**（改个字符串、加一行注释、把自测序号 `/* probe-3 */` 递增）。纯空白差异不算。
- **启动时不重放已存在的内容**。插件启动那一刻若 `eval.txt` 已存在，其内容会被记为"已执行过"。这是**修 bug** 的结果，见 §7。
- 第二参数 `userGesture = true`，所以 `executeJavaScript` 带用户手势（某些 API 才可用）。
- 通道会在**所有窗口**执行，包括 webview 宿主、截图窗口、内置浏览器。

### 3.2 探针书写约定（强烈建议）

```js
/* probe-07-hit-test */            // ① 标记 + 自测序号：既是"内容变化"的键，也方便在结果里定位
(() => {
  if (location.hash.indexOf("/main") < 0) return { skip: true };   // ② 窗口判断，别在无关窗口里瞎跑
  // ③ 只返回字符串/数字/普通对象/数组（JSON 可序列化）
  const el = document.elementFromPoint(30, 596);
  return { url: location.href.slice(0, 60), hit: el ? el.tagName + "." + String(el.className).slice(0, 40) : null };
})()
```

- 判断"主窗口"用 `location.hash.indexOf("/main") >= 0`；判断"内置浏览器页"用 `location.pathname.indexOf("qqBrowser") >= 0` 或 `document.querySelector('[dt-pgid="pg_bas_built_in_browser"]')`。
- **返回值要能被 JSON 序列化**。实测踩过一次：探针返回后日志里全是

  ```text
  --- [app://./renderer/index.html] EXEC_FAIL An object could not be cloned.
  ```

  8 个窗口全部失败。原因不在探针逻辑本身，而是返回值/时机不满足结构化克隆（当时多个窗口正在导航）。结论：**返回值优先 `JSON.stringify(...)` 成字符串**，最稳；不要把 DOM 节点、函数、Proxy 直接返回。
- URL 里可能带 `uin=` 等个人数据（如 `screenshot.html`），**别把原始 URL 抄进仓库**。

### 3.3 六个实用探针（均可在 `eval-result.log` 里找到成功运行记录）

#### ① 命中测试：谁挡住了按钮

"按钮点不到 / 要点好几次"这类问题**第一个**用这个。

```js
/* probe-hit */
(() => {
  if (location.hash.indexOf("/main") < 0) return { skip: true };
  const x = 30, y = 596;                       // 目标点的视口坐标（CSS px）
  const el = document.elementFromPoint(x, y);
  if (!el) return { x, y, hit: null };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const chain = document.elementsFromPoint(x, y).slice(0, 5)
    .map(e => e.tagName + "." + String(e.className).slice(0, 30));
  return { x, y, hit: el.tagName + "." + String(el.className).slice(0, 50),
           pointerEvents: cs.pointerEvents, zIndex: cs.zIndex,
           rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
           stack: chain };
})()
```

要点：`elementFromPoint` 给**最上层**命中者；`elementsFromPoint` 给整摞（顺序=从上到下），定位"谁遮住了谁"更有用。别忘了同时读 `pointer-events` 与 `z-index`。

#### ② 枚举"桥接对象"：这个窗口里挂了哪些 API

用来回答"这个功能有没有 JS 入口""别人家插件暴露了什么"。

```js
/* probe-bridge */
(() => {
  if (location.hash.indexOf("/main") < 0) return { skip: true };
  const SKIP = { window:1, self:1, document:1, location:1, customElements:1, history:1,
                 navigation:1, frames:1, top:1, parent:1, navigator:1, external:1, screen:1,
                 performance:1, crypto:1, indexedDB:1, localStorage:1, sessionStorage:1,
                 CSS:1, console:1, visualViewport:1 };
  const hits = [];
  for (const k of Object.keys(window)) {
    if (SKIP[k]) continue;
    let v; try { v = window[k]; } catch (e) { continue; }
    if (!v || typeof v !== "object") continue;
    const fns = Object.keys(v).filter(f => { try { return typeof v[f] === "function"; } catch (e) { return false; } });
    if (fns.length) hits.push({ k, n: fns.length, fns: fns.slice(0, 20) });
  }
  return { url: location.href.slice(0, 50), n: hits.length, hits: hits.slice(0, 30) };
})()
```

实测返回（`eval-result.log`，主窗口）：命中 **30 个**这样的对象，包括加载器/各插件暴露的桥接：`anti_recall`、`audio_sender`、`euphonyNative`、`LLCUM`、`LLASM`、`background_plugin`（30 个方法）、`custom_css`、`fuck_sidebar`、`gpt_reply`、`link_preview`、`ListViewer`、`lite_tools`（30 个方法）等。
`SKIP` 那一坨是**必须**的：不过滤的话 `window`/`document`/`self` 这些会刷满结果，真正有用的桥接对象被挤掉。

#### ③ 打印某窗口的 DOM（按 class/aria/title 过滤）

```js
/* probe-dom */
(() => {
  const info = e => ({ tag: e.tagName, cls: String(e.className).slice(0, 44),
                       t: (e.getAttribute("title") || "").slice(0, 24),
                       a: (e.getAttribute("aria-label") || "").slice(0, 24),
                       txt: (e.textContent || "").trim().slice(0, 16) });
  return {
    url: location.href.slice(0, 90),
    nodes: document.querySelectorAll("*").length,
    titled: [...document.querySelectorAll("[title],[aria-label]")].map(info).slice(0, 30),
    webviews: [...document.querySelectorAll("webview,iframe")].map(w =>
      ({ tag: w.tagName, src: String(w.src || "").slice(0, 60), cls: String(w.className).slice(0, 20) })),
    bodyHead: document.body ? document.body.innerHTML.replace(/\s+/g, " ").slice(0, 700) : null
  };
})()
```

`titled`（只挑带 `title`/`aria-label` 的元素）是性价比最高的一招：QQ 大量用它们标注按钮语义，一下就能看清一个页面的骨架。`nodes` 计数可用来判断"这个页面根本没渲染"（实测内置浏览器页是 104，错误页 19）。

#### ④ 看窗口 / 标签结构（以 QQ 内置浏览器为例）

```js
/* probe-qqb */
(() => {
  if (location.pathname.indexOf("qqBrowser") < 0) return { skip: true };
  const tabs = document.getElementById("qqb-tabs");
  const tab = document.querySelector("#qqb-tabs .tab");
  const btn = document.getElementById("qqb-default-browser-button");
  return {
    url: location.href.slice(0, 60),
    pgid: (document.querySelector("[dt-pgid]") || {}).getAttribute
            ? document.querySelector("[dt-pgid]").getAttribute("dt-pgid") : null,
    nodes: document.querySelectorAll("*").length,
    tabAttrs: tab ? [...tab.attributes].map(a => a.name + "=" + String(a.value).slice(0, 40)) : [],
    tabTitle: tab && tab.querySelector(".tab-content") ? tab.querySelector(".tab-content").textContent.trim().slice(0, 40) : null,
    closeTabs: document.querySelectorAll("#qqb-tabs .close-tab").length,
    ctrlIds: [...document.querySelectorAll("button.control-btn")].map(b => b.id),
    defaultBtn: btn ? { disabled: btn.disabled } : null
  };
})()
```

实测返回要点：`dt-pgid="pg_bas_built_in_browser"`；标签是 `#qqb-tabs .tab[data-tab-id]`，标题在 `.tab-content`，关闭键是 `.close-tab`；工具栏按钮 id 为 `qqb-go-back` / `qqb-go-forward` / `qqb-reload` / `qqb-download-context-menu-button` / **`qqb-default-browser-button`**（「用默认浏览器打开」）。完整锚点表见 [qqnt-internals.md](qqnt-internals.md) §10。

#### ⑤ 检查计算样式 / 内联样式（"为什么看不见 / 点不到"）

```js
/* probe-style */
(() => {
  const sel = "#background-video";
  const e = document.querySelector(sel);
  if (!e) return { sel, found: false, count: document.querySelectorAll(sel).length };
  const cs = getComputedStyle(e), r = e.getBoundingClientRect();
  const inline = e.getAttribute("style");
  return { sel, found: true,
           display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
           pointerEvents: cs.pointerEvents, zIndex: cs.zIndex, position: cs.position,
           rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
           inline: inline ? inline.slice(0, 160) : null,
           parent: e.parentElement ? e.parentElement.tagName + "." + String(e.parentElement.className).slice(0, 40) : null };
})()
```

要点：`getComputedStyle` 给**生效值**（能发现被别的样式表覆盖），`getAttribute("style")` 给**内联值**（能发现是谁写进去的）。再配上 `parent`，就能解释"元素被挂到了哪个容器里"。把 `sel` 换成 `#app`、`.tab-container` 之类可以逐层排除。

#### ⑥ 在页面里模拟点击（**注意不触发 QQ 的某些处理器**）

```js
/* probe-click */
(() => {
  if (location.hash.indexOf("/main") < 0) return { skip: true };
  const el = document.querySelector("<选择器>");
  if (!el) return { found: false };
  const before = el.getAttribute("aria-checked");
  for (const ev of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    const E = ev.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent;
    el.dispatchEvent(new E(ev, { bubbles: true, cancelable: true, view: window, button: 0 }));
  }
  return { ok: true, before, afterNow: el.getAttribute("aria-checked") };
})()
```

**实测反例（必须记住）**：探针连同 `{ ok: true }` 一起返回的就是这个形状 —— 对原生设置开关「使用系统默认浏览器打开网页」的 `.q-switch` 派发完整 `pointerdown/mousedown/pointerup/mouseup/click` 序列，返回

```json
{"ok":true,"before":"false","afterNow":"false"}
```

—— **状态没变**。同一开关用真实鼠标点就能打开。所以：

- 合成事件**不能**用来验证"这个控件能不能点"，只能用来**探测监听器存在性**；
- 需要真实输入时走 §5 的 Win32 注入；
- 反过来，**合成点击不生效 ≠ 你的选择器错了** —— 先用探针①②⑤确认元素确实在那儿，再考虑输入层的问题。

（同一个探针机制在别处是有效的：`dispatchEvent` 序列能触发主世界监听器。判断标准是"这个处理器在哪一层"。）

---

## 4. 探针的读法：怎么把结果变成结论

| 现象 | 含义 | 下一步 |
|---|---|---|
| 某个窗口返回 `{skip:true}` | 窗口判断生效，该窗口不适用 | 正常 |
| 所有窗口都 `{skip:true}` | 判断条件写错了，或**目标页面当时没打开** | 先把目标页开出来再跑（实测踩过：`diag-qqbrowser-plugin` 因为当时没有内置浏览器窗口而全 skip） |
| `=> undefined` | 探针没写 `return`，或返回了 `undefined` | 检查 IIFE |
| `EXEC_FAIL An object could not be cloned.` | 返回值不可结构化克隆 / 页面正在导航 | 改成只返回 `JSON.stringify(...)`（§3.2） |
| `EXEC_FAIL <其他>` | 代码抛错 | 精简探针，逐步排除 |
| 目标选择器 0 命中，但插件也没报错 | **最危险的情况**：插件在选择器上静默失效 | 立刻把插件用的选择器原样丢进探针（§8.4） |

---

## 5. 真实鼠标事件注入（Win32）

合成事件不够用时（§3.3 ⑥），用系统级输入。

### 5.1 坐标怎么算

```text
屏幕坐标 = 窗口 GetWindowRect 的左上角 + 页面内 getBoundingClientRect 的偏移
screenX = winRect.left + pageRect.left + offsetX
screenY = winRect.top  + pageRect.top  + offsetY
```

三个必须注意的点：

1. **DPI 缩放为 1 时**上式才成立。缩放不为 1 时，`GetWindowRect`（物理像素）与 `getBoundingClientRect`（CSS px）不同尺度，需要乘/除 `scaleFactor`。
2. **用 `GetWindowRect` 复核窗口位置，不要信 `window.screenX/screenY`** —— 实测可能过期（窗口移动后不同步）。
3. QQ 主窗口是**无边框**的，客户区≈窗口矩形，一般不需要再减标题栏高度；但若窗口有阴影/边框，需要按 `GetClientRect` + `ClientToScreen` 校准。

页面侧的探针负责给出 `pageRect`：

```js
/* probe-rect */
(() => { const e = document.querySelector("<选择器>");
  if (!e) return { found: false };
  const r = e.getBoundingClientRect();
  return { found: true, cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) }; })()
```

### 5.2 注入（PowerShell + P/Invoke）

```powershell
Add-Type @"
using System;using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004;
}
"@
$h = (Get-Process QQ -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 }).MainWindowHandle
$r = New-Object W+RECT; [void][W]::GetWindowRect($h, [ref]$r)
"winRect = $($r.Left),$($r.Top) - $($r.Right),$($r.Bottom)"
# 下面这两个数来自 probe-rect 的 cx / cy
$cx = 0; $cy = 0
[void][W]::SetCursorPos($r.Left + $cx, $r.Top + $cy)
Start-Sleep -Milliseconds 80
[W]::mouse_event([W]::LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 40
[W]::mouse_event([W]::LEFTUP,   0, 0, 0, [IntPtr]::Zero)
```

注意：

- 先 `SetCursorPos` 再 `mouse_event`：很多控件靠 `WM_MOUSEMOVE`/hover 才进入可点状态。
- 发送前把 QQ 窗口置前并确保没有别的窗口盖住，否则点到的是别人。
- 会**真的点到界面上**，所以只对安全的目标用；用完心里要清楚怎么撤销（§7）。本文只给配方，仓库不附带可执行脚本。

---

## 6. 抓 IPC

目标不同，做法完全不同：

| 想抓 | 做法 | 限制 |
|---|---|---|
| **之后才注册**的处理器 | 在插件 `main.js` 里包 `ipcMain.handle` / `ipcMain.on` | 只能抓"注册晚于你"的；加载器先于 app_launcher 执行，所以能抓到 QQ 后续注册的大部分 |
| **已经注册**的处理器 | 包 Electron 内部结构 `ipcMain._invokeHandlers`（`Map`）与 `ipcMain._events` | `_` 前缀是**内部 API**，跨 Electron 版本会变，必须做存在性判断 |
| 渲染进程发出的 IPC | 在**主进程**包 `ipcMain.emit`（日志插件就是这么做的） | 频道过多，先按关键词过滤 + 去重，否则日志会被淹 |
| 在 renderer 里包 `window.ipcRenderer` | ❌ **做不到** | contextBridge 冻结对象，见下 |

**`ipcMain` 包装骨架（新注册 + 已注册都覆盖，实测用于统计命中数）：**

```js
/* main 侧，插件加载时执行 */
const { ipcMain } = require("electron");

// ① 之后注册的
for (const m of ["handle", "handleOnce", "on", "once"]) {
  const orig = ipcMain[m].bind(ipcMain);
  ipcMain[m] = function (channel, ...rest) {
    console.error(`[ipc-spy] register ${m} ${channel}`);
    return orig(channel, ...rest);
  };
}

// ② 已经注册的（内部 API，注意存在性）
try {
  const invoke = ipcMain._invokeHandlers;          // Map<channel, handler>
  if (invoke && typeof invoke.forEach === "function") {
    let n = 0;
    invoke.forEach((handler, channel) => {
      n++;
      invoke.set(channel, function (...a) {
        console.error(`[ipc-spy] HIT invoke ${channel}`);
        return handler.apply(this, a);
      });
    });
    console.error(`[ipc-spy] 已包裹 ${n} 个已注册的 invoke 处理器`);
  }
  const ev = ipcMain._events;                      // 普通对象：channel -> listener
  if (ev) {
    let n = 0;
    for (const ch of Object.keys(ev)) {
      const arr = Array.isArray(ev[ch]) ? ev[ch] : [ev[ch]];
      ev[ch] = arr.map(fn => function (...a) {
        console.error(`[ipc-spy] HIT on ${ch}`);
        return fn.apply(this, a);
      });
      n++;
    }
    console.error(`[ipc-spy] 已包裹 ${n} 个已注册的 on 通道`);
  }
} catch (e) { console.error("[ipc-spy] 包内部结构失败: " + e.message); }
```

**实测计数**（`console.log` L5129–5130，同一启动批次）：

```text
[main] ERROR [open-in-browser:diag] 已包裹 59 个已注册的 invoke 处理器（共 59 个）
[main] ERROR [open-in-browser:diag] 已包裹 15 个已注册的 on 通道
```

随后点链接、点图标 → **一条 `HIT` 都没有**。这就是"这件事不经过 `ipcMain`"的直接证据（结论见 [qqnt-internals.md](qqnt-internals.md) §7）。

**为什么不能在 renderer 侧包**（实测，`eval-result.log` 的 `wrap-ipcrenderer` 探针）：主窗口返回

```json
{"ok":true,"frozen":true,"sealed":true,"desc":{"w":false,"c":false,"get":false},
 "send":"assign-failed(readonly)","invoke":"assign-failed(readonly)","sendSync":"missing"}
```

`frozen` + `sealed` + `writable:false` + `configurable:false` → 赋值静默失败（严格模式下会抛）。**renderer 侧的 IPC 观测只能靠主进程。**

另外：包 `ipcMain` 时优先 `console.error` 而不是 `console.log` —— 日志插件只接管主进程的 `warn`/`error`（见其 README §1），用 `log` 会丢。

---

## 7. 事故教训：留在 `eval.txt` 里的自测负载会被重放（必读）

### 7.1 发生了什么

为了验证"点链接会开内置浏览器"，写了一段自测脚本留在 `<profile>/data/dsh-debug-logger/eval.txt` 里：**造一个链接 → 派发点击**。

当天的实际后果：

- **每次 QQ 启动都会重放它** —— 因为旧版插件的判断是"`eval.txt` 内容 ≠ 上次执行过的内容"，而 `lastKey` 初始为 `""`、**每次启动归零**，于是文件里已有内容在启动后第一秒就被当成"新内容"执行；
- 脚本把 QQ **第一个窗口**导航到测试 URL；
- 结果：**主界面起不来**，QQ **两次 AppHang**。

### 7.2 修复

插件的 `main.js` 现在在**启动时**先把已存在的 `eval.txt` 内容读进 `lastKey`（记为"已执行过"）：

```js
let lastKey = "";
try { if (fs.existsSync(evalFile)) lastKey = fs.readFileSync(evalFile, "utf8").trim(); } catch { }
```

之后只有文件被**重新写入**（内容真的变化）才执行。这是"启动时不重放已存在内容"的原因。

### 7.3 规则（写进肌肉记忆）

1. **不要留下会被重放的自测负载。** 自测脚本用完**清空 `eval.txt`**（`eval-result.log` 里也别留敏感内容）。
2. **任何"改 QQ 状态"的探针，先想好回滚**：会导航页面的、会点按钮的、会写配置的、会改 DOM 的，都属于这一类。优先写成"只读探针"（读 DOM、读样式、读计数）——本文 §3.3 的六个探针里，只有 ⑥ 是写操作。
3. 写操作探针要**自带幂等与恢复**：记录 before → 操作 → 返回 after，并给出恢复手段。
4. 探针要**自带窗口判断**（否则会在所有窗口里都执行一遍，把 8 个窗口全导航走）。
5. 探测**原生行为**（尤其是可能弹窗/导航的）尽量放在**不重要的窗口**上，或先用只读探针确认路径。

---

## 8. 案例复盘

四个真实案例。每个都写清"怎么查出来的"、证据、根因、修法。

### 8.1 链接外开：怎么一步步证伪到"原生外壳"，最后在原生设置里解决

**症状**：QQ 里点 `http(s)` 链接走内置浏览器，希望改走系统默认浏览器。

**排查链（每一步都做了，每一步都失败，失败本身构成证据）**：

| 步骤 | 做法 | 结果 |
|---|---|---|
| 1 | renderer 插件在主世界替换 `window.open` | 只对页面自己调的 `window.open` 有效，QQ 的链接不走它 |
| 2 | 捕获阶段拦 `<a>` 点击 | 只对**主世界**监听器有效；QQ 的触发器不在这一层 |
| 3 | main 侧包 `ipcMain.handle/on`（抓新注册） | 无命中 |
| 4 | 包**已注册**的 `_invokeHandlers` + `_events` | 日志：`已包裹 59 个已注册的 invoke 处理器` / `已包裹 15 个已注册的 on 通道`；**点链接、点图标 0 命中** |
| 5 | 包 `shell.openExternal` | **从未被调用** |
| 6 | 挂 `loadURL` / `will-navigate` / `will-redirect` / `did-start-navigation` | **全部未触发** |
| 7 | 只剩"等内置浏览器页出现，再点它自己的按钮" | 能 work，但极不稳定：慢站要等 10–20 秒、QQ 有时一次点开两个标签 → 变成"重复外开 + 反复关标签"的补丁堆 |

**结论**：QQ 打开内置浏览器、以及工具栏那个「用默认浏览器打开」图标，**都是 `QQNT.dll` 原生实现** —— 不走 Electron IPC，也不走 Electron 导航路径。**插件层不存在拦截点。**

**正解（一行设置，零插件）**：

> **设置 → 通用 / 其他 →「使用系统默认浏览器打开网页」**

**教训**：为这件事写了 **4 版插件**，最后发现是原生开关。**排障第一步应该是查原生设置**，第二步才是判断"经不经过 JS 层"。

反面案例的完整代码与哈希：[`../examples/open-in-browser/README.md`](../examples/open-in-browser/README.md)。

### 8.2 背景插件：`#background-video` 铺满窗口 → "更多"按钮要点 3 次

**症状**：主窗口左下角"更多"按钮要连点好几次才生效（同位置其它点击也发飘）。

**怎么查出来的**：

1. 先怀疑按钮本身 → 探针③给它做 DOM 概览：元素在、没 disabled。
2. 再用**探针①命中测试**：在按钮中心坐标调 `document.elementFromPoint(x, y)` —— 命中的**不是按钮**，而是 `#background-video`。
3. 用**探针⑤**读计算样式：`position: fixed`、`width/height: 100%`、`z-index: -999`，而 `pointer-events` **没有声明 → 默认 `auto`**。

**根因（读源码确认）**：背景插件用一个铺满窗口的 `<video>` 做壁纸：

```js
var video = document.createElement("video");
video.id = "background-video";
// 挂载点：优先 .tab-container，其次 .container，再退到 #app.forward，最后 #app
```

配套 CSS：

```css
#background-video {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  z-index: -999;
}
```

一个铺满整个窗口、又接受鼠标事件的层，就抢走了它下面 UI 的点击 —— 表现为"要点好几次才落到底层按钮上"。

**修法**（本次实际采用的就是这个 —— 在 `custom_css` 插件的样式表里加一条覆盖规则；注意 `custom_css` **不在本仓库内**，这里只给修复内容本身）：

```css
#background-video { pointer-events: none !important; }
```

**顺带两个教训**：

- `setVideoSrc()` 的兜底分支（`#app.forward` → `#app`）**不检查可见性**，所以在某些视图里视频会被挂进**隐藏容器**，于是"背景没了"。排查这类"功能时好时坏"，用探针⑤的 `parent` 字段看元素实际挂在谁下面。
- 样式层的问题（铺满 + `pointer-events`）用**命中测试**定位，比读 CSS 快得多：`elementFromPoint` 一句话就能证明"点到的不是你以为的那个元素"。

### 8.3 `native-menu`：主进程 `document.body.click()` → 菜单狂闪 / 菜单项失效

**症状**：右键/工具栏菜单**疯狂闪烁**，菜单项点了没反应。

**日志形状（实测，本次调试会话）**：

```text
9 秒内 6 次： INFO [object Object]×4
紧接着：      UNCAUGHT_EXCEPTION
```

**怎么查出来的**：

1. `errors.log` 里出现 `UNCAUGHT_EXCEPTION`（主进程未捕获异常）→ 这是**主进程**问题，不是渲染进程。
2. 把异常时间戳与"菜单开始闪"的时刻对齐 → 每次闪烁都紧跟一次异常。
3. 异常来源指向 `native-menu` 插件的主进程代码：里面调了 `document.body.click()`。
4. **主进程里没有 `document`** → `ReferenceError`；这个调用又发生在菜单的开合/动画路径上，于是每次都抛、状态反复翻转 → 菜单狂闪、菜单项失效。

**根因**：在主进程里写 DOM API。`document` / `window` 只存在于渲染进程；主进程只有 Electron 的模块。

**修法**：删掉主进程里的 DOM 调用；要操作页面就把动作经 `webContents.executeJavaScript()` 或 IPC 交给渲染进程。同时给插件加一层"异常不会打断自身状态机"的保护。

> **留证提醒**：这段日志**已被 5 MB/2 MB 轮转丢弃**，现有 `console.log` / `errors.log` 里搜不到 `UNCAUGHT_EXCEPTION`。此处为本次会话的脱敏摘录，无法事后复核。教训：**看到关键异常先把日志文件复制走**（见 §2 轮转说明）。

### 8.4 一次被探针推翻的推断：`fuck_sidebar` 其实在正常工作

**背景**：排查初期曾推断「该插件把选择器写成 `.sidebar__nav .nav-item[aria-label="空间"]`，而 9.9.33 改用 `title`，所以整插件静默失效」。**这个推断后来被一条裁决探针推翻**。插件确实装了、也确实加载了（`console.log` 里 `fuck_sidebar` 有 295 条命中，绝大多数是它的 preload 噪声）。

**插件用的选择器（读源码）**：

```js
observeElement('.sidebar__nav .nav-item[aria-label="空间"]', () => { … display:none });
observeElement('.sidebar__nav .nav-item[aria-label="频道"]', () => { … });
observeElement('.sidebar__menu .func-menu__item_wrap:has(.icon-item[aria-label="邮箱"])', () => { … });
```

`observeElement` 的写法是 `setInterval` 里 `document.querySelector(selector)`，**找到才 `clearInterval`**：

```js
const timer = setInterval(function () {
  const element = document.querySelector(selector);
  if (element) { callbackEnable && callback(); clearInterval(timer); }
}, 100);
```

选择器永不匹配 → 回调永不执行 → **100 ms 一次的轮询永远空转** → 插件既不生效、也不抛错。

**探针实测到的当前 DOM（`eval-result.log`）**：

```text
主窗口 [title]/[aria-label] 取样：
  DIV class="nav-item vue-component"     aria-label="消息"
  DIV class="nav-item vue-component"     aria-label="联系人"
  DIV class="nav-item-activator"         aria-label="空间"
  DIV class="nav-item vue-component"     aria-label="频道"
  DIV class="nav-item-activator"         aria-label="游戏"
  DIV class="nav-item nav-item-more vue-component"  aria-label="更多"
  DIV class="func-menu user-profile-card__menu no-dra"  aria-label="工具栏"
```

**裁决探针（本机 9.9.33-52230 主窗口实测，`eval.txt` → `eval-result.log`）**：

```json
{ "sidebar__nav": 1, "sidebar__menu": 1, "sidebar-nav": 1, "nav_items": 8,
  "ariaLabels": ["消息:36x36", "联系人:36x36", "频道:0x0", "更多:0x0"],
  "titles": [], "moreHidden": "0x0", "funcMenuCount": 2 }
```

**结论（实测，不是推断）**：

| 观察 | 值 | 含义 |
|---|---|---|
| `.sidebar__nav` / `.sidebar__menu` | 各 **1** 个 | 插件的容器选择器**能匹配**（"容器 class 漂移"这条推断也不成立） |
| `.nav-item[aria-label]` | 消息/联系人/频道/更多… | 属性就是 **`aria-label`**；实测 `title` 为空 |
| `[aria-label="频道"]` | **0×0** | 已隐藏 —— 对应插件配置 `fuckQQ频道: true` |
| `[aria-label="更多"]` | **0×0** | 已隐藏 —— 对应 `fuck更多: true` |
| `[aria-label="消息"]` / `["联系人"]` | 36×36 | 未隐藏 —— 与配置一致 |

即：**插件按它的配置正确工作**（该藏的藏了、该留的留了）。"插件失效"是**推断出来的假问题**。

**这个案例真正值得记的是"怎么判断'没生效'"**：

1. **判断插件是否生效，要看可观测结果**（元素尺寸/可见性/属性值），不要看"选择器长得不一样"。本次就是只看属性名（`title` vs `aria-label`）就下了结论，错了一轮。
2. **探针要同时验"存在性 + 结果"**：`document.querySelectorAll(sel).length` 看能不能匹配，`getBoundingClientRect()` 看有没有真的生效。
3. **旁证不能当铁证**：当时还拿"`lite_tools` 样式表里写 `.sidebar-nav`（连字符）"当证据，实测 `.sidebar-nav` 与 `.sidebar__nav` **同时存在** —— 旁证只配写进"待验证"。
4. 选择器规则本身仍然成立：**换 QQ 版本后 class/属性都可能变**，改别人的插件前先把它选择器原样丢进探针（探针③/④）—— 但结论必须以探针数据为准。

**如果将来它真的失效了**，更稳的写法是少依赖容器 class、多用语义属性 + 运行时校验：

```js
/* 只依赖语义属性 + 运行时校验，少依赖 class 名 */
(() => {
  const items = [...document.querySelectorAll('[aria-label="空间"],[aria-label="频道"],[aria-label="更多"]')]
    .filter(e => /(^|\s)nav-item(\s|$)|nav-item-/.test(String(e.className)));
  items.forEach(e => e.style.display = "none");
  return { hidden: items.length };
})()
```

**三条普适教训**：

1. **"没报错"不等于"没生效"，"看起来失效"也不等于"失效"** —— 两头都得用探针验（存在性 + 结果）。
2. **`setInterval` + `querySelector` 的写法会把"匹配失败"完全吞掉**。自己写插件时，**匹配失败要有可见反馈**（计数日志、超时后报 WARN）。
3. QQ 升级会静默改 class / 属性。**每次升级后重跑一遍探针**是成本最低的回归测试。

---

## 9. 排障决策树

```text
插件没生效
├─ 加载器有没有加载它？
│   ├─ console.log 有 "loaded v…" / 设置页有它的条目 → 已加载，往下
│   └─ 没有 → 查 manifest、slug 重名、disabled_plugins（[`../AGENT_README_ZH.md`](../AGENT_README_ZH.md) §3）
├─ QQ 起不来 / 一启动就弹窗？
│   └─ 是不是改了 <app> 下的文件 → qqnt-internals.md §2/§3
├─ errors.log 有没有你的报错？
│   ├─ 有 PRELOAD_ERROR → 预加载脚本抛错（辅助窗口公共噪声见 qqnt-internals.md §6.3）
│   ├─ 有 UNCAUGHT_EXCEPTION → 主进程问题；对齐时间戳找触发点（案例 §8.3）
│   └─ 没有 → **静默失效**，走选择器/时序排查
├─ 目标 DOM 存在吗？（探针③）
│   ├─ 不存在 → 探针④看页面结构；可能页面没打开、或选择器过期（案例 §8.4）
│   └─ 存在 → 往下
├─ 元素看得见、点得到吗？（探针⑤ + ①）
│   ├─ elementFromPoint 命中别的元素 → 被遮挡/被铺满层抢点击（案例 §8.2）
│   └─ 命中目标但点了没用 → 事件层问题：合成 click 不触发（§3.3 ⑥）→ 真实鼠标（§5）
└─ 需要观察原生行为？
    └─ 包 IPC 看有没有经过 JS（§6）；0 命中 = 原生外壳，插件层做不到
```

---

## 10. 交付前自检

- [ ] 目标功能在 9.9.33 上**真的跑通**（不只是"没报错"）
- [ ] `errors.log` 里没有**你引入的**新报错（辅助窗口的 `Cannot bind an API…` 是公共噪声）
- [ ] 用过的选择器都经过探针验证（探针③/④/①），不是抄旧版的
- [ ] **`eval.txt` 已清空**，`eval-result.log` 里没有敏感内容（§7）
- [ ] 关键日志/证据在轮转前已复制留证（§2）
- [ ] 仓库/日志里没有个人数据：QQ 号、聊天内容、`rkey`/token、真实用户名、真实绝对路径（用 `<QQNT>` / `<app>` / `<profile>`）
- [ ] 涉及改 QQ 本体文件的，风险与回滚方式已写清（[qqnt-internals.md](qqnt-internals.md) §3.4）

---

## 11. 证据索引

本文引用的实测证据在此集中列出，便于复核（日志文件位于 `<profile>/data/dsh-debug-logger/`，会轮转）：

| 证据 | 位置 |
|---|---|
| `已包裹 59 个已注册的 invoke 处理器（共 59 个）` / `已包裹 15 个已注册的 on 通道` | `console.log` L5129–5130 |
| `ipcMain 注册钩子已装好` / `shell.openExternal 钩子已装好` | `console.log` L4503–4504、L5127–5128 |
| 内置浏览器窗口标题为 `QQBrowser`、页面为 `qqBrowser.html` | `console.log` L25 等 |
| `[Preload] [fuck_sidebar]: Error: Cannot bind an API on top of an existing property`（公共噪声） | `console.log` L15/L37/…（该关键词共 295 条，绝大多数是这个） |
| `Unable to load preload script: …\src\preload\module.js` + `TypeError: … reading 'path'` | `errors.log` L8–L10 |
| `#qqb-tabs .tab[data-tab-id]` / `.tab-content` / `.close-tab` / `qqb-default-browser-button` | `eval-result.log` L97、L122 |
| `dt-pgid="pg_bas_built_in_browser"`、页面节点数 104 | `eval-result.log` L81 |
| `window.ipcRenderer` 是 frozen/sealed 只读 | `eval-result.log` L256 |
| `qqBrowser.html` 里 `no window.ipcRenderer` | `eval-result.log` L260 |
| 桥接对象枚举命中 30 个对象 | `eval-result.log` L219 |
| `.q-switch[role=switch][aria-checked]` + `panel-main` | `eval-result.log` L341–347 |
| 合成事件**没有**打开该开关（`before:"false"` → `afterNow:"false"`） | `eval-result.log` L374 |
| 开关打开后 `checked:"true"` | `eval-result.log` L395 |
| `EXEC_FAIL An object could not be cloned.` | `eval-result.log` L155–162 |
| `fuck_sidebar` 的选择器（`.sidebar__nav` / `.sidebar__menu`） | 插件源码 `renderer.js` L17–L53 |
| `#background-video` 的 CSS 与 `setVideoSrc()` 挂载点 | `background_plugin/renderer.js` L1309–L1357 |
| `#background-video { pointer-events: none !important; }` 修复 | 工作环境里 `custom_css` 插件的 `style.css`（该插件不在本仓库内） |
| QQNT.dll 补丁偏移 0x510197 与字节 | [qqnt-internals.md](qqnt-internals.md) §3.1（读 `QQNT.dll` 实测） |
| `application.json` 344 字符 base64 / 256 字节签名 | [qqnt-internals.md](qqnt-internals.md) §2.1 |
| 老 `dbghelp.dll` 代理的 `Sig not found!` / `MH Hook Patch failed!` | [qqnt-internals.md](qqnt-internals.md) §4.1 |

> 本仓库内**不含**个人数据：QQ 号、昵称、签名、`uin=` URL、favicon 路径、真实用户名一律不抄；日志摘录中的这些字段已用 `<…>` 或"已脱敏"标注。
