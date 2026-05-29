# LLM Chat Clipper 开发方法论

本指南描述如何为新 LLM 对话网站适配 Obsidian Web Clipper。涵盖两条路径：纯模板方案（适用于简单站点）和代码修改方案（适用于复杂动态站点）。

---

## 第一部分：插件提取模型与 LLM 网页的冲突

### 插件的核心管线

```
页面 DOM → Defuddle 提取 HTML → contentHtml 变量 → Turndown 转 Markdown → 模板过滤器链 → 最终 .md 文件
```

这个模型有三个隐含假设：

1. **页面有一个明确的内容主体** — Defuddle 寻找 `<article>` 或 `<main>` 等核心内容区域
2. **内容是静态的** — 提取是一次性快照，DOM 之后怎么变都不管
3. **HTML 语义是标准的** — Turndown 依赖 `<p>`、`<h1>`、`<pre><code>` 等标准元素

### LLM 网页为什么打破所有假设

| 假设 | LLM 网页的实际情况 | 后果 |
|------|-------------------|------|
| 单一内容主体 | 多轮对话 = N 个独立组件树嵌套在虚拟滚动容器中 | Defuddle 无法识别"这些 turn 合起来构成完整内容" |
| 内容静态 | 虚拟滚动只渲染可见区域约 5 条 turn | 一次性快照拿到不完整数据 |
| 标准 HTML 语义 | 自定义元素（`ms-chat-turn`、`ms-text-chunk`）包裹纯文本 | Turndown 无法正确转换，Defuddle 会折叠换行 |

**结论**：Defuddle + Turndown 这套"文章提取→Markdown 转换"模型，天然适配博客、新闻、文档等单主体静态页面，但不适配多轮对话、动态渲染、自定义组件的 LLM 聊天界面。要剪藏这类页面，需要：

- **简单站点**（无虚拟滚动、结构清晰）：模板过滤器足够
- **复杂站点**（虚拟滚动、自定义元素）：需要在 `content.ts` 数据提取阶段做站点定制逻辑

---

## 第二部分：方案选择指南

```
目标 LLM 站点
  │
  ├─ Defuddle 能正确提取完整内容？
  │   ├─ 是 → 方案 A：纯模板过滤器
  │   └─ 否 → 需要改代码
  │            │
  │            ├─ 有虚拟滚动？
  │            │   ├─ 是 → 方案 C：逐 turn 滚动提取
  │            │   └─ 否 → 方案 B：模板 + 简单代码提取
  │            │
  │            └─ 考虑：API 拦截、Angular 内部状态等替代方案
  │
  └─ 判断方法：先用 debug 模板输出 {{contentHtml}} 检查
```

---

## 第三部分：方案 A — 纯模板过滤器

### 管道概述

```
contentHtml → Pre-MD 过滤器 → markdown 转换 → Post-MD 过滤器 → 最终输出
```

### 两种清洗模式

| 模式 | 模板写法 | 适用场景 |
|------|----------|----------|
| **Pre-MD** | `{{contentHtml\|remove_html:".x"\|replace:/re/:""\|markdown}}` | 删除特定 DOM 元素 |
| **Post-MD** | `{{content\|replace:/re/:""\|trim}}` | 修整已转换的 Markdown 文本 |

**优先使用 Pre-MD** — 在 HTML 阶段移除节点比在 Markdown 阶段修补文本更可靠。

### 可用过滤器

| 过滤器 | 语法 | 说明 |
|--------|------|------|
| `remove_html` | `remove_html:".class,#id,tag"` | 删除匹配元素**及其内容**。仅支持 `.class`、`#id`、`tagname` |
| `remove_tags` | `remove_tags:"span,div"` | 删除标签但**保留内容** |
| `replace` | `replace:/regex/flags:"replacement"` | 正则替换。支持 `gimsuy` 标志 |
| `replace` | `replace:"literal":"new"` | 字面替换 |
| `strip_tags` | `strip_tags` 或 `strip_tags:"b,i,a"` | 移除所有/保留指定标签 |
| `markdown` | `markdown` | HTML → Markdown 转换 |
| `trim` | `trim` | 去除首尾空白 |

### `remove_html` 的限制

仅支持三种选择器：
- `.classname` — 匹配 `[class*="classname"]`（部分匹配）
- `#idname` — 匹配 `[id="idname"]`
- `tagname` — 匹配 `getElementsByTagName("tagname")`

