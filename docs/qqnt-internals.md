# QQ NT 内部结构、文件校验与原生/JS 边界

> **适用范围与版本：实测于 QQ NT 9.9.33-52230 + LiteLoaderQQNT 5.2.1 (2026-10)**
> 平台：Windows x64 / Electron 40。QQ 版本号取自 `<QQNT>\versions\` 下的目录名，加载器版本取自加载器 `package.json` 的 `version` 字段。

本文是**证据型**文档：每条结论后面写清是"实测"还是"未验证"，以及证据落在哪里（哪条日志、哪个文件偏移、哪次计数）。
路径里的 `<QQNT>`、`<app>`、`<profile>` 是占位符，见 §1.5。文中的 `C:\Program Files\Tencent\QQNT` 只是**通用默认安装路径**示例，不是某台机器的个人信息。

与其他文档的分工：

| 想知道什么 | 去哪 |
|---|---|
| 怎么从零写一个插件（manifest v4 / 三种注入 / API） | [plugin-development.md](plugin-development.md) |
| 怎么黑盒调试、探针、抓 IPC、真实鼠标 | [debugging.md](debugging.md) |
| 最短上手路径 / 硬规则速查 | [`../AGENT_README_ZH.md`](../AGENT_README_ZH.md)（中文；英文版 [`../AGENT_README.md`](../AGENT_README.md)；人类入口 [`../README.md`](../README.md)） |
| 反面案例：为什么插件拦不住"内置浏览器" | [`../examples/open-in-browser/README.md`](../examples/open-in-browser/README.md) |

---

## 1. 目录结构（实测）

### 1.1 三层结构

```text
<QQNT>\                                  # 安装根，例：C:\Program Files\Tencent\QQNT
├─ QQ.exe                                # 启动器（launcher）—— 负责读配置、校验、加载版本目录
├─ versions\                             # 版本目录（多版本共存 + 增量更新包）
│  ├─ <ver>\                             # 例：9.9.33-52230
│  │  ├─ QQNT.dll                        # 原生外壳主体（214,599,728 字节 ≈ 214 MB）
│  │  ├─ version.json                    # 只签一个文件：QQNT.dll
│  │  ├─ locales\
│  │  └─ resources\
│  │     └─ app\                         # ★ <app>：Electron 应用的根（package.json 在这里）
│  ├─ channel.json                       # {"channel":"QQweb","installWay":3,...}
│  ├─ config.json
│  ├─ setting.json
│  └─ <旧版本>-<新版本>.zip               # 增量更新包（delta patch），见 §9
├─ resources\                            # ⚠️ 注意：这里可能有一个**过期的 app\**，见 §1.4
└─ extension\                            # qq_explorer_command.dll / QQExtension.appx
```

**关键点：`<app> = <QQNT>\versions\<ver>\resources\app`。**

实测理由：

- 真正在跑的 app 是版本目录下那份：`application.asar`（30,339,880 字节）与 `package.json`（`"main": "./app_launcher/LiteLoader.js"`）**只存在于** `versions\9.9.33-52230\resources\app\`。
- 运行期日志里的模块路径也是版本目录：`…\versions\9.9.33-52230\resources\app\application.asar\renderer\97769.js`（`errors.log` 实测）。
- **但 `<QQNT>\resources\app` 这个目录本机是存在的** —— 它里面只有 `LiteLoaderQQNT\` 和 `LiteLoaderQQNT_bak\` 两个目录，**没有** `application.asar` / `package.json`。这是老安装器/老教程留下的**空壳，是个陷阱**（见 §1.4）。

实测的 `versions\9.9.33-52230\resources\app` 顶层内容（节选，字节数为实测）：

| 文件/目录 | 大小（字节） | 说明 |
|---|---|---|
| `application.asar` | 30,339,880 | 渲染层 JS 打包（本机 `isByteCodeShell: true`，内部是 V8 字节码，**不能直接 grep 类名**） |
| `application.json` | 1,451 | 文件签名表，见 §2 |
| `package.json` | 474 | `main` 指向 loader stub，见 §5 |
| `app_launcher\` | — | loader stub 目录，见 §5 |
| `dbghelp.dll` | 1,560,104 | 本机是**微软原版** 6.12.0002.633；历史上被用作代理，见 §4 |
| `major.node` | 107,373,608 | 原生模块 |
| `wrapper.node` | 115,118,632 | 原生模块（被 `application.json` 签名，见 §2） |
| `bsdiff.x64.node` | 115,248 | bsdiff 增量更新实现（与 §9 的 `.patch` 对应） |
| `ipc.node` / `initIpc_x64.node` | 1,030,704 / 692,776 | IPC 原生实现 |
| `win64\`、`miniapp\`、`avsdk\`、`QQScreenShot\` 等 | — | 子应用目录 |

`versions\9.9.33-52230\version.json`（359 字节，实测：只有一个键，值为 344 字符 base64）：

```json
{ "QQNT.dll": "<344 字符 base64 签名>" }
```

### 1.2 `QQ.exe` 是启动器，不是 Electron 主进程

实测：`QQ.exe` 只有 1,716,800 字节，且其 UTF-16 字符串表里是**版本选择 / 文件校验 / 弹窗**相关的文案，而不是业务逻辑：

```text
load from curVersion failed.
load from prevVersion failed.
load QQNT failed.
read config file failed.
config_current_version:
config_prev_version:
versions path is not exists
File is currently locked or in use, errno =
Error opening JSON file, errno =
Failed to open JSON file after <n> retries.
Error getting file size / Error allocating memory / Error reading file
QQ文件已损坏, 请重新安装QQ。
https://im.qq.com
```

（证据：`QQ.exe` 内 UTF-16 字符串，`文件已损坏` 字面量在偏移 ~665526 附近；ASCII 区还带 `SHA256` 符号。上面的英文串集中在 ASCII 偏移 ~1,326,000–1,336,000 的一段。）

所以排障顺序应该是：**先看 `QQ.exe` 打印的启动期错误，再看 Electron 层日志**。启动期校验失败时 Electron 根本不会起来，插件日志当然是空的。

### 1.3 `package.json` 里的两个字段值得注意（实测）

`<app>\package.json` 实测内容节选：

```json
{
  "name": "qq-chat",
  "version": "9.9.33-52230",
  "main": "./app_launcher/LiteLoader.js",
  "buildVersion": "52230",
  "isPureShell": true,
  "isByteCodeShell": true,
  "platform": "win32",
  "eleArch": "x64"
}
```

- `isByteCodeShell: true` → 渲染层是 V8 字节码，**别指望靠 grep `application.asar` 找 class 名**（实测：在 asar 里搜 `sidebar-nav` / `nav-item` / `aria-label` / `q-switch` 全部 0 命中，而 `qqBrowser.html` 能命中 1 次）。要找 DOM 选择器只能**探活页面**（见 [debugging.md](debugging.md) §3.3）。
- `main` 已经被改成 `./app_launcher/LiteLoader.js` → 说明本机装了加载器，见 §5。

### 1.4 `versions\` 的存在性决定 app 路径（以及那个空壳陷阱）

实测：`<QQNT>\versions\` 存在时，app 在版本目录下（`<QQNT>\versions\<ver>\resources\app`）。
`QQ.exe` 的字符串里有 `versions path is not exists` —— 说明启动器**自带对 `versions` 缺失的分支**。因此"app 在版本目录里"应当理解为**当前这个安装形态**（`installWay: 3`，`channel.json` 实测），而不是所有 QQ NT 安装的普遍规律。若拿到一个没有 `versions\` 的安装，需重新确认 app 路径。**（未验证：无 `versions\` 时的实际布局。）**

**⚠️ 空壳陷阱（实测）**：本机 `<QQNT>\resources\app\` **存在**，但里面只有 `LiteLoaderQQNT\` 与 `LiteLoaderQQNT_bak\`，没有 `application.asar`、没有 `package.json`。很多老教程/老安装器仍然把 `<QQNT>\resources\app` 当作 app 根，于是会往一个**根本不会被加载**的目录里装东西（症状：装完毫无反应、改动不生效）。

**判定 app 根的正确姿势**（不要靠猜路径）：

```powershell
# 哪个 package.json 有 application.asar 与 main 字段，哪个就是 <app>
Get-ChildItem "<QQNT>" -Recurse -Depth 4 -Filter package.json |
  Where-Object { Test-Path (Join-Path $_.DirectoryName "application.asar") } |
  ForEach-Object { "{0}  main={1}" -f $_.DirectoryName, ((Get-Content $_.FullName -Raw | ConvertFrom-Json).main) }
