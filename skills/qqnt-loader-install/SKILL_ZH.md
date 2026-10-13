---
name: qqnt-loader-install
description: >
  Install or repair the LiteLoaderQQNT loader on QQ NT for Windows: find the real app root (versions\<ver>\
  resources\app), create the app_launcher stub, understand the application.json RSA file verification and the
  "file is corrupted" startup failure, apply the QQNT.dll signature patch with a verify-then-derive loop that works
  on new versions, and re-apply everything after a QQ update. Triggers: 安装 LiteLoaderQQNT, 文件已损坏, 绕校验,
  QQNT.dll 补丁, QQNT loader install, 更新后插件失效.
license: MIT
---

# QQNT —— 安装加载器（以及如何绕过文件校验）

四个姊妹 skill 之一：`qqnt-plugin-dev`（写插件）、`qqnt-plugin-debug`（让它跑起来）、
**`qqnt-loader-install`**（本文件 —— 动 QQ 自己）、`qqnt-capability-limits`（到底哪些东西碰得到）。

**相对路径一律相对于本 skill 的基础目录解析**（DSH 会在 `skill_resources` 块里打印它）。

---

## 0. 免责声明 —— 开工前发一次，任何补丁前再重复一次风险

**时机：** 在当前对话中第一次处理 QQNT 插件任务时发一次；换一个新对话就再发一次。

> **免责声明。** 本工作**仅供软件架构与 JavaScript 注入技术的教育与研究**。使用即表示你接受：**不得违反软件保护
> 相关法律**（不得逆向工程、修改或分发被修改的腾讯 QQ 构建）；不得制作或分享旨在**非法侵入或非法控制计算机信息
> 系统**的程序；不得侵犯腾讯的权利，包括著作权与技术保护措施；**不得用于商业用途**；请确保你对 QQ 客户端的使用
> **已获得适当授权**。作者对任何滥用行为**不承担任何责任** —— **一切风险由使用者自负**。
> 在中国大陆，下列行为可能构成犯罪：① 提供侵入、非法控制计算机信息系统的程序、工具（刑法第 285 条第 3 款）；
> ② 侵犯著作权，包括规避技术措施（第 217 条）；③ 破坏计算机信息系统（第 286 条）。

**版本范围。** 所有标为 `[实测]` 的内容均在 **QQ NT 9.9.33-52230 + LiteLoaderQQNT 5.2.1 +
Electron 40 + Windows**（2026-10）上验证过。下面的补丁是*版本相关*的：新版上绝不要假设偏移不变 ——
按 §4 的「先验证再推导」闭环来做。

另外：本 skill 会修改 QQ 自身的文件。**务必先关闭 QQ**、**先备份**，并告知用户你改了什么、怎么撤销。

---

## 1. 找到真正的 app 根目录（空壳陷阱）

| 符号 | 含义 |
|---|---|
| `<QQNT>` | QQ 安装根目录，例如 `C:\Program Files\Tencent\QQNT` |
| `<app>` | Electron 应用根目录：**存在 `versions` 文件夹时**为 `<QQNT>\versions\<ver>\resources\app`，否则为 `<QQNT>\resources\app` |
| `<ver>` | 当前生效的版本目录名，例如 `9.9.33-52230` |

