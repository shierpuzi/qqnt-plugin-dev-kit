# skills/qqnt-plugin-dev

DSH skill：把 QQNT / LiteLoaderQQNT 插件的开发与调试流程固化下来，让 agent 在遇到相关任务时自动加载。

## 怎么安装

把整个 `qqnt-plugin-dev/` 目录复制到 DSH 的 skills 目录：

```text
<DSH_HOME>/skills/qqnt-plugin-dev/SKILL.md
```

- `<DSH_HOME>` 通常是 DeepSeek Harness 的数据目录（例如 `…\DeepSeek_Harness_Portable\data\.dsh`），skills 放在其下的 `skills/`。
- 复制后**新开一个会话**，skill 才会出现在会话的 skill 列表里。
- 校验：新会话里问一句"QQNT 插件怎么调试"，agent 应该会引用 `qqnt-plugin-dev`。

## 依赖的参考资料

SKILL.md 里引用的文档与工具都在本仓库（clone 下来后按相对路径读）：

| 文件 | 用途 |
|---|---|
| [`../../agent_readme.md`](../../agent_readme.md) | 给 agent 的最短上手路径、硬规则、实测边界表 |
| [`../../docs/plugin-development.md`](../../docs/plugin-development.md) | 从零写插件的完整指南 |
| [`../../docs/debugging.md`](../../docs/debugging.md) | 黑盒调试方法论与案例复盘 |
| [`../../docs/qqnt-internals.md`](../../docs/qqnt-internals.md) | QQ 9.9.33 内部机制实测 |
| [`../../plugins/dsh-debug-logger/`](../../plugins/dsh-debug-logger/) | 调试日志插件（含安装说明） |

如果 skill 是单独复制的（没有随仓库 clone），把上面这些文件一并带上，或改读 GitHub 仓库：
`https://github.com/shierpuzi/qqnt-plugin-dev-kit`

## 适用范围

实测环境：QQ NT **9.9.33-52230** (x64) + LiteLoaderQQNT fork **5.2.1** + Electron 40 + Windows（2026-10）。
其它 QQ 版本：目录结构、校验机制、DOM 选择器都可能变，按 `docs/debugging.md` 的探针重新确认后再动手。
