# agent_readme.md

**读这一份就够开工。** 面向"新接手 QQNT 插件开发/排障"的 agent。人类入口见 [README.md](README.md)。

- 实测环境：**QQ NT 9.9.33-52230 (x64)** + **LiteLoaderQQNT fork 5.2.1** + **Electron 40** + Windows（2026-10）
- 这是**经验仓库**，不是官方文档。所有"实测"结论都带证据，写在 `docs/qqnt-internals.md` / `docs/debugging.md` 里。

---

## 0. 最短路径（照做）

```text
1) 装调试插件：复制 plugins/dsh-debug-logger/ → <profile>/plugins/dsh-debug-logger/ → 重启 QQ
2) 确认活着：<profile>/data/dsh-debug-logger/console.log 首行有 "loaded v…"
3) 要探页面/查元素/看桥接 API：把 JS 写进 <profile>/data/dsh-debug-logger/eval.txt
   → 插件在所有窗口执行 → 结果在 <profile>/data/dsh-debug-logger/eval-result.log
4) 写插件：按 docs/plugin-development.md 的骨架 + 本文 §3 硬规则
5) 排障：先看 errors.log，再按 docs/debugging.md 的探针套路定位
```

`<profile>` = 环境变量 `LITELOADERQQNT_PROFILE`，未设置时是 LiteLoaderQQNT 加载器根目录。

---

## 1. 接手前先问三个问题（能省掉整轮白干）

1. **QQ 自己有没有原生设置/开关？** 有就用它，别写插件。
   已知例子：链接外开 = 设置 → 通用/其他 →「使用系统默认浏览器打开网页」（控件 `.q-switch[role=switch]`）。
2. **这件事经不经过 JS 层？** 见 §2 的实测边界表。原生外壳做的事，插件拦不住。
3. **改动会不会被文件校验挡？** 改 `<app>` 下的文件（`package.json` 等）会被 RSA 签名校验拦，导致启动报「文件已损坏」；先读 `docs/qqnt-internals.md`。

---

## 2. 实测边界表（哪些能 hook，哪些不能）

| 目标 | 能不能 | 证据/做法 |
|---|---|---|
| 拦 `window.open`（页面里） | ✅ | renderer 插件在主世界覆盖 `window.open` |
| 拦 `<a>` 点击 | ⚠️ 只对"主世界监听器"有效 | 捕获阶段能抢先，但 QQ 自己的触发器不在这一层 |
| 包 `ipcMain.handle/on` 的**新注册** | ✅ | 插件在 QQ 之前加载（LLQQNT 先于 app_launcher 执行） |
| 包**已注册**的 invoke 处理器 | ✅ | 包 `ipcMain._invokeHandlers`（Map，内部 API）+ `ipcMain._events` |
| 改 `window.ipcRenderer`（页面里那个桥） | ❌ | 是 contextBridge **冻结**对象，`send/invoke` 都只读 |
| 拦 QQ 开"内置浏览器" | ❌ | 包了 59 invoke + 15 on 通道后 0 命中；`loadURL`/`will-navigate`/`will-redirect`/`did-start-navigation` 全未触发 → 原生外壳干的 |
| 拦"用默认浏览器打开"图标 | ❌ | 同上；`shell.openExternal` **从未**被调用 |
| 给 `qqBrowser.html`（内置浏览器外壳页）注入脚本 | ✅（只能 main 注入） | LLQQNT **不会**把 renderer 插件注入这个页面；要用 `webContents.executeJavaScript` |
| 观察窗口创建/显示 | ✅ | `app.on('browser-window-created')` + 包 `BrowserWindow.prototype.show/focus`（本仓库日志插件已做） |

**结论**：想"阻止"QQ 的原生行为，插件层基本做不到；能做的是**观察**和**在 JS 层能碰到的地方改**。要做原生级别的事，只能是 DLL hook（不在本仓库范围）。

---

## 3. 硬规则（都踩过）

1. **不要留下会被重放的自测负载。** `eval.txt` 在旧版本里每次 QQ 重启都会重放 → 曾把 QQ 第一个窗口导航到测试 URL，导致主界面起不来 + 两次 AppHang。现在插件启动时会把已存在的 `eval.txt` 记为"已执行"，但**你自己也别把"会改状态"的脚本留在里面**；用完清空。
2. **任何改 QQ 状态/文件的探针，先想好回滚**，并先备份（例如 `QQNT.dll` 动手前必须复制一份）。
3. **别用推断代替探针。** 我曾在排查里推断"`fuck_sidebar` 因 9.9.33 改用 `title` 而失效"，后来被实测推翻：`.sidebar__nav`/`.sidebar__menu` 都在、`.nav-item` 用的就是 `aria-label`，而该插件要隐藏的项（`频道`/`更多`）确实是 0×0（未隐藏的 `消息`/`联系人` 是 36×36）—— **它在正常工作**。判断"没生效"要看可观测结果（`querySelectorAll(sel).length` + `getBoundingClientRect()`），不要看选择器"长得像不像"。
4. **同名 `slug` 的两个插件目录只会加载一个**（谁赢取决于目录读取顺序）——先查重名。
5. **`dependencies` 只保证加载顺序，不会自动安装**依赖插件。
6. **preload 在辅助窗口刷 `Cannot bind an API on top of an existing property` 是所有插件的共同噪声**，不是你的 bug；`screenshot.html` 里加载器自己的 `module.js` 也会加载失败（`reading 'path'`）。
7. **改 `<app>` 里的文件前先读 `docs/qqnt-internals.md`**：9.9.33 有 RSA 签名校验，直接改 `package.json` = 启动报「文件已损坏」。
8. **QQ 更新后要重做安装**：app 目录会变成 `<QQNT>\versions\<新版本>\resources\app`，签名补丁与新 stub 都要对新版本重打。
9. **不要提交个人数据**：QQ 号、聊天内容、`rkey`/token、真实用户名、真实绝对路径（用 `<QQNT>`/`<app>`/`<profile>` 占位）。
10. **第三方插件有账号风险**，涉及绕过校验/注入的操作先告知用户。