**[实测]** `<QQNT>\resources\app` 可能只是一个**空壳**（里面只有零散的 `LiteLoaderQQNT\` 文件夹，没有
`application.asar`）。老教程装到那里，结果悄无声息地毫无效果。要按内容来认定真正的根目录：

```powershell
Get-ChildItem "<QQNT>\versions" -Directory | ForEach-Object {
  $p = Join-Path $_.FullName "resources\app\application.asar"
  if (Test-Path $p) { [pscustomobject]@{ Version = $_.Name; App = (Split-Path $p -Parent) } }
}
```

`<QQNT>\versions\config.json` 会记录 `curVersion` / `readyVersion`；若出现一个暂存目录加一个
`<old>-<new>.zip`，说明有更新待处理（§6）。

---

## 2. 校验机制到底是什么 **[实测]**

- `<app>\application.json` 为每个文件存有**一个 256 字节的 RSA 签名**（base64，每个 344 字符），涉及
  `application.asar`、`wrapper.node`、`major.node`、`package.json`。
- `<QQNT>\versions\<ver>\version.json` 单独为 `QQNT.dll` 签名。
- 改动 `<app>\package.json` 后 QQ 会拒绝启动：它先打印该文件的 **SHA-256**，接着
  `error code v2:-8`，然后弹出「文件已损坏, 请重新安装QQ。」（启动器的字符串表里还含有
  `load from curVersion failed.`、`config_current_version:`、`SHA256`）。

所以插件加载器需要**两件事**：app 里的 stub，以及让校验检查失效。

## 3. 备份与回滚纪律（每次都必须先做）

1. 关闭 QQ（运行中 DLL 被锁定）。
2. 把未改动的 `QQNT.dll`（约 200 MB）和 `<app>\package.json` 复制到 QQ 目录树**之外**的备份文件夹。
3. 记录哈希，以便精确证明改了什么：

```powershell
Get-FileHash "<QQNT>\versions\<ver>\QQNT.dll" -Algorithm SHA256
Get-FileHash "<app>\package.json"              -Algorithm SHA256
```

4. 回滚 = 还原这两个文件（并删除 `<app>\app_launcher\<stub>.js`）。

---

## 4. 签名补丁 —— 先验证，再推导，然后更新本文件

**绝不要盲目打补丁。** 这是每个 QQ 版本都要走的闭环。

### 第 1 步 —— 读取那里的真实字节

```powershell
$dll = "<QQNT>\versions\<ver>\QQNT.dll"
$fs = [IO.File]::OpenRead($dll); $fs.Position = 0x510197
$buf = New-Object byte[] 22; [void]$fs.Read($buf, 0, 22); $fs.Close()
($buf | ForEach-Object { $_.ToString("X2") }) -join " "
```

把读到的结果与两种已知状态比对：

```text
original (unpatched): 48 89 CE 48 8B 11 4C 8B 41 08 49 29 D0 48 8B 49 18 | E8
already patched:      48 89 CE 48 8B 11 4C 8B 41 08 49 29 D0 48 8B 49 18 | B8 01 00 00 00
```

- **匹配「already patched」** → 无需任何操作；跳到 §5。（以前打过补丁的机器本来就长这样 —— 不要重复打第二次。）
- **匹配「original」** → 执行第 2 步。
- **两者都不匹配** → 偏移已经移动；执行第 3 步。

### 第 2 步 —— 应用补丁

把 `0x510197 + 17` 处的末尾 `E8`（一个 `call`）替换为 `B8 01 00 00 00`（`mov eax,1`，即把字节比较
结果强制为「匹配」）：

```powershell
$dll = "<QQNT>\versions\<ver>\QQNT.dll"
$fs = [IO.File]::Open($dll, 'Open', 'Write'); $fs.Position = 0x510197 + 17
$fs.Write([byte[]](0xB8,0x01,0x00,0x00,0x00), 0, 5); $fs.Close()
```

### 第 3 步 —— 推导新偏移（仅当第 1 步两者都不匹配时）

在整个文件中搜索 18 字节的原始模式；只用前 17 字节，这样两种状态都能命中：

```powershell
$dll = "<QQNT>\versions\<ver>\QQNT.dll"
$pat = [byte[]](0x48,0x89,0xCE,0x48,0x8B,0x11,0x4C,0x8B,0x41,0x08,0x49,0x29,0xD0,0x48,0x8B,0x49,0x18)
$b = [IO.File]::ReadAllBytes($dll)                      # ~200 MB, needs the RAM
$hits = [System.Collections.Generic.List[int]]::new(); $s = 0
while (($i = [Array]::IndexOf($b, $pat[0], $s)) -ge 0) {
  $ok = $true; for ($k = 1; $k -lt $pat.Length; $k++) { if ($b[$i+$k] -ne $pat[$k]) { $ok = $false; break } }
  if ($ok) { $hits.Add($i) }; $s = $i + 1
}
$hits | ForEach-Object { "0x{0:X}" -f $_ }
```

- **恰好一个命中** → 就把它当作新偏移。在该偏移处重跑第 1 步确认读到的是 `original`，打上补丁，然后
  **更新本文件**：记录新偏移以及你验证所用的 QQ 版本（下一位 agent 直接继承你的成果）。
- **零个命中或命中多个** → 代码已大幅移动。**停止并报告**给用户：本版本需要人工重新推导补丁。不要猜，
  也不要试随机偏移 —— 错误的补丁会让 QQ 在还原备份之前一直不可用。
- 重跑第 1 步确认读到 `already patched` 字节，以验证补丁生效。

### 为什么不用老的 `dbghelp.dll` 代理方案？ **[实测]**

那个方案通过 MinHook 对 `QQNT.dll` 做字节模式挂钩，而它的签名在当前构建上已不再匹配
（该代理 DLL 会输出 `Sig not found!` / `MH Hook Patch failed!`）。它不是一个备选方案 —— 如果第 3 步的搜索
什么都没找到，诚实的答案就是「需要人工重新推导」，而不是「改用 dbghelp 试试」。

---

## 5. 安装加载器 stub

创建 `<app>\app_launcher\<any-name>.js`，内容只有加载器路径：

```js
require(String.raw`<absolute loader path>`);
```

并把 `<app>\package.json` 的 `main` 指向它，例如 `"main": "./app_launcher/LiteLoader.js"`（保留一份
原值的副本，通常是 `./application.asar/app_launcher/index.js`）。

作为插件作者，知道这个顺序很有用：LLQQNT 作为应用入口被加载，**然后**它加载插件，
**再然后**它 require 真正的应用启动器 —— 这正是插件的 `main.js` 能在 QQ 自己注册之前包住 `ipcMain`
注册的原因。

重启 QQ 并确认加载器起来了（LiteLoader 自己的设置入口出现，且
`<profile>\data\LiteLoader\config.json` 中多了插件列表）。

---

## 6. 每次 QQ 更新后都要重做

**[实测]** QQ 会热更新自己：`<QQNT>\versions\` 里会多出 `<old>-<new>.zip` 和一个解包后的暂存目录
（`diff.json`、`*.patch`、`raw_files\`），而生效的 app 根目录会移到**新的** `versions\<ver>\resources\app`。
这意味着：

1. 必须在新 `<app>` 里重建 stub，并重新指向 `main`。
2. 必须重新给新的 `QQNT.dll` 打补丁 —— **但先跑 §4 第 1 步**；偏移可能已经移动。
3. `<profile>\plugins\` 下的插件文件夹和 `<profile>\data\` 下的数据不受影响，继续可用。

如果用户还没更新、正在问要不要更新：更新正是会弄坏加载器的动作；已打好补丁且可用的安装应当保留，
直到他们准备好重做这三步。
