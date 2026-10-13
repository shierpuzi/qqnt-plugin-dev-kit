# merit-counter —— 左侧栏「功德 +1」按钮（skill 实测样例 · v2 电子木鱼版）

用 skill（`qqnt-plugin-dev` / `qqnt-plugin-debug`）从零走完插件开发的结果，也是那次实测的复现样例。

## 行为

- 左侧栏（`.sidebar__nav`）一个 **木鱼图标** 按钮，右上角**常驻徽标**显示总次数（≥1000 显示 `1.2k`）
- **点击**：合成音效「笃」+ 按钮旁浮出 **“+1　共点击了 N 次”**（上浮+淡出），次数累加
- **长按 0.7 秒**：清零（弹出“已清零”）；长按后紧随的那次 click 会被吃掉
- 计数存 `localStorage`，**跨 QQ 重启保留**
- 悬停 `title` 显示“共点击了 N 次（长按清零）”

## 安装

```powershell
Copy-Item . "<profile>\plugins\merit-counter" -Recurse      # <profile> = $env:LITELOADERQQNT_PROFILE 或加载器根目录
```

重启 QQ。验证：`console.log` 出现 `[merit-counter] v2 按钮已插入左侧栏`，或直接看左侧栏。

## 实测要点（QQ NT 9.9.33-52230）

| 事实 | 值 |
|---|---|
| 注入容器 | `.sidebar__nav`（`nav sidebar__nav vue-component`，约 52×455，`flex/column/center`） |
| 子项 | `.nav-item[size="22"][scene="nav"][role="button"]`，36×36；隐藏项（频道/更多）为 0×0 |
| 注入方式 | 克隆**可见**的 `.nav-item`（`cloneNode` 不复制事件监听器 → 克隆体只属于本插件），再替换内部内容 |
| 图标 | 导航项自带 SVG **不用** `currentColor`；自绘 SVG 用 `currentColor` 即自动跟随主题（实测 `rgb(4,30,42)`） |
| 音效 | 无需音频文件：click 是合法用户手势 → `new AudioContext()` 可用；三角波下滑 + 带通噪声 ≈ 木鱼声 |
| 徽标 | QQ 自带未读徽标类为 `q-badge q-badge__red`；本插件用绝对定位 `<span>`（实测 23×13 px） |
| 长按 | `pointerdown` + 700 ms 定时器；`pointerup/cancel/leave` 清除；时间戳吃掉后续 click |
| 持久化 | `localStorage` 在 `app://` 页面跨 QQ 重启保留（实测：162 次重启后仍在） |
| 迭代 | 版本标记 + `install()` 移除旧节点 → 用 `eval.txt` **热替换**，约 1 秒生效、无需重启 |

## 注意

- 选择器会随 QQ 版本漂移 —— 换版本先按 `qqnt-plugin-debug` 的探针重新确认。
- 本插件只注入自己的节点，不修改 QQ 已有元素，也不绕过任何校验。