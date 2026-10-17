# DSH 调试日志（dsh-debug-logger）

一个「把该看的东西全部落盘」的排查插件：QQ 主进程 / 预加载脚本 / 渲染进程的日志、异常、窗口创建与显示、webContents 创建、以及一部分主进程 IPC 频道，统统写进 `<profile>/data/dsh-debug-logger/` 下的文本文件。再附两样工具：**迷你 devtools**（往文件里写一段 JS，插件在所有窗口执行并记录结果）和**元素选择器**（`Ctrl+Shift+C` 把界面上的元素点出来看样式）。

> 这个插件是**正在使用、已验证**的版本，从实际环境原样复制而来（逐字节一致，见文末哈希）。
> 它只读环境、只写自己的日志目录，不修改 QQ 本身的任何文件。

## 1. 能抓到什么

| 来源 | 说明 |
| --- | --- |
| 主进程 `console.warn` / `console.error` | 主进程只接管 warn / error 两个级别（`console.log` 不落盘，避免噪声淹没日志） |
| 渲染进程 `console` | 所有窗口/iframe 的 `console-message`，含 VERBOSE / INFO / WARN / ERROR，带来源 URL 与行号 |
| `preload-error` | 预加载脚本抛错（插件加载失败最常见的原因） |
| `uncaughtException` / `unhandledRejection` | 主进程未捕获异常与未处理 Promise 拒绝 |
| 窗口 `CREATED` | 谁创建了窗口（`browser-window-created`），附 `id`、`url` 与**调用栈** |
| 窗口 `SHOW/<方法>` | 对 `BrowserWindow.prototype` 的 `show` / `showInactive` / `focus` / `restore` / `moveTop` 打补丁，记录每次「窗口被显示/聚焦」的 `id`、`url` 与**调用栈** —— 专抓「自己弹出来的窗口」 |
| `WEB_CONTENTS_CREATED` | `web-contents-created` 事件，记录 webContents 类型与调用栈；同时给新 webContents 挂上上面那些监听 |
| `RENDER_GONE` / `LOAD_FAIL` | 渲染进程崩溃、页面加载失败 |
| 主进程 IPC 频道 | 包装 `ipcMain.emit`，只记录**频道名命中关键词**的调用 |

### 主进程 IPC 记录的范围与去重

包装的是 `ipcMain.emit`，只写频道名匹配 `/chat|aio|window|show|open|session|switch|focus|activate|recent|contact/i` 的调用（用于回答「谁要求开窗口 / 切会话」）。每条带来源 webContents 的 URL 与截断后的参数 JSON，同一个 `频道 + 来源 URL` 在 1.5 秒内只记一次。

这是**默认开启、写死在代码里**的，不是配置项：不想要就把 `main.js` 里 `---- 渲染进程 → 主进程 IPC 频道记录 ----` 这一段注释掉（改文件前先备份）。

## 2. 日志在哪、每个文件是什么

目录：`<profile>/data/dsh-debug-logger/`（`<profile>` 的含义见第 5 节）

| 文件 | 内容 |
| --- | --- |
| `console.log` | **全量**日志（跳过 `VERBOSE` 级别），排查基本先看它 |
| `errors.log` | 只收 `warn` / `error` / 异常类：级别匹配 `/ERROR|WARN|ASSERT|EXCEPTION/i` 的行，即渲染进程 WARN/ERROR、主进程 WARN/ERROR、`UNCAUGHT_EXCEPTION`、`UNHANDLED_REJECTION`、`PRELOAD_ERROR`、以及窗口补丁自身报的 WARN |
| `eval-result.log` | 迷你 devtools 的执行结果（见第 4 节） |
| `eval.txt` | 迷你 devtools 的**输入**文件，由你自己写（不是插件生成的日志） |

行格式：

```text
[2026-01-01T00:00:00.000Z] [logger] INFO loaded v1.3 (electron <版本>, qq <版本>, 日志上限 5MB/保留 2MB)
[2026-01-01T00:00:01.000Z] [main] ERROR 出错了
[2026-01-01T00:00:02.000Z] [renderer:<标题>:<url 尾部>] WARN 我是一条警告  @<来源>:<行号>
[2026-01-01T00:00:03.000Z] [window] SHOW/show id=3 url=...  <- <调用栈>
```

`[tag]` 里 `main` = 主进程，`renderer:…` = 某个渲染进程，`window` = 窗口/webContents 事件，`ipc` = IPC 频道记录，`logger` = 插件自身。

> 版本号说明：`manifest.json` 现在是 `1.4.0`（v1.4 新增了 `renderer.js` 元素选择器），而 `main.js` 内部自报的仍是 `v1.3` —— `main.js` 在 v1.4 里**没有改动**（只新增了 renderer 与 manifest 字段），所以日志首行还是 `loaded v1.3`。以 `console.log` 首行为准。

### 5 MB 上限与轮转规则

三个输出文件（`console.log`、`errors.log`、`eval-result.log`）**每个**都有独立上限：

