/**
 * DSH 调试日志 · 元素选择器（独立实现，不依赖 Lens）
 *
 * 与 Lens 插件内置的调试工具同一套交互，但这里【不依赖任何其他插件】：
 * 只有元素拾取 + 详情复制 + 快捷键，没有"限制光照范围"（那是 Lens 专有的）。
 *
 * 功能：
 *   - Ctrl+Shift+C  进入/切换元素拾取：鼠标划过高亮，点击选中
 *   - 按住 Ctrl 点击  多选（再次 Ctrl 点击同一元素 = 反选）
 *   - Ctrl+Shift+X  复制已选元素详情到剪贴板
 *   - Ctrl+Shift+B  开关"拖框高亮"：只显示范围内的元素信息（不改渲染，仅辅助观察）
 *   - Ctrl+Esc     逐级退出（拾取 → 拖框 → 关工具）
 *   - 选中后自动复制详情 + 气泡提示"已复制到剪贴板"
 *
 * 快捷键可用 window.__dshPicker.setHotkeys({...}) 自定义。
 *
 * ===== 实测约束（照抄会有坑）=====
 * 1. navigator.clipboard.writeText 在 QQ 里会抛
 *    "NotAllowedError: Document is not focused"（Electron 40 要求文档有焦点）。
 *    因此复制必须退到 document.execCommand("copy") —— 实测该退路有效。
 * 2. 覆盖层 pointer-events 默认必须 none，否则会吞掉 QQ 全部点击。
 *    只在拾取/拖框模式临时 auto，用完立刻恢复。
 * 3. 单独 Esc 是 QQ 关窗口的键，占用会冲突 → 用 Ctrl+Esc。
 */

const STYLE_ID = "dsh-picker-style";
const OVERLAY_ID = "dsh-picker-overlay";

const DEFAULT_HOTKEYS = Object.freeze({
    pick: "Ctrl+Shift+C",
    copy: "Ctrl+Shift+X",
    box: "Ctrl+Shift+B",
    exit: "Ctrl+Esc",
});

/*
 * 快捷键持久化的 localStorage 键。
 * 【必须声明在使用之前】—— bootPicker() 会读它，而自举是模块加载时立刻跑的，
 * 若把它写在文件后面（const 的暂时性死区），会直接抛 ReferenceError
 * 导致整个 renderer 失效。
 */
const HOTKEY_KEY = "dsh-debug-logger:hotkeys";

/*
 * 跨窗口命令通道：设置页点「开始抓取」时，把命令写进 localStorage，
 * 主界面的 renderer 收到后启动拾取器（两窗口是独立 JS 上下文，无法直接互调）。
 */
const CMD_KEY = "dsh-debug-logger:command";

let hotkeys = { ...DEFAULT_HOTKEYS };

let active = false;
let picking = false;
let boxMode = false;
let pickHover = null;
let boxDrag = null;
let host = null;

const els = {};
let selected = [];

/* ---------- 覆盖层 ---------- */

