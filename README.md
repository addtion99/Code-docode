# Code Decode

程序员最应该学习的语言,不是C，Rust，Java，C++，Python，Go，JavaScript，你们都很好
但是英语更好.

**Code Decode** 是一款专为开发者设计的 VS Code 源码阅读辅助插件。它能利用 AI 智能识别代码中的变量、函数、类名等标识符，并将其翻译为中文（或你指定的语言），助你快速理解复杂代码的业务含义，实现“见文知意”。

> 核心理念：只翻译“标识符”，保留语法关键字（如 `if`, `for`, `return`），最大程度保持代码结构原汁原味，同时降低阅读门槛。
**效果展示**
> <img width="1728" height="684" alt="image" src="https://github.com/user-attachments/assets/137efe3b-d9f7-4410-a5be-fc8a2f457b9b" />


## 🌟 项目亮点

- **🔍 语义级精准识别**
  - 拒绝暴力替换！基于 VS Code **Semantic Tokens** 深度解析，精准提取变量、函数、类名等标识符。
  - **只译“意”不改“形”**：保留 `if`/`for`/`return` 等语法关键字，维系代码原始逻辑结构，让阅读如母语般顺滑。

- **👓 双模体验**
  - **Inlay 虚影模式**：译文如幽灵般浮现于变量之后，**零侵入**原代码，鼠标悬停即可视，不打断你的编码心流。
  - **Split 分屏模式**：左侧源码、右侧“伪代码”译文，利用 Diff 视图左右对照，复杂逻辑一目了然。

- **⚡️ 智能增量引擎**
  - 内置**工作区级索引**，首次全项目扫描后，二次运行**秒级响应**。
  - 智能识别文件变更，仅对修改过的文件重新请求翻译，大幅节省 API Token 消耗。

- **🛡️ 隐私与安全优先**
  - 你的代码属于你！插件**仅提取标识符列表**（如 `getUserProfile`）发送给 AI，绝不上传完整源代码文件。
  - API Key 安全存储于 VS Code 原生 SecretStorage，拒绝明文泄露。

- **🤖 多模型自由切换**
  - 开箱即用：默认适配 **Gemini** (免费且高速)。
  - 兼容并包：完美支持 **DeepSeek**、**OpenAI**、**SiliconFlow** 等所有兼容 OpenAI 格式的 API 服务。

## 使用教程

1. **安装插件**：在 VS Code 插件市场搜索并安装 `Code Decode`。
2. **配置 API**：
   - 按 `F1` 或 `Ctrl+Shift+P` 打开命令面板。
   - 输入并执行 `Code Decode: Set API Key`。(如果你不是使用 gemini,需要自行更换服务商)
   - 填入你的 API Key（默认使用 Gemini，可免费申请）。
3. **开始翻译**：
   - 打开任意代码文件。
   - 执行命令 `Code Decode: Translate This Project`。
   - 稍等片刻，译文即刻呈现！

> **提示**：如果是第一次打开大项目，建议执行 `Code Decode: Translate This Project` 进行全项目预索引。

## 📖 使用指南

### 1. 翻译命令

| 命令                        | 快捷键 | 说明                                                           |
| --------------------------- | ------ | -------------------------------------------------------------- |
| **Translate This File**     | -      | **(推荐)** 仅翻译当前打开的文件，速度快，即点即用。            |
| **Translate This Project**  | -      | 扫描整个工作区进行翻译。首次运行推荐使用，建立缓存后后续极快。 |
| **Refresh Current View**    | -      | 如果修改了代码或切换了语言，执行此命令强制刷新当前视图。       |
| **Clear Translation Cache** | -      | 清空所有缓存和索引（更换 API 模型后建议执行）。                |

### 2. 切换视图模式

你可以根据喜好选择译文展示方式，支持热切换：