```

或者直接读运行期日志里的模块路径（`…\application.asar\renderer\…`），那是**确定**的答案。

### 1.5 占位符约定

| 占位符 | 含义 | 怎么确定 |
|---|---|---|
| `<QQNT>` | 安装根（`QQ.exe` 所在目录） | 例：`C:\Program Files\Tencent\QQNT` |
| `<ver>` | 版本目录名 | `<QQNT>\versions\` 下的目录名，例 `9.9.33-52230` |
| `<app>` | Electron 应用根 | `<QQNT>\versions\<ver>\resources\app` |
| `<profile>` | 加载器的用户目录 | 环境变量 `LITELOADERQQNT_PROFILE`；未设置时 = 加载器根目录 |

---

## 2. 文件校验机制（实测）

### 2.1 `application.json`：每个受保护文件一个 256 字节 RSA 签名

`<app>\application.json` 实测是一个**扁平 JSON 对象**，键是文件名，值是 base64 签名：

```json
{
  "application.asar": "<344 字符 base64>",
  "wrapper.node":     "<344 字符 base64>",
  "major.node":       "<344 字符 base64>",
  "package.json":     "<344 字符 base64>"
}
```

实测核对：

- 顶层键恰好 4 个：`application.asar`、`wrapper.node`、`major.node`、`package.json`。
- 每个值长度 **344** 字符（base64）。
- 344 字符 base64 以 `==` 结尾 → 解码后 **256 字节** → 这就是 **2048-bit RSA 签名**的长度。

即：**不是对整个目录做哈希，而是逐文件一个 256 字节 RSA 签名**。`package.json` 在名单里且只有 474 字节 —— 所以改它会被抓。

`version.json` 是**同一套机制的另一种用法**：它只签一个键 `QQNT.dll`（同样 344 字符 base64 / 256 字节），即原生的 214 MB 主体也被签名覆盖。

### 2.2 触发过程（实测）

改动 `<app>\package.json`（例如为了注入 loader 而改 `main`）后启动 QQ：

1. 启动器算出该文件的 **SHA-256** 并打印出来；
2. 打印 **`error code v2:-8`**；
3. 弹出对话框：**「QQ文件已损坏, 请重新安装QQ。」**

证据分级：

| 结论 | 证据 |
|---|---|
| 弹窗文案 | **已核对**：`QQ文件已损坏, 请重新安装QQ。` 字面量存在于 `QQ.exe` 的 UTF-16 字符串表（`文件已损坏` 在偏移 ~665526） |
| `SHA-256` 参与校验 | **已核对**：`QQ.exe` 内有 `SHA256` 符号（ASCII 偏移 ~1,276,576） |
| 校验失败会走退出路径而不是"忽略" | **已核对**：`QQ.exe` 有 `load from curVersion failed.` / `load QQNT failed.`；老的 `dbghelp.dll` 代理里也有 `已触发QQ文件校验退出函数` 文案（见 §4） |
| `error code v2:-8` 这条**控制台输出** | **实测于本次调试会话**。注意：该字符串**没有**作为字面量出现在 `QQ.exe` 里（`error code` / `v2:` 在 ASCII 与 UTF-16 两种对齐下都搜不到），应为运行时拼出来的，所以只把它当"观测到的现象" |

### 2.3 这对插件开发者意味着什么

- **改 `<app>` 下的任何被签名文件 = 启动炸。** 包括 `package.json`（loader 安装需要改它）、`application.asar`、`wrapper.node`、`major.node`。
- 校验失败时你**看不到任何 Electron 日志**（进程没走到 Electron），所以"日志是空的"本身就是一条证据。
- 因此所有"改 QQ 本体"的方案都必须先处理校验，见 §3。

---

## 3. 绕过校验的可行办法（实测有效）

实测有效的做法不是"重签"（拿不到腾讯私钥），而是**打补丁让校验比较恒真**：按社区工具 **QQNTFileVerifyPatch** 的思路改 `<QQNT>\versions\<ver>\QQNT.dll`（本文只给偏移与字节，不给外链——网络上同名仓库有多个，请自行甄别）。

### 3.1 补丁点

| 项 | 值 |
|---|---|
| 文件 | `<QQNT>\versions\<ver>\QQNT.dll`（实测 214,599,728 字节 ≈ 214 MB） |
| 文件偏移 | **0x510197** |
| 改前（21 字节） | `48 89 CE 48 8B 11 4C 8B 41 08 49 29 D0 48 8B 49 18 E8` |
| 改后（21 字节） | `48 89 CE 48 8B 11 4C 8B 41 08 49 29 D0 48 8B 49 18 B8 01 00 00 00` |

原理：把原来那条 `E8 xx xx xx xx`（`call <比较函数>`）换成 `B8 01 00 00 00`（`mov eax, 1`）—— 返回值恒为 1，比较结果恒真。前缀 16 字节不动，所以命中后原地替换即可，**长度不变**（原 5 字节 call → 5 字节 mov）。

**实测核对**：本机该文件在 0x510197 处的当前字节为

```text
48 89 CE 48 8B 11 4C 8B 41 08 49 29 D0 48 8B 49 18 B8 01 00 00 00 89 C7 48 8B 5E 18 48 C7 46 18
```

—— 正是**已打过补丁**的状态（`…18 B8 01 00 00 00` 而不是 `…18 E8`）。这同时验证了偏移、原字节、补丁字节三者都对。后续 5 字节 `89 C7`（`mov edi, eax`）与 `48 8B 5E 18` 未被修改，可作为"补丁只动了 5 字节"的对照。

### 3.2 操作步骤（务必先备份）

1. **完整退出 QQ**（检查任务管理器里没有 `QQ.exe`；`QQNT.dll` 被占用时无法写入）。
2. **备份**：把 `<QQNT>\versions\<ver>\QQNT.dll` 复制一份到 QQ 目录之外（214 MB，别留在 app 里）。同时备份 `<app>\package.json`。
3. 用十六进制编辑器打开 `<QQNT>\versions\<ver>\QQNT.dll`，跳到 **0x510197**，核对上面那 21 字节是否与"改前"一致；**不一致就停手**（说明版本不同，偏移大概率变了）。
4. 把末尾的 `E8` 那 5 字节改成 `B8 01 00 00 00`，保存。
5. 启动 QQ 验证：改了 `<app>\package.json` 也不再报「文件已损坏」。
6. **回滚**：QQ 未运行时用备份覆盖回去即可。

### 3.3 PowerShell 零依赖做法（读改一处、可核对）

```powershell
$dll = "<QQNT>\versions\<ver>\QQNT.dll"
$bak = "$env:TEMP\QQNT.dll.bak"
Copy-Item $dll $bak                       # 先备份
$before = '48 89 CE 48 8B 11 4C 8B 41 08 49 29 D0 48 8B 49 18 E8'
$after  = '48 89 CE 48 8B 11 4C 8B 41 08 49 29 D0 48 8B 49 18 B8 01 00 00 00'
$fs = [IO.File]::Open($dll, 'Open', 'ReadWrite'); $fs.Seek(0x510197, 'Begin') | Out-Null
$buf = New-Object byte[] 21; $fs.Read($buf, 0, 21) | Out-Null
if ((($buf | % { $_.ToString('X2') }) -join ' ') -ne $before) { $fs.Close(); throw "偏移内容不匹配，停手" }
$fs.Seek(0x510197, 'Begin') | Out-Null
$fs.Write((($after -split ' ') | % { [Convert]::ToByte($_, 16) }), 0, 21)
$fs.Close()
```

### 3.4 风险与边界

- 这是**修改 QQ 本体文件 + 绕过它自己的完整性校验**。升级/修复安装会覆盖回去，补丁需要重打（见 §9）。别替用户做，先说明风险与回滚方式。
- 补丁点**与版本强绑定**。QQ 一升级，0x510197 处的内容必须先核对，不要盲目写。
- 本文只覆盖到"启动不炸"。loader 安装还要动 `<app>\package.json`（§5），那是**另一个**被签名文件。

---

## 4. 为什么老的 `dbghelp.dll` 代理失效（实测）

历史上流行过一招：把伪造的 `dbghelp.dll` 放进 `<app>\`，劫持 `QQNT.dll` 对 `dbghelp` 的加载，用 **MinHook 按字节签名 hook** 掉校验函数。新版 QQ 上这招**不成立了**。

### 4.1 代理本体（实测）

本机保留了一份该代理（`dbghelp_x64.dll`，299,008 字节，**无版本信息、无签名**）。字符串实测：

```text
\System32\dbghelp.dll            ← 转发给系统原版
QQNT.dll
MinHook 风格的错误串：
  MH Init Error!
  Hook Sig not found!
  Sig not found!
  MH Hook Patch failed!
  MH Hook MessageBoxW failed!
  MH Hook CreateFileW failed!
  MH Hook NtQueryInformationProcess failed!
  MH enable all hooks failed!
  MH Hook Patchdetect failed!