---

## 4. 探针速查（写进 `eval.txt`，结果看 `eval-result.log`）

```js
// ① 谁挡住了按钮（命中测试）
(() => { const e = document.elementFromPoint(30, 596);
  return e ? e.tagName + "." + String(e.className).slice(0,40) + " pe=" + getComputedStyle(e).pointerEvents : null; })()

// ② 枚举页面里的"桥接对象"（QQ 把自己的 API 挂在 window 上）
(() => { const out = [];
  for (const k of Object.keys(window)) { const v = window[k];
    if (!v || typeof v !== "object") continue;
    const fns = Object.keys(v).filter(f => { try { return typeof v[f] === "function"; } catch(e){ return false; } });
    if (fns.length) out.push(k + ": " + fns.slice(0,12).join(",")); }
  return out.slice(0, 40); })()

// ③ 某窗口的 DOM 概览（class/title/aria 过滤）
(() => [...document.querySelectorAll("[title],[aria-label]")].slice(0,20)
  .map(e => ({ tag: e.tagName, cls: String(e.className).slice(0,40), t: e.getAttribute("title") })))()

// ④ 计算样式/内联样式（查"为什么看不见/点不到"）
(() => { const e = document.querySelector("#background-video"); if (!e) return "no el";
  const cs = getComputedStyle(e); return { display: cs.display, pe: cs.pointerEvents, z: cs.zIndex,
    rect: [e.getBoundingClientRect().width, e.getBoundingClientRect().height] }; })()
```

- 合成 `click` **不会**触发 QQ 某些处理器（需要真实输入）；需要真实鼠标时用 Win32 `SetCursorPos` + `mouse_event`，坐标 = 窗口 `GetWindowRect` + 页面 `getBoundingClientRect`（DPI=1 时）。
- 抓 IPC：包 `ipcMain.handle/on`（抓之后注册的）+ `ipcMain._invokeHandlers`/`ipcMain._events`（抓已注册的）。
- 更多探针与案例复盘见 `docs/debugging.md`。

---

## 5. 插件骨架（最小可用）

```text
<profile>/plugins/my-plugin/
  manifest.json     # manifest_version:4, slug, version, platform, injects{main,preload,renderer}
  main.js           # Electron 主进程：可 require('electron')、全局 LiteLoader
  preload.js        # 有 Node：contextBridge / ipcRenderer
  renderer.js       # 页面主世界 ESM：window.LiteLoader.api.*
<profile>/data/my-plugin/   # 自己的配置/数据（LiteLoader.api.config.get/set）
```

- main 侧常用：`LiteLoader.path.{root,data,profile,plugins}`、`LiteLoader.package.qqnt.version`、`exports.onBrowserWindowCreated(win)`
- renderer 侧常用：`window.LiteLoader.api.openExternal(url)`、`openPath(path)`、`config.get/set`、`plugin.*`
- 细节与配方：`docs/plugin-development.md`

---

## 6. 安装/绕校验（改 QQ 本体时读这一节）

1. QQ 9.9.33 的 app 目录在 `<QQNT>\versions\<ver>\resources\app`（存在 `versions` 目录时）。
2. 直接改 `<app>\package.json` → 启动必炸（RSA 签名校验）。可行做法是按签名补丁改 `<QQNT>\versions\<ver>\QQNT.dll` 偏移 **0x510197**：`48 89 CE 48 8B 11 4C 8B 41 08 49 29 D0 48 8B 49 18 E8` → 同前缀 + `B8 01 00 00 00`（`mov eax,1`）。
3. 加载器入口：`<app>\app_launcher\<名>.js` 写 `require(String.raw\`<加载器绝对路径>\`)`，并把 `<app>\package.json` 的 `main` 改成该文件。
4. 动手前**备份** `QQNT.dll`（约 200 MB）与原 `package.json`；QQ 更新后重复步骤 1-3。
5. 老办法 `dbghelp.dll` 代理在新版**无效**（MinHook 签名匹配不上 QQNT.dll）。

完整背景与证据：`docs/qqnt-internals.md`。

---

## 7. 交付前的自检清单

- [ ] 插件在 9.9.33 上真的加载了（`<profile>/data/<slug>/` 有写入，或设置页能看到）
- [ ] `errors.log` 里没有**你引入的**新报错（注意 preload 的公共噪声）
- [ ] 改了别人插件的选择器/逻辑时，验证过目标 DOM 真的匹配（§4 探针①③④）
- [ ] 没留下会重放的自测脚本
- [ ] 没有个人数据进仓库/日志附件
- [ ] 涉及改 QQ 原文件的，用户已被告知风险与回滚方式