不支持的写法：`div.class`、`[data-type="thinking"]`、`:first-child` 等。对于无法处理的情况，改用 `replace` 正则。

### 开发流程

1. **准备测试环境**：在目标网站打开有代表性的对话（含思考过程、代码块、多轮对话）
2. **用默认模板 clip 一次**，保存为基线
3. **分析 DOM 结构**：用 DevTools 检查对话容器、思考过程容器、UI 控件的 class/tag
4. **检查 contentHtml 范围**：用 debug 模板 `{{contentHtml}}` 确认 Defuddle 提取了什么
5. **迭代构建过滤器**：从 `{{contentHtml|markdown}}` 开始，每次加一个过滤器
6. **编写最终 JSON 模板**

### JSON 转义注意

| 过滤器中的字符 | JSON 中的写法 |
|----------------|---------------|
| `"..."` 内的双引号 | `\"...\"` |
| 正则中的 `\s` | `\\s` |
| 正则中的 `\d` | `\\d` |
| 正则中的 `\/` | `\\/` |
| Post-MD 中需要的字面量 `\n` | `\\\\n` |

---

## 第四部分：方案 B — 模板 + 简单代码提取

当 Defuddle 能提取大部分内容但某些元素需要特殊处理时使用。

在 `src/content.ts` 的 `getPageContent` handler 中，`extractedContent` 对象上添加自定义变量：

```typescript
const extractedContent: { [key: string]: string } = {
    ...defuddle.variables,
};

// 站点定制提取
const specialEl = document.querySelector('.special-content');
if (specialEl?.textContent) {
    extractedContent['customContent'] = specialEl.textContent;
}
```

模板中使用 `{{customContent}}` 引用。

`extractedContent` 中的键会自动变为 `{{key}}` 模板变量。

---

## 第五部分：方案 C — 逐 turn 滚动提取（虚拟滚动站点）

这是最终验证成功的方案，适用于 AI Studio 这类使用虚拟滚动的站点。

### 核心原理

虚拟滚动站点的关键特征：`querySelectorAll('ms-chat-turn')` 返回的 **NodeList 顺序就是对话顺序**。虽然不可见 turn 的内部内容为空，但 turn 元素本身始终存在于 DOM 中。

因此策略是：**遍历所有 turn，逐个 scrollIntoView 触发渲染，提取内容**。

### 实现代码模式