硬编码的 x64 字节签名（带 ?? 通配符），例如：
  57 41 56 41 55 41 54 56 57 55 53 48 81 ec ?? ?? ?? ??
  0f 29 bc 24 ?? ?? ?? ?? 0f 29 b4 24 ?? ?? ?? ?? 48 8b 05 ?? ?? ?? ?? 48 31 e0 …
运行时提示（GBK）：
  已触发QQ文件校验退出函数, 一般情况下有可能是LLQQNT框架/插件导致的问题
  有任何问题请到Repo开issue, 带上你的截图
  CallStack: … Address: 0x … Data: …
```

### 4.2 失效机制（实测 + 推断）

- 它是**按字节签名**匹配 `QQNT.dll` 里的目标函数（上面那些带 `??` 通配符的模式就是签名），不是按导出名。
- 新版 QQ 编译变了 → 签名匹配不上 → 代理自己打印 `Sig not found!` / `MH Hook Patch failed!`，**hook 根本没装上**。
- hook 没装上，校验就照常跑 → 于是老方案在新版上的表现是：**报了一堆错，但校验依然生效**，用户看到的还是「文件已损坏」。
- 旁证：代理里那条 `已触发QQ文件校验退出函数` 说明它原本 hook 的位置就是"校验失败退出"那条路径。

> 分级：代理文件与上述字符串是**实测核对**（本机留有副本）；"新版签名匹配不上"这一点综合了代理自身的错误串与它 hook 后仍走校验的观察。
> 注意：当前 `<app>\dbghelp.dll` 是**微软原版**（6.12.0002.633，1,560,104 字节，无 MinHook 特征串）—— 也就是说这个代理**现在并没有装**，所以本机走的是 §3 的 DLL 补丁路线。

---

## 5. 加载器安装机制（实测）

QQ 只会启动 `<app>\package.json` 里 `main` 指向的入口。加载器的安装就是**把这个入口换成一个 stub**。

### 5.1 实测的 stub

`<app>\package.json` → `"main": "./app_launcher/LiteLoader.js"`

`<app>\app_launcher\LiteLoader.js` 全文（**69 字节**，实测）：

```js
require(String.raw`C:/Program Files/Tencent/LiteLoaderQQNT-5.2.1`);
```

- 目录 `<app>\app_launcher\` 实测**只有一个文件**（`LiteLoader.js`）。
- 用 `String.raw` 是为了让 Windows 反斜杠路径不被当转义；这里用了正斜杠，两者都可以。
- `require(<目录>)` 会读该目录的 `package.json` 的 `main` → 进入加载器。

### 5.2 通用做法（自己装加载器时）

1. `<app>\app_launcher\<任意名>.js` 里写：
   ```js
   require(String.raw`<加载器绝对路径>`);
   ```
2. 把 `<app>\package.json` 的 `main` 改成 `./app_launcher/<任意名>.js`。
3. **这一步会改被签名文件** → 必须先做 §3 的校验补丁，否则启动报「文件已损坏」。
4. QQ 更新换代目录后要重做（§9）。

### 5.3 本机加载器（实测）

`C:\Program Files\Tencent\LiteLoaderQQNT-5.2.1\package.json`：

```json
{
  "name": "liteloader-qqnt",
  "version": "5.2.1",
  "main": "./src/main.js",
  "private": true,
  "license": "MIT",
  "author": { "name": "LiteLoaderQQNT" },
  "repository": { "type": "git", "url": "https://github.com/MrNya907/LiteLoaderQQNT.git" }
}
```

即这是一个 **fork**（upstream 是 `LiteLoaderQQNT/LiteLoaderQQNT`，这份指向 `MrNya907/LiteLoaderQQNT`），版本 **5.2.1**，入口 `src/main.js`。

<profile> 的确定方式：环境变量 `LITELOADERQQNT_PROFILE`；未设置时 = 加载器根目录。插件目录 `<profile>\plugins\`，插件数据 `<profile>\data\<slug>\`，加载器配置 `<profile>\data\LiteLoader\config.json`。

---

## 6. LLQQNT 侧的注入机制

### 6.1 三种注入的执行世界

插件按 `manifest.json` 的 `injects` 声明注入点：

| 注入 | 执行世界 | 能拿到什么 |
|---|---|---|
| `main` | Electron 主进程 | `require("electron")`、全局 `LiteLoader`、`exports.onBrowserWindowCreated(win)` |
| `preload` | 渲染进程的**隔离世界** | Node + `contextBridge` + `ipcRenderer`（`require("electron")`） |
| `renderer` | 页面**主世界**（ESM） | 页面真实 `window`/DOM；`window.LiteLoader.api.*` |

manifest 约定、骨架、打包方式见 [plugin-development.md](plugin-development.md) —— 本文不重复。

### 6.2 renderer 插件**不会**注入 `qqBrowser.html`（实测）

内置浏览器外壳页是 `app://./renderer/qqBrowser.html`。它**不是**一个被 renderer 插件覆盖的页面。

