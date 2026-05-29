# LLM Chat Clipper

A browser extension that extracts LLM chat conversations as structured Markdown, ready to save into Obsidian.

## Features

- **One-click extraction** — Extract conversations from supported AI platforms with a single click
- **Structured Markdown** — Conversations are formatted with clear headings for each turn (User/Model)
- **Obsidian integration** — Save directly to your Obsidian vault with customizable templates, properties, and file locations
- **Thinking process control** — Optionally include or exclude model reasoning/thinking content
- **Template system** — Auto-match templates by URL pattern, customize note format with variables
- **Multiple save options** — Add to Obsidian, copy to clipboard, or save as file

## Supported Platforms

- Google AI Studio (Gemini)

More platforms coming soon.

## Installation

1. Download the latest release from [Releases](https://github.com/zhm20001/llm-chat-clipper/releases)
2. Open `chrome://extensions/` in your browser
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the unzipped folder

## Build from Source

```bash
git clone https://github.com/zhm20001/llm-chat-clipper.git
cd llm-chat-clipper
npm install
npm run build:chrome
```

The built extension will be in `builds/`.

## Credits

Based on [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-web-clipper) by Obsidian.
