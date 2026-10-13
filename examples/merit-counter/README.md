# merit-counter —— 左侧栏「功德 +1」按钮（skill 实测样例）

用 skill（`qqnt-plugin-dev` / `qqnt-plugin-debug`）从零走完一次插件开发的结果，也是那次实测的复现样例。

## 行为

- 在 QQ 左侧栏（`.sidebar__nav`）追加一个 `＋1` 按钮
- 点一下：按钮旁边浮出提示 **“+1　共点击了 N 次”**（上浮 + 淡出）
- 计数存 `localStorage`，**跨 QQ 重启保留**
- 鼠标悬停按钮时 `title` 也显示“共点击了 N 次”

## 安装

```powershell
Copy-Item . "<profile>\plugins\merit-counter" -Recurse      # <profile> = $env:LITELOADERQQNT_PROFILE 或加载器根目录
```

重启 QQ。验证：`console.log` 里出现 `[merit-counter] 按钮已插入左侧栏`，或直接看左侧栏多了一个 `＋1`。

## 实测要点（9.9.33-52230）

| 事实 | 值 |
|---|---|
| 注入容器 | `.sidebar__nav`（`nav sidebar__nav vue-component`，约 52×455，`flex/column/center`） |
| 子项 | 8 个 `.nav-item`（36×36；被隐藏的如“频道/更多”是 0×0） |
| 注入方式 | 克隆一个**可见**的 `.nav-item`（`cloneNode` 不复制事件监听器 → 克隆体只归自己），再替换内部内容 |
| 持久化 | `localStorage` 在 `app://` 页面跨 QQ 重启保留（实测：计数 115 重启后仍在） |
| 免重启迭代 | 先把同一段代码写进 `eval.txt` 验证注入，再打包成插件；**验完清空 `eval.txt`** |

## 注意

- 选择器会随 QQ 版本漂移 —— 换版本先按 `qqnt-plugin-debug` 的探针重新确认 `.sidebar__nav` / `.nav-item`。
- 本插件只注入自己的节点，不修改 QQ 已有元素，也不绕过任何校验。