证据（`eval-result.log` 中 `wrap-ipcrenderer` 探针的返回，逐窗口）：

```text
--- [app://./renderer/index.html]            => {"ok":true,"frozen":true,"sealed":true,"desc":{"w":false,"c":false,"get":false}, …}
--- [app://./renderer/hiddenWindow.html]     => {"ok":true,"frozen":true,…}
--- [app://./renderer/qqBrowser.html]        => {"ok":false,"why":"no window.ipcRenderer"}   ← 没有加载器 preload
--- [https://…]                              => {"ok":false,"why":"no window.ipcRenderer"}
--- [app://./renderer/qqBrowser404.html]     => {"ok":false,"why":"no window.ipcRenderer"}
```

主窗口有 `window.ipcRenderer`（说明加载器 preload 进去了），`qqBrowser.html` **没有**。

结论：**想操作内置浏览器页面，只能用主进程 `webContents.executeJavaScript()`**（或 `executeJavaScriptInIsolatedWorld`），不能指望写个 renderer 插件。反面案例见 [`../examples/open-in-browser/README.md`](../examples/open-in-browser/README.md)。

### 6.3 辅助窗口里的 preload 报错是公共噪声（实测）

日志里会反复出现（`console.log` 里 `fuck_sidebar` 出现 295 次，绝大多数是这个）：

