# Pocket IDE 📱

A self-hosted, mobile-responsive development platform and AI agent playground. Inspired by Portable.dev, it allows you to write, test, run, and deploy code directly from your phone or any mobile web browser.

## Features

- **Responsive Multi-Panel Workspace:** Desktop layout displays all panes side-by-side (File Explorer, Editor, AI Agent, Terminal, Web Preview) while mobile screens fold into a sleek bottom-nav application tab setup.
- **Autonomous AI Coding Agent:** Powered by Gemini, the built-in AI agent can recursively list your files, read them, write/update code, and execute shell commands inside your workspace.
- **Embedded Terminal:** Interactive shell connection via WebSockets running in your workspace directory.
- **Live Preview:** Built-in iframe displaying the running application's frontend for instant visual testing.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- A Google Gemini API Key (obtained from [Google AI Studio](https://aistudio.google.com/))

## Installation & Setup

1. Open your terminal in the `pocket-ide` directory:
   ```bash
   npm install
   ```

2. Start the local server:
   ```bash
   npm start
   ```

3. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

4. To access it from your phone:
   - Ensure your phone and computer are on the same Wi-Fi network.
   - Find your computer's local IP address (e.g., `192.168.1.50`).
   - Open your phone's browser and go to `http://192.168.1.50:3000`.

5. Configure Settings:
   - Click the gear icon (<i class="fa-solid fa-gear"></i>) in the upper-right corner of the page.
   - Paste your **Gemini API Key**.
   - Click **Save Configuration**. The key will be saved locally in your browser's local storage.

## How to Use the AI Coding Agent

Once your API key is configured, you can prompt the agent in the **Coding Agent** panel:
- *"Create an HTML file with a simple count timer and a CSS file to make it look futuristic. Create a JS file to make it tick."*
- *"List the files in the workspace."*
- *"Run a command to install bootstrap."*

You will see the agent update its state in real-time, showing when it is **Thinking**, **Reading Files**, **Writing Code**, or **Running Commands**. After the agent finishes, the File Tree and Live Preview panels will refresh automatically to display your changes.

## Security Warning

Because Pocket IDE runs arbitrary shell commands (like terminal terminals and AI-run bash instructions) and permits modifying files in your workspace, **do not expose this server to the public internet** without setting up reverse-proxy authentication (e.g., basic auth, Tailscale, Cloudflare Access).
