---
name: qqnt-plugin-dev
description: >
  Write, modify or review a LiteLoaderQQNT / QQNT plugin for the QQ NT desktop client on Windows: manifest v4, what
  the main / preload / renderer worlds each can touch, hooks and LiteLoader APIs, a minimum working plugin, common
  recipes, and the pre-delivery checklist. Carries the mandatory disclaimer and the iron rules (check QQ's own native
  settings first; confirm the JS layer is even involved). Triggers: LiteLoaderQQNT, LLQQNT, QQNT 插件,
  LiteLoader 插件, write a QQNT plugin, QQ 插件 manifest.
license: MIT
---

# QQNT / LiteLoaderQQNT —— 写一个插件

这是四个同级 skill 之一，按任务挑选：

| Skill | 用途 |
|---|---|
| **`qqnt-plugin-dev`**（也就是本 skill） | 写 / 改插件：结构剖析、API、配方、交付 |
| `qqnt-plugin-debug` | 让插件在真实客户端上跑起来：自带日志器、`eval.txt` REPL、探针、IPC 捕获、坑位清单 |
| `qqnt-loader-install` | 安装 / 修复 loader、文件校验、`QQNT.dll` 签名补丁 |
| `qqnt-capability-limits` | 判断某个功能到底能不能从插件触及 |

写成 `<这样>` 的路径都是占位符。**把相对路径按本 skill 的 base directory 解析**
（Codex 会在加载时给出该技能的绝对目录）。所有内容都随包本地提供 —— 无需联网下载。

---

## 0. 免责声明 —— 在开始之前，向用户发送一次

**When（时机）：** 在**当前对话**中的第一个 QQNT 插件任务时发送一次。同一对话里的追问**不会**再次触发。
**新开一个对话**会重新发一次。如果用户使用其他语言书写，就把这段翻译过去。

> **免责声明。** 本项工作（工具包、补丁、文档）**仅供对软件架构与 JavaScript 注入技术进行教育与研究之用**。
> 使用即表示你接受：
> - **不得违反软件保护相关法律**；不得对腾讯 QQ 的修改版进行逆向工程、修改或分发。不得制作或分享
>   意图**侵入或非法控制计算机信息系统**的程序。
> - **不得侵犯腾讯的权利**，包括 QQ 客户端上的著作权与技术保护措施。
> - **不得用于商业用途**；不得损害腾讯的合法权益。
> - 你必须确保自己对 QQ 客户端的使用是**已获正当授权**的（包括腾讯的服务条款）。
> - 本文档中任何涉及 QQ 自身文件的内容，其目的都是**解释其机制并保留回滚手段**，
>   而非帮助绕过官方授权。
> - 对于滥用及其后果，作者**不承担任何责任**。**全部风险由用户自行承担。**
>
> 在中国大陆，下列行为可能构成犯罪 —— 请避免任何与之相似的行为：① 提供用于侵入、非法控制计算机信息系统的
> 程序、工具（刑法第 285 条第 3 款）；② 侵犯著作权，包括规避技术保护措施（第 217 条）；
> ③ 破坏计算机信息系统（第 286 条）。

在同一条消息里还要说明：**插件工作需要用户配合** —— 大多数事实只能在其运行中的客户端上观察到，
因此要预期若干轮简短测试（*debug* skill 涵盖了这套“向用户提问”的循环）。

**版本范围。** 所有标记为 `[实测]` 的内容，均在 **QQ NT 9.9.33-52230 + LiteLoaderQQNT 5.2.1 +
Electron 40 + Windows**（2026-10）上验证过。在其他任何版本上，把每一条 `[实测]` 结论都当作假设，
先用探针重新验证，再据此行动。

---

## 1. 铁律（属于设计阶段的两条）

1. **先检查 QQ 自身的原生设置。** 用户想要的功能可能已经有一个开关 —— 那么就不需要插件。
   真实案例：“用系统浏览器打开链接”其实就是 设置 → 通用/其他 →
   *使用系统默认浏览器打开网页*。在任何人去看一眼之前，已经写了四个版本的插件。
   （`qqnt-capability-limits` 里有具体做法。）
