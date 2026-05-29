# Google AI Studio DOM 分析笔记

## 核心发现

### 1. 虚拟滚动（最关键的限制）

AI Studio 使用虚拟滚动渲染对话，**只有当前可见区域附近约 5 条 turn 会被渲染内部内容**。其余 turn 仅保留空壳 `ms-chat-turn` 元素，内部的文本容器不存在于 DOM 中。

实测数据（19 条 turn 的对话）：

| 滚动位置 | 有内容的 turn | 空壳 turn |
|----------|-------------|----------|
| 停留在第 2 轮对话 | 约 5 条 | 约 14 条 |
| 滚动到底部 | 全部 19 条（但内部不一定全部渲染） | — |

关键特征：
- 滚动到某个位置后，之前位置的内容可能被卸载
- 偶尔有内容被缓存渲染（不规律）
- **滚动过程中的 DOM 状态是不可靠的快照**

### 2. `ms-chat-turn` 容器结构

每个对话原子操作占用一个 `ms-chat-turn`：

```
User 上传附件   → ms-chat-turn (User)
User 输入文本   → ms-chat-turn (User)
Model 思考过程  → ms-chat-turn (Model)
Model 正文回复  → ms-chat-turn (Model)
```

结构示例：
```html
<ms-chat-turn id="turn-989B14A5-E2D9-4E86-BE1B-B66FF6A7F074">
  <div class="chat-turn-container ... model render">
    <!-- 操作按钮区域 -->
    <div class="actions-container">...</div>

    <!-- 文本内容区域 -->
    <div class="virtual-scroll-container model-prompt-container" data-turn-role="Model">
      <div class="turn-content">
        <ms-prompt-chunk class="text-chunk">
          <ms-text-chunk>
            <div class="very-large-text-container">
              <!-- Raw mode: 纯 Markdown 文本，换行符为字面量 \n -->
            </div>
          </ms-text-chunk>
        </ms-prompt-chunk>
      </div>
    </div>
  </div>
</ms-chat-turn>
```

### 3. `very-large-text-container`（最重要的类）

Raw mode 下，**所有文本内容**（包括 User 输入和 Model 回复）都存放在：

```html
<div class="very-large-text-container ng-star-inserted">
  ### 1. 斐波那契数列通项公式
  ...
</div>
```

特点：
- 文本是纯文本节点（text node），**不是 HTML 子元素**
- 换行符是**字面量 `\n`**，依赖 CSS `white-space: pre` 渲染
- 代码块、数学公式都是原始 Markdown 源码
- **这是 Raw mode 的核心数据源，内容本身就是完整 Markdown**

但注意：**虚拟滚动可能导致此容器不存在**。只有在 turn 处于可见区域时才会被渲染。

### 4. 思考过程（Thoughts）的识别

思考过程 turn 有两个特征：
- `data-turn-role="Model"`
- 内部包含 `<div class="mat-expansion-panel-body">`（Material 折叠面板组件）

正文回复 turn **没有** `mat-expansion-panel-body`。

### 5. Turn ID 的特点

格式：`turn-{UUID}`，例如 `turn-989B14A5-E2D9-4E86-BE1B-B66FF6A7F074`

- UUID 是随机生成的，**不包含任何顺序信息**
- 无法通过 ID 排序来确定对话顺序
- 只能用 DOM 中的出现顺序（但虚拟滚动使这个顺序不可靠）

### 6. 时间戳的隐藏缺陷

每个 turn 前方有时间戳显示，格式为 `HH:MM`（如 `14:55`、`16:35`）。

**致命缺陷**：
- 只显示时间，**不显示日期**
- 如果对话跨越多天，第二天的 `09:00` 会排在第一天的 `23:00` 之前
- 不能用作排序依据

### 7. `data-turn-role` 属性

`data-turn-role` 位于 `.virtual-scroll-container` 上，值为 `"User"` 或 `"Model"`。

注意：思考过程 turn 和正文回复 turn 的 `data-turn-role` 都是 `"Model"`，需要额外检查 `mat-expansion-panel-body` 来区分。

---

## 已验证的技术方案

### 方案 A：正常模式 + 模板过滤器（已成功）

模板：`google-ai-studio.json`

