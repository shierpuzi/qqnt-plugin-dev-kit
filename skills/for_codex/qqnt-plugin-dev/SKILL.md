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
Electron 40（Chromium 144）+ Windows**（2026-10）上验证过。在其他任何版本上，把每一条 `[实测]` 结论都当作假设，
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
  "authors": [{ "name": "you", "link": "https://github.com/you" }],
  "platform": ["win32"],
  "type": "extension",
  "dependencies": ["other-slug"],
  "injects": { "main": "./main.js", "preload": "./preload.js", "renderer": "./renderer.js" }
}
```

- `type` 取值为 `extension | theme | framework`；loader **不会**按它过滤 **[实测]**。
- **`authors` 每一项都需要 `name` *和* `link`** **[实测]** —— loader 自带的 `manifest.schema.json`
  （随 LiteLoaderQQNT 发布包提供，和它的 `package.json` 同级；要读就读那里，因为部署到
  `<app>\LiteLoaderQQNT\` 下的副本可能只剩 `src/`）里写着 `authors.items.required = ["name","link"]`。
  缺 `link` 仍然能加载，但已不符合 schema，而且 QQ 的插件列表会把每位作者渲染成一个可点击链接，缺了就是死链。
- **`repository` 决定插件列表里的仓库链接** **[实测]**（`manifest.repository.{repo,branch}` →
  `https://github.com/<repo>/tree/<branch>`）；这个插件只要将来会上架，就把它补上：
  `"repository": { "repo": "you/my-plugin", "branch": "main", "release": { "tag": "1.0.0", "url": "my-plugin.zip" } }`。
  一旦写了 `repository`，`branch` 就是必填；`release` 下 `tag` 必填，`url` 是 **release 附件文件名**
  （不写则直接下载该 tag 的源码包）。
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
- **加载插件目录里的 CSS/图片资源** **[实测]**：把文件随插件一起发布，用 loader 的 `local://` 协议引用 ——
  `local://profile/<相对 profile 的路径>/x.css`（关键场景：插件目录就在 `<profile>\plugins\` 下）或
  `local:///<绝对路径>`。不要硬编码盘符或用户名，用 loader 给的两个根目录把相对路径算出来：

  ```js
  // renderer.js — 只用 loader 提供的根目录算绝对路径 [实测]
  const me = LiteLoader.plugins["my-plugin"].path.plugin;      // <profile>\plugins\my-plugin
  const prof = LiteLoader.path.profile;                        // <profile>
  const rel = me.slice(prof.length).replace(/\\/g, "/").replace(/^\//, "");  // plugins/my-plugin
  const cssUrl = `local://profile/${rel}/style.css`;
  const imgUrl = `local://profile/${rel}/icon.png`;
  ```
- **一个设置页面**：渲染进程的 `onSettingWindowCreated`（loader API）+ `LiteLoader.api.config.get/set` 做存储
  —— 见 §3.7，那里有实测的开关结构、配置校验，以及让改动无需重启 QQ 就能生效的跨窗口同步。
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
- **音频节点不会跟着一个纯数字字段走** **[实测]**：`master.gain.value` 只在你搭好音频图的那一刻读一次。如果你的配置里有
  `volume` 字段，就必须在它的 setter 里**以及**初始化时都去改节点 —— 或者把 `volume` 做成一个同步进 `gain.value` 的
  getter/setter —— 否则滑杆在动、配置也存了，声音永远不变。识别症状：「设置能保存但毫无反应」，而且它**不是** §3.8 的跨窗口问题。
- **常驻徽标**：QQ 自己的未读徽标类是 `q-badge q-badge__red`；在克隆出来的 `.nav-item` 里放一个绝对定位的 `<span>` 更简单且不依赖主题（实测右上角 23×13 px）。
- **长按清零**：`pointerdown` + 700 ms 定时器，在 `pointerup` / `pointercancel` / `pointerleave` 清除；用时间戳（`Date.now() - lastLongPress < 600`）吃掉紧随其后的那次 click。
- **迭代时热替换**：给注入节点打版本标记（`btn.dataset.ver = "v2"`），`install()` 里先移除旧标记节点，再把新代码贴进 `eval.txt` —— 运行中的客户端约 1 秒内换新，**不用重启**。
用这种方式做出来的完整可用插件在仓库 `examples/merit-counter/`（左栏按钮、点击弹「+1　共点击了 N 次」、计数持久化）。
先在调试 skill 的 `eval.txt` 里原型验证（每轮迭代不用重启），再打包成 renderer 插件。

### 3.7 设置页 —— 三个实测坑

`onSettingWindowCreated(view)` 会把一个容器交给你做自己的面板（loader 会克隆一份设置页签项，并用 `view` 调用它）。
以下都是 9.9.33 实测，正是它们把「点了没反应」变成真正能用的开关。

**坑 1 —— QQ 的开关外观由 class `is-active` 驱动，不是 `aria-checked`** **[实测]**。`.q-switch` 的开关样式来自这个
class；只改 `aria-checked` 会得到一个*状态值正确、外观永远是关*的开关 —— 用户只会得出「开关坏了」的结论。正确的结构与切换：

```js
// markup: <div class="q-switch"><span class="q-switch__handle"></span></div>
const sw = view.querySelector(".my-switch .q-switch");
sw.classList.toggle("is-active", on);   // ← 真正画出开关状态的是这一行 [实测]
sw.setAttribute("aria-checked", String(on));  // 也要保留，用于无障碍和读回状态
```

**坑 2 —— `config.get` 会把磁盘值合并覆盖到你的默认值上，而且不做校验** **[实测]**：loader 返回的是
`Object.assign({}, default, savedFromDisk)`。因此被手工改坏或损坏的 `config.json` 会静默生效，一个 `null` 字段经
`Number()` 会变成 `0` —— 这就是「音量 0 / 插件变哑」这类问题要查一个小时的原因。每次读取都要校验：

```js
const raw = await LiteLoader.api.config.get("my-plugin", { volume: 60, on: true });
const cfg = {
    volume: Number.isFinite(+raw.volume) ? Math.min(100, Math.max(0, +raw.volume)) : 60,
    on: raw.on === true
};
```

**坑 3 —— 配置已经写进磁盘，却仍然「要重启才生效」**：那是 §3.8，是**窗口**问题，不是配置问题。先往这个方向想：
配置写入成功 + UI 不动，几乎一定是跨窗口，而不是写入失败。

### 3.8 跨窗口同步 —— 实测最大的坑

**QQ 的每个窗口都是独立的 JS 上下文** **[实测]** —— 主界面窗口和设置窗口不共享内存，`window.dispatchEvent` 也
**跨不过**窗口边界。症状：「设置要重启 QQ 才生效」，尽管磁盘上的值其实早就写对了。本次实测主界面
`webcontentsid=2`、设置页 `=6`。

`localStorage` **是**按 origin 共享的，它的 `storage` 事件**确实**能跨窗口 **[实测]** —— 但有一个前提：
**它不会在写入者自己的窗口里触发。** 所以写入方必须自己通知自己，而最干净的做法是让所有代码路径都走同一个
`saveConfig()` —— 不要把广播留给各个调用点去记得：

```js
// renderer.js — 只有一个广播点，不会漏掉调用方 [实测]
const CH = "my-plugin:config";
function saveConfig(cfg) {
    LiteLoader.api.config.set("my-plugin", cfg);
    localStorage.setItem(CH, JSON.stringify({ ...cfg, _ts: Date.now() }));  // 其它窗口：'storage'
    window.dispatchEvent(new CustomEvent(CH, { detail: cfg }));             // 仅本窗口
}
window.addEventListener("storage", (e) => {
    if (e.key === CH && e.newValue) applyConfig(JSON.parse(e.newValue));
});
window.addEventListener(CH, (e) => applyConfig(e.detail));
```

如果你确实需要把主进程拉进链路（或者需要一个在 `localStorage` 不可用的上下文里也能工作的方案），从 preload 世界用
`ipcRenderer` 转发同样的消息是自然的备选 —— 这条路径属于**推断**，不是实测，依赖前请先验证。先试 `localStorage`：
它不需要桥、也不需要主进程代码。

### 3.9 动效与浮层 —— 两条各花掉一天的规则

- **用 `scale` / `translate` / `opacity` 这些独立属性做动画，绝不要覆盖 `transform` 简写** **[实测]**：QQ 自己的
  浮层用 `transform` 做居中，所以一条把 `transform: translateX(...)` 重置的规则会把浮层拽离原位，而不是微调你的元素。
- **绝不要写 `button { … }` 这种全局元素规则** **[实测]**：有一条针对 QQ 整个应用的覆盖规则，在点头像打开资料卡时
  把界面卡死了。每条规则都限定在你自己的容器内。相关的：QQ 的**发送按钮不是 `<button>`** —— 它是一组嵌套的
  `div`，而背景由最外层的 **`.send-btn-wrap`** 绘制；要改就改它，而不是你最先找到的那个内层节点。

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