2. **在设计任何拦截之前，先确认 JS 层是否真的参与其中。** QQ 自身的链接打开行为及其内置浏览器
   属于原生外壳行为；插件只能观察它们。证据与判定流程：`qqnt-capability-limits`。

第三条规则 —— *动 QQ 自身文件之前先备份* —— 属于 `qqnt-loader-install`。

---

## 2. 插件放在哪里

| 符号 | 含义 |
|---|---|
| `<profile>` | LiteLoader 数据根目录：环境变量 `LITELOADERQQNT_PROFILE`，否则用 loader 自身的根目录 |
| plugin dir | `<profile>\plugins\<slug>\` |
| plugin data | `<profile>\data\<slug>\`（你的配置/状态） |
| loader config | `<profile>\data\LiteLoader\config.json` —— `disabled_plugins` 列出被禁用的 slug |
| `<QQNT>` / `<app>` | QQ 安装根目录 / Electron 应用根目录（`qqnt-loader-install` 展示了如何找到它） |

插件目录是按目录名和 manifest 中的 `slug` 识别的；没有注册表。修改任何插件文件
（main/preload/renderer）都需要**重启 QQ** —— 它们只在启动时加载一次。

---

## 3. 插件结构剖析

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

- `type` 取值为 `extension | theme | framework`；loader **不会**按它过滤 **[实测]**。
- `dependencies` 只决定**加载顺序** —— 它**不会**安装依赖 **[实测]**。
- 两个文件夹使用相同 `slug` → 只有一个会加载（扫描时最后到达的那个）**[实测]**。在调试一个“死掉”的
  插件之前，先检查是否有重复。
- `injects` 各项都是可选的；不需要的世界就省略。

### 3.2 三个世界

| Inject | 运行于 | 有 Node？ | 可触及 | 用途 |
|---|---|---|---|---|
| `main` | Electron 主进程 | 有 —— `require('electron')` | `ipcMain`、`webContents`、`BrowserWindow`、`shell`、`app` | 钩子、窗口/IPC 工作、原生桥接 |
| `preload` | 渲染进程的隔离 preload 世界 | 有 | `contextBridge`、`ipcRenderer` | 向页面暴露一个安全的 API |
| `renderer` | 页面**主世界**，经 `local://` 走 ESM | 无 | DOM、`window.LiteLoader.api.*` | UI、CSS、点击处理 |

两个实测的坑：

- 渲染进程插件**不会**被注入 `app://./renderer/qqBrowser.html`（QQ 内置浏览器的外壳）。
  要从 `main` 用 `webContents.executeJavaScript` 注入到那里。
- 页面暴露了 QQ 自己的 `window.ipcRenderer`，但它是**被冻结**的 contextBridge 对象 —— 你无法从主世界
  包装它。请改在 **preload** 侧包装。

### 3.3 钩子与 API

- main：`exports.onBrowserWindowCreated(win)`、`exports.onBrowserWindowCreating()`、全局 `LiteLoader`
  （`path.{root,data,profile,plugins}`、`package.qqnt.version`、`api.config.get/set`、`api.plugin.*`）。
