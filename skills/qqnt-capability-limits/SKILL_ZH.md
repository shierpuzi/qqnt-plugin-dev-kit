---
name: qqnt-capability-limits
description: >
  Decide whether a QQ NT feature can be changed by a LiteLoaderQQNT plugin at all, before writing one. Covers the
  measured native-shell vs JS boundary (what ipcMain hooks, navigation hooks and window.open can and cannot
  intercept), why QQ's internal browser and its "open in default browser" toolbar button are unreachable from a
  plugin, and how to find and flip QQ's own native setting instead. Triggers: 为什么插件拦不住, 内置浏览器,
  qqBrowser, QQ 原生设置, can a plugin hook this, QQNT plugin limitations.
license: MIT
---

# QQNT —— 插件能不能做到（能力边界）

四个姊妹技能之一：`qqnt-plugin-dev`（写插件）、`qqnt-plugin-debug`（让它跑起来）、
`qqnt-loader-install`（安装/打补丁）、**`qqnt-capability-limits`**（就是本技能 —— 在动手写代码*之前*先做判断）。

**相对路径一律以本技能的基础目录为基准解析**（DSH 会在 `skill_resources` 块里打印该目录）。

---

## 0. 免责声明 —— 开始之前发一次

**何时：** 在**当前对话**中的第一个 QQNT 插件任务上发一次；新开一个对话则要重新发。

> **免责声明。** 本工作**仅用于软件架构与 JavaScript 注入技术的教育与研究**。使用即表示你接受：
> **不得违反软件保护相关法律**（不得对腾讯 QQ 构建产物进行逆向工程、修改或分发修改版）；不得制作或传播
> 意图**侵入或非法控制计算机信息系统**的程序；不得侵犯腾讯的权利，包括著作权与技术保护措施；
> **不得用于商业用途**；确保你对 QQ 客户端的使用**已获得正当授权**。作者对任何滥用**不承担任何责任** ——
> **一切风险由使用者自负**。
> 在中国大陆，下列行为可能构成犯罪：① 提供侵入、非法控制计算机信息系统的程序、工具（刑法第 285 条第 3 款）；
> ② 侵犯著作权，包括规避技术措施（刑法第 217 条）；③ 破坏计算机信息系统（刑法第 286 条）。

**版本范围。** 所有标注 `[实测]` 的内容均在 **QQ NT 9.9.33-52230 + LiteLoaderQQNT 5.2.1 +
Electron 40 + Windows**（2026-10）上验证通过。换到别的版本，依赖这些结论前请重新验证。

---

## 1. 原生优先：写代码之前先找 QQ 自己的设置

用户的目标往往本来就是一个 QQ 选项。真实案例 **[实测]**：“让所有链接都用我的浏览器打开” ——
四轮插件迭代全部失败（见 §2），而 QQ 自己就有
**设置 → 通用/其他 → *使用系统默认浏览器打开网页***（`.q-switch[role=switch]`）；把它翻过来，
任务就用原生方式解决了。

从设置窗口定位并翻转这样一个开关（借助调试技能的 `eval.txt` REPL）：

```js
// 1) locate the labelled switch and read its state
(() => { const KEY = "使用系统默认浏览器打开网页";                       // ← the label text you are looking for
  const leaf = [...document.querySelectorAll("*")].find(e => e.children.length === 0 && (e.textContent||"").trim() === KEY);
  if (!leaf) return "not on this page";
  const item = leaf.closest(".panel-main") || leaf.parentElement.parentElement;
  const sw = item.querySelector(".q-switch[role=switch]");
  return sw ? { checked: sw.getAttribute("aria-checked") } : "no switch"; })()
```

```js
// 2) flip it (dispatch the same events a real click produces), then re-read aria-checked
(() => { const sw = document.querySelector(".q-switch[role=switch]"); if (!sw) return "not found";
  for (const ev of ["pointerdown","mousedown","pointerup","mouseup","click"]) {
    const E = ev.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent;
    sw.dispatchEvent(new E(ev, { bubbles: true, cancelable: true, view: window, button: 0 })); }
  return { after: sw.getAttribute("aria-checked") }; })()
```

