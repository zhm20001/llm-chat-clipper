# LLM Chat 模板开发方法论

本指南描述如何为新 LLM 对话网站创建 Obsidian Web Clipper 清洗模板。

## 前置知识

### 管道概述

```
网页 DOM → Defuddle 提取 HTML → contentHtml 变量 → 模板过滤器链 → 最终 .md 文件
```

模板通过 `noteContentFormat` 字段中的过滤器链在"HTML → Markdown"这一步前后介入，清洗不需要的内容。

### 两种清洗模式

| 模式 | 模板写法 | 适用场景 |
|------|----------|----------|
| **Pre-MD** | `{{contentHtml\|remove_html:".x"\|replace:/re/:""\|markdown}}` | 删除特定 DOM 元素（思考过程、UI 控件） |
| **Post-MD** | `{{content\|replace:/re/:""\|trim}}` | 修整已转换的 Markdown 文本 |

**优先使用 Pre-MD 模式**——在 HTML 阶段移除节点比在 Markdown 阶段修补文本更可靠。

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

`remove_html` **仅支持三种选择器**：
- `.classname` — 匹配 `[class*="classname"]`（部分匹配）
- `#idname` — 匹配 `[id="idname"]`
- `tagname` — 匹配 `getElementsByTagName("tagname")`

不支持的写法：`div.class`、`[data-type="thinking"]`、`:first-child` 等。

对于 `remove_html` 无法处理的情况，改用 `replace` 正则：
```
replace:"/<div class=\"thinking[^\"]*\"[^>]*>[\s\S]*?<\/div>/g":""
```

---

## 步骤一：准备测试环境

1. 在目标 LLM 网站打开一段**有代表性的对话**，包含：
   - 至少一轮用户提问 + AI 回复
   - AI 的"思考/推理"过程（如果有）
   - 代码块、列表等结构化内容
   - 不同长度的回复

2. **用扩展默认模板 clip 一次**，保存输出。这是"原始快照"，用于后续对比。

## 步骤二：分析 DOM 结构

打开浏览器 DevTools（F12），逐项检查：

### 2.1 识别对话结构
- [ ] 用户消息的容器元素及其 class/tag
- [ ] AI 回复的容器元素及其 class/tag
- [ ] 对话列表的父容器 class/tag

### 2.2 识别需要移除的元素
- [ ] "思考过程"容器的 class/tag/data-attribute
- [ ] 复制按钮的 class/tag
- [ ] 点赞/点踩按钮
- [ ] Token 计数显示
- [ ] 模型名称/配置区域
- [ ] 其他 UI 控件

### 2.3 检查 contentHtml 范围
- 使用扩展的 `...` 菜单 → 检查变量
- 查看 `{{contentHtml}}` 的实际内容
- 确认 Defuddle 是否已过滤导航栏等非正文区域

## 步骤三：映射为过滤器链

对每个需要移除的元素，选择对应策略：

| 元素特征 | 推荐策略 | 示例 |
|----------|----------|------|
| 有明确的 class 名 | `remove_html` | `remove_html:".thought-chain"` |
| 有明确的 id | `remove_html` | `remove_html:"#thinking-block"` |
| 特定 HTML 标签 | `remove_html` | `remove_html:"details"` |
| 复杂选择器/属性 | `replace` 正则 | `replace:"/<details[^>]*>[\s\S]*?<\/details>/g":""` |
| 固定文本模式 | `replace` 字面 | `replace:"[Copy]":""` |

## 步骤四：迭代构建过滤器链

从最简模板开始，逐步添加过滤器：

### 迭代 0：基线
```
noteContentFormat: "{{contentHtml|markdown}}"
```
Clip → 查看输出 → 标记问题。

### 迭代 1-N：逐个添加过滤器
每轮只添加**一个**过滤器，重新 clip 同一页面，对比输出变化：

```
迭代 1: "{{contentHtml|remove_html:".thinking"|markdown}}"
迭代 2: "{{contentHtml|remove_html:".thinking,.copy-btn"|markdown}}"
迭代 3: "{{contentHtml|remove_html:".thinking,.copy-btn"|replace:/regex/:""|markdown}}"
```

如果某个过滤器没有预期效果，移除并尝试其他选择器。

## 步骤五：调试技巧

### 查看 HTML 原始内容
```
noteContentFormat: "{{contentHtml}}"
```
不带任何过滤器，直接输出 HTML 文本。用于确认 `contentHtml` 包含哪些元素。

### 测试正则
在浏览器控制台中验证正则是否匹配：
```javascript
"<div class=\"thinking\">...</div>".replace(/<div class="thinking[^"]*"[^>]*>[\s\S]*?<\/div>/g, "")
```

### 处理动态 class 名
某些网站使用哈希化的 class 名（如 `_a3x7f9`），随部署变化。策略：
1. 寻找不变的属性（`data-*` 属性、aria 角色、特定标签嵌套结构）
2. 用 `replace` 正则匹配结构而非 class 名
3. 如果都不行，考虑用 `{{selectorHtml:...}}` 变量精确提取

## 步骤六：编写最终模板

确认过滤器链后，创建 JSON 文件：

```json
{
    "schemaVersion": "0.1.0",
    "name": "LLM Chat - <站点名>",
    "behavior": "create",
    "noteNameFormat": "{{title}}",
    "path": "Clippings/LLM",
    "noteContentFormat": "<你的过滤器链>",
    "properties": [
        { "name": "title", "value": "{{title}}", "type": "text" },
        { "name": "source", "value": "{{url}}", "type": "text" },
        { "name": "created", "value": "{{date}}", "type": "text" },
        { "name": "tags", "value": "llm-chat", "type": "text" }
    ],
    "triggers": ["<站点 URL 前缀>"]
}
```

### JSON 转义注意

在 JSON 字符串中，过滤器链需要双重转义：

| 过滤器中的字符 | JSON 中的写法 |
|----------------|---------------|
| `"..."` 内的双引号 | `\"...\"` |
| 正则中的 `\s` | `\\s` |
| 正则中的 `\d` | `\\d` |
| 正则中的 `\/` | `\\/` |

示例：
```
模板中: {{contentHtml|remove_html:".thinking"|replace:"/\[copy\]/gi":""|markdown}}
JSON中: "noteContentFormat": "{{contentHtml|remove_html:\".thinking\"|replace:\"/\\[copy\\]/gi\":\"\"|markdown}}"
```

## 步骤七：测试清单

- [ ] trigger 自动匹配目标 URL
- [ ] 思考过程内容被移除
- [ ] 用户消息被保留
- [ ] AI 正式回复被保留
- [ ] 代码块格式正确
- [ ] 列表格式正确
- [ ] 多轮对话顺序正确
- [ ] 长对话无截断
- [ ] frontmatter 字段正确
