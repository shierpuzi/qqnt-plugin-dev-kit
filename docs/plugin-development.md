# LiteLoaderQQNT 插件开发指南（给新来的 agent）

> **适用范围与版本：实测于 QQ NT 9.9.33-52230 + LiteLoaderQQNT 5.2.1 (2026-10)，其它版本可能不同。**
>
> 本文里的 API、钩子、目录规则都核对过 5.2.1 的加载器源码（`<loader>/src/**`），
> 标注 **【实测】** 的结论来自本仓库这次真实调试（QQ NT 9.9.33-52230 x64 / Electron 40 / Windows）。
> 加载器安装、目录校验等机制细节见 [`qqnt-internals.md`](qqnt-internals.md)；调试手法见 [`debugging.md`](debugging.md)。

本文目标：读完能**从零写出一个在 QQ NT 9.9.33 上跑得起来的插件**，并知道出错时去哪里看。

---

## 0. 先搞清楚三个路径

| 占位符 | 含义 | 本机实例 |
|---|---|---|
| `<QQNT>` | QQ NT 安装根目录 | `C:\Program Files\Tencent\QQNT` |
| `<loader>` | LiteLoaderQQNT 加载器自己的目录（安装位置随意，本机放在 `<QQNT>` 同级） | `<QQNT>` 同级目录 `LiteLoaderQQNT-5.2.1` |
| `<app>` | QQ 的应用包目录（`package.json` / `application.asar` 所在处） | `<QQNT>\versions\<版本>\resources\app` |
| `<profile>` | 插件目录与数据目录的根 | 环境变量 `LITELOADERQQNT_PROFILE` 的值 |

```
<profile>\plugins\<slug>\     ← 插件本体（一个 slug 一个目录，目录里有 manifest.json）
<profile>\data\<slug>\        ← 插件私有数据（卸载插件不会自动删）
```

`<profile>` 的确定规则（5.2.1 源码）：`process.env.LITELOADERQQNT_PROFILE` 优先；没设时若加载器已被启动器注入 `globalThis.qwqnt`，用「QQ 数据目录/LiteLoader」，否则回落到 `<loader>` 自身目录。本机设了环境变量，所以 `<profile>` 就是它的值。

加载入口（知道就行，细节见 [`qqnt-internals.md`](qqnt-internals.md)）：`<app>\package.json` 的 `main` 被改成 `./app_launcher/LiteLoader.js`，该文件里只有一行 `require(...)`，参数是 `<loader>` 的绝对路径（模板字符串 `String.raw`）。

---

## 1. 快速开始：最小可跑插件

### 1.1 目录结构

```
<profile>\plugins\hello-qqnt\
├── manifest.json     必需：插件元数据 + 注入点声明
├── main.js           可选：主进程
├── preload.js        可选：预加载脚本环境
└── renderer.js       可选：渲染进程主世界（ESM）
```

**目录名不必等于 slug**，但强烈建议一致（加载器按 `manifest.slug` 建数据目录，见第 5 节）。

### 1.2 `manifest.json`

```json
{
  "manifest_version": 4,
  "type": "extension",
  "name": "Hello QQNT",
  "slug": "hello-qqnt",
  "description": "最小示例：三种注入各打印一行日志",
  "version": "1.0.0",
  "authors": [
    { "name": "you", "link": "https://github.com/you" }
  ],
  "platform": ["win32", "darwin", "linux"],
  "injects": {
    "main": "./main.js",
    "preload": "./preload.js",
    "renderer": "./renderer.js"
  }
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `manifest_version` | 写 `4`。生态通用值（5.2.1 源码其实不校验这个版本号，但别乱写） |
| `type` | `extension` / `theme` / `framework`。**只是设置界面里的分类，加载器不按它过滤** |
| `slug` | 插件唯一标识，也是 `<profile>\data\<slug>` 的目录名 |
| `version` | 必须 semver（`x.y.z`），设置界面会显示 |
| `authors` | 数组，元素 `{ name, link }` |
| `platform` | 数组，`win32` / `darwin` / `linux`；**不在列表里会被标记 incompatible 并跳过加载** |
| `injects` | 三块按需声明：`main` / `preload` / `renderer`（相对插件目录的路径） |
| `icon` / `thumb` | 可选，相对路径（设置界面用） |
| `dependencies` | 可选，依赖的 slug 数组，见第 4.6 节 |

### 1.3 `main.js`（主进程）

```js
// <profile>\plugins\hello-qqnt\main.js
// 运行在 Electron 主进程：普通 CommonJS 模块，可 require electron / node 内置模块
const { ipcMain } = require("electron");