function ensureDom() {
    if (host) return;
    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
          #${OVERLAY_ID} { position: fixed; inset: 0; z-index: 2147483001; pointer-events: none; }
          #${OVERLAY_ID} .dp-hl {
            position: fixed; pointer-events: none; box-sizing: border-box;
            border: 1px solid #33a0ff; background: rgba(51,160,255,.16); border-radius: 2px;
          }
          #${OVERLAY_ID} .dp-tag {
            position: fixed; pointer-events: none; max-width: 60vw;
            font: 11px/1.7 ui-monospace, Consolas, monospace;
            background: #33a0ff; color: #fff; padding: 1px 6px; border-radius: 3px;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          }
          #${OVERLAY_ID} .dp-sel, #${OVERLAY_ID} .dp-sel-multi {
            position: fixed; pointer-events: none;
            border: 1px dashed #ff8a1f; border-radius: 2px;
          }
          #${OVERLAY_ID} .dp-sel-multi { border: 1px solid #ff8a1f; background: rgba(255,138,31,.10); }
          #${OVERLAY_ID} .dp-margin { position: fixed; pointer-events: none; background: rgba(255,164,0,.24); }
          #${OVERLAY_ID} .dp-hint {
            position: fixed; left: 50%; top: 12px; transform: translateX(-50%);
            pointer-events: none; font: 12px/1.8 system-ui, "Microsoft YaHei", sans-serif;
            background: rgba(20,24,32,.92); color: #e8eefc; padding: 6px 14px;
            border-radius: 8px; border: 1px solid rgba(255,255,255,.12);
          }
          #${OVERLAY_ID} .dp-toast {
            position: fixed; left: 50%; bottom: 48px; transform: translateX(-50%);
            pointer-events: none; font: 13px/1.7 system-ui, "Microsoft YaHei", sans-serif;
            background: rgba(24,120,70,.96); color: #fff; padding: 8px 18px;
            border-radius: 10px; border: 1px solid rgba(255,255,255,.18);
            box-shadow: 0 6px 20px rgba(0,0,0,.32); animation: dp-toast-in .18s ease-out;
          }
          @keyframes dp-toast-in {
            from { opacity: 0; transform: translateX(-50%) translateY(8px); }
            to   { opacity: 1; transform: translateX(-50%) translateY(0); }
          }
        `;
        document.head.appendChild(style);
    }
    host = document.createElement("div");
    host.id = OVERLAY_ID;
    host.innerHTML = `
      <div class="dp-multi"></div>
      <div class="dp-hl" hidden></div>
      <div class="dp-tag" hidden></div>
      <div class="dp-margin" hidden></div>
      <div class="dp-sel" hidden></div>
      <div class="dp-hint" hidden></div>
      <div class="dp-toast" hidden></div>
    `;
    (document.body || document.documentElement).appendChild(host);
    els.multi = host.querySelector(".dp-multi");
    els.hl = host.querySelector(".dp-hl");
    els.tag = host.querySelector(".dp-tag");
    els.margin = host.querySelector(".dp-margin");
    els.sel = host.querySelector(".dp-sel");
    els.hint = host.querySelector(".dp-hint");
    els.toast = host.querySelector(".dp-toast");
}

const show = (el, visible) => { if (el) el.hidden = !visible; };

function syncOverlayPointerEvents() {
    if (!host) return;
    host.style.pointerEvents = (boxMode || picking) ? "auto" : "none";
}

/* ---------- 剪贴板（双路径，见文件头实测说明）---------- */

async function copyText(text) {
    try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* 失焦时必失败，走退路 */ }

    try {
        let handled = false;
        const onCopy = (ev) => {
            try { ev.clipboardData.setData("text/plain", text); } catch { }
            ev.preventDefault();
            handled = true;
        };
        document.addEventListener("copy", onCopy, true);
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
        (document.body || document.documentElement).appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        const ok = document.execCommand("copy");
        document.removeEventListener("copy", onCopy, true);
        ta.remove();
        return ok || handled;
    } catch {
        return false;
    }
}

/* ---------- 气泡提示 ---------- */

function toast(text, ms = 1800) {
    ensureDom();
    if (!els.toast) return;
    els.toast.textContent = text;
    els.toast.hidden = false;
    els.toast.style.animation = "none";
    void els.toast.offsetHeight;
    els.toast.style.animation = "";
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { els.toast.hidden = true; }, ms);
}

/* ---------- 元素描述 ---------- */

function selectorOf(el) {
    if (!el || el.nodeType !== 1) return "?";
    const parts = [];
    let cur = el, depth = 0;
    while (cur && cur.nodeType === 1 && depth < 4) {
        let p = cur.tagName.toLowerCase();
        const cls = (typeof cur.className === "string")
            ? cur.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
        if (cls.length) p += "." + cls.join(".");
        parts.unshift(p);
        cur = cur.parentElement; depth++;
    }
    return parts.join(" > ");
}

function describe(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
        tag: el.tagName,
        cls: String(el.className || ""),
        selector: selectorOf(el),
        rect: { w: Math.round(r.width), h: Math.round(r.height),
                left: Math.round(r.left), top: Math.round(r.top) },
        radius: cs.borderTopLeftRadius,
        boxShadow: cs.boxShadow === "none" ? "none" : cs.boxShadow,
        background: cs.backgroundColor,
        backgroundImage: cs.backgroundImage === "none" ? "none" : cs.backgroundImage.slice(0, 80),
        zIndex: cs.zIndex,
        normalized: {
            x: +(r.left / innerWidth).toFixed(4), y: +(r.top / innerHeight).toFixed(4),
            w: +(r.width / innerWidth).toFixed(4), h: +(r.height / innerHeight).toFixed(4),
        },
    };
}

/** 找出是哪些 CSS 规则给了该元素可见的背景/圆角/阴影 —— 定位"谁画的框" */
function traceRules(el) {
    const out = [];
    for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        if (!rules) continue;
        for (const rule of rules) {
            if (!rule.selectorText) continue;
            let m = false;
            try { m = el.matches(rule.selectorText); } catch { }
            if (!m) continue;
            const bg = rule.style.getPropertyValue("background") || rule.style.getPropertyValue("background-color");
            const br = rule.style.getPropertyValue("border-radius");
            const bs = rule.style.getPropertyValue("box-shadow");
            if (!bg && !br && !bs) continue;
            out.push({
                owner: sheet.ownerNode?.id || (sheet.href ? sheet.href.split("/").pop() : sheet.ownerNode?.tagName || "?"),
                selector: rule.selectorText.slice(0, 120),
                bg: bg || "-", radius: br || "-", shadow: bs ? bs.slice(0, 70) : "-",
            });
        }
    }
    return out.slice(0, 15);
}

const themeName = () => document.body.matches(".q-theme-tokens-dark") ? "dark"
    : document.body.matches(".q-theme-tokens-light") ? "light" : "?";

/* ---------- 拾取 ---------- */

/*
 * 顶部提示条。
 * 【用户反馈】选中之后提示文字一直悬浮在页面上不消失 —— 原因是早期实现
 * 只 show() 不 hide()。所以这里统一加自动关闭：
 * 调用 setHint(text, ms) 时会在 ms 后自动隐藏；传 0 / 负数表示"常驻"，
 * 只在明确需要持续提示的模式（拾取/拖框进行中）才用常驻。
 */
function setHint(text, ms = 0) {
    ensureDom();
    clearTimeout(setHint._timer);
    if (!text) { show(els.hint, false); return; }
    els.hint.textContent = text;
    show(els.hint, true);
    if (ms > 0) {
        setHint._timer = setTimeout(() => { show(els.hint, false); }, ms);
    }
}

function paintHover(el) {
    ensureDom();
    if (!el) { show(els.hl, false); show(els.tag, false); return; }
    const r = el.getBoundingClientRect();
    Object.assign(els.hl.style, {
        left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px",
    });
    show(els.hl, true);
    els.tag.textContent = selectorOf(el) + `  ${Math.round(r.width)}x${Math.round(r.height)}  r=${getComputedStyle(el).borderTopLeftRadius}`;
    const above = r.top > 20;
    els.tag.style.left = Math.max(2, r.left) + "px";
    els.tag.style.top = (above ? r.top - 18 : r.bottom + 2) + "px";
    show(els.tag, true);
}

function onPickMove(event) {
    if (!picking) return;
    /*
     * 拾取目标必须是【覆盖层下面】的真实元素。
     *
     * 用户反馈"选不中 WebGL 画布上的元素"——那不是 bug：
     * Lens 的光照画布是一张 pointer-events:none 的全屏透明层，
     * 它本来就【不该被选中】；它下面的控件才是要选的东西。
     * 所以这里额外判断命中结果是不是 canvas 之类的高层绘制层，
     * 在标签上标注出来，避免用户误以为"选不中"。
     */
    if (host) host.style.pointerEvents = "none";
    const el = document.elementFromPoint(event.clientX, event.clientY);
    syncOverlayPointerEvents();
    if (!el || el === host || (host && host.contains(el))) return;
    if (el !== pickHover) { pickHover = el; paintHover(el); }
}

function onPickClick(event) {
    if (!picking) return;
    event.preventDefault();
    event.stopPropagation();
    const el = pickHover;
    if (!el) return;
    const additive = event.ctrlKey || event.metaKey;
    selectElement(el, additive);
    if (!additive) setPicking(false);   // 多选时不退出，便于连续点
}

function selectElement(el, additive) {
    const info = describe(el);
    const rules = traceRules(el);

    if (additive) {
        const i = selected.findIndex((s) => s.el === el);
        if (i >= 0) selected.splice(i, 1);
        else selected.push({ el, info, rules });
    } else {
        selected = [{ el, info, rules }];
    }

    paintSelection();

    const detail = selected.map((s) => ({ info: s.info, rules: s.rules }));

    /*
     * 【实测坑】不要把对象直接 console.log 后就指望它落进日志文件。
     *
     * dsh-debug-logger 是把渲染进程的 console-message 转发到 console.log 文件的
     * （main.js 的 wc.on("console-message")），而 Chromium 传给该事件的 message
     * 是【已经序列化过的字符串】—— 对象会变成字面的 "[object Object]"。
     * 实测日志里就是：
     *   [dsh-picker] 选中 1 个元素: [object Object]
     * 于是"从控制台/日志拿选中条目"这条路径完全读不出内容。
     *
     * 所以这里额外打一份 JSON 字符串：既保留对象形态（DevTools 里可展开），
     * 又给日志留一条可读、可复制、可粘贴的记录。
     * 前缀 [dsh-picker:json] 便于用 grep / Select-String 精确抓取。
     */
    try {
        console.log(`[dsh-picker:json] ${JSON.stringify(detail)}`);
    } catch (e) {
        // 循环引用等极端情况：退化成逐条最小字段，保证日志里仍有可用信息
        try {
            console.log(`[dsh-picker:json] ${JSON.stringify(selected.map((s) => ({
                selector: s.info.selector, cls: s.info.cls, rect: s.info.rect,
                radius: s.info.radius, normalized: s.info.normalized,
            })))}`);
        } catch { /* 放弃序列化，仍有人类可读的那两行 */ }
    }

    console.log(`[dsh-picker] 选中 ${selected.length} 个元素:`, detail);
    for (const s of selected) console.log(`[dsh-picker] ${s.info.selector} 的样式来源:`, s.rules);

    try { window.dispatchEvent(new CustomEvent("dsh:picker-selected", { detail })); } catch { }

    /*
     * 选中后：收起顶部提示条（用户反馈它一直悬浮不消失）。
     * 单选会随即退出拾取模式，所以提示本就该消失；
     * 多选时也收起，让气泡（已复制）成为唯一反馈，避免两条信息同时挂在屏幕上。
     */
    setHint(selected.length > 1
        ? `已选 ${selected.length} 个（Ctrl+点击 继续增减，${hotkeys.exit} 退出）`
        : "", selected.length > 1 ? 2600 : 0);

    // 选中即复制 + 气泡（用户要求）
    copyDetails();
}

function paintSelection() {
    ensureDom();
    els.multi.innerHTML = "";
    if (!selected.length) { show(els.sel, false); return; }
    show(els.hl, false);
    const f = selected[0].el.getBoundingClientRect();
    Object.assign(els.sel.style, {
        left: f.left + "px", top: f.top + "px", width: f.width + "px", height: f.height + "px",
    });
    show(els.sel, true);
    for (let i = 1; i < selected.length; i++) {
        const r = selected[i].el.getBoundingClientRect();
        const d = document.createElement("div");
        d.className = "dp-sel-multi";
        Object.assign(d.style, {
            left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px",
        });
        els.multi.appendChild(d);
    }
}

/** 把详情整理成可粘贴文本（Markdown 风格，便于直接贴给我） */
function buildDetailsText() {
    const L = [];
    L.push(`# DSH 元素详情  ${new Date().toLocaleString()}`);
    L.push(`窗口 ${innerWidth}x${innerHeight}  dpr=${devicePixelRatio}  主题=${themeName()}`);
    L.push("");
    selected.forEach((s, i) => {
        const d = s.info;
        L.push(`## [${i + 1}] ${d.selector}`);
        L.push(`class: ${d.cls}`);
        L.push(`尺寸: ${d.rect.w}x${d.rect.h}  位置: ${d.rect.left},${d.rect.top}  z-index: ${d.zIndex}`);
        L.push(`圆角: ${d.radius}`);
        L.push(`归一化: x=${d.normalized.x} y=${d.normalized.y} w=${d.normalized.w} h=${d.normalized.h}`);
        L.push(`背景: ${d.background}`);
        if (d.backgroundImage !== "none") L.push(`背景图: ${d.backgroundImage}`);
        L.push(`阴影: ${d.boxShadow}`);
        if (s.rules.length) {
            L.push("样式来源:");
            for (const r of s.rules) {
                L.push(`  - [${r.owner}] ${r.selector}`);
                const bits = [];
                if (r.bg !== "-") bits.push(`bg=${r.bg}`);
                if (r.radius !== "-") bits.push(`radius=${r.radius}`);
                if (r.shadow !== "-") bits.push(`shadow=${r.shadow}`);
                if (bits.length) L.push(`      ${bits.join("  ")}`);
            }
        } else {
            L.push("样式来源: (无可疑规则)");
        }
        L.push("");
    });
    return L.join("\n");
}

