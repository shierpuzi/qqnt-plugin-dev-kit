# AGENT_README_ZH.md

**读这一份就能开工。** 面向接手 QQNT / LiteLoaderQQNT 插件开发或排障的 agent。人类入口：[README.md](README.md)。
英文母本（权威）：[AGENT_README.md](AGENT_README.md)。

- 实测环境：**QQ NT 9.9.33-52230 (x64)** + **LiteLoaderQQNT fork 5.2.1** + **Electron 40** + Windows（2026-10）
- 这是**经验仓库**，不是官方文档。所有"实测"结论都在
  `docs/qqnt-internals.md` / `docs/debugging.md` 里带着证据（这两份目前是中文）。
- 深入阅读：[docs/plugin-development.md](docs/plugin-development.md)、[docs/debugging.md](docs/debugging.md)、
  [docs/qqnt-internals.md](docs/qqnt-internals.md)。

> **免责声明** —— 动手改任何东西之前，先把这段向用户转述一次。本仓库存在的目的是
> **教育与软件架构、JavaScript 注入技术的研究**。不得违反软件保护相关法律；不得逆向工程 / 修改 / 分发被修改过的
> 腾讯 QQ 程序；不得制作或分享用于侵入、非法控制计算机信息系统的程序、工具（《刑法》第 285 条第 3 款
> 提供侵入、非法控制计算机信息系统程序、工具罪）；不得侵犯腾讯的著作权与技术保护措施（《刑法》第 217 条
> 侵犯著作权罪）；不得破坏计算机信息系统（《刑法》第 286 条破坏计算机信息系统罪）；不得将其中任何内容用于
> 商业用途；不得逆向分发。用户必须自行确保自己对 QQ 客户端的使用已获得合法授权。作者对滥用行为不承担任何责任
> —— **风险自担**。使用本工具集即视为接受上述条款。

---

## 0. 最短路径（照做）

```text
1) 装调试插件：复制 plugins/dsh-debug-logger/ 到 <profile>/plugins/dsh-debug-logger/ 并重启 QQ
2) 确认它活着：<profile>/data/dsh-debug-logger/console.log 首行含 "loaded v…"
3) 要探页面 / 找元素 / 列桥接 API：把 JS 写进
   <profile>/data/dsh-debug-logger/eval.txt
   → 插件会在每个窗口执行它 → 结果落在
   <profile>/data/dsh-debug-logger/eval-result.log
4) 写插件：从 §6 的骨架开工，并遵守 §3 的硬规则
5) 排障：先看 errors.log，再照 docs/debugging.md 里的探针配方做
```

`<profile>` = 环境变量 `LITELOADERQQNT_PROFILE`，未设置时是 LiteLoaderQQNT 加载器自己的根目录。

---

## 1. 写代码前先问三个问题（每一个都省下过一整轮白干）

1. **QQ 自己有没有原生的设置或开关？** 有就用它 —— 别写插件。
   已知例子：链接外开 = 设置 → 通用/其他 → **「使用系统默认浏览器打开网页」**
   （控件 `.q-switch[role=switch]`）。
2. **这件事到底经不经过 JS 层？** 见 §2 的实测边界表。原生外壳的行为，插件拦不住。
3. **文件校验会不会把我的改动挡回去？** 改 `<app>` 下的文件（例如 `package.json`）会触发
   RSA 签名校验，QQ 会弹「文件已损坏」并拒绝启动。先读 `docs/qqnt-internals.md`。

---

## 2. 实测边界表（哪些能 hook，哪些不能）

| 目标 | 能不能 | 证据 / 做法 |
|---|---|---|
| 拦 `window.open`（页面内） | ✅ | renderer 插件在主世界覆盖 `window.open` |
| 拦 `<a>` 点击 | ⚠️ 只对主世界监听器有效 | 捕获阶段能抢先，但 QQ 自己的触发器往往不在这一层 |
| 包**新注册**的 `ipcMain.handle/on` | ✅ | 我们的插件比 QQ 的 app 代码先加载（LLQQNT 先于 app launcher 执行） |
| 包**已注册**的 invoke 处理器 | ✅ | 包 `ipcMain._invokeHandlers`（一个 Map，内部 API）+ `ipcMain._events` |
| 替换页面里的 `window.ipcRenderer` | ❌ | 它是 contextBridge 的**冻结**对象，`send/invoke` 都是只读的 |
| 拦 QQ 打开它自己的内置浏览器 | ❌ | 包了 59 个 invoke + 15 个 on 通道后**0 命中**；`loadURL` / `will-navigate` / `will-redirect` / `did-start-navigation` 全都没触发 → 原生外壳干的 |
| 拦工具栏的「用默认浏览器打开」图标 | ❌ | 同上；`shell.openExternal` **从未**被调用 |
| 往 `qqBrowser.html`（内置浏览器外壳页）注入脚本 | ✅（只能在 main 进程做） | LLQQNT **不会**把 renderer 插件注入那个页面；要用 `webContents.executeJavaScript` |
| 观察窗口创建 / 显示 | ✅ | `app.on('browser-window-created')` + 包 `BrowserWindow.prototype.show/focus`（本仓库的日志插件就是这么做） |