- 每次追加后检查文件大小，超过 **5 MB** 就截断；
- 截断时只保留**尾部 2 MB**，并且从整行边界开始，避免留下半行；
- 截断后文件开头会多一行：`[已截断，仅保留最近 2 MB]`。

也就是说日志不会无限增长，超过上限时**早期内容会被丢弃**。需要长期留证就先把文件复制走。

## 3. 安装

1. 把 `manifest.json` 和 `main.js` **两个文件**放到 `<profile>/plugins/dsh-debug-logger/`（目录不存在就新建）。
2. **重启 QQ**（退出进程再启动，注销/重新登录不算）。
3. 验证加载成功，二选一：
   - QQ 设置里能看到插件条目「**DSH 调试日志**」；
   - `<profile>/data/dsh-debug-logger/console.log` 首行出现 `[logger] INFO loaded v…`。

`<profile>` 的确定方式：

- 设置了环境变量 `LITELOADERQQNT_PROFILE` 时，`<profile>` 就是该变量的值；
- 没设置时，`<profile>` 是 LiteLoaderQQNT 加载器的根目录。

日志目录会被自动创建，不需要手动建。

## 4. 迷你 devtools（eval 通道）

没有 devtools 的时候，用它执行一小段 JS：

1. 把要执行的 JS 写进 `<profile>/data/dsh-debug-logger/eval.txt`（整个文件就是一段代码，建议写成 `(() => { ... })()` 形式）；
2. 插件每秒轮询一次该文件，**在所有窗口**（`webContents.getAllWebContents()`）里用 `executeJavaScript(code, true)` 执行；
3. 结果追加到 `<profile>/data/dsh-debug-logger/eval-result.log`，格式为 `--- [<窗口 url>] => <返回值的 JSON，最长 4000 字符>`；执行失败记 `EXEC_FAIL <错误信息>`。

两个必须知道的行为：

- **启动时不会重放**：插件启动那一刻如果 `eval.txt` 已经存在，其内容会被记为「已执行过」，不会被再次执行（曾经因为重启后重放旧脚本，把窗口导航到测试网址导致卡死）。
- **只有内容变化才执行**：判断依据是文件内容去掉首尾空白后，是否与上一次执行过的内容不同。所以想**重复执行同一段代码**，必须让内容产生实际变化（例如换一行注释、改个字符串），纯空白差异不算。

> 安全提示：这个通道会在所有窗口执行任意 JS（包括 QQ 主界面）。别把不信任的脚本、或含敏感信息的载荷留在 `eval.txt` / `eval-result.log` 里；用完删掉这两个文件即可。

### 三个示例探针

**A. 命中测试：看屏幕中心点到底是什么元素**（配合「点不到那个按钮」类问题）

```js
(() => { const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return JSON.stringify({ url: location.href, hit: el && el.outerHTML.slice(0, 400) }); })()
```

**B. 枚举桥接对象：看这个窗口里 preload 暴露了什么**

```js
Object.keys(window).filter(k => /lite|api|bridge|open|qq|dsh|ipc/i.test(k)).map(k => k + ":" + typeof window[k]).join(", ")
```

**C. 打印当前窗口 DOM 概况**

```js
JSON.stringify({ title: document.title, url: location.href, body: document.body ? document.body.outerHTML.slice(0, 2000) : null })
```

## 5. 元素选择器（v1.4 新增）

`renderer.js` 提供了一个**类 Chrome DevTools 的元素选择器**，用来回答「这个框是谁画的」「这个元素叫什么、多大、圆角多少」。以前靠截图猜，现在直接把元素点出来。

| 操作 | 效果 |
| --- | --- |
| `Ctrl+Shift+C` | 进入/切换元素拾取模式（也可在设置页点「开始抓取」） |
| 鼠标划过元素 | 蓝框高亮 + 顶部显示 `选择器 宽x高 r=圆角` |
| 点击元素 | 选中并把类名、尺寸、圆角、背景、**样式来源规则**输出到 console |
| **按住 `Ctrl` 点击** | 多选（再次 `Ctrl` 点击同一元素 = 反选） |
| 选中后 | 详情**自动复制到剪贴板**，并弹气泡提示「已复制」 |
| `Ctrl+Shift+X` | 再复制一次已选元素详情 |
| `Ctrl+Shift+B` | 框选：拖动列出框内元素（输出到 console） |
| `Ctrl+Esc` | 逐级退出（拾取 → 框选 → 关工具） |

> 退出键用 `Ctrl+Esc` 而不是单独的 `Esc`：**QQ 自己用 `Esc` 关窗口**，占用它会导致「想退出调试反而把窗口关了」。

### 5.1 怎么把选中的元素交给别人（或交给 agent）

这是这个选择器真正的用途：**用户负责指，详情自动变成文本**。以前要说「联系人列表里那一项」，现在点一下就够。

三条路径，任选：

