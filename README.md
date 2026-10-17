# QQNT Plugin Dev Kit

> 给 **agent**（和愿意读文档的人）准备的 LiteLoaderQQNT 插件开发工具包：
> 一份调试插件、一套实测出来的 QQ NT 内部机制笔记、一份开发指南，以及一个"别踩"的反面案例。
>
> 所有结论都来自 **QQ NT 9.9.33-52230 (x64) + LiteLoaderQQNT fork 5.2.1 + Electron 40** 上的真实调试（2026-10），不是抄文档。

## 这个仓库解决什么问题

QQ NT 的插件生态文档很少，而且大多数"经验"只能口口相传。这个仓库把一次完整插件开发/排障过程里**能用、不能用、以及为什么**固化下来：

- 新 agent 不用再从零摸索目录结构、注入点、日志通道、调试手法
- 有些坑（比如"renderer 插件不会被注入内置浏览器外壳页"、"QQ 的链接外开是原生实现、插件层拦不住"）一开始就知道，能省掉几小时
- 连"推断翻车"也留下了：判断插件有没有生效，要看可观测结果，别靠"选择器长得像不像"

## 30 秒上手

```text
1. 装上调试插件：把 plugins/dsh-debug-logger/ 整个目录复制到
   <profile>/plugins/dsh-debug-logger/  然后重启 QQ
2. 日志出现在 <profile>/data/dsh-debug-logger/：
   console.log（全量）、errors.log（只有报错）、eval-result.log（探针结果）
3. 想探页面就把 JS 写进 <profile>/data/dsh-debug-logger/eval.txt，
   插件会在所有窗口里执行，结果写进 eval-result.log
4. 想知道"屏幕上那个框是谁画的"：在主界面按 Ctrl+Shift+C 进元素选择器，
   鼠标划过高亮、点击选中（按住 Ctrl 可多选），详情自动复制到剪贴板；
   也可在设置页点"开始抓取"。Ctrl+Esc 退出
   （单独 Esc 被 QQ 占用去关窗口，所以退出键带 Ctrl）
5. 详细流程读 docs/debugging.md；开发插件读 docs/plugin-development.md
6. 给 agent 的最短路径读 AGENT_README.md（英文）/ AGENT_README_ZH.md（中文）
```

`<profile>` 由环境变量 `LITELOADERQQNT_PROFILE` 决定；没设置时就是 LiteLoaderQQNT 加载器自己的根目录。

## 目录结构

| 路径 | 内容 |
|---|---|
| [`AGENT_README.md`](AGENT_README.md) | **给 agent 的入口（英文）**：最短上手路径、硬规则 10 条、实测边界表、探针速查、与用户配合的测试流程、交付自检 |
| [`AGENT_README_ZH.md`](AGENT_README_ZH.md) | 同上，中文版 |
| [`docs/plugin-development.md`](docs/plugin-development.md) | 从零写一个 LLQQNT 插件：manifest、三种注入、API、常见配方、打包与安装（中文） |
| [`docs/debugging.md`](docs/debugging.md) | 黑盒调试方法论：日志通道、eval 探针、真实鼠标事件、IPC 抓取、案例复盘（中文） |
| [`docs/qqnt-internals.md`](docs/qqnt-internals.md) | QQ 9.9.33 内部机制实测：目录/校验/签名补丁/原生与 JS 的边界（中文） |
| [`plugins/dsh-debug-logger/`](plugins/dsh-debug-logger/) | 调试日志插件（可直接安装，含 `README.md` 安装说明） |
| [`plugins/README.md`](plugins/README.md) | 插件安装/禁用通用步骤 |
| [`examples/open-in-browser/`](examples/open-in-browser/) | 反面案例：用插件拦"QQ 内置浏览器"为什么做不到 |
| [`examples/merit-counter/`](examples/merit-counter/) | **可用样例**：左侧栏「功德 +1」按钮（skill 实测产物，含 DOM 与持久化实测数据） |
| [`examples/lens-skin/`](examples/lens-skin/) | **皮肤插件实测复盘**：把开源设计体系 Lens 映射到 QQ（主题令牌 / 派生色 `color-mix` 补全 / 弹性动效 / 合成音 / 设置页）；含 18 条「症状→误判→根因→正解」踩坑记录 |
| [skills/for_codex/](skills/for_codex/README.md) | **Codex 适配版**（同一套四个 skill，中文正文作为 `SKILL.md`、英文留作 `SKILL_EN.md`；修正了 Codex 校验器不接受的尖括号与 DSH 专属工具措辞） |
| [`skills/`](skills/README.md) | **DSH skill 家族（四个自包含模块）**：`qqnt-plugin-dev`（写插件）/ `qqnt-plugin-debug`（调试）/ `qqnt-loader-install`（安装与签名补丁）/ `qqnt-capability-limits`（能力边界）；每块含英文 `SKILL.md` + 中文 `SKILL_ZH.md`，调试模块内嵌调试插件，四块 description 均 ≤500 字符；安装与作者约束见 `skills/README.md` |