```typescript
const allTurns = document.querySelectorAll('ms-chat-turn');
if (allTurns.length > 0) {
    const parts: string[] = [];
    for (let i = 0; i < allTurns.length; i++) {
        const turn = allTurns[i] as HTMLElement;
        turn.scrollIntoView({ block: 'center', behavior: 'instant' });
        await new Promise(r => setTimeout(r, 300));

        const role = turn.querySelector('[data-turn-role]')?.getAttribute('data-turn-role');
        const isThinking = turn.querySelector('.mat-expansion-panel-body') !== null;

        if (isThinking) {
            parts.push(`## Model\n\n> Thoughts`);
            continue;
        }

        const vlc = turn.querySelector('.very-large-text-container');
        if (vlc) {
            const text = vlc.textContent?.trim();
            if (text) parts.push(`## ${role}\n\n${text}`);
        }

        // 文件附件 fallback
        const fileName = turn.querySelector('ms-file-chunk .name');
        if (fileName?.textContent?.trim()) {
            parts.push(`## ${role}\n\n📎 ${fileName.textContent.trim()}`);
        }
    }
    extractedContent['rawContent'] = parts.join('\n\n');
    window.scrollTo({ top: 0, behavior: 'instant' });
}
```

### 适配其他站点的要点

1. **找到 turn 容器**：对应 `ms-chat-turn`，每个站点的名称不同，但通常有一个统一的对话轮次容器
2. **找到文本容器**：对应 `.very-large-text-container` 或类似元素
3. **识别 thinking turn**：找到区分思考过程与正文的 class/属性
4. **确定等待时间**：`scrollIntoView` 后需要多久才渲染内容，300ms 是 AI Studio 的经验值
5. **注意：不要用 Map 收集后重排** — 直接按 NodeList 顺序遍历即可

---

## 第六部分：踩坑记录

### 坑 1：Defuddle 折叠换行

`defuddle/standardize.js` 的 `removeEmptyLines` 把文本节点中的 `\n` 替换为空格。导致 Raw mode 纯 Markdown 经过 Defuddle 后丢失所有换行。`contentHtml` 和 `content` 都受影响，但 `fullHtml` 不受影响。

### 坑 2：自定义元素被展平

AI Studio 的 `ms-thought-chunk`、`ms-code-block` 等自定义元素在 Defuddle 提取时被展平为标准 HTML。`remove_html` 对这些元素无效，因为模板处理时它们已经不存在。

### 坑 3：Tokenizer 丢弃反斜杠

`src/utils/tokenizer.ts` 中 `tokenizeString` 的 default 分支 `value += escaped` 丢弃了 `\`，导致 `\s`、`\d` 等 regex 字符类失效。修复：改为 `value += '\\' + escaped`。

### 坑 4：Map 收集顺序 ≠ 对话顺序

虚拟滚动中，可见区域约 5 条 turn。滚动收集时从中间向两端加载，Map 插入顺序与对话顺序不一致。

**尝试过但失败的方案**：
- 按 UUID 排序（UUID 无序号信息）
- 按时间戳排序（跨天时间倒灌）
- 从顶部开始滚动（部分 turn 未渲染）
- 减小步长增大延迟（仍有遗漏）
- 后置重排（多个 Thoughts 堆叠时无法配对）

**最终解决方案**：逐个 `scrollIntoView` + 按 NodeList 顺序遍历，彻底绕开排序问题。

### 坑 5：User turn 的 ms-text-chunk 为空

Raw mode 下 User 文本在 `.very-large-text-container` 中，不在 `ms-text-chunk` 中。需要同时检查两种容器。

### 坑 6：JSON 中 `\\n` 变成实际换行

模板 JSON 中 `\\n` 被 JSON 解析器转为换行字符。Post-MD regex 需要字面量 `\n` 时必须写成 `\\\\n`。

### 坑 7：虚拟滚动卸载内容不可预测

同一页面不同时刻查询 `.very-large-text-container`，结果是"有时有、有时没有"。缓存行为不规律。结论：不能假设任何 turn 的内部内容持久存在，必须在 `scrollIntoView` 后立即提取。

---

## 第七部分：Google AI Studio DOM 参考

### 容器层级

```
ms-chat-session                        ← 整个对话
  └─ ms-chat-turn (×N)                 ← 每个原子操作（按对话顺序排列）
       ├─ div.chat-turn-container
       │    ├─ div.actions-container   ← 编辑、重跑、更多选项按钮
       │    └─ div[data-turn-role]     ← "User" 或 "Model"
       │         └─ div.turn-content
       │              ├─ ms-text-chunk
       │              │    └─ div.very-large-text-container  ← 纯文本 Markdown
       │              └─ ms-file-chunk   ← 文件附件
       │                   └─ span.name  ← 文件名
       └─ div.mat-expansion-panel-body  ← 仅思考过程 turn 有此元素
```

### 关键选择器

| 目标 | 选择器 |
|------|--------|
| 所有对话轮次 | `ms-chat-turn` |
| 角色标识 | `[data-turn-role]` → `"User"` 或 `"Model"` |
| 文本内容 | `.very-large-text-container` 的 `textContent` |
| 思考过程标记 | `.mat-expansion-panel-body` 存在与否 |
| 文件附件名 | `ms-file-chunk .name` |
| Turn ID | `turn-{UUID}`（无顺序信息） |

### 已验证的模板

| 模板文件 | 模式 | 状态 |
|----------|------|------|
| `google-ai-studio.json` | 正常模式 + Pre/Post-MD 过滤器 | 可用（数学公式除外） |
| `google-ai-studio-raw.json` | Raw mode + `{{rawContent}}` | 完整可用 |

---

## 第八部分：未来方向

1. **Angular 内部状态提取**：`ms-chat-session` 的 `__ngContext__` 等属性可能包含完整有序对话数据
2. **API 拦截**：AI Studio 可能有内部 API 返回完整对话结构化数据
3. **通用虚拟滚动适配器**：将逐 turn 滚动提取模式抽象为可复用模块，适配其他 LLM 站点
4. **网络请求层拦截**：在对话数据加载阶段直接捕获，绕过 DOM 渲染限制
