# lens-skin —— 「Lens 透镜」QQ NT 皮肤插件（实测经验文档 · v0.9.1）

把一个开源设计体系 [ruiqichenbiec/design-systems](https://github.com/ruiqichenbiec/design-systems) 里的 **Lens**（玻璃 / 圆角 / 弹性 / 合成音）映射到 QQ NT 的 LiteLoaderQQNT 皮肤插件（MIT，作者 shierpuzi）。

本目录**只有文档**，不含插件源码。插件本体在 `<profile>\plugins\lens-skin\`（仓库：[shierpuzi/LiteLoaderQQNT-Lens-Skin](https://github.com/shierpuzi/LiteLoaderQQNT-Lens-Skin)）。写这份文档的目的不是介绍这个皮肤好不好看，而是把**一次真实的皮肤插件开发里，"为什么这样做"和实测到的边界值**固化下来。

> 环境：**QQ NT 9.9.33-52230 (x64) + LiteLoaderQQNT 5.2.1 + Chromium 144 + Windows**，实测日期 **2026-10-16/17**。
> 换 QQ 版本先按 [`docs/debugging.md`](../../docs/debugging.md) 的探针复核选择器与令牌，本文件里的数字不保证跨版本成立。

> **版本沿革**：本文件最初随插件 **v0.4.0（旧版）** 写下；v0.5→v0.9.1 期间插件加了 GPU 光源、面板透明度/高斯模糊、控件固定边界，并把元素选择器**移出**到 `dsh-debug-logger`。下方所有"实测要点"都已按 **v0.9.1** 复核，仍标 `v0.4.0` 的地方一律用括号注明是旧版行为。

## 结构：三层可独立停用 + 一个设置入口

| 文件 | 层 | 做什么 |
|---|---|---|
| `manifest.json` | — | manifest v4，`type: theme`，`injects.renderer`，`version 0.9.1` |
| `renderer.js` | 装配 | `fetch` 注入两个 CSS 层、动态 `import()` 声音层 / GPU 光源层 / 设置模块、暴露 `onSettingWindowCreated` 钩子 |
| `lens-skin.css` | **令牌层** | 改 `body:is(.q-theme-tokens-light,.q-theme-tokens-dark)` 上的 QQ 原生 CSS 变量：配色 / 圆角 / 玻璃 / **固定边界** |
| `lens-motion.css` | **动效层** | 静态元素（导航项 / 联系人项 / 底部功能项 / 发送按钮）的被动 `transition` 弹性按压 |
| `lens-light.js` | **光源层** | 覆盖全窗口的 WebGL2 画布：SDF 逐元素圆角 + 全局鼠标方向光，一次 draw call 画完所有控件 |
| `lens-sound.js` | **声音层** | Lens 音频原语：Web Audio 实时合成，**零音频文件、不联网** |
| `lens-sound-bind.js` | 声音层 | 把音频接到 QQ 控件：点击 / 悬浮 / 回车发送 / 拖拽 / 滚轮 / 原生窗口拖动 |
| `lens-debug.js` | 调试工具 | **只剩**「限制光照渲染范围」：`Ctrl+Shift+B` 拖框，`uClip` 归一化裁剪 |
| `lens-settings.js` | 设置页 | QQ 设置页里的开关 + 滑杆 + 恢复默认；配置持久化 + 跨窗口广播 |
| `docs/GPU-LIGHT.md` | — | GPU 光源的开发文档（着色器数学、顶点布局、性能预算、重验清单） |
| `icon.png` | — | 插件图标 |

四个层各自独立：声音 / 光源模块加载失败不影响皮肤与动效（`renderer.js` 里用 `import().catch()` 兜住）。样式之所以放在同目录的外部 CSS 而不是内联进 JS，是因为**样式是设计资产、要能独立迭代**——改完重启 QQ 即生效。

### v0.4.0（旧版）→ v0.9.1 的差异

| 能力 | v0.4.0（旧版） | v0.9.1 |
|---|---|---|
| 面板玻璃 | 固定 alpha，无模糊 | **透明度 + 高斯模糊两个滑杆**（`--lg-alpha` / `--lg-blur`，模糊 0 时整条 `backdrop-filter` 置 `none`） |
| 光影 | 只有弹性按压 | **GPU 全局鼠标光源**（所有控件共用一个光源，联动迎光/背光） |
| 控件边界 | 无 | **1px 内描边 + 轻投影**，模糊调到 0 时控件也不糊在壁纸里 |
| 调试工具 | 内置元素选择器 + 拖框 | 选择器**移出**到 `dsh-debug-logger`；本插件只剩 `Ctrl+Shift+B` 拖框限制光照范围 |

## 安装 / 迭代

```powershell
Copy-Item "<插件目录>" "<profile>\plugins\lens-skin" -Recurse   # <profile> = $env:LITELOADERQQNT_PROFILE 或加载器根目录
```

重启 QQ。设置入口是 LiteLoader 提供的**插件设置页**（QQ 设置里的插件列表 → Lens 透镜），由 `onSettingWindowCreated` 钩子渲染。配置落盘在 `<profile>\data\lens-skin\config.json`（走 `LiteLoader.api.config`）。

日志自检（`console.log`）：

| 期望输出 | 说明 |
|---|---|
| `[lens-skin] lens-skin: <字节> 字节 / <规则数> 条规则` | 令牌层注入成功（动效层同格式第二条） |
| `[lens-skin] 声音已启用：点击 select/success · 拖拽/滚动/窗口拖动 friction` | 声音层就绪 |
| `[lens-skin] 设置已应用: {…}` | 本窗口读到了持久化配置 |

**改插件文件必须重启 QQ**；调试阶段可用调试插件的 `eval.txt` 热替换迭代（注意下面的"eval.txt 并发"）。

## 实测要点

### 1. 主题令牌：挂在哪、为什么会有两套蓝

| 事实 | 实测值 |
|---|---|
| 令牌挂载点 | `body.q-theme-tokens-light`；暗色版是同级的 `i.q-theme-tokens-dark`。**不是** `document.documentElement` |
| 令牌数量 | 实测 **388~429** 个 |
| `--nt_*` 派生令牌 | 是**构建期预计算的字面色值**，**不跟随** `--brand_standard` |
| 后果 | 只改基色后，**25 个**蓝色系令牌仍是旧值（`--divider-brand`、`--badge-brand`、`--nt_brand_standard_2_20_2_alpha`、`--host_bubble_bg_css_value` 等）→ 界面出现**两套蓝** |
| 解法 | 用 `color-mix(in srgb, var(--lg-accent) N%, transparent)` 从唯一真源 `--lg-accent` 推导**全部**派生令牌 |
| 兼容性 | Chromium 144 支持 `color-mix`（实测） |
| 校验结果 | **32/32** 派生令牌补齐；全界面扫描 **637** 个元素，**0** 处旧色残留 |
| alpha 阶梯 | 8 / 10 / 20 / 25 / 40 / 50 %，以及 0% 占位 |
| 覆盖顺序 | 样式必须插到 `head` 末尾，保证在 QQ 自己的样式之后，令牌覆盖才生效 |
| 自身气泡 | `--host_bubble_bg_css_value` 用 `color-mix(accent 22%, #fff)` 保持浅色可读，不直接上纯 accent |
| **作用域写法** | 每条规则都必须写成 `body:is(.q-theme-tokens-light, .q-theme-tokens-dark)` —— 写死成 `body.q-theme-tokens-light` 会让**暗色主题下整套皮肤完全不生效**（元素匹配不到任何规则）。这是 v0.4.0（旧版）里真实发生过的 bug |

**这一条是整份文档里最值得记住的**：QQ 的皮肤令牌不是一套"改一个基色就全跟着变"的变量系统，派生令牌是预计算的字面值。不做补全，界面一定花。

### 2. 设置页开关：外观由 `is-active` 驱动，不是 `aria-checked`

| 事实 | 实测值 |
|---|---|
| 驱动外观的 class | **`is-active`**（**不是** `aria-checked`） |
| 只改 `aria-checked` 的症状 | 状态值正确，但外观**永远显示为关** → 用户以为"开关点不动" |
| 正确结构 | `<div class="q-switch"><span class="q-switch__handle"></span></div>`，切换时 `classList.toggle("is-active", on)` |
| 开启态实测 | 轨道 `rgb(40,117,237)`、手柄 `translate 12px` |
| 仍然要做的 | `aria-checked` 照旧同步，用于无障碍语义 |
| 恢复默认 | 必须回写控件（开关 + 滑杆 + 数值文本），否则界面停在旧位置，看起来像"按钮没生效" |
| 滑杆落盘 | 拖动 `input` 高频触发 → 防抖 **160ms**（源码确认），停手后才写磁盘 |
| 滑杆回调 | 必须 `await saveConfig()` 之后再 `onChange`，否则传出去的是 Promise，声音层 `Object.assign(cfg, Promise)` 是空操作 → 拖动不即时生效 |
| 配置范围 | `volume` 0~1、`frictionGain` 0~0.6、`panelOpacity` 0~1、`panelBlur` 0~64(px)、`lightStrength` 0~1；`null`/`""` 会被 `Number()` 静默转成 0（表现为"音量莫名 0 静音"），所以显式挡掉再用 fallback |

### 3. 跨窗口：最大的坑

| 事实 | 实测值 |
|---|---|
| 窗口模型 | QQ 每个窗口是**独立 JS 上下文**：主界面 `webcontentsid=2`、设置页 `webcontentsid=6` |
| 错误做法 | 在设置页 `window.dispatchEvent(...)` —— **跨不过窗口**，主界面收不到 |
| 表面症状 | "设置改了要重启 QQ 才生效"（而磁盘写入其实一直是对的） |
| 解法 | `localStorage` 的 **`storage` 事件**（浏览器原生跨窗口机制），实测可用 |
| 关键注意 | `storage` **不在写入者自己的窗口触发** → 本窗口要另走一条 `CustomEvent` |
| 载荷 | 配置里额外带 `_t: Date.now()`，保证连续两次相同配置也能触发事件 |
| 实测验证 | 主窗口写入后，其它 **3 个窗口**都收到了通知 |
| 广播位置 | 放在 `saveConfig()` 内部而不是各调用点，保证开关 / 滑杆 / 恢复默认三处都不漏 |

### 4. 音量：改了字段但没碰音频图

| 事实 | 实测值 |
|---|---|
| 原先的写法 | `master.gain.value` 只在创建 `AudioContext` 时设一次 |
| 后果 | 之后 `sound.volume = x` 只改字段值、不碰音频图 → 音量滑杆"没反应" |
| 解法 | 给 `volume` 写 **getter/setter**，setter 里同步 `master.gain.value` |
| 边界 | setter 在 `master` 存在前无副作用（初始化时用 `_volume` 而不是 `volume`） |

### 5. 滚动边界：几何公式在虚拟列表上永远失败

| 事实 | 实测值 |
|---|---|
| QQ 滚动容器 `overflowY` | **`overlay`**（不是 `auto`/`scroll`）→ 匹配正则必须含 `overlay` |
| 消息列表 | **虚拟列表**：`scrollHeight` 是伪造的 **300000**，`clientHeight` 只有 **322** |
| 几何判据 | `scrollHeight - clientHeight - scrollTop ≈ 0` **永远失败**（这是上一版的 bug） |
| 解法 | **行为判据**：滚轮触发了，但 `scrollTop` 没变化（同方向、变化 < 0.5px）→ 已在边界 |
| 为什么更好 | 对虚拟列表、普通列表，以及顶 / 底两个方向都成立；反向滚动时方向改变会正常恢复出声 |
| 输入框 | `.chat-input-area` 区域滚轮不出声 |

### 6. 原生窗口拖动：收不到 pointer，但进程活着

| 事实 | 实测值 |
|---|---|
| `app-region: drag` 区域 | 顶栏 **1061×40**、左侧竖条 **52×581** |
| 拖动时的 pointer 事件 | renderer **收不到**：pointerdown / move / up 全为 **0** |
| 渲染进程状态 | **仍在正常运行**：12 秒 **239** 次心跳、最长卡顿 **0ms**、窗口确实位移 **214px** |
| 解法 | 轮询 `window.screenX/screenY` 反推速度来做"拖窗口的沙沙声"（90ms 一轮；位移 > 4px 视为拖动开始；只对 `visibilityState === "visible"` 生效，后台窗口的 screen 值不可信） |

结论：**原生拖动不是"进程被冻住"，只是输入事件不走 JS**。别因为收不到事件就以为这条路断了。

### 7. 动效层：独立属性 + 选择器精度

| 事实 | 实测值 |
|---|---|
| 用什么属性 | `scale` / `translate` **独立属性**，**不覆盖** `transform` 简写（QQ 弹窗可能用 transform 做居中定位） |
| 弹簧曲线 | `cubic-bezier(.2,.9,.25,1.22)`，实测过冲 **0.4%**（scale 0.94 → 峰值 1.004 → 1.000） |
| 时长 | fast 160ms / normal 240ms / feedback 520ms |
| 缩放量 | 导航项 0.92 · 联系人项 0.985（长列表密集按压不晃眼）· 底部功能项 0.94 · 发送按钮 0.94 |
| 发送按钮 | **不是 `<button>`**，是 div 组合：最外层 `.send-btn-wrap` 才画蓝底（`rgb(40,117,237)`、**94×32**），内层 `.send` / `.send-msg` 只有文字（60×32 / 28×28，背景透明）→ 弹性必须加在 `.send-btn-wrap`，加在内层只有文字在缩 |
| 全站 `button` 规则 | 一条覆盖**全站 `button`** 的规则会让"点左上角头像开资料卡"时界面**卡死**（实测）→ QQ 这种大型应用里要限定容器 |
| v1 事故（源码记载） | 早期版本让主窗口渲染冻结；源码里记的嫌疑是**全文档 MutationObserver**（对每个新增节点递归 `getComputedStyle`）与给动态浮层加 `animation` + `fill-mode: both`。故 v2 三条铁律：只作用于始终存在的静态元素 / 零 `@keyframes`、零 `animation`、零 `fill-mode` / 不引入任何 JS 观察器。补充：另有一条覆盖全站 `button` 的规则会卡死（见上一行），两者是不同的原因，都未做单独隔离验证 |
| 无障碍 | `@media (prefers-reduced-motion: reduce)` 时 `scale: 1` 且 `transition-duration: 0s` |

### 8. 声音层：合成原语与事件绑定

| 事实 | 实测值 |
|---|---|
| 音频来源 | 全部 Web Audio **实时合成**，不含音频文件、不联网 |
| `success`（发送） | `[[660,660,.15],[990,990,.085,.085]]` |
| `select`（点击） | `[[760,620,.17],[1140,960,.035]]` |
| `grab`（悬浮） | 冷却 **95ms**（70ms 过密、140ms 迟钝，95ms 是实测折中） |
| `synthesizeFriction` | 2 秒循环摩擦纹理，由播放速率与带通滤波映射速度 |
| 手势解锁 | 浏览器要求**真实用户手势**后才能出声，**首次点击前无声是预期行为** |
| 悬浮判定 | `pointerenter` 不冒泡 → 用 `pointerover` + 记录上一个元素模拟；移出所有控件时要清空记录，否则回到同一个控件不会再响 |
| 回车发送 | 回车**不产生 click** → 另监听编辑器 `keydown` 的 Enter（排除 `isComposing` 与 Shift/Ctrl/Alt/Meta） |
| 拖拽起音 | **不能**在 `pointerdown` 就出声（单击联系人会叠一层音）→ 位移超过 **6px** 才算拖拽 |
| 速度映射 | `speed = hypot(dx,dy) * 1000 / max(8, dt)`；`amount = clamp((speed-8)/1100, 0, 1)` |
| 摩擦音强度 | 绑定处默认 `frictionGain 0.32`（滑杆范围 0~0.6）；构造函数默认 0.42 |
| 滚轮参数 | `wheelHold 400ms`（停手后余韵，调大=连续滚动少重启）/ `wheelScale 0.6`（滚轮比拖拽轻） |
| 并发限制 | `maxVoices 6`：超了淘汰最旧的声部；默认 `cooldown 70ms` 防止密集爆音 |
| 绑定方式 | 事件委托挂 `document`，全部 `{ passive: true }`，绝不 `preventDefault`，不用 `getComputedStyle` 做全量查询 |

### 9. 性能：用来反驳"美化会拖慢 QQ"

| 事实 | 实测值 |
|---|---|
| 动效层真实开销 | **0.5ms**（A/B 对比：2.1ms vs 1.6ms，1300+ 元素） |
| 全量样式遍历 | **1691** 元素 / **7.7ms** |
| 皮肤层规模 | **95** 张样式表 / **7570** 条规则 |
| GPU 光源 | **一次 `drawArrays`** 画完 20~24 个控件；CPU 每帧开销**测不出**（`cpuMedianMs: 0`） |
| CSS 阴影方案（已废弃） | 给所有控件挂 `box-shadow` 实测 **约 20fps**（27 个控件 × 5~6 层模糊 = 每帧 160+ 层光栅化） |
| 几何重建 | `REBUILD_MS = 700` 定时 + `scroll` / `resize` 事件，绝不在 `pointermove` 里读 `getBoundingClientRect` |

### 10. 工程细节

| 事实 | 实测值 |
|---|---|
| 读插件自己的资源 | `local://profile/<相对路径>` 可读；`local:///绝对路径` 也**可用**（早期误判为不可用）。仍推荐用 profile 相对路径，避免硬编码盘符 |
| 路径推导 | 从 `LiteLoader.plugins[slug].path.plugin` 反推相对 `LiteLoader.path.profile` 的路径 |
| 热迭代 | 改插件文件需重启 QQ；调试阶段用调试插件 `eval.txt` 可热替换 |
| **eval.txt 陷阱** | `eval.txt` **在每个窗口都执行** → 改状态的脚本会**并发跑 N 次**，读回的值可能互相覆盖（因此误判过一次） |
| 声音层解耦 | 独立 ESM 模块，`import().catch()` 兜底，加载失败不影响皮肤与动效 |
| 设置钩子 | `onSettingWindowCreated` 导出 + 同时挂 `window.lensSkinSettings`（两处冗余，兼容不同加载方式） |
| `local://` 模块实例 | `local://profile/...` 与 `local:///绝对路径` 是**两个不同的模块实例**（各自维护状态）。用 eval 通道做探针时要操作页面**自己的**实例（如 `window.__dshPicker`），不要自己 `import` |

### 11. GPU 全局鼠标光源（v0.9.1 新增）

**为什么必须是 GPU**：v0.7.0 只在 `:hover` 给一个控件加阴影 → 其它控件不联动；给所有控件挂 CSS 阴影 → 约 20fps。`box-shadow` 走绘制路径而非合成器，层数一多必崩，而且 CSS 做不了逐像素方向光。

| 事实 | 实测值 |
|---|---|
| 载体 | 一张覆盖全窗口的 **WebGL2** 画布，`z-index: 2147483000`、`pointer-events: none` |
| 硬件加速 | `ANGLE (NVIDIA GeForce RTX 3070 Ti, D3D11)`，`MAX_TEXTURE_SIZE=16384` |
| 每次绘制 | 单次 `drawArrays(gl.TRIANGLES, 0, quadCount * 6)`，20~24 个控件 |
| 几何 | 每个控件 6 顶点 / 2 三角形；每个顶点 **7 个 float**（`aPos` 2 + `aRect` 4 + `aCorner` 1） |
| 圆角 | **逐元素**读 `getComputedStyle(el).borderTopLeftRadius`，并夹到半宽高以内（`.func-menu__item` 真实圆角是 **0px**，统一用 14px 会画出悬空方框） |
| SDF | `sdRoundBox(p, b, r)`，`b` 必须是**真实半宽高**；外扩 `MARGIN = 7px` 只用于顶点，用进 SDF 会让光框整体外移 7px |
| 光照公式 | `directional = pow(max(dot(n2, light), 0), 7)`；`opposite = pow(max(dot(n2, -light), 0), 7) * 0.52`；固定偏置 `vec2(-80, 150)` + 跟随鼠标的 glint |
| DPR | `devicePixelRatio` 上限 **2**（4K 屏下不让纹理失控） |
| 节流 | 写入节流 **16ms**（≈60fps）+ 定时器补写；**不依赖 `requestAnimationFrame`**（实测 QQ 里 rAF 回调可能被丢弃） |
| 只建一次 | 只在实际承载 UI 的窗口建上下文（隐藏/池化/空白窗口注入的 renderer 不建），有限次重试等待 `.recent-contact-item` / `.nav-item` 出现 |
| 删除的亮线 | Lens 原件的 1px `outline` 已删 —— DOM 侧 CSS 已画 1px 内描边，两条线叠加就是用户看到的"双边框" |

**必须做的四道几何过滤**（缺一条就会卡死或画错）：

| 过滤 | 阈值 | 不做的后果 |
|---|---|---|
| `Number.isFinite(left/top/width/height)` | — | `NaN` 顶点 → 光栅化行为未定义，可能挂死 |
| 最小尺寸 | `width < 10 \|\| height < 10` | `display:none` 元素是 0 矩形 |
| 尺寸上限 | `MAX_TARGET = 2000` px | 虚拟列表占位/末项容器的巨型矩形 → 海量像素光栅化 → GPU 卡住、窗口失去响应（群成员列表滑到最后一项必崩） |
| **可见性** | `getComputedStyle(el).visibility === "hidden"` | 见下方第 12 条 / [`LESSONS.md` 第 19 条](LESSONS.md) —— 尺寸上限**拦不住**它 |
| 视口外 | `top = -200, bottom = innerHeight + 200` | 白建顶点，但保留 200px 余量让滚动边缘不闪 |
| 数量兜底 | `MAX_QUADS = 300` | 顶点数失控 |

**窗口不可见时跳过绘制**（`if (document.hidden) return;`）：省 GPU。副作用是 `readPixels` 全 0 —— **预期行为，不是 bug**。

### 12. 面板透明度与高斯模糊滑杆（v0.9.1 新增）

| 事实 | 实测值 |
|---|---|
| 透明度 | `panelOpacity` 0~1（默认 0.34）→ 写 `--lg-alpha`，`--lg-glass: rgb(245 250 255 / var(--lg-alpha))` |
| 高斯模糊 | `panelBlur` 0~64px（默认 12）→ 写 `--lg-blur`，同时写整条 `--lg-backdrop` |
| **为什么整套 `backdrop-filter` 由 JS 写** | `blur(0px)` 仍会让浏览器为元素建立 **backdrop root**（合成成本照付）却毫无视觉效果 → 模糊为 0 时直接置 `none` 省掉这份开销 |
| 面板集合 | `.sidebar` / `.recent-contact` / `.chat-header` / `.chat-func-bar` / `.chat-input-area` / `.chat-msg-area`，`-webkit-` 前缀同步一份 |
| 叠加顺序（有意的） | ① 我们的 `backdrop-filter` ② QQ 面板自身的半透明底色；**不要**再给面板加共享 `box-shadow`，否则与 GPU 光源的边界光叠加成"多一圈" |
| 默认值单源 | `lens-skin.css` 的 `--lg-alpha` / `--lg-blur` 默认值必须与 `lens-settings.js` 的 `DEFAULT_CONFIG` 保持一致（改一处要同步另一处） |
| **"整界面透明"已回退** | QQ 自己在 `.message-panel` / `.viewport-list__inner` / `.sidebar-nav` 等表层刷半透明白底（0.5 / 0.2 …），它们不引用我们的变量。曾把这些表层统一改写成 `var(--lg-glass)` 以让滑杆一路管到全透明（像素堆叠探针确实显示 `allBlockersTransparent: true`），但实测**让 QQ 卡死两次**：叠加我们面板的 `backdrop-filter` 与全窗口 WebGL 画布后，合成器持续走"与桌面合成"的慢路径 → 主界面失去响应。**故整段回退**，"面板透明度"只作用于我们自己声明的玻璃层，表现是"玻璃层变透"而非"整个界面变透" |

### 13. 控件固定边界：1px 内描边（v0.9.1 新增）

| 事实 | 实测值 |
|---|---|
| 目的 | 高斯模糊调到 0 时控件**不会糊在壁纸里**（"边界性低"的修复） |
| 实现 | `box-shadow: 0 1px 2px rgba(33,53,82,.14), inset 0 0 0 1px rgba(255,255,255,.4)` |
| 作用对象 | **只有** `.recent-contact-item` 与 `.nav-item`；`.func-menu__item` 被**故意排除**（真实圆角 `0px`，统一加圆角描边会画出方框，与 GPU 侧方形光带叠成用户截图里左下角那个多余矩形） |
| 与 GPU 光源的分工 | CSS 只负责固定边界；**方向光一律由 `lens-light.js` 统一渲染**，不要在 CSS 里再加方向性光影 |

### 14. 调试工具（v0.9.1：选择器已移出）

| 工具 | 位置 | 用法 |
|---|---|---|
| **元素选择器** | **`dsh-debug-logger` 插件**（本插件不再提供） | `Ctrl+Shift+C` 拾取、按住 Ctrl 多选、选中自动复制详情 + 气泡、自定义快捷键、`Ctrl+Esc` 退出 |
| 拖框限制光照范围 | `lens-debug.js` | `Ctrl+Shift+B` 进入拖框（或设置页点「拖框限制」）；拖完自动退出；「清除范围」恢复全窗口 |
| 归一化裁剪 | `lens-light.js` 的 `uClip` | 范围用 **0..1 归一化**坐标，窗口缩放不错位（实测 1061 与 2122 宽下同一比例都是 `0.5`） |
| 导出光照报告 | 设置页 | 光照命中清单 + 当前范围写入控制台（搜 `lens-debug`） |
| eval REPL / 探针 | `dsh-debug-logger` | 写 `eval.txt`，注意**每个窗口都执行** |

**为什么用 `Ctrl+Esc` 而不是 `Esc`**：QQ 自己用 `Esc` 关窗口，占用它会"想退出调试反而把窗口关了"。注意 `KeyboardEvent.key` 的值是 `"Escape"`，而用户习惯写 `"Esc"` —— 早期版本直接字符串比较，导致 `Ctrl+Esc` **永远匹配不上**（退出键失效），必须做别名映射。

**两条覆盖层铁律**：① 拾取/拖框时覆盖层才临时 `pointer-events: auto`，**用完必须立刻恢复 `none`**，否则吞掉 QQ 全部点击；② 拖完一个框**自动退出**拖框模式。

**渲染范围（`uClip`）不落盘**：只在当前窗口会话内有效，重启/刷新回到全窗口 —— 它是有意的排查工具，不是常态设置。

## 注意

- **选择器会随 QQ 版本漂移。** 本文件所有类名与尺寸都来自 9.9.33-52230，换版本先按探针重新确认，尤其 `q-switch`、`.send-btn-wrap`、`q-theme-tokens-*`、`.viewport-list__measure` 四处。
- **不要写全站 `button` 规则。** 实测会让资料卡场景卡死；动效选择器一律限定到具体容器/组件。
- **新增 CSS 规则必须沿用 `body:is(.q-theme-tokens-light, .q-theme-tokens-dark)`。** 只写 `light` 会让暗色主题下整条规则失效（真实 bug）。
- **光照目标不能只靠尺寸过滤。** 必须过 `visibility === "hidden"`，否则虚拟列表的测量副本会画出一个巨型光框。
- **首次点击前没有声音是正常的**，不是插件坏了（浏览器手势解锁机制）。
- **不要用 `scrollHeight - clientHeight - scrollTop` 判断滚动到底**，QQ 消息列表是虚拟列表，这个公式永远不成立。
- **动效层不要碰 `transform`**，用 `scale` / `translate` 独立属性，否则会破坏 QQ 自己的定位与居中。
- **不要给 GPU 画布以外的全屏层留 `pointer-events: auto`**；画布本身必须 `none`，否则吞掉 QQ 全部点击。
- **不要在设置页指望 `window.dispatchEvent` 跨窗口生效**，用 `localStorage` 的 `storage` 事件，并记得它不在写入者窗口触发。
- 本插件只改 CSS 变量、加被动 `transition`、挂被动事件监听、画一块 `pointer-events: none` 的画布；不改 QQ 已有 DOM 结构，不绕过任何校验，不联网。

## 踩坑复盘

逐条的症状 → 误判 → 根因 → 正解，见 [`LESSONS.md`](LESSONS.md)（24 条，含本轮修掉的隐藏测量副本 / 主题作用域 / 原生行背景露角 / rAF 丢帧 / `blur(0px)` 开销 / 整界面透明回退）。
GPU 光源的着色器数学、顶点布局与重验清单见 [`<插件目录>/docs/GPU-LIGHT.md`](https://github.com/shierpuzi/LiteLoaderQQNT-Lens-Skin/blob/main/docs/GPU-LIGHT.md)。
</content>