**结论**：想从插件层**阻止** QQ 的原生行为，基本做不到；插件能做的是**观察**，以及改变 JS 层自己拥有的东西。
再往下就只剩 DLL hook 了，那不在本仓库范围内。

---

## 3. 硬规则（每一条都是踩出来的）

1. **绝不留下会被重放的自测负载。** 调试插件的旧版本每次启动 QQ 都会重跑 `eval.txt`；一个残留的「造个链接再点它」
   脚本把 QQ 的第一个窗口导航到了测试 URL，主界面因此起不来，QQ 卡死了两次（Windows AppHang）。现在它会把已存在的
   `eval.txt` 内容标记为"已执行"，但**别把会改状态的脚本留在里面**；用完就清空。
2. **任何会改 QQ 状态或文件的探针，先想好回滚**，并先备份（例如打补丁前先复制 `QQNT.dll`，约 200 MB）。
3. **别信旧版本的选择器 —— 更别用推断代替探针。** 实测：曾推断 `fuck_sidebar` 已失效（理由：9.9.33 "改用 `title`"），
   探针把它推翻了：`.sidebar__nav`/`.sidebar__menu` 存在，`.nav-item` 用的是 `aria-label`，而它隐藏的项（`频道`/`更多`）
   确实是 0×0，其它项是 36×36。**它是生效的。** 判断"有没有生效"要用可观测结果
   （`querySelectorAll(sel).length` + `getBoundingClientRect()`），不要用选择器长得像不像来推断。
4. **两个 `slug` 相同的插件目录只会加载一个**（目录扫描最后读到的那个赢）。
5. **`dependencies` 只决定加载顺序** —— 它不会帮你装上依赖插件。
6. **辅助窗口里的 `Cannot bind an API on top of an existing property` 是所有插件共有的噪声**，每个插件的
   preload 都会刷；加载器自己在 `screenshot.html` 里的 `module.js` 失败（`reading 'path'`）也是同理。
7. **改 `<app>` 下的文件前先读 `docs/qqnt-internals.md`**：9.9.33 用 RSA 签名校验它们。
8. **QQ 更新后要重做安装**：app 目录会变成
   `<QQNT>\versions\<新版本>\resources\app`；签名补丁和 stub 都得对新版本重打一遍。
9. **绝不提交个人数据**：QQ 号、聊天内容、`rkey`/token、真实用户名、真实绝对路径
   （用 `<QQNT>` / `<app>` / `<profile>` 占位）。
10. **第三方插件带账号风险**；做任何绕过校验或注入代码的事之前，先告诉用户。

---

## 4. 与用户配合测试（问询，频繁地用 ask 工具）

插件的多数事实只在用户**正在运行**的客户端上才可观测（DOM 长什么样、哪个层处理某个动作、某个修复到底有没有生效）。
**预期要来回测好几轮；别想着一次做完。**

- **在 DSH（DeepSeek Harness）上**：用 **`ask_user_question`**。它向用户要一个确认、一个选择或缺失的信息，并等待回答
  （默认阻塞等待）。每个问题给一个 `id`、一个简短的 `header`、一个具体的 `question`，以及**带一句话说明的 `options`，
  推荐项放第一个**；可能有多个答案同时成立时设 `multi_select: true`。用户也可以自己写 `custom` 自由答案，或跳过某一项。
  答案形如 `{"answers":[{"id","selected","custom"}]}`。**等待人类回答不消耗 token。** 变体：`mode: timed` +
  `timeout` 让模型在问题仍可回答的同时继续干活；`timeout: -1` 表示无限等待。挂在别的 agent 名下、仍存活的子 agent
  不能向用户提问 —— 它必须把未决问题写进自己的最终结果里。
- **在其它 agent 平台上**：自查你的环境有没有等价能力（elicitation / 人机交互工具 / 审批提示）；如果确实没有，
  就把确切的测试步骤和需要回报的内容讲清楚。
- **一轮只做一个小而决定性的测试。** 反例："麻烦把所有功能都测一遍"。正例："点一个聊天里的链接，然后选：
  ① 在我的系统浏览器里打开 ② 弹出 QQ 内置浏览器 ③ 什么都没发生"。
- **会改状态的动作先说明再做**（装插件、改文件、重启 QQ），并说清怎么回滚。
- 把互相独立的问题合并成一次调用；在机制还没被验证之前，持续问。

---

## 5. 探针速查（写进 `eval.txt`，读 `eval-result.log`）

