---
name: qqnt-loader-install
description: >
  Install or repair the LiteLoaderQQNT loader on QQ NT for Windows: find the real app root (the versioned
  resources\app folder, not the empty shell), create the app_launcher stub, understand the application.json RSA
  file verification and the
  "file is corrupted" startup failure, apply the QQNT.dll signature patch with a verify-then-derive loop that works
  on new versions, and re-apply everything after a QQ update. Triggers: 安装 LiteLoaderQQNT, 文件已损坏, 绕校验,
  QQNT.dll 补丁, QQNT loader install, 更新后插件失效, 更新已下载未安装.
license: MIT
---

# QQNT — installing the loader (and surviving QQ's file verification)

One of four sibling skills: `qqnt-plugin-dev` (writing a plugin), `qqnt-plugin-debug` (making it work),
**`qqnt-loader-install`** (this one — touching QQ itself), `qqnt-capability-limits` (what is reachable at all).

**Resolve relative paths against this skill's base directory** (the absolute path Codex reports for this skill).

---

## 0. Disclaimer — send once, before you start, and repeat the risk before any patch

**When:** once, at the first QQNT-plugin task **in the current conversation** — first check the conversation above: **if the notice already appears there, do not repeat it.** A new conversation gets it again.

> **Disclaimer.** This work is provided for **education and research on software architecture and JavaScript
> injection techniques only**. By using it you accept: **do not violate software protection law** (no
> reverse-engineering, modifying or distributing modified Tencent QQ builds); do not build or share programs
> intended to **intrude into or unlawfully control computer information systems**; do not infringe Tencent's rights,
> including copyright and technical protection measures; **no commercial use**; ensure your own use of the QQ client
> is **properly licensed**. The authors **accept no liability** for misuse — **all risk stays with the user**.
> In mainland China these can be criminal offences: ① providing programs/tools for intruding into or unlawfully
> controlling computer information systems (Criminal Law art. 285 §3); ② copyright infringement, including
> circumventing technical protection measures (art. 217); ③ disrupting computer information systems (art. 286).

**Version scope.** Everything marked `[measured]` was verified on **QQ NT 9.9.33-52230 + LiteLoaderQQNT 5.2.1 +
Electron 40 (Chromium 144) + Windows** (2026-10). The patch below is *version-specific*: never assume an offset on a
new version — follow §4's verify-then-derive loop.

Also: this skill edits QQ's own files. **Always close QQ first**, **back up**, and tell the user what you changed
and how to undo it.

---

## 1. Find the real app root (the empty-shell trap)

| Symbol | Meaning |
|---|---|
| `<QQNT>` | QQ install root, e.g. `C:\Program Files\Tencent\QQNT` |
| `<app>` | the Electron app root: `<QQNT>\versions\<ver>\resources\app` **when a `versions` folder exists**, else `<QQNT>\resources\app` |
| `<ver>` | the active version directory name, e.g. `9.9.33-52230` |