console.log("[hello-qqnt][main] loaded, qqnt =", LiteLoader.package.qqnt.version);

ipcMain.handle("hello-qqnt:ping", () => "pong");

exports.onBrowserWindowCreated = (win) => {
    console.log("[hello-qqnt][main] window created:", win.id);
};
```

### 1.4 `preload.js`（预加载环境）

```js
// <profile>\plugins\hello-qqnt\preload.js
// 运行在每个窗口的预加载环境（隔离世界）
const { contextBridge, ipcRenderer } = require("electron");

console.log("[hello-qqnt][preload] loaded");

contextBridge.exposeInMainWorld("helloQQNT", {
    ping: () => ipcRenderer.invoke("hello-qqnt:ping")
});
```

### 1.5 `renderer.js`（渲染进程主世界）

```js
// <profile>\plugins\hello-qqnt\renderer.js
// 运行在渲染进程主世界，是 ESM 模块（用 export 导出钩子）
console.log("[hello-qqnt][renderer] loaded, liteloader =", LiteLoader.versions.liteloader);

window.helloQQNT.ping().then((v) => console.log("[hello-qqnt][renderer] ping =", v));
```

### 1.6 三种注入分别在哪、能拿到什么

| inject | 进程 / 世界 | 加载方式 | 能拿到 | 拿不到 |
|---|---|---|---|---|
| `main` | Electron **主进程** | `require()`（CommonJS） | 全局 `LiteLoader`（**同步** API）、`require("electron")` / Node 内置模块、窗口与登录钩子 | DOM / `window` |
| `preload` | 每个窗口的**预加载环境**（隔离世界，与主世界共享同一个 DOM） | `require()` | `require("electron")` 的 `ipcRenderer` / `contextBridge`、Node 内置模块 | **没有 `LiteLoader` 全局**（5.2.1：加载器只给自带的 `src/preload.js` 注入该变量）；不能直接改主世界的 window 属性 |
| `renderer` | 渲染进程**主世界** | 动态 `import()`（ESM，经 `local://root/src/renderer.js`） | `window.LiteLoader`（快照 + **异步** API）、DOM、Vue 组件钩子、`local://` 协议 | `require` / Node API；改不了 `window.ipcRenderer`、`window.LiteLoader` |

改完代码必须**重启 QQ** —— 没有热重载、没有卸载钩子（`disabled` 只影响下次启动时是否加载）。

---

## 2. 生命周期与钩子

加载顺序（5.2.1）：

1. 加载器主进程扫描 `<profile>\plugins\*\manifest.json`，做**依赖拓扑排序**（被依赖的先加载），把结果放进 `LiteLoader.plugins`；
2. 逐个 `require()` main 插件，把返回值当 `exports` 存起来；
3. 每个窗口创建时，依次跑各插件的 `onBrowserWindowCreating` → 创建窗口 → `onBrowserWindowCreated`；
4. 每个窗口：preload 插件加载（`require()`），随后向主世界 `import()` renderer 插件（ESM）；
5. 登录完成时触发 `onLogin`。

钩子清单（**只有这些会被调用**，函数名对不上就是死代码）：