async function copyDetails() {
    if (!selected.length) return false;
    const ok = await copyText(buildDetailsText());
    toast(ok ? `已复制 ${selected.length} 个元素的详情到剪贴板`
             : "复制失败（详情已输出到控制台）");
    return ok;
}

/* ---------- 快捷键 ---------- */

export function setHotkeys(patch) {
    const next = { ...hotkeys };
    for (const [k, v] of Object.entries(patch || {})) {
        if (typeof v === "string" && v.trim()) next[k] = v.trim();
    }
    hotkeys = next;
    return { ...hotkeys };
}

export function getHotkeys() { return { ...hotkeys }; }

/*
 * 键名别名表。
 * 【实测 bug】KeyboardEvent.key 的实际值是 "Escape"，而用户/默认配置里写的是 "Esc"。
 * 早期实现直接做字符串比较，于是 "Ctrl+Esc" 永远匹配不上 ——
 * 表现为"退出快捷键完全没反应、提示条一直挂着关不掉"。
 * 这里把习惯写法统一映射到 event.key 的实际值。
 */
const KEY_ALIAS = {
    esc: "escape", escape: "escape",
    del: "delete", delete: "delete",
    ins: "insert", insert: "insert",
    space: " ", spacebar: " ",
    enter: "enter", return: "enter",
    up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright",
    pgup: "pageup", pgdn: "pagedown",
    plus: "+",
};

