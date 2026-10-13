# QQNT Plugin Dev Kit

> 给 **agent**（和愿意读文档的人）准备的 LiteLoaderQQNT 插件开发工具包：
> 一份调试插件、一套实测出来的 QQ NT 内部机制笔记、一份开发指南，以及一个"别踩"的反面案例。
>
> 所有结论都来自 **QQ NT 9.9.33-52230 (x64) + LiteLoaderQQNT fork 5.2.1 + Electron 40** 上的真实调试（2026-10），不是抄文档。

## 这个仓库解决什么问题

QQ NT 的插件生态文档很少，而且大多数"经验"只能口口相传。这个仓库把一次完整插件开发/排障过程里**能用、不能用、以及为什么**固化下来：

- 新 agent 不用再从零摸索目录结构、注入点、日志通道、调试手法
- 有些坑（比如"renderer 插件不会被注入内置浏览器外壳页"、"QQ 的链接外开是原生实现、插件层拦不住"）一开始就知道，能省掉几小时

## 30 秒上手

```text
1. 装上调试插件：把 plugins/dsh-debug-logger/ 整个目录复制到
   <profile>/plugins/dsh-debug-logger/  然后重启 QQ
2. 日志出现在 <profile>/data/dsh-debug-logger/：
   console.log（全量）、errors.log（只有报错）、eval-result.log（探针结果）
3. 想探页面就把 JS 写进 <profile>/data/dsh-debug-logger/eval.txt，
   插件会在所有窗口里执行，结果写进 eval-result.log
4. 详细流程读 docs/debugging.md；开发插件读 docs/plugin-development.md
5. 给 agent 的最短路径读 agent_readme.md
```

`<profile>` 由环境变量 `LITELOADERQQNT_PROFILE` 决定；没设置时就是 LiteLoaderQQNT 加载器自己的根目录。

## 目录结构

| 路径 | 内容 |
|---|---|
| [`agent_readme.md`](agent_readme.md) | **给 agent 的入口**：最短上手路径、硬规则、实测事实表 |
| [`docs/plugin-development.md`](docs/plugin-development.md) | 从零写一个 LLQQNT 插件：manifest、三种注入、API、常见配方、打包与安装 |
| [`docs/debugging.md`](docs/debugging.md) | 黑盒调试方法论：日志通道、eval 探针、真实鼠标事件、IPC 抓取、案例复盘 |
| [`docs/qqnt-internals.md`](docs/qqnt-internals.md) | QQ 9.9.33 内部机制实测：目录/校验/加载器安装/原生与 JS 的边界 |
| [`plugins/dsh-debug-logger/`](plugins/dsh-debug-logger/) | 调试日志插件（可直接安装，含 `README.md` 安装说明） |
| [`plugins/README.md`](plugins/README.md) | 插件安装/禁用通用步骤 |
| [`examples/open-in-browser/`](examples/open-in-browser/) | 反面案例：用插件拦"QQ 内置浏览器"为什么做不到 |
| [`skills/qqnt-plugin-dev/`](skills/qqnt-plugin-dev/) | DSH skill：把上面这套流程固化给 agent 自动加载 |

## 三条最值得先读的结论

1. **先查 QQ 原生设置，再写插件。**
   本次真实教训：折腾半天"让链接走系统默认浏览器"，最后发现 QQ 自带开关 **「使用系统默认浏览器打开网页」**（设置 → 通用/其他），打开即可。
2. **QQ 的很多行为是原生外壳（`QQNT.dll`）做的，JS 层碰不到。**
   实测：包住 59 个已注册 `ipcMain` invoke 处理器 + 15 个 on 通道后，点链接/点图标 **0 命中**；`shell.openExternal` 从未被调用；导航钩子全未触发。写插件前先确认"这事到底经不经过 JS 层"。
3. **插件代码改动会被 QQ 的文件校验挡下来。**
   9.9.33 用 `application.json` 里的 **RSA 签名**校验 app 目录文件（改 `package.json` 会直接启动失败），需要按签名补丁改 `QQNT.dll`（见 [`docs/qqnt-internals.md`](docs/qqnt-internals.md)）。

## 免责声明

- 第三方插件存在**账号风险**，请自行评估；本仓库只提供技术资料与调试工具。
- 请在遵守各插件自身许可与作者声明的前提下使用。
- 仓库内不包含任何个人数据（QQ 号、聊天内容、token 等），示例路径一律用占位符。

## License

MIT（见 [`LICENSE`](LICENSE)）。