| 层 | 钩子 | 参数 | 时机 / 用途 |
|---|---|---|---|
| main | `onBrowserWindowCreating(target, argArray, newTarget)` | `argArray[0]` 是 `BrowserWindow` 构造参数 | 构造**之前**。可以读 `webPreferences`；**改它风险极高** |
| main | `onBrowserWindowCreated(win)` | `win` 是 `BrowserWindow` | 构造**之后**，`win.webContents` 已可用。最常用的钩子 |
| main | `onLogin(uid)` | 登录账号标识 | 会话初始化完成（`nodeIKernelSessionListener/onSessionInitComplete`） |
| renderer | `onSettingWindowCreated(view)` | `view` 是已插入设置面板的 `<div>` | 用户进入「设置」页时调用，把 UI 写进 `view` 即可 |
| renderer | `onVueComponentMount(component)` | QQ 的 Vue 组件实例 | 组件挂载（找元素、挂事件） |
| renderer | `onVueComponentUnmount(component)` | 同上 | 组件卸载（清理定时器/监听） |
| preload | —— | —— | 加载器目前不触发 preload 钩子，脚本就是「加载时执行一次」 |

主进程侧示例：

```js
// main.js
exports.onBrowserWindowCreating = (target, argArray) => {
    console.log("[demo] 即将创建窗口, preload =", argArray?.[0]?.webPreferences?.preload);
};

exports.onBrowserWindowCreated = (win) => {
    win.webContents.on("did-finish-load", () => {
        console.log("[demo] 加载完成:", win.webContents.getURL());
    });
};

exports.onLogin = (uid) => {
    // 注意：uid 属于个人数据，别写进日志 / 别提交
    console.log("[demo] 登录完成");
};
```

渲染进程侧示例：

```js
// renderer.js
export function onSettingWindowCreated(view) { /* 写设置页，见 4.1 */ }
export function onVueComponentMount(component) { /* 组件出现 */ }
export function onVueComponentUnmount(component) { /* 组件消失：清定时器 */ }
```

排错提示：**钩子里抛异常不会让 QQ 崩**，但只会往控制台打一行 `[主进程/Preload/Renderer] [<slug>] [<钩子名>]: <错误>`，聊天窗口界面上什么都看不到 —— 所以务必挂上 [`dsh-debug-logger`](../plugins/dsh-debug-logger/README.md)（见第 6 节）。**【实测】5.2.1 的设置界面不会显示插件加载错误**，只有控制台有。

---

## 3. 可用 API

### 3.1 main 侧全局 `LiteLoader`

只有 main 插件有全局 `LiteLoader`（且访问它的代码文件必须位于 `<loader>` 或 `<profile>` 之下，否则 getter 返回 `null` —— 5.2.1 用调用栈做白名单）。

```js
LiteLoader.path.root        // <loader>
LiteLoader.path.profile     // <profile>
LiteLoader.path.data        // <profile>\data
LiteLoader.path.plugins     // <profile>\plugins

LiteLoader.package.qqnt.version      // "9.9.33-52230"（来自 <app>/package.json）
LiteLoader.package.liteloader        // 加载器 package.json
LiteLoader.versions.qqnt             // 同上版本号
LiteLoader.versions.liteloader       // "5.2.1"
LiteLoader.versions.electron / node / chrome

LiteLoader.os.platform      // "win32"

LiteLoader.plugins          // { <slug>: { manifest, path:{ plugin, data, injects:{main,preload,renderer} }, disabled, incompatible } }
```

API（**main 侧全部同步**）：

```js
// 配置：读写 <profile>\data\<slug>\config.json
LiteLoader.api.config.get(slug, defaultObject)   // 同步，返回「默认值 + 磁盘内容」的浅合并
LiteLoader.api.config.set(slug, object)          // 同步，整份写回（返回 true/false）

// 插件管理
LiteLoader.api.plugin.install(zip_or_manifest_path)  // 登记「下次启动时安装」，返回 bool
LiteLoader.api.plugin.disable(slug, ???)             // 注意第二参含义与名字相反，见下
LiteLoader.api.plugin.delete(slug, [self, data], now)

// 系统
LiteLoader.api.openExternal(url)     // 系统默认浏览器打开
LiteLoader.api.openPath(path)        // 资源管理器 / Finder 打开
```