function normalizeKey(name) {
    const k = String(name || "").trim().toLowerCase();
    return KEY_ALIAS[k] ?? k;
}

function matchesHotkey(event, spec) {
    if (!spec) return false;
    const parts = String(spec).split("+").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return false;
    const key = normalizeKey(parts[parts.length - 1]);
    const mods = parts.slice(0, -1).map((m) => m.toLowerCase());
    const need = (m) => mods.includes(m);
    if (need("ctrl") !== !!event.ctrlKey) return false;
    if (need("shift") !== !!event.shiftKey) return false;
    if (need("alt") !== !!event.altKey) return false;
    if (need("meta") !== !!event.metaKey) return false;
    return normalizeKey(event.key) === key;
}

function onKeyDown(event) {
    if (!active) return;

    if (matchesHotkey(event, hotkeys.exit)) {
        event.preventDefault(); event.stopPropagation();
        if (picking) { setPicking(false); toast("已退出拾取"); }
        else if (boxMode) { setBoxMode(false); toast("已退出拖框"); }
        else stopPicker();
        return;
    }
    if (matchesHotkey(event, hotkeys.pick)) {
        event.preventDefault(); event.stopPropagation(); setPicking(!picking); return;
    }
    if (matchesHotkey(event, hotkeys.box)) {
        event.preventDefault(); event.stopPropagation(); setBoxMode(!boxMode); return;
    }
    if (matchesHotkey(event, hotkeys.copy)) {
        event.preventDefault(); event.stopPropagation();
        if (!selected.length) toast("还没有选中元素（先 Ctrl+Shift+C 拾取）");
        else copyDetails();
    }
}

/* ---------- 拖框（仅高亮范围内元素，不改渲染）---------- */

function onBoxDown(event) {
    if (!boxMode || !active) return;
    event.preventDefault(); event.stopPropagation();
    boxDrag = { x0: event.clientX, y0: event.clientY, cur: null };
}

function onBoxMove(event) {
    if (!boxDrag) return;
    const x0 = Math.min(boxDrag.x0, event.clientX), y0 = Math.min(boxDrag.y0, event.clientY);
    const x1 = Math.max(boxDrag.x0, event.clientX), y1 = Math.max(boxDrag.y0, event.clientY);
    boxDrag.cur = { x0, y0, x1, y1 };
    ensureDom();
    Object.assign(els.margin.style, {
        left: x0 + "px", top: y0 + "px", width: (x1 - x0) + "px", height: (y1 - y0) + "px",
    });
    show(els.margin, true);
}

