# LLM Chat Clipper — 项目上手文档

## 项目是什么

这是一个浏览器扩展（Chrome），专门用于从 LLM 对话网站（Google AI Studio、ChatGPT、Claude.ai 等）提取对话内容，输出为结构化的 Markdown 文件。

**基于** [obsidian-web-clipper](https://github.com/obsidianmd/obsidian-clipper) 魔改。原扩展是通用网页剪藏器，本项目只做 LLM 对话提取，去掉通用 clipper 功能。

## 核心原理

LLM 对话网站有两个共同特征导致通用剪藏工具失效：

1. **虚拟滚动** — 只渲染可见区域的 DOM 元素，不可见区域的内容为空壳
2. **自定义组件** — 对话内容被包裹在框架特定的自定义元素中，标准 HTML 提取器无法识别

解决方案：逐个滚动到每个对话轮次（turn），触发渲染后提取文本。

## 关键文件

### 必读

| 文件 | 作用 |
|------|------|
| `src/content.ts` | **核心提取逻辑**。`getPageContent` handler 中有 AI Studio 的逐 turn 滚动提取代码。新站点适配在这里添加 |
| `clipper-templates-llm/METHODOLOGY.md` | 完整方法论。包含插件管线分析、三种方案选择指南、踩坑记录、AI Studio DOM 参考 |
| `src/utils/tokenizer.ts` | 模板字符串解析器。已修复 regex 反斜杠丢弃 bug（两处 `default` 分支） |

### 参考

| 文件 | 作用 |
|------|------|
| `clipper-templates-llm/templates/google-ai-studio.json` | AI Studio 正常模式模板（Pre-MD + Post-MD 过滤器） |
| `clipper-templates-llm/templates/google-ai-studio-raw.json` | AI Studio Raw mode 模板（使用 `{{rawContent}}` 变量） |
| `src/utils/content-extractor.ts` | 变量构建。`contentHtml` / `content` / `fullHtml` 等变量的生成点 |
| `src/utils/shared.ts` | `buildVariables()` 函数。`extractedContent` 中的键会变为 `{{key}}` 模板变量 |

## 数据流

```
用户点击 clip 按钮
  → background.ts 发送 "getPageContent" 消息到 content.ts
  → content.ts:
      1. flattenShadowDom()
      2. Defuddle 解析（提取通用页面元数据）
      3. ★ 站点定制提取（逐 turn 滚动）→ extractedContent['rawContent']
      4. DOMParser 清理 fullHtml
      5. buildVariables() → 所有模板变量
  → template-compiler.ts 用模板 + 变量渲染最终 Markdown
  → 输出到 Obsidian vault / 剪贴板
```

## 站点适配方法

每个 LLM 站点需要一个"adapter"——本质是一段在 `content.ts` 的 `getPageContent` handler 中运行的提取逻辑。

### 步骤

1. **找到 turn 容器** — 打开 DevTools，找到包裹每轮对话的最外层元素。记录选择器。

2. **找到文本内容容器** — 在 turn 内部，找到存放实际文本的元素。用 Console 执行：
   ```js
   document.querySelectorAll('你的turn选择器').forEach(t => {
     console.log(t.innerHTML.substring(0, 200));
   });
   ```
   找到包含用户输入和 AI 回复的元素。

3. **识别思考过程标记** — 找到一个只在 thinking turn 中存在的 class 或属性。方法：在 DevTools 中分别检查思考过程 turn 和正文回复 turn 的 HTML，找差异。

4. **检查虚拟滚动** — 滚动页面后执行：
   ```js
   document.querySelectorAll('你的turn选择器').forEach(t => {
     const content = t.querySelector('你的文本容器选择器');
     console.log(content ? 'HAS_CONTENT' : 'EMPTY');
   });
   ```
   如果有 EMPTY，说明存在虚拟滚动，需要用逐 turn 滚动提取。

5. **编写提取代码** — 参照 `content.ts` 中 AI Studio 的实现模式，在 `if (allTurns.length > 0)` 块之前添加新的站点检测分支。

### AI Studio adapter 代码位置

`src/content.ts` 第 226 行附近，`extractedContent` 初始化之后。搜索 `ms-chat-turn` 可定位。

### 检测方式

用 URL 前缀或 DOM 元素检测当前站点：
```typescript
if (document.querySelector('目标站点的特征元素')) {
    // 该站点的提取逻辑
}
```

## 目标站点（按优先级）

| 站点 | URL | 状态 |
|------|-----|------|
| Google AI Studio | `aistudio.google.com` | ✅ 已完成 |
| ChatGPT | `chatgpt.com` | 待适配 |
| Claude.ai | `claude.ai` | 待适配 |
| Gemini | `gemini.google.com` | 待适配 |
| Perplexity | `perplexity.ai` | 待适配 |
| DeepSeek | `chat.deepseek.com` | 待适配 |

## TODO：清理原扩展代码

本项目不再需要以下通用剪藏功能。逐步移除：

- [ ] 移除 `src/utils/filters.ts` 中不需要的过滤器（保留 `replace`、`trim`、`strip_tags` 等文本处理相关的）
- [ ] 移除 highlighter 相关代码（`src/utils/highlighter.ts`、`src/utils/highlighter-overlays.ts`）
- [ ] 移除 sidebar/iframe 模式（`src/utils/iframe-resize.ts`），改为 popup 或直接导出
- [ ] 移除通用页面模板功能（`schema.org` 提取、`meta tags` 变量等）
- [ ] 简化 `content.ts`：移除 `copyMarkdownToClipboard`、`saveMarkdownToFile` 等原扩展特有的 action handler
- [ ] 移除 `src/utils/clip-utils.ts` 中的 `parseForClip`（如果不使用通用 clipper 模式）
- [ ] 简化 `content-extractor.ts`：移除 selection/highlight 逻辑
- [ ] 清理 `src/side-panel.html` 和相关 UI 代码
- [ ] 更新 `manifest.json`：修改扩展名称、描述、权限（移除不需要的）

**注意**：每次删除一个模块后 `npm run build:chrome` 确认编译通过，再 commit。不要一次删太多。

## 构建与测试

```bash
npm run build:chrome    # 构建 Chrome 扩展
# 产出在 dist/ 目录
# chrome://extensions → 开发者模式 → 加载已解压的扩展 → 选择 dist/ 目录
```