> `plugin.disable(slug, x)` 的第二参在 5.2.1 源码里是「**是否从 disabled 列表里移除**」：`x = true` 表示**启用**，`x = false` 表示**禁用**，名字很容易搞反。要在自己的插件里管别的插件，建议直接读写 `<profile>\data\LiteLoader\config.json`，或调用前先看一眼源码。

### 3.2 renderer 侧 `window.LiteLoader`

由加载器的 preload 通过 `contextBridge` 暴露到主世界，因此：

* 它是一份 **快照 + 代理**：`path` / `plugins` / `versions` / `package` 是加载器初始化时序列化的数据；
* `api.*` **全部是异步**（返回 Promise），必须 `await`；
* 它是 contextBridge 对象，**不能给它加属性/改方法**（自己另起一个全局名，如 `window.myPlugin = ...`）。

```js
await LiteLoader.api.config.get(slug, defaultObject);
await LiteLoader.api.config.set(slug, object);
await LiteLoader.api.plugin.install(path);      // install / delete / disable 同样可用
await LiteLoader.api.plugin.disable(slug, true);
await LiteLoader.api.openExternal("https://example.com");
await LiteLoader.api.openPath(LiteLoader.path.data);
```

### 3.3 `local://` 协议（加载器注册的）

| URL | 指向 |
|---|---|
| `local:///<绝对路径>` | 该绝对路径的文件（`local:///C:/...`） |
| `local://root/<相对路径>` | `<loader>/<相对路径>` |
| `local://profile/<相对路径>` | `<profile>/<相对路径>` |

renderer 里 `import("./modules/foo.js")` 这类**相对导入**也能用（模块本身就是从 `local:///...` 加载的）。路径含空格/中文时建议先 `encodeURI()`（加载器用 `decodeURI` 解析）。

---

## 4. 常见任务配方

> 每段都是最小可跑代码。默认 slug 用 `hello-qqnt`。

### 4.1 写设置页（renderer）

加载器提供了一套自定义元素（`setting-section` / `setting-panel` / `setting-list` / `setting-item` / `setting-text` / `setting-switch` / `setting-button` / `setting-select` / `setting-option` / `setting-link` / `setting-divider` / `setting-modal`），在插件渲染模块加载前就已经注册好，直接用。

```js
// renderer.js
const SLUG = "hello-qqnt";
const DEFAULTS = { enabled: false };

export async function onSettingWindowCreated(view) {
    // view 是已经插入 LiteLoader 设置面板的 <div>，把内容写进去就行
    view.innerHTML = /* html */ `
        <setting-section data-title="Hello QQNT">
            <setting-panel>
                <setting-list data-direction="column">
                    <setting-item>
                        <setting-text>启用示例功能</setting-text>
                        <setting-switch class="enabled"></setting-switch>
                    </setting-item>
                    <setting-item>
                        <setting-text data-type="secondary">改完立即写盘</setting-text>
                        <setting-button data-type="primary" class="open">打开仓库</setting-button>
                    </setting-item>
                </setting-list>
            </setting-panel>
        </setting-section>`;

    const config = await LiteLoader.api.config.get(SLUG, DEFAULTS);

    const sw = view.querySelector(".enabled");
    sw.toggleAttribute("is-active", !!config.enabled);
    sw.addEventListener("click", async () => {
        config.enabled = !config.enabled;
        sw.toggleAttribute("is-active", config.enabled);
        await LiteLoader.api.config.set(SLUG, config);
    });

    view.querySelector(".open").addEventListener("click", () => {
        LiteLoader.api.openExternal("https://github.com/LiteLoaderQQNT");
    });
}
```

