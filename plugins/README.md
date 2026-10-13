# 本目录的插件

这里放的是**可直接安装**的 LiteLoaderQQNT 插件。当前只有：

| 目录 | 说明 | 建议 |
| --- | --- | --- |
| [`dsh-debug-logger/`](dsh-debug-logger/README.md) | DSH 调试日志：把主进程/渲染进程的 console、异常、窗口创建与显示、部分 IPC 频道写进文件，附迷你 devtools | ✅ 推荐，排查插件 bug 的第一件工具 |

## 怎么安装

1. 找到你的 `<profile>` 目录：
   - 设置了环境变量 `LITELOADERQQNT_PROFILE` 时，`<profile>` 就是它的值；
   - 没设置时，`<profile>` 是 LiteLoaderQQNT 加载器的根目录。
2. 在 `<profile>/plugins/` 下新建一个以插件 `slug` 命名的目录（`slug` 见插件的 `manifest.json`），例如 `<profile>/plugins/dsh-debug-logger/`。
3. 把插件目录里的**所有运行时文件**（至少 `manifest.json` 和它 `injects` 里声明的脚本，例如 `main.js`）复制进去。**不要**把 `README.md` 一起当成运行文件看待 —— 它只是文档，放着不影响加载。
4. **重启 QQ**（完全退出进程再启动；注销重登不算）。
5. 验证：QQ 设置里出现插件条目（名称见 `manifest.json` 的 `name`），或插件自己的日志/提示出现。

插件私有数据一般写在 `<profile>/data/<slug>/`，卸载时该目录不会自动删除，需要自己清理。

## 这些插件长什么样

LiteLoaderQQNT（`manifest_version: 4`）的插件就是一个文件夹 + 一个 `manifest.json`：

```json
{
  "manifest_version": 4,
  "type": "extension",
  "name": "显示名",
  "slug": "目录名",
  "description": "一句话说明",
  "version": "1.0.0",
  "injects": {
    "main": "./main.js",
    "preload": "./preload.js",
    "renderer": "./renderer.js"
  }
}
```

`injects` 里的三块按需声明：`main` 跑在主进程，`preload` 跑在预加载脚本环境（可用 `contextBridge` 暴露接口），`renderer` 跑在渲染进程。`main.js` 通过全局 `LiteLoader`（如 `LiteLoader.path.data`）拿到路径等信息，并可以导出 `onBrowserWindowCreated` / `onBrowserWindowCreating` 钩子。

## 怎么停用 / 卸载

任选其一：

- 在 LiteLoaderQQNT 的设置界面里把插件开关关掉；
- 编辑 `<profile>/data/LiteLoader/config.json`，把 slug 加进 `disabled_plugins`：

```json
{
  "disabled_plugins": ["dsh-debug-logger"]
}
```

- 彻底卸载：退出 QQ，删掉 `<profile>/plugins/<slug>/` 目录。

## 改文件之前先备份

**动插件文件前，先把整个插件目录复制一份**（例如 `<profile>/plugins/dsh-debug-logger.bak/`，或打包成 zip 存到别处）。

理由很实在：

- 插件跑在 QQ 进程里，写错一行可能让 QQ 起不来或界面白屏，而报错信息不一定看得见 —— 这时有个能立刻还原的备份，比现场 debug 快得多；
- 本仓库里的插件是**从正在使用、已验证的环境原样复制**的（见各插件 README 的 SHA256），你改过之后就和上游版本不一致了，备份能让你随时回到已知可用的状态；
- 备份时建议连同 `<profile>/data/<slug>/` 一起留一份，排查日志往往还要对照。

改完后重启 QQ，再确认一次插件仍是加载成功的状态。