- renderer：`window.LiteLoader.api.openExternal(url)`、`openPath(path)`、`config.get/set`、`plugin.*`。
- 配置存放在 `<profile>\data\<slug>\`；请通过 `LiteLoader.api.config` 读写，以保证路径始终正确。

### 3.4 最小可用插件

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

### 3.5 常用配方

- **注入 CSS**：渲染进程插件，在加载时追加一个 `<style>`；如果 QQ 替换了 DOM 子树，就重新追加。
- **一个设置页面**：渲染进程的 `onSettingWindowCreated`（loader API）+ `LiteLoader.api.config.get/set` 做存储。
- **拦截一次点击**：在 `document` 上用捕获阶段监听器，然后 `preventDefault()` +
  `stopImmediatePropagation()`。实测注意点：QQ 的某些处理程序并不在主世界里，所以捕获监听器可能失效 ——
  先探测，再承诺它能工作。
- **响应新窗口**：`app.on('web-contents-created')` **以及**在加载时遍历 `webContents.getAllWebContents()`，
  因为 QQ 会在你的插件运行之前预先创建好池化窗口。
- **在外部打开某物**：渲染进程里用 `LiteLoader.api.openExternal(url)` / `openPath(path)`，
  或在 main 里用 `shell.openExternal` / `shell.openPath`。

---

### 3.6 实操样例：左侧栏按钮 **[实测]**

9.9.33 实测：左侧栏是 `.sidebar__nav`（`display:flex; flex-direction:column; align-items:center`，约 52 px 宽），
内含约 8 个 `.nav-item`（36×36；被隐藏的如「频道/更多」是 0×0）。**克隆一个可见的 `.nav-item` 再追加**，QQ 自己的
样式与 hover 就免费得到了 —— 注意 `cloneNode` 只复制 class、**不复制事件监听器**，所以克隆体完全归你：

```js
(() => {
  if (window.__demoLoaded || location.hash.indexOf("/main") < 0) return;
  window.__demoLoaded = true;
  let n = parseInt(localStorage.getItem("demo:n") || "0", 10) || 0;   // 跨 QQ 重启保留 [实测]
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
      e.preventDefault(); e.stopImmediatePropagation();     // 挡住 QQ 在轨道层级的处理器
      n++; localStorage.setItem("demo:n", String(n));
      btn.title = "共点击了 " + n + " 次";
    }, true);
    nav.appendChild(btn);
    return true;
  }
  if (!install()) { const t = setInterval(() => { if (install()) clearInterval(t); }, 500); setTimeout(() => clearInterval(t), 60000); }
})()
```

**把它做成真正的玩具**（均为 9.9.33 实测）：

- **图标**：导航项的图标是内联 `<svg>` 且**不用** `currentColor`；你自己的 SVG 用 `currentColor` 就会自动跟随主题（实测浅色主题下 `color: rgb(4,30,42)`）。
- **音效不需要音频文件**：真实用户点击本身就是合法手势，所以在 click 处理器里 `new (window.AudioContext)()` 可用；三角波快速下滑 + 带通噪声瞬态就很像木鱼"笃"声，无需下载或随包发布任何资源。
- **常驻徽标**：QQ 自己的未读徽标类是 `q-badge q-badge__red`；在克隆出来的 `.nav-item` 里放一个绝对定位的 `<span>` 更简单且不依赖主题（实测右上角 23×13 px）。
- **长按清零**：`pointerdown` + 700 ms 定时器，在 `pointerup` / `pointercancel` / `pointerleave` 清除；用时间戳（`Date.now() - lastLongPress < 600`）吃掉紧随其后的那次 click。
- **迭代时热替换**：给注入节点打版本标记（`btn.dataset.ver = "v2"`），`install()` 里先移除旧标记节点，再把新代码贴进 `eval.txt` —— 运行中的客户端约 1 秒内换新，**不用重启**。
用这种方式做出来的完整可用插件在仓库 `examples/merit-counter/`（左栏按钮、点击弹「+1　共点击了 N 次」、计数持久化）。
先在调试 skill 的 `eval.txt` 里原型验证（每轮迭代不用重启），再打包成 renderer 插件。
## 4. 交付纪律

- 绝不写入个人数据（QQ 号、聊天内容、`rkey`/token、真实用户名、真实绝对路径 → 使用
  `<QQNT>` / `<app>` / `<profile>` 占位符）。提交或粘贴到报告里的内容同样如此。
- 报告时区分**哪些是实测的、哪些是推断的**，并附上涉及的 QQ 与 loader 确切版本。
- 任何绕过校验、注入代码或改动 QQ 文件的操作：先说明风险与回滚方式
  （`qqnt-loader-install`）。

**交付前自检清单**

- [ ] 插件确实加载了（写入了 `<profile>\data\<slug>\`，或出现在 QQ 的设置列表中）
- [ ] `errors.log` 里没有**你新引入的**错误（注意共享 preload 的噪声 —— 见 *debug* skill）
- [ ] 你在其他插件里改动的任何东西，都是针对**当前** DOM 验证过的，而不是凭记忆
- [ ] 调试插件的 `eval.txt` 里没有留下可重放的自测载荷
- [ ] 代码、日志、截图或仓库中都没有个人数据
- [ ] 对 QQ 自身文件的改动：已告知用户风险与回滚路径
- [ ] 已请用户验证用户可见的结果
- [ ] 以上任何一步之前，都先检查过原生设置