```text
[renderer:about:blank:about:blank] INFO [Preload] [fuck_sidebar]:
  Error: Cannot bind an API on top of an existing property on the window object
```

以及 `screenshot.html` 上加载器**自己的** preload 挂掉（`errors.log`）：

```text
ERROR Unable to load preload script: …\LiteLoaderQQNT-5.2.1\src\preload\module.js
ERROR TypeError: Cannot read properties of undefined (reading 'path')
PRELOAD_ERROR …\src\preload\module.js TypeError: Cannot read properties of undefined (reading 'path')
```

- 第一种来自加载器 `src/preload.js` 的 `catch`：`contextBridge.exposeInMainWorld` 在同一个 window 上被多次绑定同名属性时抛错（辅助窗口/复用窗口会这样）。**这是加载器侧问题，不是你的插件 bug。**
- 第二种是加载器 preload 自身在某些页面（如 `screenshot.html`）加载失败。
- 判断原则：**同一个窗口上所有插件都刷同样的错 → 公共噪声；只有你的 slug 出现、且只有你的窗口 → 你的 bug。**

---

## 7. 原生外壳与 JS 的边界（本次最重要的实测结论）

### 7.1 问题

"点 QQ 里的链接会开内置浏览器"、"内置浏览器工具栏那个『用默认浏览器打开』图标"——这两件事能不能在插件层拦掉？