## 三条最值得先读的结论

1. **先查 QQ 原生设置，再写插件。**
   本次真实教训：折腾半天"让链接走系统默认浏览器"，最后发现 QQ 自带开关 **「使用系统默认浏览器打开网页」**（设置 → 通用/其他），打开即可。
2. **QQ 的很多行为是原生外壳（`QQNT.dll`）做的，JS 层碰不到。**
   实测：包住 59 个已注册 `ipcMain` invoke 处理器 + 15 个 on 通道后，点链接/点图标 **0 命中**；`shell.openExternal` 从未被调用；导航钩子全未触发。写插件前先确认"这事到底经不经过 JS 层"。
3. **插件代码改动会被 QQ 的文件校验挡下来。**
   9.9.33 用 `application.json` 里的 **RSA 签名**校验 app 目录文件（改 `package.json` 会直接启动失败），需要按签名补丁改 `QQNT.dll`（见 [`docs/qqnt-internals.md`](docs/qqnt-internals.md)）。

## 与用户配合测试（"问询"）

插件的事实大多只能在**用户正在运行的 QQ** 上观察到（DOM 形状、哪个层处理了这个动作、改动到底生效没有），所以**必须和用户来回测试**，不要指望一轮做完。

- **在 DSH（DeepSeek Harness）上**：用 **`ask_user_question`** 工具向用户提问并等待回答（默认阻塞）。每个问题给 `id`、短 `header`、具体 `question`，以及**带一句话说明的选项（推荐项放第一个）**，多项可选时用 `multi_select`；用户也可以给自定义答案或跳过。答案以 `{"answers":[{"id","selected","custom"}]}` 回传；**等待人类回答不消耗 token**。（另有 `mode: timed` + `timeout` 变体：超时后模型可继续独立工作、问题仍可回答；`timeout: -1` 无限等待。注意：归属于另一个 agent 的存活子 agent 不能提问，必须把未决问题写进自己的最终结果。）
- **其它 agent 平台**：请自查环境是否有等价能力（elicitation / 人机交互工具 / 审批提示）；没有就把测试步骤和需要回报的内容写清楚，请用户执行。
- **一轮一个小而决定性的测试**："点一条链接，然后选：① 进了系统浏览器 ② 弹出 QQ 内置浏览器 ③ 没反应"，而不是"请帮我全测一遍"。
- 任何会**改变用户客户端**的动作（装插件、改文件、重启 QQ）先说明，并给出回滚方式。

> **适配范围**：本仓库的四个 skill 模块针对 **DSH（DeepSeek Harness）** 编写与实测（工具名、`ask_user_question`、eval 调试流程）；**未在其它的 agent 平台上测试过**，其它平台请先在自己环境里验证再套用。

## 免责声明（务必阅读）

本仓库提供的全部内容（代码、补丁、脚本、文档）**仅用于关于软件架构与 JavaScript 注入技术的教育、研究目的**。使用者必须严格遵守以下条款：

- **禁止违反《计算机软件保护条例》**：禁止逆向工程、修改或分发腾讯 QQ 客户端的修改版本；禁止将本仓库内容用于制作、提供任何用于侵入或非法控制计算机信息系统的程序、工具。
- **禁止任何商业用途**，禁止任何损害腾讯及其关联公司合法权益的行为。
- **禁止侵犯著作权**，包括规避 QQ 客户端的技术保护措施。
- 使用者必须自行确保其对 QQ 客户端的使用**已获得合法授权**（包括遵守腾讯的用户协议）。
- 本仓库中涉及 QQ 本体文件的说明**仅用于解释校验机制本身，便于研究与回滚**，不用于帮助绕过官方授权。
- **开发者不承担**任何人因使用本仓库内容而产生的滥用行为与后果。
- **使用本仓库即表示接受上述条款，所有风险由使用者自行承担。**

> ⚠️ 在中国大陆，下列行为**可能构成犯罪**，请务必避免：
> ① **提供侵入、非法控制计算机信息系统程序、工具罪**（《刑法》第二百八十五条第三款）；
> ② **侵犯著作权罪**（《刑法》第二百一十七条，含规避技术措施）；
> ③ **破坏计算机信息系统罪**（《刑法》第二百八十六条）。
> 本仓库仅供学习研究，任何越界使用均与本仓库作者无关。

另附：第三方插件存在**账号风险**，请自行评估；本仓库不包含任何个人数据（QQ 号、聊天内容、token 等），示例路径一律使用占位符。

## License

MIT（见 [`LICENSE`](LICENSE)）。