- **Code Decode: Use Inlay Mode** (默认)
  - 译文以灰色虚影形式跟在变量名后面。
  - 优点：视线无需移动，沉浸式阅读。
  - _效果示例：_ `const user: 用户 = getUser: 获取用户();`
  <img width="1820" height="1378" alt="image" src="https://github.com/user-attachments/assets/ba96eeea-8d23-4f37-9098-72de36002498" />


- **Code Decode: Use Split Mode** (快捷键 `Ctrl+Alt+T`)
  - 自动打开右侧对比窗口，显示翻译后的伪代码。
  - 优点：源码保持纯净，适合大段代码对照理解。
<img width="2570" height="1414" alt="image" src="https://github.com/user-attachments/assets/39716ec6-a13e-4b2a-9d3f-4204ca953da0" />

### 3. 更换 AI 服务商

除了默认的 Gemini，你也可以使用 DeepSeek 或其他 OpenAI 兼容接口：

1. 执行 `Code Decode: Select API Provider`。
2. 选择服务商（如 `deepseek`、`openaiCompatible` 等）。
3. 如果是自定义服务商，需在设置中填写 `Base URL` 和 `Model` 名称。

## ⚙️ 进阶配置

你可以在 VS Code 设置中搜索 `codeTranslator` 进行精细化配置：

- **目标语言** (`targetLanguage`)：默认为 `zh-CN` (简体中文)，可改为 `en`, `jp` 等。
- **术语表** (`glossary`)：定义专有名词的固定译文。
  - 例如：`{ "dto": "数据传输对象", "ctx": "上下文" }`
- **保护词** (`protectedTerms`)：设置不希望被翻译的缩写或专有名词。
  - 默认包含：`id`, `url`, `http`, `json` 等。
- **跳过模式** (`skipPatterns`)：正则匹配跳过无意义变量。
  - 默认跳过：`i`, `j`, `k`, `tmp` 等循环变量。
- **渲染模式** (`renderMode`)：
  - `inlay`：虚影提示（默认）。
  - `bilingual`：双语对照（如 `user(用户)`）。
  - `translatedOnly`：纯译文替换。

## 📦 发布 Release

### 方式一：推送 tag（推荐，自动打包并发布）

1. 确保 `package.json` 中 `version` 已更新（如 `0.0.1`）。
2. 提交并推送后，打 tag 并推送：
   ```bash
   git tag v0.0.1
   git push origin v0.0.1
   ```
3. GitHub Actions 会自动编译、打包为 `.vsix` 并创建 [Releases](https://github.com/addtion99/Code-docode/releases)，用户可在该页下载安装包。

### 方式二：本地打包并发布

需要 **Node.js ≥ 20**（可用 `nvm use 20`）。

```bash
# 打包并创建 Release（使用 package.json 的 version 作为 tag）
./scripts/release.sh

# 或指定 tag
./scripts/release.sh v0.0.1
```

需已安装 [GitHub CLI](https://cli.github.com/)（`gh`）并登录，否则请到仓库 Releases 页面手动上传生成的 `.vsix`。

### 仅本地打包（不发布）

```bash
npm ci
npm run package
# 会生成 code-decode-<version>.vsix，可在 VS Code 中“从 VSIX 安装”进行安装。
```

## ❓ 常见问题

**Q: 为什么翻译后没有反应？**
A: 请检查 API Key 是否正确，以及网络是否能连接到 API 服务商。可以尝试执行 `Set API Provider` 切换到 `demo` 模式测试插件是否正常工作。

**Q: 项目很大，翻译会不会很贵？**
A: 不会。插件内置了智能增量索引，第二次运行时，**只有修改过的文件**才会消耗 Token，未修改的文件直接读取本地缓存。

**Q: 我的代码会被泄露吗？**
A: 不会。插件只提取 identifiers（如 `getUserProfile`），打散后发送给 AI 翻译，AI 无法还原你的完整业务逻辑代码。

---

**Code Decode** —— 让阅读源码像读母语文章一样轻松。