**[measured]** `<QQNT>\resources\app` can exist as an **empty shell** (only stray `LiteLoaderQQNT\` folders, no
`application.asar`). Old tutorials install there and silently do nothing. Identify the real root by content:

```powershell
Get-ChildItem "<QQNT>\versions" -Directory | ForEach-Object {
  $p = Join-Path $_.FullName "resources\app\application.asar"
  if (Test-Path $p) { [pscustomobject]@{ Version = $_.Name; App = (Split-Path $p -Parent) } }
}
```

`<QQNT>\versions\config.json` records `curVersion` / `readyVersion`; a staging directory + a `<old>-<new>.zip` means
an update is pending (§6).

---

## 2. What the verification actually is **[measured]**

- `<app>\application.json` stores one **256-byte RSA signature** per file (base64, 344 chars each) for
  `application.asar`, `wrapper.node`, `major.node`, `package.json`.
- `<QQNT>\versions\<ver>\version.json` separately signs `QQNT.dll`.
- Edit `<app>\package.json` and QQ refuses to start: it prints that file's **SHA-256**, then
  `error code v2:-8`, and shows 「文件已损坏, 请重新安装QQ。」 (the launcher's string table also contains
  `load from curVersion failed.`, `config_current_version:`, `SHA256`).

So a plugin loader needs **both**: the stub in the app, and the verification check neutralised.

## 3. Backup and rollback discipline (do this first, every time)

1. Close QQ (the DLL is locked while it runs).
2. Copy the unmodified `QQNT.dll` (~200 MB) and `<app>\package.json` to a backup folder **outside** the QQ tree.
3. Record hashes so you can prove exactly what changed:

```powershell
Get-FileHash "<QQNT>\versions\<ver>\QQNT.dll" -Algorithm SHA256
Get-FileHash "<app>\package.json"              -Algorithm SHA256
```

4. Rollback = restore those two files (and delete `<app>\app_launcher\<stub>.js`).

---

## 4. The signature patch — verify, then derive, then update this file

**Never blind-patch.** This is the closed loop to follow on every QQ version.

### Step 1 — read what is actually there

```powershell
$dll = "<QQNT>\versions\<ver>\QQNT.dll"
$fs = [IO.File]::OpenRead($dll); $fs.Position = 0x510197
$buf = New-Object byte[] 22; [void]$fs.Read($buf, 0, 22); $fs.Close()
($buf | ForEach-Object { $_.ToString("X2") }) -join " "
```

Compare what you got against the two known states:

```text
original (unpatched): 48 89 CE 48 8B 11 4C 8B 41 08 49 29 D0 48 8B 49 18 | E8
already patched:      48 89 CE 48 8B 11 4C 8B 41 08 49 29 D0 48 8B 49 18 | B8 01 00 00 00
```

- **Matches "already patched"** → nothing to do; go to §5. (A machine that has been patched before legitimately
  looks like this — do not patch it twice.)
- **Matches "original"** → apply Step 2.
- **Matches neither** → the offset moved; go to Step 3.

### Step 2 — apply the patch

Replace the trailing `E8` (a `call`) at `0x510197 + 17` with `B8 01 00 00 00` (`mov eax,1`, i.e. the byte-comparison
result is forced to "match"):

```powershell
$dll = "<QQNT>\versions\<ver>\QQNT.dll"
$fs = [IO.File]::Open($dll, 'Open', 'Write'); $fs.Position = 0x510197 + 17
$fs.Write([byte[]](0xB8,0x01,0x00,0x00,0x00), 0, 5); $fs.Close()
```

### Step 3 — derive a new offset (only when Step 1 matched neither)

Search the whole file for the 18-byte original pattern; use the first 17 bytes so both states match:

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

- **Exactly one hit** → treat it as the new offset. Re-run Step 1 at that offset to confirm it reads `original`,
  patch it, then **update this file**: record the new offset and the QQ version you verified it on (the next agent
  inherits your work).
- **Zero hits or several hits** → the code moved substantially. **Stop and report** to the user that the patch needs
  manual re-derivation for this version. Do not guess, and do not try random offsets — a bad patch can make QQ
  unusable until the backup is restored.
- Verify the patch took effect by re-running Step 1 and confirming the `already patched` bytes.

### Why not the old `dbghelp.dll` proxy? **[measured]**

That approach byte-pattern-hooks `QQNT.dll` through MinHook, and its signatures no longer match current builds (the
proxy DLL carries `Sig not found!` / `MH Hook Patch failed!`). It is not a fallback — if the search in Step 3 finds
nothing, the honest answer is "needs manual re-derivation", not "try dbghelp instead".

---

## 5. Install the loader stub

Create `<app>\app_launcher\<any-name>.js` containing only the loader path:

```js
require(String.raw`<absolute loader path>`);
```

and point `<app>\package.json`'s `main` at it, e.g. `"main": "./app_launcher/LiteLoader.js"` (keep a copy of the
original value, usually `./application.asar/app_launcher/index.js`).

This ordering is useful to know as a plugin author: LLQQNT is loaded as the app entry, **then** it loads plugins,
**then** it requires the real app launcher — which is exactly why a plugin's `main.js` can wrap `ipcMain`
registrations before QQ makes its own.

Restart QQ and verify the loader came up (LiteLoader's own settings entry appears, and
`<profile>\data\LiteLoader\config.json` gains the plugin list).

---

## 6. After every QQ update, redo it

**[measured]** QQ hot-updates itself: `<QQNT>\versions\` gains `<old>-<new>.zip` plus an unpacked staging directory
(`diff.json`, `*.patch`, `raw_files\`), and the live app root moves to the **new** `versions\<ver>\resources\app`.
That means:

1. The stub must be re-created in the new `<app>` and `main` re-pointed.
2. The new `QQNT.dll` must be patched again — **but run §4 Step 1 first**; the offset may have moved.
3. Plugin folders under `<profile>\plugins\` and data under `<profile>\data\` are untouched and keep working.

If the user has not updated yet and asks whether to: updating is what breaks the loader; a working patched install
should be kept until they are ready to redo these three steps.

**A downloaded-but-not-installed update is *not* a broken loader** **[measured]**: `<QQNT>\versions\` holds
`<old>-<new>.zip` while `versions\config.json`'s `curVersion` still names the **old** directory and `readyVersion`
is empty. QQ is simply waiting for the next restart to install it. Nothing about the loader is wrong in this state,
and restarting does **not** invalidate it — the stub and the patch still belong to the version in `curVersion` and
keep working. Do not repatch anything on the strength of that zip alone.

---

## 7. Triage order when "the plugin stopped working" — plugin first, loader last

**[measured]** In a real session the failure was **not** the loader at all: the patch was still in place (offset
`0x510197` read `… B8 01 00 00 00`, i.e. already patched) and the loader came up normally. Follow this order, and
stop at the first thing that is actually wrong:

1. **Did the plugin itself load?** Its own log line / its own config file under `<profile>\data\<slug>\`, or its
   entry in QQ's plugin list. Also check `disabled_plugins` in `<profile>\data\LiteLoader\config.json` — the plugin
   may simply be disabled, and a duplicate `slug` folder may be shadowing it (`qqnt-plugin-dev` §3.1).
2. **Did the plugin throw?** `errors.log` / `console.log` from the debug skill's logger (`qqnt-plugin-debug`).
3. **Only then the loader**: does its settings entry appear, and does §4 Step 1 still read "already patched"?
4. **Only then QQ's own files**: a pending update, a moved app root, or a reverted DLL.

Most "plugins stopped working" reports are resolved at steps 1–2; blaming the loader first sends you to patch a file
that was never broken.
