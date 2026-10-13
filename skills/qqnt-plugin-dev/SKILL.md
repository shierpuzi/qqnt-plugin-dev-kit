---
name: qqnt-plugin-dev
description: >
  Develop, debug, or repair LiteLoaderQQNT / QQNT plugins for QQ NT on Windows
  (verified on QQ NT 9.9.33-52230 + LiteLoaderQQNT fork 5.2.1 + Electron 40).
  Covers: plugin anatomy and manifest v4, main/preload/renderer injection and
  their execution worlds, LiteLoader APIs, the dsh-debug-logger black-box
  debugging toolkit (console/preload-error/uncaught-exception capture, window
  creation tracing, 5 MB log rotation, and an eval.txt "mini devtools" channel
  that runs JS in every window), DOM hit-testing probes, capturing IPC channels
  (including already-registered Electron handlers), real-mouse-event injection,
  the QQ file-verification / QQNT.dll signature patch needed to install the
  loader, and a catalogue of measured pitfalls (renderer plugins are NOT
  injected into qqBrowser.html; window.ipcRenderer is a frozen contextBridge
  object; duplicate slugs; stale eval payload replay causing QQ AppHangs; QQ's
  link opening and its "open in default browser" toolbar button are native
  shell behaviour that plugins cannot intercept). Use whenever the task
  mentions LiteLoaderQQNT, LLQQNT, QQNT plugin, 插件开发/调试, QQ 插件, lite-tools,
  NapCat, LLOneBot, qqBrowser, 内置浏览器, 背景插件, 防撤回插件, or asks to
  add/fix/debug a feature inside the QQ desktop client.
argument-hint: "[task: e.g. 'debug 某插件不生效' | 'write a plugin that ...']"
license: MIT
---

# QQNT / LiteLoaderQQNT 插件开发与调试

这个 skill 固化了一次真实插件开发+排障的全部经验。**先读完 §1 的三条铁律再动手**，能省掉几小时白干。

参考仓库（文档与工具都在里面，建议 clone 到本地再引用）：
`https://github.com/shierpuzi/qqnt-plugin-dev-kit`

| 想干什么 | 读哪个文件 |
|---|---|
| 给 agent 的最短上手路径 / 硬规则 / 实测边界表 | `agent_readme.md` |
| 从零写一个插件（manifest、三种注入、API、配方、打包） | `docs/plugin-development.md` |
| 黑盒调试方法论（日志、eval 探针、IPC 抓取、真实鼠标、案例复盘） | `docs/debugging.md` |
| QQ 9.9.33 目录/校验/加载器安装/原生与 JS 边界 | `docs/qqnt-internals.md` |
| 调试插件本体（可直接安装） | `plugins/dsh-debug-logger/`（含 `README.md` 安装说明） |
| 反面案例：插件拦"内置浏览器"为什么做不到 | `examples/open-in-browser/` |

---

## 1. 三条铁律

1. **先查 QQ 原生设置，再考虑写插件。**
   已知例子：让链接走系统浏览器 = 设置 → 通用/其他 →「使用系统默认浏览器打开网页」（控件 `.q-switch[role=switch]`）。本次真实教训：为这件事写了 4 版插件，最后发现是原生开关。
2. **先确认"这件事经不经过 JS 层"。**
   实测：QQ 的「开内置浏览器」和内置浏览器工具栏那个"用默认浏览器打开"图标都是**原生外壳（QQNT.dll）**做的 —— 包住 59 个已注册 `ipcMain` invoke 处理器 + 15 个 on 通道后点链接/点图标 **0 命中**，`shell.openExternal` 从未被调用，导航钩子（`loadURL`/`will-navigate`/`will-redirect`/`did-start-navigation`）全未触发。**原生行为插件拦不住**，只能观察或在 JS 能碰到的层面改。
3. **改 QQ 本体文件前先备份、先确认校验机制。**
   9.9.33 用 `<app>\application.json` 里的 **RSA 签名**校验文件；直接改 `<app>\package.json` → 启动报「文件已损坏, 请重新安装QQ。」+ `error code v2:-8`。可行做法是按签名补丁改 `<QQNT>\versions\<ver>\QQNT.dll` 偏移 **0x510197**（`48 89 CE 48 8B 11 4C 8B 41 08 49 29 D0 48 8B 49 18 E8` → 同前缀 + `B8 01 00 00 00`）。

---

## 2. 标准工作流