```js
// 1) 谁在偷点击 / 某个控件为什么点不到
(() => { const e = document.elementFromPoint(30, 596);
  return e ? e.tagName + "." + String(e.className).slice(0,40) + " pe=" + getComputedStyle(e).pointerEvents : null; })()

// 2) 列出页面暴露的"桥接对象"（QQ 把自己的 API 挂在 window 上）
(() => { const out = [];
  for (const k of Object.keys(window)) { const v = window[k];
    if (!v || typeof v !== "object") continue;
    const fns = Object.keys(v).filter(f => { try { return typeof v[f] === "function"; } catch(e){ return false; } });
    if (fns.length) out.push(k + ": " + fns.slice(0,12).join(",")); }
  return out.slice(0, 40); })()

// 3) 某个窗口的 DOM 概览（按 class/title/aria 过滤）
(() => [...document.querySelectorAll("[title],[aria-label]")].slice(0,20)
  .map(e => ({ tag: e.tagName, cls: String(e.className).slice(0,40), t: e.getAttribute("title") })))()

// 4) 计算样式 / 内联样式（查某个东西为什么看不见或点不动）
(() => { const e = document.querySelector("#background-video"); if (!e) return "no el";
  const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
  return { display: cs.display, pe: cs.pointerEvents, z: cs.zIndex, w: Math.round(r.width), h: Math.round(r.height) }; })()
```

- 合成 `click` **不会**触发 QQ 的某些处理器（它们的触发器常常在 preload 的隔离世界或原生代码里）。需要真实输入就用
  Win32 `SetCursorPos` + `mouse_event`；屏幕坐标 = 窗口 `GetWindowRect` + 页面 `getBoundingClientRect`（DPI 缩放为 1 时）。
  `window.screenX/screenY` 可能是过期的 —— 信 `GetWindowRect`。
- 抓 IPC：包 `ipcMain.handle/on` 只能抓到**在你之后**注册的处理器；要抓**在你之前**注册的，包
  `ipcMain._invokeHandlers` / `ipcMain._events`（内部 API —— 每个版本都要自己验一遍）。
- 更多配方和四个案例复盘：`docs/debugging.md`。

---

## 6. 插件骨架（最小可用）

```text
<profile>/plugins/my-plugin/
  manifest.json     # manifest_version:4, slug, version, platform, injects{main,preload,renderer}
  main.js           # Electron 主进程：require('electron') 可用，全局 LiteLoader 可用
  preload.js        # 有 Node：contextBridge / ipcRenderer
  renderer.js       # 页面主世界，ESM：window.LiteLoader.api.*
<profile>/data/my-plugin/   # 你自己的配置/数据（LiteLoader.api.config.get/set）
```

- main 侧：`LiteLoader.path.{root,data,profile,plugins}`、`LiteLoader.package.qqnt.version`、
  `exports.onBrowserWindowCreated(win)`
- renderer 侧：`window.LiteLoader.api.openExternal(url)`、`openPath(path)`、`config.get/set`、`plugin.*`
- 完整指南与配方：`docs/plugin-development.md`

---

## 7. 安装加载器 / 绕校验（只在要动 QQ 本体时读）

1. QQ 9.9.33 上 app 目录是 `<QQNT>\versions\<ver>\resources\app`（只要存在 `versions` 目录就是这样）。
2. 只改 `<app>\package.json` 会让 QQ 拒绝启动（RSA 签名校验）。可行路线是给
   `<QQNT>\versions\<ver>\QQNT.dll` 打签名补丁，偏移 **0x510197**：
   `48 89 CE 48 8B 11 4C 8B 41 08 49 29 D0 48 8B 49 18 E8` → 同前缀 + `B8 01 00 00 00`（`mov eax,1`）。
3. 加载器入口：建 `<app>\app_launcher\<name>.js`，内容为 `require(String.raw\`<absolute loader path>\`)`，
   再把 `<app>\package.json` 的 `main` 指向该文件。
4. 先**备份** `QQNT.dll`（约 200 MB）和原始 `package.json`；每次 QQ 更新后重复步骤 1-3。
5. 老的 `dbghelp.dll` 代理方案在这个版本上**已经无效**（它的 MinHook 签名匹配不上
   `QQNT.dll`）。完整背景与证据：`docs/qqnt-internals.md`。

---

## 8. 交付前自检清单

- [ ] 插件在 9.9.33 上真的加载了（会写 `<profile>/data/<slug>/`，或在设置页里能看到）
- [ ] `errors.log` 里没有**你引入的**新错误（记得 preload 的公共噪声）
- [ ] 如果你改了别的插件的选择器/逻辑，你验证过目标 DOM 确实匹配（§5 探针 1/3/4）
- [ ] 没有留下会被重放的自测脚本
- [ ] 仓库里和随附日志里都没有个人数据
- [ ] 任何会碰 QQ 自身文件的操作：用户已被告知风险和回滚路径
- [ ] 任何会改变用户客户端状态的步骤（装插件、改文件、重启 QQ）都已先说明并给出回滚方式（§4）
- [ ] 同名 `slug` 的插件目录已查重（§3 第 4 条）

---

> **适配范围**：本文件与配套 skill 针对 **DSH（DeepSeek Harness）** 编写与实测（工具名、`ask_user_question`、`eval.txt` 流程均为 DSH 特有）；**未在其它的 agent 平台上测试过**，其它平台请先在自己环境里验证再套用。