function onBoxUp() {
    if (!boxDrag) return;
    const cur = boxDrag.cur;
    boxDrag = null;
    setBoxMode(false);   // 拖完自动退出，避免覆盖层持续吞点击
    if (!cur || (cur.x1 - cur.x0) < 8 || (cur.y1 - cur.y0) < 8) { show(els.margin, false); return; }
    // 报告范围内的元素（不改任何渲染，只列出）
    const inside = [];
    for (const el of document.body.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        if (r.left >= cur.x0 && r.top >= cur.y0 && r.right <= cur.x1 && r.bottom <= cur.y1) {
            inside.push(selectorOf(el));
            if (inside.length >= 40) break;
        }
    }
    const norm = {
        x: +(cur.x0 / innerWidth).toFixed(4), y: +(cur.y0 / innerHeight).toFixed(4),
        z: +(cur.x1 / innerWidth).toFixed(4), w: +(cur.y1 / innerHeight).toFixed(4),
    };
    console.log("[dsh-picker] 框选范围内元素:", { normalized: norm, count: inside.length, inside });
    toast(`框内 ${inside.length} 个元素（已输出到控制台）`);
}

export function setBoxMode(on) {
    boxMode = !!on && active;
    ensureDom();
    syncOverlayPointerEvents();
    if (boxMode) setHint("拖动框选：列出框内元素（Ctrl+Esc 取消）");
    else if (!picking) setHint("");
}

/* ---------- 生命周期 ---------- */

export function setPicking(on) {
    picking = !!on && active;
    ensureDom();
    syncOverlayPointerEvents();
    document.body.style.cursor = picking ? "crosshair" : "";
    if (picking) {
        setHint(`元素拾取：点击选中，按住 Ctrl 可多选（${hotkeys.exit} 退出）`);
    } else {
        pickHover = null;
        paintHover(null);
        /*
         * 【用户反馈】选中一个元素后会留下一个橙色虚线矩形不消失。
         * 原因：早期实现只在 !active（整个拾取器关闭）时才隐藏选中框，
         * 而单选结束后拾取器仍处于 active（还能继续按快捷键），
         * 于是那个框就一直挂在屏幕上。
         *
         * 现在：拾取一轮结束就清掉选中标记，但【短暂保留 600ms】让用户看清
         * 自己选中的是哪个元素（立刻消失会让人怀疑"到底选中了没"），随后自动清除。
         * 多选时 picking 仍为 true，不走这里，标记保留 —— 符合多选预期。
         */
        scheduleHideSelectionMarks(600);
    }
}

let hideMarksTimer = 0;

/** 延迟隐藏选中标记：先留住让用户看清，再清除，不留残余 */
function scheduleHideSelectionMarks(ms) {
    clearTimeout(hideMarksTimer);
    if (ms <= 0) { hideSelectionMarks(); return; }
    hideMarksTimer = setTimeout(() => { hideSelectionMarks(); }, ms);
}

/** 立即隐藏所有选中标记（橙色虚线圈） */
function hideSelectionMarks() {
    clearTimeout(hideMarksTimer);
    if (!host) return;             // 没有覆盖层就无需隐藏，别凭空建层
    show(els.sel, false);
    if (els.multi) els.multi.innerHTML = "";
}

export function startPicker() {
    if (active) return;
    ensureDom();
    active = true;
    window.__dshPickerOn = true;

    document.addEventListener("pointermove", onPickMove, { capture: true, passive: true });
    document.addEventListener("click", onPickClick, { capture: true });
    document.addEventListener("keydown", onKeyDown, { capture: true });
    host.addEventListener("pointerdown", onBoxDown, { capture: true });
    document.addEventListener("pointermove", onBoxMove, { capture: true, passive: true });
    document.addEventListener("pointerup", onBoxUp, { capture: true, passive: true });
}

