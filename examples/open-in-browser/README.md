# 反面案例：open-in-browser（链接外部打开）

> **本示例默认不建议安装。** 这是一个**失败**的尝试，保留下来是为了当教材：
> 它想解决的问题，QQ 自己有一个开关可以解决。要装请自行评估风险。

## 目标

让 QQ 里所有 `http(s)` 链接都走**系统默认浏览器**，不再走 QQ 内置浏览器、也不再经过它的拦截页。

## 它做了什么

| 层 | 做法 |
| --- | --- |
| 渲染进程（`renderer.js`） | 在主世界直接替换 `window.open`：`http(s)` 的请求转交出去并返回 `null`；早期版本还拦过页面里的链接点击 |
| 预加载（`preload.js`） | 通过 `contextBridge` 暴露 `openInBrowser.open(url)`，把请求送回主进程（走主进程的去重逻辑） |
| 主进程（`main.js`） | `shell.openExternal` 真正外开；同一 URL **2 秒内只开一次**去重；`setWindowOpenHandler` 兜底拦 `window.open`；包装 webContents 的 `loadURL`，并挂 `will-navigate` / `will-redirect` / `did-start-navigation`，一旦要导航到 `http(s)` 就 `preventDefault` + `wc.stop()` + 把内置浏览器窗口 `hide()` 掉（非 `webview` 类型才拦） |
| 主进程（v2.1 的「主路径」） | 往 QQ 内置浏览器窗口（`app://./renderer/qqBrowser.html`）里注入脚本：监听 `#qqb-tabs`，一旦出现标签就自动点它自己工具栏的「用默认浏览器打开」按钮 `#qqb-default-browser-button`，然后把内置标签全部关掉 |
| 其它兜底 | 包装 `webContents.send` 改老版 QQ 的 `checkUrlsResult` 载荷；还留了个渲染进程 IPC 通道 `open-in-browser:open` |

## 为什么最终失败（实测证据）

核心事实：**QQ 打开内置浏览器、以及工具栏上那个「用默认浏览器打开」图标，都是原生外壳（QQNT.dll）实现的**，不是 JS 层。

实测过程与结果：

1. **包装 IPC 处理器 —— 0 命中。** 包住当时**已注册的 59 个 invoke 处理器 + 15 个 on 通道**后，点链接、点那个图标，**一条都没有被调用**。也就是说这两个动作根本不经过 Electron 的 `ipcMain`。
2. **`shell.openExternal` 从未被调用。** 插件层压根拿不到外壳那个「方法」，没有可 hook 的入口。
3. **导航钩子全部静默。** `loadURL` / `will-navigate` / `will-redirect` / `did-start-navigation` 一个都没触发 —— 内置浏览器的打开不是走这些 Electron 导航路径。
4. **「事后转发」也不稳定。** 只剩「等内置浏览器页面出现，再点它的按钮」这条路，于是必须：
   - 等 QQ 把内置页开出来；
   - 等它的按钮就绪（**实测慢站在页面上要等 10–20 秒**，脚本里只能 1 秒一轮重试）；
   - 还要处理 **QQ 有时一次点击开两个标签** 的情况 —— 于是变成「重复外开」，只能再靠 2 秒去重和反复关标签来掩饰。
5. 由此而来的种种丑陋补丁（15 秒启动保护、3 秒冷却、localStorage 记录已转发、250 ms × 20 次反复关标签）本身也说明：**这是在不该下手的地方下手。**

结论：**在插件层拦 QQ 内置浏览器，路走不通。**

## 正解

QQ 自带设置就有这个开关：

> **设置 → 通用 / 其他 → 「使用系统默认浏览器打开网页」**

对应的控件是 `.q-switch[role=switch]`，打开它，所有网页链接就交给系统默认浏览器了。

**打开这个开关即可，不要装这个插件。**

## 保留它的价值

- 作为**方法论案例**：遇到「我要改 QQ 某个行为」时，先查**原生设置**能不能直接做到，再确认那个行为**到底能不能 hook** —— 本例是典型的「原生外壳做的事，JS 插件碰不到」。
- 里面的**探测代码可以复用**：
  - 包装 IPC 处理器统计命中（`ipcMain` 包装思路，见 `main.js` 的 `patchSend` / 导航钩子部分）；
  - DOM 命中测试（`elementFromPoint`，见 `dsh-debug-logger` 的示例探针 A）；
  - `executeJavaScript` 向指定窗口注入脚本（`hookQQBrowser`）—— 在确实需要操作某个页面 DOM 时很有用。

## 风险提示

**本示例默认不建议安装。** 若仍要安装，请自行评估：它会改写 `window.open`、包装 webContents 的 `loadURL`/`send`，并可能隐藏或关闭窗口、自动点击 UI，在 QQ 升级后行为不可预期。

文件（原样复制，未做任何修改）：

```text
main.js        646972EF5F699B1E10A3F7971CF75D47B1F0C416E4291F1844D6DF3EDBF04D8C
manifest.json  40C8D539585EDE897486FDFDBDDA3C07B8F5C482BB577A893408AC41F825472C
preload.js     27AC854E5375C90062502985E4A5C0349F8661A68B3CB5C535C7823ADDC247B7
renderer.js    A081E9AC55184684C917EDBB88AD231FE0163E71A105BFCAB29A4F27FBFED097
```