```
{{contentHtml|
  replace:"/<p>\s*Thoughts\s*<\/p>[\s\S]*?(?=<h[23]>)/g":""|
  replace:"/<p>\s*[\d,]+\s*tokens\s*<\/p>/g":""|
  replace:"/<p>\s*Model\s*<\/p>/g":""|
  replace:"/<p>\s*Text\s*<\/p>/g":""|
  markdown|
  replace:"/^(Mermaid|JavaScript|...)\s*\\n\\n(```)/gm":"```$1"
}}
```

已解决的问题：
- Thoughts 移除 ✓
- 代码块语言标签 ✓
- UI 噪音清除 ✓

未解决：
- 数学公式重复（KaTeX 渲染文本 + LaTeX 源码拼接）— 已决定暂不处理

### 方案 B：Raw mode + DOM 直接提取（部分成功）

Raw mode 下 `very-large-text-container` 包含完整的纯 Markdown 文本，是最干净的数据源。

已验证可行：
- 单条 turn 文本提取 ✓
- 换行符保留 ✓
- Thoughts 识别与过滤 ✓
- 代码块和公式格式正确 ✓

未解决：
- **虚拟滚动导致多 turn 对话内容不完整** — 自动滚动方案因 DOM 收集顺序与对话顺序不一致而失败

---

## 踩坑记录

### 坑 1：Defuddle 折叠换行

`defuddle/standardize.js` 的 `removeEmptyLines` 会把文本节点中的 `\n` 替换为空格：
```js
.replace(/[\n\r]+/g, ' ')
```

这导致 Raw mode 的纯文本 Markdown 经过 Defuddle 处理后丢失所有换行。
`contentHtml` 和 `content` 变量都受影响。

**但**：`fullHtml` 变量不受此影响（直接序列化 `document.documentElement.outerHTML`，不经 Defuddle 标准化）。

### 坑 2：`remove_html` 对自定义元素无效

AI Studio 使用 `ms-thought-chunk`、`ms-code-block` 等自定义元素。但 Defuddle 在提取时将这些元素展平为标准 HTML，模板处理时已不存在。

### 坑 3：Tokenizer 丢弃反斜杠

`src/utils/tokenizer.ts` 中两个 `tokenizeString` 函数的 default 分支：
```js
default: value += escaped;  // Bug: 丢弃了 \
```
导致模板中 `\s`、`\d`、`\S` 等 regex 字符类变成 `s`、`d`、`S`。

**修复**：改为 `default: value += '\\' + escaped;`（已提交）。

### 坑 4：Map 收集顺序 ≠ 对话顺序

虚拟滚动中，可见区域约 5 条 turn。滚动过程中从中间向两端加载，导致 Map 的插入顺序与对话顺序不一致。

尝试过的修复：
- 按位置重排（失败：UUID 无序号）
- 按时间戳排序（失败：跨天时间倒灌）
- 从顶部开始滚动（失败：滚动过快时部分 turn 未渲染）
- 减小步长增大延迟（失败：仍有 turn 未被捕获）
- 将 Thoughts 移到下一个 Model 正文前（部分成功：但多个 Thoughts 堆叠时无法配对）

### 坑 5：User turn 的 `ms-text-chunk` 数量为 0

Raw mode 下，User 的文本在 `very-large-text-container` 中，**不在 `ms-text-chunk` 中**。所有 User turn 的 `textChunks.length === 0`。

### 坑 6：JSON 中 `\\n` 变成实际换行

模板 JSON 中，`\\n` 被 JSON 解析器转为换行字符。Post-MD regex 需要字面量 `\n`（反斜杠+n），必须写成 `\\\\n`。

---

## 滚动抓取建议

如果未来要实现自动滚动抓取，需要解决的核心问题是**排序**。可能的方案：

1. **利用 Angular 内部状态**：`ms-chat-session` 元素上有 `__ngContext__` 等 Angular 内部属性，可能包含完整的有序对话数据。需要进一步分析 Angular 组件树结构。

2. **两遍扫描**：第一遍滚动收集所有 turn id 和文本，第二遍利用某种启发式排序（如文本内容的相似度匹配 User↔Model 配对关系）。

3. **AI Studio API**：探索是否存在内部 API 返回完整对话数据（如 `aistudio.google.com/api/...`）。

4. **分步手动模式**：放弃自动滚动，改为引导用户分段 clip（每段停留在不同位置），然后手动合并。

5. **浏览器插件拦截**：在 AI Studio 的网络请求层面拦截对话数据的加载，从源头获取完整有序数据。