```text
① 摸清现状
   - QQ 版本/架构：<QQNT>\versions\ 下的目录名；<app> = <QQNT>\versions\<ver>\resources\app
   - 加载器：<app>\package.json 的 main 指向哪个 stub；stub 里 require 的加载器路径
   - 插件目录：<profile>/plugins/（<profile> 来自环境变量 LITELOADERQQNT_PROFILE，未设置=加载器根目录）
   - 有没有重名 slug、有没有已禁用（<profile>/data/LiteLoader/config.json 的 disabled_plugins）

② 装调试工具（本仓库插件）
   - 复制 plugins/dsh-debug-logger/ → <profile>/plugins/dsh-debug-logger/ → 重启 QQ
   - 确认：<profile>/data/dsh-debug-logger/console.log 首行 "loaded v…"，
     或 QQ 设置里出现「DSH 调试日志」

③ 先观测，再改代码
   - <profile>/data/dsh-debug-logger/errors.log 看报错（注意：辅助窗口里所有 preload 插件
     都会刷 "Cannot bind an API on top of an existing property"，是公共噪声）
   - 要探页面：把 JS 写进 <profile>/data/dsh-debug-logger/eval.txt
     → 插件在所有窗口执行 → 结果在 eval-result.log
   - 常用探针见 §3

④ 写/改插件
   - 骨架与配方：docs/plugin-development.md
   - 改别人的插件前，先用探针确认目标 DOM/事件真的匹配（9.9.33 改过很多 class/title）

⑤ 验证
   - 重启 QQ → 看 errors.log 有没有你引入的新报错 → 实际点一遍功能
   - 交付前过一遍 agent_readme.md §7 的自检清单
```

**调试时注意**：改插件文件后需要重启 QQ（main/preload/renderer 都是启动时加载）；QQ 更新后 app 目录换版本，安装与补丁都要重做。

---

## 3. 探针速查（写进 `eval.txt`）

```js
// 谁挡住了按钮 / 为什么点不到
(() => { const e = document.elementFromPoint(30, 596);
  return e ? e.tagName + "." + String(e.className).slice(0,40) + " pe=" + getComputedStyle(e).pointerEvents : null; })()

// 页面里有哪些"桥接对象"（QQ 把 API 挂在 window 上）
(() => { const out = [];
  for (const k of Object.keys(window)) { const v = window[k];
    if (!v || typeof v !== "object") continue;
    const fns = Object.keys(v).filter(f => { try { return typeof v[f] === "function"; } catch(e){ return false; } });
    if (fns.length) out.push(k + ": " + fns.slice(0,12).join(",")); }
  return out.slice(0, 40); })()

// 某元素的可见性/指针状态（查"看不见/点不到"类 bug）
(() => { const e = document.querySelector("#background-video"); if (!e) return "no el";
  const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
  return { display: cs.display, pe: cs.pointerEvents, z: cs.zIndex, w: Math.round(r.width), h: Math.round(r.height) }; })()
```

要点：
- **合成 `click` 不触发 QQ 某些处理器**（QQ 的触发器常在 preload 隔离世界或原生层）。需要真实输入时用 Win32 `SetCursorPos` + `mouse_event`；坐标 = 窗口 `GetWindowRect` + 页面 `getBoundingClientRect`（DPI=1 时）。`window.screenX/screenY` 可能过期，以 `GetWindowRect` 为准。
- 抓 IPC：包 `ipcMain.handle/on` 只能抓到"注册晚于你"的处理器；抓**已注册**的要包 `ipcMain._invokeHandlers`（Map）与 `ipcMain._events`（内部 API，注意版本差异）。
- **不要留下会被重放的自测负载**：曾经留在 `eval.txt` 里的点击脚本在每次 QQ 启动时重放，把 QQ 第一个窗口导航到测试 URL → 主界面起不来 + 两次 AppHang。现在日志插件启动时会把已存在的 `eval.txt` 记为"已执行"，但你自己也别留会改状态的脚本。

---

## 4. 能力/边界速查

| 想做的事 | 结论 |
|---|---|
| 改页面样式/注入 CSS | ✅ renderer 插件（主世界） |
| 拦 `window.open` | ✅ renderer 插件覆盖 |
| 拦 `<a>` 点击 | ⚠️ 只对主世界的监听器有效；QQ 的触发器常不在这层（先探） |
| 读写自己的配置 | ✅ `LiteLoader.api.config.get/set`（数据在 `<profile>/data/<slug>/`） |
| 新开窗口/系统浏览器/打开文件夹 | ✅ main 侧 `shell.*` / `LiteLoader.api.openExternal/openPath` |
| 观察窗口何时被创建/显示 | ✅ `app.on('browser-window-created')` + 包 `BrowserWindow.prototype.show/focus` |
| 拦 QQ 开内置浏览器 / 拦它自带的外开按钮 | ❌ 原生外壳实现（证据见 §1.2） |
| 改页面里的 `window.ipcRenderer` | ❌ contextBridge 冻结对象 |
| 给 `app://./renderer/qqBrowser.html` 注入脚本 | ✅ 但**只能**用 main 进程 `webContents.executeJavaScript`（LLQQNT 不往这个页面注入 renderer 插件） |
| 阻止 QQ 更新 / 改它文件 | ⚠️ 有 RSA 签名校验，见 §1.3；不要替用户做，先告知风险 |

---

## 5. 交付纪律

- 不写入个人数据（QQ 号、聊天内容、`rkey`/token、真实用户名、真实绝对路径 → 用 `<QQNT>`/`<app>`/`<profile>` 占位）。
- 任何"改 QQ 状态"的探针/脚本：先备份、想好回滚、用完清理。
- 涉及绕过校验、注入、改原文件的方案：先说明风险与回滚方式，再动手。
- 交付时说清楚：**实测版本**（QQ 版本 + 加载器版本），以及"哪些是实测、哪些是推测"。