务必告诉用户**你改了哪一项设置、以及怎么改回去**。

---

## 2. 实测边界：QQ 的原生外壳从 JS 侧够不着

**[实测]** 针对“在 QQ 内置浏览器里打开链接”以及内置浏览器自己那个
“用默认浏览器打开”工具栏按钮：

- 包裹 **59 个已注册的 `ipcMain` invoke 处理器 + 15 个 `on` 通道**，然后点击这两处 → **0 命中**。
- `shell.openExternal` **从未**被调用，即使按钮成功打开了系统浏览器。
- 内置浏览器加载页面时，`webContents.loadURL`、`will-navigate`、`will-redirect`、`did-start-navigation`
  **全都没有触发**。
- 页面里的 `window.ipcRenderer` 是一个**冻结**的 contextBridge 对象；它同样无法被包裹。

结论：这些动作实现在**原生外壳（`QQNT.dll`）**里。插件可以*观察到*它们（并在事后做清理），
但无法拦截或阻止它们。事后补救（先让 QQ 的页面出现，再去驱动 QQ 自己的工具栏按钮）又慢又存在竞态
**[实测]** —— 不要把它当作修复方案来承诺。

---

## 3. 能力表 **[实测]**

| 目标 | 结论 |
|---|---|
| 改页面样式 / 注入 CSS | ✅ 渲染进程插件（main world） |
| 覆盖 `window.open` | ✅ 渲染进程插件 |
| 拦截 `<a>` 点击 | ⚠️ 只对 main world 的监听器有效；QQ 自己的触发点常在别处 —— 先探测 |
| 自己的配置/数据 | ✅ `LiteLoader.api.config.get/set` → `<profile>\data\<slug>\` |
| 打开浏览器 / 文件夹 | ✅ `LiteLoader.api.openExternal/openPath`（渲染进程），`shell.*`（主进程） |
| 观察窗口创建 / 显示 | ✅ `app.on('browser-window-created')`，包裹 `BrowserWindow.prototype.show/focus` |
| 包裹新注册的 `ipcMain` 处理器 | ✅ 插件主进程代码先于 QQ 的应用代码执行 |
| 包裹已注册的 invoke 处理器 | ✅ 通过 `ipcMain._invokeHandlers` / `_events`（内部 API） |
| 阻止 QQ 打开内置浏览器，或其“外部打开”图标 | ❌ 原生外壳（§2） |
| 替换页面的 `window.ipcRenderer` | ❌ 冻结的 contextBridge 对象 |
| 注入 `qqBrowser.html`（内置浏览器外壳 UI） | ✅ 仅限主进程 `webContents.executeJavaScript` |
| 修改 QQ 自己的设置 | ✅ 通过驱动设置 UI（`.q-switch`，§1）—— 而不是盲写它的配置文件 |
| 阻止 QQ 更新 / 悄悄改它的文件 | ⚠️ 有 RSA 校验；要提醒用户并给出回滚方案（`qqnt-loader-install`） |

---

## 4. 决策流程：“我能不能 hook 它？”（5 分钟，在任何设计之前）

1. **QQ 有没有对应的设置？** 用用户的措辞去搜设置文本（§1 的定位代码）。有 —— 收工。
2. **先观察。** 开着调试技能的 logger，让用户把该动作触发一次，然后在
   `errors.log` / `console.log` 里看有没有动静。什么都没有，就是“这是原生实现”的强提示。
3. **探测 JS 各层表面**（全部只读）：包裹 `ipcMain` 注册 **以及** 内部处理器映射
   （代码在 `qqnt-plugin-debug` 里），然后再重复该动作。
4. **如果是 UI 侧的动作，就试 DOM 层**：捕获阶段点击监听，并检查 QQ 的处理器是否在
   main world（`elementFromPoint` + `getEventListeners` 不可用；改为记录你的
   `preventDefault()` 到底有没有拦住它）。
5. **若 2–4 全程静默 → 它就是原生的。** 如实告知，并给出二选一：事后补救方案（同时说明其
   延迟/竞态问题）或原生设置。**不要**再花一轮设计去猜。
