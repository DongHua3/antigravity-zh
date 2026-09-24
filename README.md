# Google Antigravity 2.x 简体中文汉化包 (antigravity-zh)

`antigravity-zh` 是专为 **Google Antigravity 2.x** 桌面客户端打造的全自动、零外部依赖简体中文本地化与补丁工具。

本工具基于 Windows 原生批处理脚本与客户端自身内置运行时构建，无需用户在系统中预先配置 Node.js 或 Python 环境，开箱即用、一键安装、无损还原。

---

## 目录

- [核心特性](#核心特性)
- [快速上手](#快速上手)
  - [一键安装](#一键安装)
  - [一键卸载与还原](#一键卸载与还原)
- [路径配置与高级用法](#路径配置与高级用法)
  - [5 级智能路径探测机制](#5-级智能路径探测机制)
  - [手动指定路径方式](#手动指定路径方式)
- [模块化分类词典体系](#模块化分类词典体系)
  - [词典文件说明](#词典文件说明)
  - [匹配与翻译优先级](#匹配与翻译优先级)
- [词典贡献指南](#词典贡献指南)
- [底层技术架构](#底层技术架构)
  - [两阶段补丁架构与 EBUSY 避锁机制](#两阶段补丁架构与-ebusy-避锁机制)
  - [运行时 Shadow DOM 穿透拦截](#运行时-shadow-dom-穿透拦截)
  - [中文输入法 (IME) 会话保护](#中文输入法-ime-会话保护)
  - [代码编辑器与编辑区绝对免触碰](#代码编辑器与编辑区绝对免触碰)
  - [WSL 异步菜单双语兼容挂载](#wsl-异步菜单双语兼容挂载)
- [常见问题与排错指南 (FAQ)](#常见问题与排错指南-faq)
- [开发者验证与测试](#开发者验证与测试)
- [开源许可证](#开源许可证)

---

## 核心特性

- **零外部环境依赖**：完全不依赖主机全局安装的 Node.js 或 Python，脚本利用 Antigravity 自身携带的 Chromium/Electron 内部 Node 运行时（Node v24.x）自动执行补丁打包。
- **两阶段原子安全写入**：通过独特的两阶段架构，在临时目录完成打包后再执行系统级文件替换，彻底杜绝 Windows 内核常见的文件占用与共享冲突（`EBUSY` / Error 32）。
- **无损备份与一键复原**：首次安装时自动在同级目录生成 `app.asar.bak` 原始备份。卸载时无损恢复官方原版，不留冗余残留。
- **深度运行时 DOM 翻译引擎**：
  - **根节点极早监听**：直接在 `document.documentElement` 就绪时建立监听，消除主文档早期的 `null` body 报错。
  - **Shadow DOM 穿透**：全局拦截 `Element.prototype.attachShadow`，无缝渗透 Web Components 与关闭根（closed shadow roots）。
  - **中文输入法 (IME) 会话保护**：精确捕捉 `compositionstart` 与 `compositionend` 事件，拼音输入过程中自动暂停 DOM 替换，杜绝打字吞字、错词与光标跳动。
  - **代码区域严密隔离**：严格忽略 `<pre>`, `<code>`, `.monaco-editor`, `.cm-editor` 以及富文本输入区，保护用户 Prompt、模型输出与代码文本 100% 原始呈现。
- **主进程与 WSL 菜单双语挂载**：重构 `addItemToSubmenu` 标签匹配逻辑，引入中英别名映射，确保 WSL 容器菜单（`Connect to WSL`）和离线本地重开功能在汉化后依然稳定挂载。
- **参数化动态正则词典**：提供基于捕获组的正则动态翻译，智能处理智能体数量（如 `3 agents running`）、修改文件数、相对时间差（如 `5 mins ago`）与版本信息。

---

## 快速上手

### 一键安装

1. **下载或克隆本仓库**到本地任意目录（例如解压至桌面或工具文件夹）。
2. **完全退出 Antigravity 客户端**（若程序仍在后台运行，脚本会自动尝试安全终止进程）。
3. **双击运行 `install.bat`**。
4. 脚本将自动完成：
   - 安全终止 Antigravity 进程并释放文件锁句柄；
   - 自动扫描并定位客户端安装路径；
   - 借用客户端内部 Node 环境打包汉化核心；
   - 自动备份原始 `app.asar` 至 `app.asar.bak` 并应用新补丁；
   - 提示 `[√] Antigravity 2.x 汉化补丁安装成功！`。
5. 启动 Antigravity 即可尽享纯正简体中文界面。

### 一键卸载与还原

若需要恢复官方纯英文版本，或在官方升级前进行还原：

1. **双击运行 `uninstall.bat`**。
2. 脚本将安全终止客户端，检测同目录下的 `app.asar.bak` 备份文件。
3. 将原始备份原子还原覆盖至 `app.asar`，并清理临时补丁与备份。
4. 提示 `[√] Antigravity 2.x 汉化补丁已成功卸载！`，客户端即刻恢复至官方原厂状态。

---

## 路径配置与高级用法

### 5 级智能路径探测机制

`install.bat` 与 `uninstall.bat` 均内置了完备的 5 级路径探测机制，按以下优先级逐层检索客户端：

1. **第 1 级（CLI 参数 / 拖拽）**：检测命令行传入的第一个参数 `%~1`。
2. **第 2 级（当前用户安装路径）**：检测 `%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe`（以及小写变体）。
3. **第 3 级（系统注册表卸载项）**：分别遍历 `HKCU` 与 `HKLM` 的 `Software\Microsoft\Windows\CurrentVersion\Uninstall` 注册表，检索 `DisplayName`、`DisplayIcon` 与 `InstallLocation`。同时对 `Antigravity` 与 `Antigravity IDE` 做出精准区分。
4. **第 4 级（系统全局目录）**：检索 `%ProgramFiles%\Antigravity\Antigravity.exe` 以及 32 位兼容路径。
5. **第 5 级（交互式用户兜底）**：若上述所有自动探测均未命中，终端将暂停并提示用户手动输入安装路径或可执行文件位置。

### 手动指定路径方式

如果您将 Antigravity 安装在非标准自定义目录，可采用以下任一方式执行安装：

- **方式 A（拖拽执行）**：
  直接将桌面上的 `Antigravity.exe` 图标拖拽到 `install.bat` 上释放，脚本将自动提取路径并开始安装。
- **方式 B（命令行参数执行）**：
  打开 Windows 命令提示符（CMD）或 PowerShell，执行：
  ```cmd
  install.bat "D:\MyApps\Antigravity"
  ```
  或者直接指定可执行文件：
  ```cmd
  install.bat "D:\MyApps\Antigravity\Antigravity.exe"
  ```
- **方式 C（交互式终端输入）**：
  直接双击 `install.bat`，当自动检索未命中时，在控制台提示符后粘贴您的安装目录回车即可。

---

## 模块化分类词典体系

为了提高维护效率、避免词条冲突并支持协作扩展，词典采用分模块组织架构，全部存放于 `dicts/` 目录中：

```
dicts/
├── menu.json         # 系统级菜单栏、右键上下文菜单、托盘菜单
├── sidebar.json      # AI 聊天侧边栏、Agent 工作流、模型选择器、任务卡片
├── settings.json     # 首选项配置、快捷键设置、扩展与环境配置
├── regex.json        # 动态插值正则规则（数量、时间、状态）
└── common.json       # 全局通用操作按钮、对话框、标准提示词
```

### 词典文件说明

| 词典文件 | 适用范围与典型内容 | 示例词条 |
|---|---|---|
| `menu.json` | 顶部主菜单栏（File, Edit, View, Help）、窗口管理、托盘菜单 | `"New Window": "新建窗口"`, `"Connect to WSL": "连接到 WSL"` |
| `sidebar.json` | Agentic AI 侧边栏面板、Prompt 提示词占位、模型切换器 | `"Ask Antigravity...": "向 Antigravity 提问..."`, `"Review Changes": "审查更改"` |
| `settings.json` | 配置项标签、描述说明、快捷键提示、账户与遥测选项 | `"General": "通用"`, `"Keybindings": "快捷键设置"`, `"Appearance": "外观"` |
| `regex.json` | 包含动态数值、变量的文本模式替换（使用捕获组） | `"^(\\d+) agents? running$"` -> `"$1 个正在运行的智能体"` |
| `common.json` | 全局基础词汇，所有视图共享的兜底词库 | `"Save": "保存"`, `"Cancel": "取消"`, `"Delete": "删除"`, `"Loading...": "加载中..."` |

### 匹配与翻译优先级

翻译引擎对界面上的每一个文本节点执行三级渐进式匹配：

1. **精准字典匹配 (O(1))**：
   - 优先在视图所属的特定上下文词典（`menu` / `sidebar` / `settings`）中检索；
   - 未命中则自动在 `common.json` 通用字典中检索。
2. **动态正则匹配 (O(N))**：
   - 若精准匹配未命中，按顺序逐条匹配 `regex.json` 中的规则；
   - 命中则以正则替换并插值返回（如将 `2 files changed` 替换为 `2 个文件已更改`）。
3. **回退直通**：
   - 若均无匹配，保持原文字符串不变，绝不影响界面的正常排版与功能。

---

## 词典贡献指南

欢迎参与词条补充与校对！请遵循以下贡献规范：

### 1. 静态词典格式规范 (`menu.json`, `sidebar.json`, `settings.json`, `common.json`)

静态词典为键值对应的 JSON Object，Key 为官方英文原文，Value 为简体中文翻译：

```json
{
  "Original English Text": "中文翻译文本",
  "Run Agent": "运行智能体"
}
```

- **严禁空键或空值**：Key 与 Value 均不可为空字符串。
- **严禁非字符串类型**：禁止使用数字、布尔值或嵌套对象。
- **尊重开发者使用习惯**：专用术语（如 `Git`, `WSL`, `Diff`, `Shadow DOM`, `Monaco`）建议保留或采用行业通用表达。

### 2. 正则词典格式规范 (`regex.json`)

正则词典为 JSON Array，每个规则项需包含 `pattern` 与 `replace`：

```json
[
  {
    "pattern": "^(\\d+)\\s+files?\\s+changed$",
    "flags": "i",
    "replace": "$1 个文件已更改",
    "description": "文件变更数量统计"
  }
]
```

- `pattern`: 正则表达式字符串（无需两端的 `/` 定界符）。
- `flags`: 正则修饰符，默认为 `"i"`（不区分大小写）。
- `replace`: 替换字符串，可使用 `$1`、`$2` 引用捕获组。
- `description`: 规则功能简要说明，便于后续审查维护。

### 3. 本地自检验证

在提交 PR 之前，请在项目根目录下运行验证套件确保语法合规：

```bash
npm test
# 或执行具体字典测试
node test/verify.js --tier=1
```

---

## 底层技术架构

```
┌────────────────────────────────────────────────────────┐
│                      install.bat                       │
├──────────────────────────┬─────────────────────────────┤
│ 阶段 1: Node 内存打包     │ 阶段 2: 批处理安全原子替换   │
│                          │                             │
│ set ELECTRON_RUN_AS_NODE │ 1. 检验 %TEMP% 补丁完整性   │
│ Antigravity.exe patch.js │ 2. copy app.asar app.asar.bak│
│   ├── 读取原 app.asar    │ 3. move 覆盖 app.asar       │
│   ├── 注入 runtime 引擎  │ 4. 清理临时环境             │
│   ├── 替换静态离线视图   │                             │
│   └── 写入 %TEMP% asar   │                             │
│ (Node 进程安全退出释放锁) │ (无文件锁冲突，杜绝 EBUSY) │
└──────────────────────────┴─────────────────────────────┘
```

### 两阶段补丁架构与 EBUSY 避锁机制

在 Windows NT 内核中，当可执行文件或其动态载入的模块被映射到内存（`MapViewOfFile`）时，系统将强制施加共享排他保护。直接在 Node.js 进程中覆写正在运行的宿主 `app.asar` 必然会导致操作系统抛出 `EBUSY: resource busy or locked`（Error 32 共享冲突错误）。若直接流式写入失败，原 `app.asar` 将被截断损坏，造成客户端崩溃无法启动。

为此，`antigravity-zh` 采用两阶段（Two-stage）解耦设计：
1. **阶段 1（只读提取与离线重构）**：借由 `ELECTRON_RUN_AS_NODE=1` 启动 Antigravity 内置的无头 Node.js，只读挂载原 `app.asar`，生成纯净的补丁包写入到系统的临时文件夹中（`%TEMP%\ag_patched.asar`）。随后，Node 进程彻底终止退出，完全释放所有底层句柄。
2. **阶段 2（原生 Batch 原子级轮转）**：此时系统处于无进程占用状态。Windows 批处理脚本执行原生 `copy` 建立 `app.asar.bak`，再执行原子级 `move` 移动替换 `app.asar`。整套流程具备事务性保护，一旦中途出错可立即回滚。

### 运行时 Shadow DOM 穿透拦截

现代基于 Web Components 架构的客户端将大量组件封装于 Shadow Root 内部，常规的 DOM 遍历（如 `document.querySelectorAll`）无法穿透闭合的 Shadow Tree。

补丁注入引擎在 `dist/preload.js` 中全局重写了 `Element.prototype.attachShadow`：
- 在组件创建 shadow root 时同步将该 root 纳入观察者队列；
- 支持无论 `mode: "open"` 还是 `mode: "closed"` 的 shadow root，彻底消除界面中 Web Components 汉化死角。

### 中文输入法 (IME) 会话保护

在前端直接监听 `MutationObserver` 更改文本时，若用户正通过输入法键入拼音，对 DOM 文本节点的修改会导致浏览器重新初始化输入上下文，造成候选词列表被强制打断、文字吞吐或重合。

引擎通过状态机维护输入法会话：
- 监听 `compositionstart` 事件立即置位 `isComposing = true`，挂起一切 DOM 修改；
- 在用户敲击空格或回车选定文字触发 `compositionend` 后，重置状态并安全恢复翻译队列。

### 代码编辑器与编辑区绝对免触碰

AI 编程客户端的核心在于准确理解代码与 Prompt。汉化引擎坚决遵守“安全第一”原则：
- **容器跳过规则**：严格跳过 `<pre>`, `<code>`, `.monaco-editor`, `.cm-editor` 以及 `[contenteditable="true"]` 容器内及其所有子孙节点。
- **输入元素属性保护**：对 `<input>` 与 `<textarea>` 仅翻译其 `placeholder` 与 `title` 属性，绝不修改其 `value` 属性，确保用户的提问 Prompt 与模型代码输出完全保持真实原貌。
- **WeakMap 内存保护**：采用 `WeakMap<Node, string>` 记录节点的原始文本与汉化状态，结合互斥状态锁，彻底防止 `MutationObserver` 发生重新触发的自激死循环。

### WSL 异步菜单双语兼容挂载

在 Antigravity 官方源码 `dist/menu.js` 中，动态挂载 WSL（Windows Subsystem for Linux）分发项的函数 `addItemToSubmenu` 采用了硬编码查找：
```javascript
const submenuItem = appMenu.items.find((item) => item.label === submenuLabel);
```
当一级菜单被汉化为 `"文件"` 或 `"帮助"` 时，`item.label === 'File'` 会返回 `undefined`，导致 `"新建窗口"`、`"连接到 WSL"` 以及 `"在本地重新打开"` 菜单项丢失。

补丁对其进行了别名映射修复：
```javascript
const SUBMENU_LABEL_ALIASES = {
    'File': ['File', '文件'],
    'Help': ['Help', '帮助'],
    'Edit': ['Edit', '编辑'],
    'View': ['View', '视图'],
    'Window': ['Window', '窗口']
};
```
无论系统菜单处于英文还是中文状态，WSL 菜单项均能准确插入，保障全套开发流程顺畅无阻。

---

## 常见问题与排错指南 (FAQ)

### Q1: 运行 `install.bat` 提示“拒绝访问”或“权限不足”？
**原因**：如果您的 Antigravity 安装在全局 `C:\Program Files` 目录下，对该目录的写入操作需要 Windows 系统管理员权限。  
**解决方法**：右键点击 `install.bat`，选择 **以管理员身份运行**。

### Q2: 提示“未找到 Antigravity 客户端可执行文件”？
**原因**：客户端安装在非常规路径下，自动探测未能检索到。  
**解决方法**：直接将您的 `Antigravity.exe` 桌面图标或安装目录拖拽到 `install.bat` 脚本文件上，或根据终端提示直接输入路径。

### Q3: 杀毒软件提示批处理脚本拦截？
**原因**：部分安全软件对批处理脚本中的 `taskkill`（用于关闭正在运行的客户端）或重命名 `app.asar` 行为较为敏感。  
**解决方法**：本工具代码 100% 开源，无任何闭源外挂、外部下载或第三方二进制注入，请放心添加信任或放行。

### Q4: 客户端升级新版本后汉化失效？
**原因**：官方客户端在自动升级时会直接下载官方全新的 `app.asar` 文件覆盖旧版本。  
**解决方法**：官方升级完成后，重新双击运行一次本项目的 `install.bat` 即可恢复汉化。

### Q5: 如何手动完全还原官方版本？
**解决方法**：
- 推荐方式：双击运行 `uninstall.bat`。
- 手动方式：进入 Antigravity 安装目录下的 `resources` 文件夹，删除现有的 `app.asar`，将同目录下的备份文件 `app.asar.bak` 重命名为 `app.asar` 即可。

---

## 开发者验证与测试

本项目内置了完整的 5 级全套自动化测试验证套件，覆盖语法格式、ASAR 打包、DOM 模拟翻译、输入法保护与 Windows 批处理安全规范：

```bash
# 执行完整测试套件 (Tiers 1-5)
npm test

# 分级针对性测试
node test/verify.js --tier=1   # 词典合规性与正则语法校验
node test/verify.js --tier=2   # 纯 JS ASAR 解包与 Chromium Pickle 结构测试
node test/verify.js --tier=3   # DOM 翻译引擎与代码块跳过测试
node test/verify.js --tier=4   # 中文输入法 IME 会话保护测试
node test/verify.js --tier=5   # Windows 批处理脚本安全规范与语法 Linter
```

---

## 开源许可证

本项目基于 [MIT License](LICENSE) 开源发布。
Google Antigravity 及相关商标为 Google LLC 所有，本项目仅供交流学习与本地化体验使用。