1. **剪贴板（默认，给人用）**：选中后详情**自动复制**，直接粘贴即可。内容包括类名、尺寸、圆角、背景，以及**命中的 CSS 来源规则**（哪个样式表、哪条选择器）。
2. **日志文件（给 agent 用）**：详情同时会写进
   `<profile>/data/dsh-debug-logger/console.log`，前缀 **`[dsh-picker:json]`**，后面是可直接解析的 JSON。用 `grep` / `Select-String` 精确抓最近一次选择即可：

   ```powershell
   Select-String -Path "$env:USERPROFILE\..\path\to\console.log" -Pattern "dsh-picker:json" | Select-Object -Last 1
   ```

   实际条目形如：

   ```text
   [dsh-picker:json] [{"info":{"tag":"DIV","cls":"item__content item-dragging-over",
     "selector":"div.viewport-list... > div.recent-contact-item > div.item__content",
     "rect":{"w":304,"h":72,"left":64,"top":340},"radius":"14px",
     "boxShadow":"none","background":"rgba(0, 0, 0, 0.06)","zIndex":"auto",
     "normalized":{"x":0.0546,"y":0.4509,"w":0.2594,"h":0.0955}},
     "rules":[{"owner":"lens-skin","selector":"body:is(...) .recent-contact-item .item__content",
               "bg":"-","radius":"var(--lg-chrome)","shadow":"-"}]}]
   ```

   `rules` 就是「谁画的这个框」的答案 —— 一个原始命中测试探针给不出这些。

   > **实测坑**：不要把对象直接 `console.log` 就以为日志能读到。本插件是把渲染进程的 console
   > 转发到文件（`wc.on("console-message")`），而 Chromium 传过来的是**已序列化的字符串** ——
   > 对象会变成字面的 `[object Object]`。所以选择器**额外**打了一行 JSON 字符串；
   > 如果你自己写类似的日志转发，同样要 `JSON.stringify`。

3. **控制台**：DevTools 里搜 `[dsh-picker]`（人能看）或 `[dsh-picker:json]`（能解析）。

### 自定义快捷键

设置页（QQ 设置 → 插件 → DSH 调试日志）里有「自定义快捷键」区：**点一下输入框，然后直接按你想用的组合键**即可（与 QQ 原生设置一致，直接侦听键盘；单独按 `Esc` 取消录制）。改完点「应用并保存」，**立即生效、无需重启**，主界面会通过 `storage` 事件同步。

也可以用代码改：

```js
window.__dshPicker.setHotkeys({ pick: "F8" })   // 单键也行
window.__dshPicker.getHotkeys()
```

### 一个实测坑：剪贴板

`navigator.clipboard.writeText` 在 QQ 里会抛 `NotAllowedError: Document is not focused`（Electron 要求文档有焦点）。所以复制走**双路径**：先试 Clipboard API，失败立刻退到 `document.execCommand("copy")`（实测后者对失焦窗口有效）。

### 调试中途接手？注意模块实例

`local://profile/...` 与 `local:///E:/...` 是**两个不同的模块实例**。用 eval 通道做探针时，请用页面自己的实例（`window.__dshPicker`），不要自己 `import` —— 否则你操作的是另一份状态，还会多建一层覆盖层。

## 6. 停用 / 卸载

- 在 LiteLoaderQQNT 的设置界面里禁用该插件；或
- 把 `dsh-debug-logger` 加进 `<profile>/data/LiteLoader/config.json` 的 `disabled_plugins` 数组：

```json
{
  "disabled_plugins": ["dsh-debug-logger"]
}
```

- 彻底卸载：删掉 `<profile>/plugins/dsh-debug-logger/` 目录；日志文件在 `<profile>/data/dsh-debug-logger/`，按需自行清理。

## 7. 已知无关噪声

在**辅助窗口**里，所有带 preload 的插件都会刷：

```text
Cannot bind an API on top of an existing property
```

这是 LiteLoaderQQNT 加载器侧的问题（同一个属性被多次 `contextBridge` 绑定），**与本插件无关**，也**不会**影响日志功能。看到它不用当成 bug 追。

## 8. 文件哈希（SHA256）

原样复制自实际在用的插件，可与源文件比对（哈希基于 **LF 换行** 的原始文件；Windows 上 checkout 成 CRLF 后哈希会不同，属正常）：

```text
main.js        14B58FE71478EEF4BC7C1C3E07259D82C47BFC99CCC2ED2AEAA15664F8A29C60
manifest.json  B97278333952356A043A7A79EB5545CA76CC02A3CBBDC8CAF0151CF6A49CE3C2
renderer.js    E562B09EB7881A5305F2234E42826A0211ABC9283605FC107F924E5DC473EA81
```

`main.js` 的哈希与 v1.3 完全一致 —— v1.4 没有改动主进程脚本。`renderer.js` 是 v1.4 新增，此后修过一次
（把选中详情以 JSON 字符串写进日志，见 §5.1 的实测坑），所以哈希与 v1.4 首发版本不同。