### 7.2 实测：**不能**。两件事都是 `QQNT.dll` 原生实现

做了三组探测（方法见 [debugging.md](debugging.md) §6）：

| 探测 | 做法 | 结果（实测） |
|---|---|---|
| 包 IPC 处理器 | 包住当时**已注册**的 `ipcMain` invoke 处理器与 on 通道 | 日志（`console.log`）：`已包裹 59 个已注册的 invoke 处理器（共 59 个）` / `已包裹 15 个已注册的 on 通道`（同一启动批次，行号 5129–5130） |
| 点链接 / 点图标 | 在包好的状态下分别点击 | **0 命中** —— 59 + 15 个处理器一条都没被调用 |
| `shell.openExternal` | 包住主进程 `shell.openExternal` | **从未被调用** |
| 导航钩子 | `webContents.loadURL` / `will-navigate` / `will-redirect` / `did-start-navigation` | **全部未触发** |

四条独立证据指向同一结论：这两个动作不经过 Electron 的 IPC，也不走 Electron 的导航路径 —— 它们是 `QQNT.dll` 里直接调系统 API 干的。

### 7.3 顺带确认：`window.ipcRenderer` 是冻结的 contextBridge 对象

`eval-result.log` 中 `wrap-ipcrenderer` 探针对主窗口的返回（实测）：

```json
{"ok":true,"frozen":true,"sealed":true,"desc":{"w":false,"c":false,"get":false},
 "send":"assign-failed(readonly)","invoke":"assign-failed(readonly)","sendSync":"missing"}
```

即：`frozen` + `sealed`，属性描述符 `writable:false, configurable:false`，赋值无效。**renderer 侧包不了 `ipcRenderer.invoke`。** 想抓 IPC 只能在主进程侧做（[debugging.md](debugging.md) §6）。

### 7.4 结论与正确姿势

> **插件层不存在"阻止 QQ 开内置浏览器"的拦截点。**

- 插件能做的：**观察**（窗口创建/显示追踪）、**在 JS 层能碰到的地方改**（页面 DOM/样式/`window.open`/主世界事件）、**main 侧 `executeJavaScript` 往特定页面注入**。
- 想从根上改原生行为 → 只能 DLL hook（**不在本仓库范围**），并且要面对 §2/§3/§4 那套校验与版本绑定问题。
- 正确的第一步永远是 §8：**先查 QQ 原生设置**。

---

## 8. 原生设置优先（教训）

**先查 QQ 自己有没有开关，再考虑写插件。**

实测案例：让链接走系统默认浏览器，QQ **自带**这个开关：

> **设置 → 通用 / 其他 →「使用系统默认浏览器打开网页」**

对应控件（实测，`eval-result.log` 中 `locate-browser-setting` 探针返回）：

```json
{"leaf":{"tag":"DIV","cls":"text","html":"<div class=\"text\">使用系统默认浏览器打开网页</div>"},
 "item":{"tag":"DIV","cls":"panel-main"},
 "sw":{"tag":"DIV","cls":"q-switch vue-component",
       "html":"<div class=\"q-switch vue-component\" role=\"switch\" bf-label-inner=\"true\"
                tabindex=\"0\" aria-checked=\"false\" aria-disabled=\"false\">
               <span class=\"q-switch__handle\"></span></div>"}}
```

- 开关状态读法：`.q-switch` 的 **`aria-checked`**（`"true"` / `"false"`）。
- 打开后复验探针返回 `{"ok":true,"checked":"true"}`（实测）。
- 定位套路：按文本找叶子节点 → 向上找到容器（实测容器 class 含 `panel-main`）→ 里面 `querySelector(".q-switch")`。

