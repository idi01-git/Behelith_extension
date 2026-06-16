<div align="center">

<img width="100%" src="https://capsule-render.vercel.app/api?type=waving&height=180&text=%20Behelith&fontSize=50&fontAlignY=35&animation=fadeIn"/>

<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=700&size=26&pause=1000&center=true&vCenter=true&width=900&lines=The+Ultimate+Competitive+Programming+Companion;VS+Code+Experience+Inside+Codeforces;Monaco+Editor+%7C+Offline+Testing+%7C+WASM+Formatting;Built+for+Competitive+Programmers" />
</p>

### Transform Codeforces into a Modern Competitive Programming Environment

<p align="center">

<img src="https://img.shields.io/badge/Monaco-Editor-blue?style=for-the-badge">
<img src="https://img.shields.io/badge/Offline-Execution-success?style=for-the-badge">
<img src="https://img.shields.io/badge/WASM-Formatting-orange?style=for-the-badge">
<img src="https://img.shields.io/badge/Codeforces-Enhanced-red?style=for-the-badge">

</p>

</div>

---

# ✨ Why Behelith?

Competitive programmers spend countless hours switching between editors, browsers, formatters, templates, and testing tools.

Behelith removes that friction.

Powered by the **Monaco Editor** (the editor behind VS Code), Behelith transforms the default Codeforces experience into a modern competitive programming workspace directly inside your browser.

No external APIs.

No online formatters.

No context switching.

Just open a problem and start coding.

---

# 🎬 Preview

<p align="center">
  <img src="assets/editor-demo.gif" width="100%">
</p>

> Replace the GIF above with your own demo recording.

---

# ⚡ Features

## 🎨 Monaco Editor Integration

Replace the default Codeforces textarea with a fully-featured Monaco Editor.

### Highlights

* Intelligent autocomplete
* Multi-cursor editing
* Auto indentation
* Bracket matching
* Code folding
* Word wrap support
* VS Code-like editing experience

---

## 🧪 Draggable HUD & Test Runner

A floating HUD provides an integrated local testing environment.

### Features

* Automatic sample test extraction
* Custom test case creation
* Persistent storage across reloads
* Accepted / Wrong Answer detection
* Diff visualization
* Runtime Error reporting
* Compile Error reporting
* Time Limit Exceeded detection
* One-click copy utilities

---

## 🧩 Template Manager

Never write boilerplate again.

### Features

* Multiple templates
* Language-specific templates
* Custom hotkeys
* Template management UI
* Cursor anchoring

Example:

```cpp
int main() {
    [cursor]
}
```

The cursor automatically moves to the desired position after loading the template.

---

## 🎨 Offline Code Formatting

Powered entirely by WebAssembly.

### C++

* clang-format.wasm

### Python

* ruff.wasm

Benefits:

* No internet required
* No API requests
* Extremely fast formatting
* Privacy friendly

---

## ⌨️ Productivity Hotkeys

| Action        | Default Shortcut |
| ------------- | ---------------- |
| Toggle Editor | Ctrl + Alt + E   |
| Run Code      | Ctrl + Alt + R   |
| Format Code   | Ctrl + Alt + F   |
| Word Wrap     | Alt + W          |
| Help Panel    | Ctrl + Alt + H   |

---

# 🖼️ Screenshots

## Monaco Editor

![Monaco Editor](https://res.cloudinary.com/dwunkkjze/image/upload/v1781597776/Screenshot_2026-06-16_134202_fq1dyt.png)

---

## Test Runner HUD

![HUD](https://res.cloudinary.com/dwunkkjze/image/upload/v1781597777/Screenshot_2026-06-16_134307_a5nmi8.png)

---

## Template Manager

![Template Manager](https://res.cloudinary.com/dwunkkjze/image/upload/v1781597776/Screenshot_2026-06-16_134246_ebptkw.png)

---

## Settings

![Settings](https://res.cloudinary.com/dwunkkjze/image/upload/v1781597776/Screenshot_2026-06-16_134136_oduurd.png)

---

# ⚙️ Installation

## Option A — Standard Installation

### Clone Repository

```bash
git clone https://github.com/idi01-git/Behelith_v_1.1.2.git
cd Behelith_v_1.1.2/extension
```

### Install Dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

### Load Into Chrome

1. Open:

```text
chrome://extensions
```

2. Enable Developer Mode.

3. Click **Load Unpacked**.

4. Select:

```text
extension/dist
```

⚠️ Load the `dist` folder, not the parent extension folder.

---

## Option B — Local Compilation Support

Unlock local execution for C++ and Python.

### Requirements

* Python 3
* g++ (MinGW)

Both must be available in your system PATH.

### Setup

1. Complete Option A.
2. Copy the extension ID from Chrome Extensions.
3. Open `local_daemon`.
4. Run:

```bash
install.bat
```

5. Paste your Extension ID.
6. Reload the extension.

You're done.

---

# 🛠️ Customization

### Editor Themes

* VS Dark
* Light
* HC Black

### Font Size

* 10px → 24px

### Compiler Standards

* C++11
* C++14
* C++17
* C++20

### Optimization Levels

* O0
* O2
* O3

### Submission Modes

#### Review Mode

Navigate to the submit page and review before submission.

#### Direct Mode

Submit automatically.

---

# 🏗️ Architecture

```text
┌─────────────────────────────────────────┐
│           Codeforces Webpage            │
├─────────────────────────────────────────┤
│ Content Script ↔ Monaco iframe          │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│     Background Service Worker           │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│      Native Messaging Bridge            │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│      Python / g++ Execution Layer       │
└─────────────────────────────────────────┘
```

---

# 🔒 Security

### Sandbox Isolation

Browsers restrict direct execution features through Content Security Policies.

Behelith uses:

* Isolated iframe architecture
* Structured postMessage communication
* Browser-compliant WebAssembly execution

### Native Messaging

Local execution uses Chrome's official Native Messaging protocol.

Temporary files are automatically cleaned after execution.

---

# 💙 Credits

## 🌱 Inspiration

### Yash Kumar

**GitHub:** @httpsyash

The original inspiration behind Behelith.

His autofill extension sparked the idea that eventually grew into this project. While Behelith evolved into something very different, the initial inspiration came from seeing what he built.

---

## 🚀 Development & Support

### Chirag Sharma

**GitHub:** @Invincible1228

Friend, collaborator, contributor, and one of the biggest reasons Behelith exists today.

Chirag contributed fixes, improvements, testing, feedback, and formatter-related enhancements throughout development. His suggestions helped refine many parts of the project and improve the overall experience.

More importantly, he constantly encouraged me to keep building and take the project seriously. His support and motivation played a huge role throughout this journey.

---

## 💻 Created By

### Shivang

**GitHub:** @idi01-git

Creator and developer of Behelith.

Built with countless hours of experimentation, debugging, iteration, learning, and a desire to make competitive programming on Codeforces feel more modern and enjoyable.

---

# ❤️ A Small Note

This was my first time building a browser extension, so there were a lot of things to learn along the way.

Special thanks to **Yash Kumar (@httpsyash)**, whose autofill extension inspired the original idea behind Behelith, and to **Chirag Sharma (@Invincible1228)**, whose contributions, feedback, and constant encouragement played a huge role throughout this journey.

If you find any bugs, issues, or unexpected behavior, please forgive me and let me know. I'll do my best to fix them and improve Behelith.

Thank you for trying Behelith. I hope it makes your competitive programming journey a little more enjoyable.

🌑

---

<div align="center">

### Codeforces, Reimagined.

<img width="100%" src="https://capsule-render.vercel.app/api?type=waving&height=120&section=footer"/>

</div>