export function stopPicker() {
    /*
     * 【重要】无条件清理，不要写成 `if (!active) return;`。
     * 曾经踩过：clearSelection() 会 ensureDom() 建出覆盖层，
     * 若此时拾取器并未 active，早期实现直接 return，
     * 于是那个覆盖层变成"孤儿"永远留在页面上（pointer-events 还可能是 auto → 吞点击）。
     */
    active = false; picking = false; boxMode = false;
    window.__dshPickerOn = false;
    clearTimeout(hideMarksTimer);            // 别再留一个待执行的隐藏任务
    clearTimeout(setHint._timer);
    document.removeEventListener("pointermove", onPickMove, true);
    document.removeEventListener("click", onPickClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("pointermove", onBoxMove, true);
    document.removeEventListener("pointerup", onBoxUp, true);
    if (host) {
        host.removeEventListener("pointerdown", onBoxDown, true);
        host.style.pointerEvents = "none";
        host.innerHTML = "";
        host.remove();
    }
    host = null;
    document.body.style.cursor = "";
    // 顺带移除我们自己注入的样式表，保证彻底零残留
    document.getElementById(STYLE_ID)?.remove();
}

/*
 * 清空已选。
 * 【注意】不能再调用 paintSelection()：它会重新把选中框画出来，
 * 与"清空"的语义相反（早期实现就有这个问题）。
 * 也不要用 ensureDom()：那会在拾取器未启动时凭空建出覆盖层（孤儿覆盖层）。
 * 只在 DOM 已存在时操作。
 */
export function clearSelection() {
    selected = [];
    clearTimeout(hideMarksTimer);
    if (!host) return;                      // 没有覆盖层就无需清理
    show(els.sel, false);
    show(els.hl, false);
    show(els.tag, false);
    if (els.multi) els.multi.innerHTML = "";
}

/** 已选元素详情文本（供外部取用） */
export function getSelectionDetails() {
    return selected.length ? buildDetailsText() : null;
}

// 便捷入口：供 eval / 控制台直接调用
window.__dshPicker = {
    start: startPicker,
    stop: stopPicker,
    pick: () => { startPicker(); setPicking(true); },
    setPicking,
    setBoxMode,
    clearSelection,
    getSelectionDetails,
    copy: copyDetails,
    setHotkeys,
    getHotkeys,
    toast,
};

/*
 * 自举：这个插件没有设置页，用户必须能直接按快捷键启动拾取器。
 *
 * 只在【真正承载 UI 的窗口】挂这个引导监听：
 * 腾讯会给隐藏窗口、会话池窗口、空白窗口、screenshot 窗口都注入 renderer，
 * 在这些窗口挂全局键盘监听纯属浪费（而且它们的 Ctrl+Shift+C 毫无意义）。
 *
 * 判据用"窗口里有没有实际的界面元素"，而不是 URL —— 实测多个窗口 URL 相同。
 */
function bootPicker() {
    if (window.__dshPickerBooted) return;
    window.__dshPickerBooted = true;

    // 读取上次保存的快捷键（每个窗口独立 JS 上下文，所以各窗口都要自己读）
    try {
        const saved = JSON.parse(localStorage.getItem(HOTKEY_KEY) || "null");
        if (saved && typeof saved === "object") setHotkeys(saved);
    } catch { }

    // 跨窗口同步：在设置页改了快捷键，主界面立即跟随
    window.addEventListener("storage", (event) => {
        if (event.key !== HOTKEY_KEY || !event.newValue) return;
        try { setHotkeys(JSON.parse(event.newValue)); } catch { }
    });

    /*
     * 接收设置页发来的命令（「开始抓取」按钮）。
     * 同一窗口写入时 storage 事件不会触发，所以只处理跨窗口场景；
     * 当前窗口是主界面时，按钮走的是本地直接调用这条路。
     *
     * 【实测踩坑】命令用完必须立刻删掉（消费掉），否则会残留：
     *   storage 事件只在"值变化"时触发，但重启 QQ 后 renderer 重新注入，
     *   所有窗口都会去读 localStorage —— 残留的 {"cmd":"pick"} 会被重放，
     *   表现为"每次重启都自动弹出拾取器"（我自己的测试就踩了这个坑）。
     */
    let lastCmdSeq = null;
    window.addEventListener("storage", (event) => {
        if (event.key !== CMD_KEY || !event.newValue) return;
        let msg; try { msg = JSON.parse(event.newValue); } catch { return; }
        if (!msg || !msg.cmd || msg.seq === lastCmdSeq) return;
        lastCmdSeq = msg.seq;
        // 先消费掉，再执行：执行出错也不会把命令留在存储里
        try { localStorage.removeItem(CMD_KEY); } catch { }
        if (msg.cmd === "pick") { startPicker(); setPicking(true); }
        else if (msg.cmd === "stop") { stopPicker(); }
        else if (msg.cmd === "copy") { copyDetails(); }
    });

    /*
     * 启动自愈：清掉本次会话【之前】遗留的命令与热键残留状态。
     * 放在 bootPicker 里（每个窗口都跑），保证任何窗口都不会被旧命令影响。
     */
    try {
        const raw = localStorage.getItem(CMD_KEY);
        if (raw) {
            // 只清掉"已经过期"的命令：超过 30 秒的一律视为残留
            let stale = true;
            try {
                const m = JSON.parse(raw);
                // seq 是 Date.now()+随机数，取整数部分当时间戳
                const t = Math.floor(Number(m && m.seq) || 0);
                if (t && Date.now() - t < 30000) stale = false;   // 刚发的，留给对应窗口处理
            } catch { }
            if (stale) localStorage.removeItem(CMD_KEY);
        }
    } catch { }

    const startOnHotkey = (event) => {
        if (window.__dshPickerOn) return;               // 已启动 → 交给拾取器自己处理
        if (!matchesHotkey(event, hotkeys.pick)) return;
        event.preventDefault();
        event.stopPropagation();
        startPicker();
        setPicking(true);
    };

    window.addEventListener("keydown", startOnHotkey, { capture: true });

    // Ctrl+Shift+X 直接复制最近选中的内容（未启动时也能用，但需要先选过元素）
    window.addEventListener("keydown", (event) => {
        if (window.__dshPickerOn) return;
        if (!matchesHotkey(event, hotkeys.copy)) return;
        if (!selected.length) return;
        event.preventDefault();
        event.stopPropagation();
        startPicker();
        copyDetails();
    }, { capture: true });
}

/*
 * 等界面出现再自举。用 MutationObserver 只观察"节点是否出现"，
 * 不做 getComputedStyle / 全量遍历（那些是实测会卡死客户端的操作）。
 */
(function waitForUi() {
    const hasUi = () => !!document.querySelector(
        ".sidebar__nav, .recent-contact, .chat-msg-area, .q-dialog-main, #app, .main"
    );
    if (hasUi()) { bootPicker(); return; }

    let tries = 0;
    const timer = setInterval(() => {
        tries++;
        if (hasUi() || tries > 100) {          // 最多等约 20 秒
            clearInterval(timer);
            if (hasUi()) bootPicker();
        }
    }, 200);
    window.__dshPickerWaitTimer = timer;
})();

/* ---------- 设置页 ----------
 * 用户反馈"找不到入口"，所以这里也提供一个设置面板。
 * 注意：面板可能出现在【任何窗口】（QQ 在设置页里调用这个钩子），
 * 但拾取器要作用在主界面上 —— 所以按钮统一走快捷键提示，
 * 引导用户回主界面按 Ctrl+Shift+C。
 */
export function onSettingWindowCreated(view) {
    renderPanel(view);
}

function renderPanel(view) {
    if (!view || view.querySelector(".dsh-panel")) return;
    const cur = getHotkeys();
    const wrap = document.createElement("div");
    wrap.className = "dsh-panel";
    wrap.innerHTML = `
      <style>
        .dsh-panel h2 { font-size: 15px; font-weight: 500; margin: 18px 0 6px; }
        .dsh-panel .dsh-hint { font-size: 12px; opacity: .6; line-height: 1.7; margin: 0 0 12px; }
        .dsh-panel .dsh-row { display: flex; align-items: center; justify-content: space-between;
          gap: 16px; padding: 10px 0; border-bottom: 1px solid rgba(128,128,128,.14); }
        .dsh-panel .dsh-row:last-child { border-bottom: none; }
        .dsh-panel .dsh-label b { font-weight: 500; }
        .dsh-panel .dsh-label small { display: block; font-size: 12px; opacity: .55; margin-top: 2px; }
        .dsh-panel kbd { font: 11px/1 ui-monospace, Consolas, monospace; background: rgba(128,128,128,.18);
          padding: 3px 6px; border-radius: 4px; border: 1px solid rgba(128,128,128,.25); }
        .dsh-panel .dsh-input { font: 12px/1.6 ui-monospace, Consolas, monospace; width: 150px;
          padding: 5px 8px; border-radius: 6px; border: 1px solid rgba(128,128,128,.3);
          background: transparent; color: inherit; }
        .dsh-panel button { font-size: 12px; padding: 5px 12px; border-radius: 6px; cursor: pointer;
          border: 1px solid rgba(128,128,128,.3); background: rgba(128,128,128,.14); color: inherit; }
        .dsh-panel .dsh-tip { font-size: 12px; color: #2f9e5f; min-height: 18px; }
      </style>

      <h2>DSH 调试日志 · 元素选择器</h2>
      <p class="dsh-hint">
        用法：<b>回到主界面</b>按 <kbd>Ctrl+Shift+C</kbd> 进入拾取，鼠标划过高亮元素，点击即选中；
        按住 <kbd>Ctrl</kbd> 点击可多选。选中后详情<b>自动复制到剪贴板</b>并弹气泡提示。
        <kbd>Ctrl+Esc</kbd> 逐级退出（单独 Esc 是 QQ 关窗口，不占用）。
      </p>

      <div class="dsh-row">
        <span class="dsh-label"><b>拾取元素</b><small>在主界面开始抓取（也可直接按快捷键）</small></span>
        <span style="display:flex;gap:8px;align-items:center;">
          <button class="dsh-start">开始抓取</button>
          <kbd>${esc(cur.pick)}</kbd>
        </span>
      </div>

      <div class="dsh-row">
        <span class="dsh-label"><b>复制已选详情</b><small>选中时已自动复制，这里可再复制一次</small></span>
        <span><kbd>${esc(cur.copy)}</kbd></span>
      </div>

      <div class="dsh-row">
        <span class="dsh-label"><b>框选元素</b><small>拖动列出框内元素（输出到控制台）</small></span>
        <span><kbd>${esc(cur.box)}</kbd></span>
      </div>

      <h2>自定义快捷键</h2>
      <p class="dsh-hint">
        <b>点一下右边的框，然后直接按你想用的组合键</b>即可（和 QQ 原生设置一样，直接侦听键盘）。<br>
        支持 <kbd>Ctrl</kbd>/<kbd>Alt</kbd>/<kbd>Shift</kbd> 组合，也可用 <kbd>F8</kbd> 这样的单键。
        改完立即生效，无需重启（主界面同步）。
      </p>
      <div class="dsh-row">
        <span class="dsh-label"><b>拾取</b><small>点框后按组合键</small></span>
        <input class="dsh-input" data-key="pick" value="${esc(cur.pick)}" readonly placeholder="点击后按键">
      </div>
      <div class="dsh-row">
        <span class="dsh-label"><b>复制详情</b></span>
        <input class="dsh-input" data-key="copy" value="${esc(cur.copy)}" readonly placeholder="点击后按键">
      </div>
      <div class="dsh-row">
        <span class="dsh-label"><b>框选</b></span>
        <input class="dsh-input" data-key="box" value="${esc(cur.box)}" readonly placeholder="点击后按键">
      </div>
      <div class="dsh-row">
        <span class="dsh-label"><b>退出</b><small>建议保留 Ctrl+Esc</small></span>
        <input class="dsh-input" data-key="exit" value="${esc(cur.exit)}" readonly placeholder="点击后按键">
      </div>
      <div class="dsh-row">
        <span class="dsh-label"></span>
        <span style="display:flex;gap:8px;align-items:center;">
          <button class="dsh-save">应用并保存</button>
          <button class="dsh-reset">恢复默认</button>
        </span>
      </div>
      <div class="dsh-tip"></div>
    `;
    view.appendChild(wrap);

    /* ---------- 快捷键录制 ----------
     * 用户反馈"右边的框只是 textbox，不侦听键盘"。
     * 改成和 QQ 原生设置一致：点框进入录制状态，下一次按键直接写入。
     * 要点：
     *   1. 输入框设 readonly —— 否则浏览器会把按键当文字输入，还会弹输入法。
     *   2. preventDefault + stopPropagation —— 否则 Ctrl+Shift+C 会被主界面的
     *      拾取器抢走（录制时用户其实是在设置页按键，但事件仍可能冒到全局监听）。
     *   3. 只按修饰键时先显示"按下修饰键…"，等主键按下才定稿。
     *   4. Esc 单独按下 = 取消录制（不写入）。
     */
    const KEYSYM_DISPLAY = {
        " ": "Space", arrowup: "Up", arrowdown: "Down", arrowleft: "Left", arrowright: "Right",
        escape: "Esc", delete: "Del", insert: "Ins", backspace: "Backspace", enter: "Enter",
    };

    function formatFromEvent(e) {
        const parts = [];
        if (e.ctrlKey) parts.push("Ctrl");
        if (e.shiftKey) parts.push("Shift");
        if (e.altKey) parts.push("Alt");
        if (e.metaKey) parts.push("Meta");
        let k = String(e.key || "");
        const lower = k.toLowerCase();
        if (["control", "shift", "alt", "meta", "os"].includes(lower)) return null;   // 只有修饰键
        if (KEYSYM_DISPLAY[lower]) k = KEYSYM_DISPLAY[lower];
        else if (k.length === 1) k = k.toUpperCase();
        else if (/^f\d{1,2}$/i.test(k)) k = k.toUpperCase();
        else k = k.charAt(0).toUpperCase() + k.slice(1);
        parts.push(k);
        return parts.join("+");
    }

    for (const inp of wrap.querySelectorAll(".dsh-input")) {
        /*
         * 进入录制态：记住原值并清空，让用户看到"空格子 = 等你按键"。
         * 同时补一个 pointerdown 兜底 —— 有些情况下（例如已经聚焦再点击）
         * focus 事件不会再触发，只靠 focus 会让 dataset.old 为空，
         * 于是按 Esc 取消时就还原不出原值。
         */
        const enterRecord = () => {
            if (inp.dataset.recording === "1") return;
            inp.dataset.recording = "1";
            inp.dataset.old = inp.value;
            inp.value = "";
        };
        const leaveRecord = () => {
            inp.dataset.recording = "0";
            if (!inp.value) inp.value = inp.dataset.old || "";
            say("");
        };
        inp.addEventListener("focus", enterRecord);
        inp.addEventListener("pointerdown", enterRecord);
        inp.addEventListener("blur", leaveRecord);
        inp.addEventListener("keydown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            enterRecord();                       // 兜底：保证 dataset.old 已保存
            const lower = String(e.key || "").toLowerCase();
            // 单独 Esc = 取消录制（还原原值）
            if (lower === "escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
                inp.value = inp.dataset.old || "";
                inp.blur();
                return;
            }
            const combo = formatFromEvent(e);
            if (!combo) { inp.value = "按下修饰键…"; return; }   // 还在按修饰键
            inp.value = combo;
        });
    }

    const tip = wrap.querySelector(".dsh-tip");
    const say = (t, ok = true) => {
        tip.textContent = t;
        tip.style.color = ok ? "#2f9e5f" : "#d9534f";
        setTimeout(() => { tip.textContent = ""; }, 2400);
    };

    const apply = async (patch) => {
        const next = setHotkeys(patch);
        try { localStorage.setItem(HOTKEY_KEY, JSON.stringify(next)); } catch { }
        for (const inp of wrap.querySelectorAll(".dsh-input")) {
            inp.value = next[inp.dataset.key] || "";
        }
        say("已保存并生效");
        try { window.dispatchEvent(new CustomEvent("dsh:hotkeys-changed", { detail: next })); } catch { }
        return next;
    };

    wrap.querySelector(".dsh-save")?.addEventListener("click", () => {
        const patch = {};
        for (const inp of wrap.querySelectorAll(".dsh-input")) {
            const v = String(inp.value || "").trim();
            if (!v) { say(`「${inp.dataset.key}」不能为空`, false); return; }
            // 录制出来的值形如 Ctrl+Shift+C / F8 / Space / Up；也允许手输
            if (!/^([A-Za-z]+\+)*[A-Za-z0-9]+$/.test(v)) { say(`格式不对：${v}`, false); return; }
            patch[inp.dataset.key] = v;
        }
        // 校验：同一个快捷键不能绑给两个动作，否则会互相抢
        const seen = new Map();
        for (const [k, v] of Object.entries(patch)) {
            const low = v.toLowerCase();
            if (seen.has(low)) { say(`「${seen.get(low)}」与「${k}」不能相同`, false); return; }
            seen.set(low, k);
        }
        apply(patch);
    });

    wrap.querySelector(".dsh-reset")?.addEventListener("click", () => {
        apply({ ...DEFAULT_HOTKEYS });
    });

    /*
     * 「开始抓取」按钮。
     * 关键：设置页与主界面是【独立 JS 上下文】——设置页里的按钮无法直接操作主界面 DOM。
     * 所以走 localStorage 命令通道（与快捷键同步同一条 storage 事件），
     * 由主界面的 renderer 收到后启动拾取器。
     * 如果当前窗口本身就是主界面（有侧边栏导航），则本地直接启动。
     */
    wrap.querySelector(".dsh-start")?.addEventListener("click", () => {
        if (document.querySelector(".sidebar__nav")) {
            // 当前就是主界面：直接启动
            startPicker();
            setPicking(true);
            say("已开始抓取：点击要检查的元素");
            return;
        }
        try {
            localStorage.setItem(CMD_KEY, JSON.stringify({ cmd: "pick", seq: Date.now() + Math.random() }));
            say("已请求主界面开始抓取（请切回主窗口）");
        } catch {
            say("指令发送失败", false);
        }
    });
}

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
