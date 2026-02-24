[简体中文](./README.md) | [English]

---

To make your GitHub repository accessible to a global audience, a professional and clear English README is essential. Here is a high-quality English version of your README, optimized for developers.

---

# Code Decode

> The most important language for a programmer isn't C, Rust, Java, C++, Python, Go, or JavaScript... it's **English**.

**Code Decode** is a VS Code extension specifically designed for developers reading source code. It uses AI to intelligently identify identifiers—such as variables, functions, and class names—and translates them into your native language. This helps you understand the business logic of complex code instantly, achieving a "read-it-like-your-mother-tongue" experience.

> **Core Philosophy**: Translate "Identifiers" only. Keep syntax keywords (`if`, `for`, `return`, etc.) untouched to maintain the original code structure while lowering the cognitive load.

**Showcase**
<img alt="image" src="https://github.com/user-attachments/assets/3f4370eb-a93c-45fc-b749-d44db5054da3" />
<img alt="image" src="https://github.com/user-attachments/assets/14caaa4f-7198-4c07-a7e4-956c451572d4" />

## 🌟 Highlights

- **🔍 Semantic-Level Recognition**
  - No more brute-force string replacement! Based on **VS Code Semantic Tokens**, it precisely extracts variables, functions, and classes.
  - **Logic-Preserving**: Only translates the "meaning" while keeping the "form." Your code structure remains 100% intact.

- **👓 Dual Display Modes**
  - **Inlay Mode**: Translations appear as "ghost text" right after the variable name. Non-intrusive and keeps you in the coding flow.
  - **Split Mode**: A side-by-side view showing the original code on the left and the "pseudocode" translation on the right using a Diff-style view.

- **⚡️ Smart Incremental Engine**
  - Built-in **workspace-level indexing**. After the initial scan, secondary runs provide **near-instant** responses.
  - Automatically detects file changes and only requests translations for modified parts, significantly saving API token consumption.

- **🛡️ Privacy & Security First**
  - Your code belongs to you! The extension **only extracts identifier lists** (e.g., `getUserProfile`) to send to the AI. It never uploads your full source files.
  - API Keys are securely stored in VS Code's native `SecretStorage`.

- **🤖 Multi-Model Support**
  - **Out-of-the-box**: Defaults to **Gemini** (Fast & Free tier available).
  - **Full Compatibility**: Supports **DeepSeek**, **OpenAI**, **SiliconFlow**, and any OpenAI-compatible API services.

## Quick Start

1. **Install**: Search for `Code Decode` in the VS Code Marketplace.
2. **Configure API**:
   - Press `F1` or `Ctrl+Shift+P` to open the Command Palette.
   - Run `Code Decode: Set API Key`.
   - Enter your API Key (Default is Gemini).
3. **Start Reading**:
   - Open any code file.
   - Run `Code Decode: Translate This Project`.
   - Wait a moment and enjoy the translated view!

> **Tip**: For large projects, run `Code Decode: Translate This Project` once to build the initial index.

## 📖 Usage Guide

### 1. Commands

| Command                     | Shortcut | Description                                                             |
| :-------------------------- | :------- | :---------------------------------------------------------------------- |
| **Translate This File**     | -        | **(Recommended)** Translates only the current file. Fast and on-demand. |
| **Translate This Project**  | -        | Scans the whole workspace. Recommended for first-time use.              |
| **Refresh Current View**    | -        | Force refresh if you've modified code or changed language settings.     |
| **Clear Translation Cache** | -        | Clears all local caches (recommended after changing AI models).         |

### 2. View Modes

Switch between modes based on your preference:

- **Inlay Mode** (Default)
  - Translations appear as grey hints following the identifier.
  - _Example:_ `const user: user_info = getUser: fetch_user_data();`
    <img alt="image" src="https://github.com/user-attachments/assets/ba96eeea-8d23-4f37-9098-72de36002498" />

- **Split Mode** (Shortcut: `Ctrl+Alt+T`)
  - Opens a side-by-side window with translated pseudocode. Perfect for deep dives into complex logic.
    <img alt="image" src="https://github.com/user-attachments/assets/39716ec6-a13e-4b2a-9d3f-4204ca953da0" />

### 3. Change AI Provider

To use DeepSeek or other OpenAI-compatible services:

1. Run `Code Decode: Select API Provider`.
2. Choose your provider (e.g., `deepseek`, `openaiCompatible`).
3. If using a custom provider, update the `Base URL` and `Model` name in the settings.

## ⚙️ Advanced Configuration

Search for `codeTranslator` in VS Code Settings:

- **Target Language** (`targetLanguage`): Default is `zh-CN`. Change to `en`, `jp`, `kr`, etc.
- **Glossary** (`glossary`): Define fixed translations for specific terms.
  - Example: `{ "dto": "Data Transfer Object", "ctx": "Context" }`
- **Protected Terms** (`protectedTerms`): List of words that should never be translated (e.g., `id`, `url`, `json`).
- **Skip Patterns** (`skipPatterns`): Regex to skip meaningless variables like `i`, `j`, `tmp`.
- **Render Mode** (`renderMode`):
  - `inlay`: Ghost hints (Default).
  - `bilingual`: Double-text (e.g., `user(User)`).
  - `translatedOnly`: Replace identifier text (Visual only).

## ❓ FAQ

**Q: Why is nothing happening after translation?**
A: Check if your API Key is correct and if your network can reach the API provider. You can switch the provider to `demo` mode to test if the plugin UI is working correctly.

**Q: Is translating a large project expensive?**
A: No. Thanks to the incremental engine, **only modified files** consume tokens after the first scan. Cached results are reused locally.

**Q: Will my code be leaked?**
A: No. The extension only sends a "bag of words" (identifiers) to the AI. Without the surrounding code structure and logic, the AI cannot reconstruct your proprietary business logic.

---

**Code Decode** — Make reading source code as easy as reading a book in your native language.