这条教训是花了几版插件换来的：**为这件事写了 4 版插件，最后发现是原生开关。** 排障第一步清单：

1. QQ 设置里有没有现成开关？（本例：有）
2. 这个行为经不经过 JS 层？（本例：不经过，原生外壳）
3. 改 QQ 本体文件会不会被校验挡？（本例：不需要改本体）

---

## 9. 更新机制（实测）

### 9.1 观测到的东西

`<QQNT>\versions\` 实测内容：

```text
9.9.33-52230\                          ← 当前版本目录
9.9.33-52230-9.9.36-53644.zip          ← 95,683,545 字节：旧版本→新版本的增量更新包
channel.json / config.json / setting.json
```

即：**`<旧版本>-<新版本>.zip` 出现在 `versions\` 下**，说明检测到热更新、正在/已经下载增量包。

### 9.2 增量包内部结构（实测，257 个条目）

| 内容 | 实测 |
|---|---|
| `.patch` 文件 | 大量，如 `QQNT.dll.patch`（3,888,868）、`resources_app_application.asar.patch`（30,736,736）、`resources_app_major.node.patch`（9,425,126）、`resources_app_wrapper.node.patch`（12,867,474） |
| `diff.json` | **328,083 字节** —— 更新清单 |
| `raw_files\` | 新增/整份替换文件的镜像树，如 `raw_files/version.json`、`raw_files/resources/app/package.json`、`raw_files/resources/app/application.json`、`raw_files/resources/app/crashpad_handler.exe` |
| 命名规则 | 路径里的 `\` / `/` 换成 `_`，如 `resources_app_QQScreenShot_BinRelease-x64_GF.dll.patch` |

配合 `<app>\bsdiff.x64.node` 的存在，可以判定这是 **bsdiff 差分包**（`diff.json` 说明怎么应用）。

### 9.3 对插件开发者的影响（重要）

1. **更新后 app 路径变成新的版本目录**：`<QQNT>\versions\9.9.36-53644\resources\app`（示例）。所以：
   - §5 的 loader stub 在**新目录**里要重做；
   - §3 的 `QQNT.dll` 补丁要在**新版本目录的 `QQNT.dll`** 上重做，且**必须重新核对 0x510197 处字节**；
   - 写死的 app 绝对路径全部失效。
2. **`application.json` 会整体换掉**（更新包里就有 `raw_files/resources/app/application.json`），所以"上次改过的签名表"不会被继承。
3. 更新是**启动时**检查的：`QQ.exe` 字符串里有 `config_current_version:` / `config_prev_version:` / `updateId`（`channel.json` 实测 `"updateId": "QQWeb"`）。
4. 想保住补丁：**更新前把改动与补丁脚本备份在 QQ 目录之外**，更新后按 §3.2 的"先核对再写"流程重放。

---

## 10. 观察到的 DOM 锚点（实测）

下面这些都能在内置浏览器 / 主窗口的探针返回里直接读到（`eval-result.log`）。写插件时可直接用，但**每次 QQ 升级都要复验**。

### 10.1 内置浏览器外壳页 `app://./renderer/qqBrowser.html`

探针 `recon3-qqbrowser-toolbar` 实测：该页面 `document.querySelectorAll("*").length === 104`，`document.body` 首部为：

```html
<div dt-pgid="pg_bas_built_in_browser" class="wrapper">
  <div id="qqb-tab-bar" class="qqb-tab-bar blur">
    <div class="qqb-tabs-container" id="qqb-tabs-container">
      <div class="scroll-button-wrapper scroll-button-wrapper-left">
        <button class="scroll-button scroll-left" style="display: none;"> …
```

| 锚点 | 说明（实测） |
|---|---|
| `dt-pgid="pg_bas_built_in_browser"` | 页面级标识，判"这是内置浏览器页"最稳 |
| `#qqb-tabs` / `#qqb-tabs-container` / `#qqb-tab-bar` | 标签容器 |
| `#qqb-tabs .tab[data-tab-id]` | 单个标签；实测属性为 `class="tab hide-divider" data-tab-id="<uuid>"` |
| `.tab-content` | 标签标题文本（实测内容就是网页标题） |
| `.close-tab` | 标签上的关闭按钮（`<button tabindex="-1" class="close-tab">`） |
| `#qqb-default-browser-button` | **「用默认浏览器打开」图标**（`<button tabindex="-1" class="control-btn" id="qqb-default-browser-button">`，内含 base64 PNG）；未就绪时带 `disabled` |
| `#qqb-go-back` / `#qqb-go-forward` / `#qqb-reload` / `#qqb-download-context-menu-button` | 其余工具栏按钮（实测同批 `control-btn`） |
| 工具栏结构 | `button.control-btn`、`button.scroll-button.scroll-left/right`（`style="display:none"` 时常驻） |