注意：**每次进入设置页都会重新调用一次** `onSettingWindowCreated`，事件监听要挂在传入的 `view` 上（不要挂在全局 `document` / 不要注册定时器不清理），否则会重复叠加。

### 4.2 注入 CSS（renderer）

```js
// renderer.js —— 插件自己的样式
const style = document.createElement("style");
style.dataset.plugin = "hello-qqnt";
style.textContent = `
    .hello-qqnt-badge { outline: 1px solid #ff00ff; }
`;
document.head.append(style);

// 也可以外链插件目录里的 CSS 文件
const link = document.createElement("link");
link.rel = "stylesheet";
link.href = `local:///${LiteLoader.plugins["hello-qqnt"].path.plugin}/style.css`;
document.head.append(link);
```

先查清楚目标元素的 class 再写选择器；QQ 升级改 DOM 是常态，选择器要写窄一点。

### 4.3 拦截点击（renderer）

QQ 的界面是 Vue 应用，事件多在冒泡阶段被组件消费，**要用捕获阶段**：

```js
// renderer.js
document.addEventListener("click", (event) => {
    const link = event.target?.closest?.("a[href^='http']");
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    LiteLoader.api.openExternal(link.href);
}, true); // ← true = 捕获阶段
```

别写「拦所有点击」的兜底：QQ 自己也是靠 DOM 事件工作的，拦宽了界面会失灵。

### 4.4 监听窗口创建（main）

```js
// main.js
exports.onBrowserWindowCreated = (win) => {
    const wc = win.webContents;
    console.log("[hello-qqnt] 新窗口:", wc.getURL());
    wc.on("did-finish-load", () => console.log("[hello-qqnt] 加载完成:", wc.getURL()));
};
```

只想改构造参数用 `onBrowserWindowCreating`，但**强烈建议只读**：QQ 起不来时你未必看得到报错。

### 4.5 读写 JSON 配置

main（同步）：

```js
// main.js
const SLUG = "hello-qqnt";
const DEFAULTS = { enabled: false, count: 0, nested: { a: 1 } };

const config = LiteLoader.api.config.get(SLUG, DEFAULTS);
config.count += 1;
LiteLoader.api.config.set(SLUG, config);       // 落盘到 <profile>\data\hello-qqnt\config.json
```

renderer（异步）：

```js
// renderer.js
const config = await LiteLoader.api.config.get("hello-qqnt", { enabled: false });
config.enabled = true;
await LiteLoader.api.config.set("hello-qqnt", config);
```

坑（源码级，5.2.1）：

* `get` 是**浅合并**（`Object.assign({}, defaults, disk)`）：嵌套对象的默认值得自己补；
* **首次 `get` 不会自动建文件**（`getPluginConfig` 里调用了不存在的 `exports.setConfig`，异常被 `catch` 吞掉后直接返回默认值）。想要文件存在，就自己 `set` 一次；
* `set` 是**整份覆盖写**，不是合并。

### 4.6 声明插件依赖

`manifest.json` 里加（值是被依赖插件的 slug 数组）：

```json
{
  "dependencies": ["other-slug"]
}
```

语义（5.2.1 源码实测确认）：

* **只保证加载顺序**：拓扑排序，被依赖的先加载；
* **不会自动安装**依赖；缺少依赖时加载器**既不报错也不提示**（`visit` 遇到不存在的 slug 直接返回）；
* 依赖被禁用/不兼容时，你的插件照常加载 —— 所以自己要判：

```js
const dep = LiteLoader.plugins["other-slug"];
if (!dep || dep.disabled || dep.incompatible) {
    console.log("[hello-qqnt] 依赖 other-slug 不可用，降级运行");
}
```

### 4.7 调用系统默认浏览器 / 打开文件夹

```js
// main.js（同步）
LiteLoader.api.openExternal("https://github.com/LiteLoaderQQNT");
LiteLoader.api.openPath(LiteLoader.path.data);          // 打开 <profile>\data

// renderer.js（异步）
await LiteLoader.api.openExternal("https://github.com/LiteLoaderQQNT");
await LiteLoader.api.openPath(LiteLoader.plugins["hello-qqnt"].path.data);
```

**【实测】写「链接外开」类插件之前，先查 QQ 原生设置**：QQ 自带「使用系统默认浏览器打开网页」开关，打开即可。QQ 的内置浏览器由原生外壳（`QQNT.dll`）实现，插件层拦不住 —— 完整失败案例与证据见 [`../examples/open-in-browser/README.md`](../examples/open-in-browser/README.md)。

### 4.8 用 `executeJavaScript` 注入「加载器不会注入」的窗口（main）

`app://./renderer/qqBrowser.html`（QQ 内置浏览器外壳页）等页面**不会**跑你的 renderer 插件，只能在 main 进程注入：

```js
// main.js
const { app, webContents } = require("electron");

const PROBE = `(() => ({ title: document.title, href: location.href }))()`;

function injectIfTarget(wc) {
    let url = "";
    try { url = wc.getURL() || ""; } catch { return; }
    if (!/qqBrowser\.html/i.test(url)) return;                 // 换目标就改这里
    wc.executeJavaScript(PROBE, true)                          // 第二参 true = userGesture
        .then((r) => console.log("[hello-qqnt] 注入结果:", JSON.stringify(r)))
        .catch((e) => console.log("[hello-qqnt] 注入失败:", e.message));
}

app.on("web-contents-created", (event, wc) => {
    wc.on("did-finish-load", () => injectIfTarget(wc));
    wc.on("did-navigate", () => injectIfTarget(wc));
});

// 兜底：插件加载时已经存在的窗口
try { webContents.getAllWebContents().forEach(injectIfTarget); } catch {}
```

**【实测】`executeJavaScript` 的返回值必须可结构化克隆**：返回了 DOM 节点 / 函数 / 循环引用会得到 `An object could not be cloned.`。要返回复杂信息就 `JSON.stringify` 成字符串，或只返回基本类型。注入的脚本也要**幂等**（用 `window.__flag` 防重复，页面导航会重跑）。

---

## 5. 打包与安装

### 5.1 目录与数据

* 插件本体：`<profile>\plugins\<slug>\`
* 插件数据：`<profile>\data\<slug>\`（`LiteLoader.path.data` + slug；加载器按 **manifest 的 slug** 决定，与目录名无关）
* 加载器自己的配置：`<profile>\data\LiteLoader\config.json`（`enable_plugins` / `disabled_plugins` / `deleting_plugins` / `installing_plugins`）

### 5.2 安装方式

| 方式 | 做法 | 生效时机 |
|---|---|---|
| 手动（推荐调试时用） | 把插件目录整个复制到 `<profile>\plugins\` 下 | **重启 QQ** |
| 设置界面安装 | 设置 → LiteLoaderQQNT → 插件 → 「安装」，选 `.zip` 或 `manifest.json` | **下次启动时**由加载器解压/复制（写入 `installing_plugins`） |
| 删目录 | 退出 QQ 后删 `<profile>\plugins\<slug>\` | 重启后 |

### 5.3 打包清单

```
hello-qqnt/
├── manifest.json         必需
├── main.js / preload.js / renderer.js    injects 里声明过的文件（+ 它们 require/import 的模块）
├── node_modules/         如果你 require 了第三方包（放在插件目录下，别指望加载器的 node_modules）
├── icon.png / style.css   可选资源
└── README.md             可选文档（不影响加载）
```

* 版本号：改 `manifest.json` 的 `version`（semver），设置界面显示的就是它；
* `type` 只是分类，不影响加载；
* **没有热重载**：任何改动都要重启 QQ；
* 改文件前先备份整个插件目录（QQ 起不来时能立刻还原，理由见 [`../plugins/README.md`](../plugins/README.md)）。

### 5.4 版本 / 卸载 / 禁用

* 禁用：设置界面关开关，或把 slug 加进 `<profile>\data\LiteLoader\config.json` 的 `disabled_plugins`：

```json
{
  "disabled_plugins": ["hello-qqnt"]
}
```

* 卸载：删 `<profile>\plugins\<slug>\`。**`<profile>\data\<slug>\` 不会自动删**，要自己清（设置界面卸载时可勾选删数据）。
* 更新：覆盖插件目录 → 重启。

### 5.5 manifest 写错会怎样（源码结论，非实测）

`scanPluginDirectory()` 会 `JSON.parse` 每个 `manifest.json`，`loadAllPlugins()` 又在加载器主进程启动流程里同步执行，所以：

* **manifest JSON 语法错误**、或**缺 `platform`**（加载时会 `.includes`）→ 抛出异常，可能让加载器整体启动失败；
* 写完后先用工具校验 JSON，`platform` / `name` / `slug` / `version` / `authors` 别漏。

---

## 6. 调试

**第一件事：装上本仓库的调试插件**，它把主进程 / preload / 渲染进程的 console、未捕获异常、preload 报错、窗口创建与显示都落盘到 `<profile>\data\dsh-debug-logger\`：

👉 [`../plugins/dsh-debug-logger/README.md`](../plugins/dsh-debug-logger/README.md)（安装步骤和日志用法都写在那里，本文不重复）

为什么必须要它：主进程的 `console.log` 在 GUI 启动的 QQ 里**看不到**（没有控制台），而 5.2.1 只在控制台打印插件加载/钩子错误，设置界面什么都不显示。

它同时带一个**元素选择器**（v1.4 起）：在主界面按 `Ctrl+Shift+C`，鼠标划过高亮、点击选中，就把该元素的类名 / 尺寸 / 圆角 / 背景 / **样式来源规则**复制到剪贴板 —— 定位"这个框是哪个样式画的"比写探针快得多。退出用 `Ctrl+Esc`（单独 `Esc` 被 QQ 占用去关窗口）。详见 👉 [`debugging.md`](debugging.md) §2.1。

方法论文档（日志通道、eval 探针、真实鼠标事件、IPC 抓取、案例复盘）在 👉 [`debugging.md`](debugging.md)。

排错顺序速查：

1. `console.log` 首行有没有 `[logger] INFO loaded` → 调试插件本身是否加载；
2. QQ 设置里有没有出现你的插件条目（按 `name` 显示）→ 加载器是否发现了你的插件；
3. `errors.log` 里搜 `[Main] [<slug>]` / `[Preload] [<slug>]` / `[Renderer] [<slug>]` → 是加载报错还是钩子报错；
4. 怀疑 DOM/页面问题，用调试插件的 eval 探针（写 JS 进 `eval.txt`，结果看 `eval-result.log`）；
5. 改完一定**重启 QQ**：没有热重载，`disabled` 也只影响下次启动。

---

## 7. 坑清单（本次调试真实踩过）

1. **【实测】加载器不会把 renderer 插件注入 `app://./renderer/qqBrowser.html`（QQ 内置浏览器外壳页）。**
   renderer 插件是通过窗口 preload 注入的，这个外壳页不在注入范围内 —— 在 renderer 插件里打的日志，在这个页面的控制台里永远看不到。要操作它，只能 main 进程 `webContents.executeJavaScript`（见 4.8）。

2. **【实测】辅助窗口（hiddenWindow / chatPool / screenshot）里，所有 preload 插件都会刷
   `Cannot bind an API on top of an existing property on the window object`。**
   这是加载器侧噪声（重复 `contextBridge` 暴露同名属性），不是你插件的 bug —— 别去修，也别据此判断插件坏了。

3. **【实测】`app://./renderer/screenshot.html` 里，加载器自己的 `<loader>\src\preload\module.js` 会加载失败：
   `Cannot read properties of undefined (reading 'path')`。**
   同样是加载器侧问题（该页面下加载器取不到自身路径），表现为 `Unable to load preload script` + `PRELOAD_ERROR`。截图等辅助窗口里插件注入不可靠，属预期。

4. **【实测】renderer 插件运行在主世界，但 QQ 暴露的 `window.ipcRenderer` 是 contextBridge 冻结对象，改不了。**
   给 `window.ipcRenderer` 加方法 / 覆盖属性都不生效；`window.LiteLoader` 同理，是自己新建全局名（`window.myPlugin = ...`）。另外在 `qqBrowser.html` / `screenshot.html` 里**根本没有** `window.ipcRenderer`。

5. **【实测】两个插件目录用同一个 `slug` 时，只会加载其中一个，哪个赢取决于目录读取顺序。**
   加载器按目录顺序扫描后写进同一个 `LiteLoader.plugins[slug]` 键，**后读到的覆盖先读到的**；而且两者共用同一个 `<profile>\data\<slug>\` 数据目录。调试时如果"改了代码没生效"，先确认没有同 slug 的副本/备份目录（例如 `xxx.bak`，只要里面有 `manifest.json` 就会被扫到）。

6. **【实测】别做「启动重放」的自测脚本。**
   写一个"每次启动自动执行上次留下的测试脚本"的探针，曾在重启后把 QQ 窗口导航到测试网址导致卡死。自测脚本必须：只执行一次、幂等、有显式开关。事故教训见 [`debugging.md`](debugging.md)。

7. **【实测】写插件之前先查 QQ 原生设置。**
   本次真实教训：花大量时间写"链接走系统默认浏览器"的插件，最后发现 QQ 自带「使用系统默认浏览器打开网页」开关。动手前先问：QQ 自己有没有这个功能？

补充（源码级确认，非实测）：

* `LiteLoader.api.config.get` 在 main 是**同步**、在 renderer 是**异步**，写反了会拿到 Promise；
* preload 插件里没有 `LiteLoader` 全局（要数据就 `ipcRenderer.invoke` 找自己的 main 插件）；
* 插件钩子里抛的错只在控制台留一行，界面无提示 —— 没有调试插件等于闭眼写代码。

---

## 8. 合规提醒

* **第三方插件有账号风险。** 加载器文档自己就写着：QQ 安全中心可能把 LiteLoaderQQNT 当作「非法外挂工具」、下线设备甚至封禁账号。请自行评估，别在重要账号上乱装插件。
* **尊重各插件作者的许可与声明。** 参考别人的代码前先看 LICENSE 和 README 的授权范围，别把别人的成品直接改名发布。
* **不要收集/上传个人数据。** QQ 号、聊天内容、rkey/token、真实用户名、真实绝对路径都不该出现在插件代码、日志和提交里；分享调试日志前先脱敏（调试日志里天然会带账号标识和会话链接）。
* 本仓库的文档与示例统一使用 `<QQNT>` / `<app>` / `<loader>` / `<profile>` 占位符。

---

## 附：一页速查

```text
插件目录      <profile>\plugins\<slug>\manifest.json
插件数据      <profile>\data\<slug>\config.json
加载器配置    <profile>\data\LiteLoader\config.json

main     全局 LiteLoader（同步 API）+ require + 钩子 onBrowserWindowCreating /
         onBrowserWindowCreated / onLogin
preload  require("electron") + contextBridge/ipcRenderer，无 LiteLoader 全局
renderer window.LiteLoader（异步 API）+ DOM + onSettingWindowCreated /
         onVueComponentMount / onVueComponentUnmount，ESM

常用      LiteLoader.path.{root,profile,data,plugins}
         LiteLoader.package.qqnt.version
         LiteLoader.api.config.get/set
         LiteLoader.api.openExternal/openPath
         LiteLoader.api.plugin.install/delete/disable
         local:///<绝对路径> | local://root/... | local://profile/...

生效条件  重启 QQ（无热重载）
```