探针 `recon5-tab` 实测的单个标签 HTML（**标题与 favicon 路径已脱敏**）：

```html
<div class="tab hide-divider" data-tab-id="<uuid>"
     style="visibility: visible; transform: translateX(0px); transition: none; pointer-events: auto;">
  <div class="tab-item-inner">
    <div class="favicon-container"><img src="appimg://…" class="favicon"></div>
    <div class="tab-content">&lt;网页标题&gt;</div>
    <button tabindex="-1" class="close-tab"> … </button>
  </div>
</div>
```

另有 `app://./renderer/qqBrowser404.html?ec=-118&url=…` —— 内置浏览器加载失败时的错误页（实测存在；`ec` 是错误码，`url` 是 URL 编码的目标地址）。

### 10.2 主窗口 / 聊天窗口

探针 `recon1`、`recon2` 实测（仅列 class 与 `aria-label` 结构；**昵称、签名等个人数据已略去**）：

| 锚点 | 实测 |
|---|---|
| `.window-control-area__btn.close` | 关闭按钮；同类还有 `miniMize`（原文如此）、普通 `window-control-area__btn`（最大化）；整块 `aria-label="窗口控制区域"` |
| `.narrow-toggler` | `aria-label="切换为经典模式"` |
| `.func-bar-native.func-bar-top` | `aria-label="更多"`（聊天窗口的自定义标题栏按钮区） |
| `.func-menu.user-profile-card__menu` | `aria-label="工具栏"` —— **注意：这个 `.func-menu` 属于用户资料卡，不是聊天工具栏** |
| `.ml-area.v-list-area.list-wrap` | `aria-label="消息列表"` |
| `.chat-func-bar` | `aria-label="会话"` |
| `.nav-item` / `.nav-item-activator` / `.nav-item.nav-item-more` | 侧栏导航项，属性是 **`aria-label`**（实测值：`消息`、`联系人`、`空间`、`频道`、`游戏`、`小程序`、`自选股`、`更多`）；**实测这些元素没有 `title`** |
| `webview.guild-webview` | 主窗口里唯一的 webview，`src="about:blank?webviewName=GuildMainWebview&businessName=guild_web"` |

> ⚠️ 用 `.func-menu` 做选择器前先看上一行：主窗口里命中的 `.func-menu` 往往是**收起的用户资料卡菜单**（`func-menu user-profile-card__menu`），不是聊天工具栏。这是真实踩过的坑，见 [debugging.md](debugging.md) §8.4。

### 10.3 窗口类型速查（实测）

同一时刻 `webContents.getAllWebContents()` 里常见的窗口（URL 片段）：

| URL | 类型 |
|---|---|
| `app://./renderer/index.html?…&processGroupNS=createBlankWindow1#/blank` | 空白/预热窗口 |
| `app://./renderer/index.html?webcontentsid=2&…#/main/message` | **主窗口**（`location.hash` 含 `/main`） |
| `app://./renderer/index.html?auxWinWithIpc=1&chatPoolWin=1#/chat` | 聊天辅助窗口（窗口池） |
| `app://./renderer/hiddenWindow.html?…&hiddenPoolBaseWin=1` | 隐藏窗口 |
| `app://./renderer/screenshot.html?initParams=…` | 截图窗口（注意其 URL 含 `uin=`，**别把带 uin 的 URL 写进仓库**） |
| `app://./renderer/qqBrowser.html?initialDarkMode=false` | 内置浏览器外壳 |
| `app://./renderer/qqBrowser404.html?ec=…&url=…` | 内置浏览器错误页 |
| `about:blank?webviewName=…` | webview 宿主 |

因为 `eval` 通道会在**所有**窗口执行，探针**必须自带窗口判断**，例如 `if (location.hash.indexOf("/main") < 0) return {skip:true}`。

---

## 11. 未验证 / 存疑清单（诚实标注）

| 事项 | 状态 |
|---|---|
| 无 `versions\` 目录时的 app 路径布局 | **未验证**（本机是 `installWay: 3`，有 `versions\`） |
| `error code v2:-8` 的确切拼装方式 | **未验证**（`QQ.exe` 里没有该字面量，只观测到输出） |
| `0x510197` 在其他 QQ 9.9.33 补丁级别 / 其他版本上是否相同 | **未验证**（强绑定版本，换版本必须先核对 21 字节） |
| `application.json` 里 4 个键之外是否还有按版本变化的其他键 | 本机**实测**为 4 个键；其他版本未验证 |
| `.sidebar-nav` 是否是 9.9.33 侧栏容器的准确 class | **存疑**：`application.asar` 是字节码搜不到类名；该 class 来自仍在使用的 `lite_tools` 样式表（旁证）。见 [debugging.md](debugging.md) §8.4 |
| 老 `dbghelp.dll` 代理的具体 hook 地址 | **未验证**（只有签名模式与错误串，未反汇编定位） |
