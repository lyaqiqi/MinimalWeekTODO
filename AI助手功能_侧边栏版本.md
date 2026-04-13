# 第三部分：AI 助手功能

请实现 AI 任务拆解助手，通过侧边栏入口打开浮窗面板。

## 交互流程

### 1. 入口（侧边栏）

在侧边栏添加 AI 助手图标，位于现有导航项下方：

```
┌──────┐
│  📅  │  ← 周视图
│  📋  │  ← 所有任务
│      │
│      │
│  ✨  │  ← AI 助手（新增，放在底部或中间位置）
│      │
│  ⚙️  │  ← 设置（如果有的话，放最底部）
└──────┘
```

侧边栏 AI 按钮样式：
- 与其他导航图标风格一致
- 使用 ✨ 或 AI 相关的 SVG 图标
- hover 时背景色变为 #F0EEE8（与其他导航项一致）
- 点击时**不切换页面**，而是打开右侧浮窗面板

### 2. 浮窗面板

点击侧边栏 AI 图标后，从右侧滑出浮窗面板：

```
┌────────────────────────────────────────────────────────────────────────┐
│ [侧边栏] │           当前视图（周视图或列表）              │  AI 面板  │
│          │           （保持不变，不被遮挡）                │  ┌─────┐  │
│   📅     │                                                 │  │     │  │
│   📋     │                                                 │  │ AI  │  │
│          │                                                 │  │助手 │  │
│   ✨     │                                                 │  │     │  │
│          │                                                 │  └─────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

面板样式：
- 宽度：360px
- 高度：100vh（全屏高度）
- 固定在页面右侧
- 白色背景，左侧有轻微阴影
- 从右侧滑入动画（transform: translateX）

### 3. 面板内容结构

```
┌────────────────────────────────────┐
│ AI 任务助手                    ✕   │  ← 标题栏，✕ 关闭面板
├────────────────────────────────────┤
│                                    │
│  输入一个任务，AI 会帮你拆解成     │
│  可执行的子任务                    │
│                                    │
│ ┌────────────────────────────────┐ │
│ │ 例如：完成毕业论文              │ │  ← 输入框
│ └────────────────────────────────┘ │
│                                    │
│         [拆解任务]                 │  ← 主按钮
│                                    │
└────────────────────────────────────┘
```

### 4. AI 拆解结果展示

用户输入任务并点击「拆解任务」后：

```
┌────────────────────────────────────┐
│ AI 任务助手                    ✕   │
├────────────────────────────────────┤
│ 📝 完成毕业论文                    │  ← 用户输入的任务
├────────────────────────────────────┤
│ AI 建议将其拆解为：                │
│                                    │
│ ┌────────────────────────────────┐ │
│ │ ☑ 确定论文题目和大纲            │ │  ← 默认勾选
│ │   ⏱ 2小时 · 🔴紧急 · 📅 4月9日  │ │
│ │                        [编辑]  │ │
│ ├────────────────────────────────┤ │
│ │ ☑ 收集文献资料                  │ │
│ │   ⏱ 4小时 · 🟡重要 · 📅 4月10日 │ │
│ │                        [编辑]  │ │
│ ├────────────────────────────────┤ │
│ │ ☑ 撰写第一章                    │ │
│ │   ⏱ 6小时 · 🟡重要 · 📅 4月11日 │ │
│ │                        [编辑]  │ │
│ └────────────────────────────────┘ │
│                                    │
│  [全部添加到周计划]  [重新生成]    │
│                                    │
└────────────────────────────────────┘
```

### 5. 子任务卡片

每个 AI 生成的子任务显示：
- 勾选框（默认勾选，用于选择要添加的任务）
- 子任务标题
- 预估时间（如：2小时、30分钟）
- 优先级标记（紧急🔴 / 重要🟡 / 普通⚪）
- 建议日期
- [编辑] 按钮：点击可修改以上所有字段

### 6. 编辑子任务

点击 [编辑] 后，该卡片变为可编辑状态：

```
┌────────────────────────────────────┐
│ 标题：                             │
│ ┌────────────────────────────────┐ │
│ │ 确定论文题目和大纲              │ │
│ └────────────────────────────────┘ │
│                                    │
│ 预估时间：[2] 小时                 │
│                                    │
│ 优先级：  ○ 紧急  ● 重要  ○ 普通   │
│                                    │
│ 日期：    [2026-04-09]             │
│                                    │
│         [保存]    [取消]           │
└────────────────────────────────────┘
```

### 7. 添加到周计划

点击「全部添加到周计划」：

1. 首先创建父任务（用户输入的任务标题）
2. 将所有勾选的子任务作为该父任务的子任务添加
3. 每个子任务的 `day` 字段使用 AI 建议的日期
4. 添加成功后显示提示："已添加 N 个任务到周计划"
5. 提供「查看周视图」按钮，点击后关闭面板并切换到周视图

### 8. 其他交互

- 点击 ✕ 按钮或面板外部区域关闭面板
- 关闭时清空输入和结果，下次打开重新开始
- 「重新生成」按钮：保留输入内容，重新调用 AI 获取新的拆解方案
- 加载状态：调用 API 时显示 loading 动画
- 再次点击侧边栏 AI 图标：如果面板已打开则关闭，已关闭则打开（toggle）

---

## 后端实现

### 新增 API

```
POST /api/ai/decompose
Content-Type: application/json

请求体：
{
  "task_title": "完成毕业论文",
  "context": "可选的补充说明"
}

成功响应：
{
  "success": true,
  "parent_task": "完成毕业论文",
  "subtasks": [
    {
      "title": "确定论文题目和大纲",
      "estimated_time": "2小时",
      "priority": "urgent",
      "suggested_date": "2026-04-09"
    },
    {
      "title": "收集文献资料",
      "estimated_time": "4小时",
      "priority": "important",
      "suggested_date": "2026-04-10"
    }
  ]
}

错误响应：
{
  "success": false,
  "error": "API Key 未配置" 或 "AI 服务暂时不可用，请稍后重试"
}
```

### DeepSeek API 集成

新建文件 `src/ai_service.py`：

```python
import os
import json
import re
import requests
from datetime import datetime, timedelta

def decompose_task(task_title: str, context: str = "") -> dict:
    """调用 DeepSeek API 拆解任务"""
    
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        return {"success": False, "error": "AI 功能未配置，请设置 API Key"}
    
    model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
    
    # 获取今天的日期用于 prompt
    today = datetime.now().strftime("%Y-%m-%d")
    
    prompt = f"""你是一个任务规划专家。用户给你一个任务，请将其拆解为 3-7 个可执行的子任务。

对于每个子任务，请提供：
1. 子任务标题（简洁明确，不超过20字）
2. 预估完成时间（如：30分钟、2小时、1天）
3. 优先级（urgent 紧急 / important 重要 / normal 普通）
4. 建议完成日期（从 {today} 开始合理安排，格式 YYYY-MM-DD）

用户任务：{task_title}
{f'补充说明：{context}' if context else ''}

请以 JSON 格式返回，格式如下：
{{
  "subtasks": [
    {{
      "title": "子任务标题",
      "estimated_time": "预估时间",
      "priority": "优先级",
      "suggested_date": "YYYY-MM-DD"
    }}
  ]
}}

只返回 JSON，不要其他任何内容。"""

    try:
        response = requests.post(
            f"{base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": model,
                "messages": [
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.7,
                "max_tokens": 1000
            },
            timeout=30
        )
        
        if response.status_code != 200:
            return {"success": False, "error": "AI 服务暂时不可用，请稍后重试"}
        
        result = response.json()
        content = result["choices"][0]["message"]["content"]
        
        # 移除可能的 markdown 代码块包裹
        content = content.strip()
        content = re.sub(r'^```json\s*', '', content)
        content = re.sub(r'^```\s*', '', content)
        content = re.sub(r'\s*```$', '', content)
        
        parsed = json.loads(content)
        
        return {
            "success": True,
            "parent_task": task_title,
            "subtasks": parsed.get("subtasks", [])
        }
        
    except requests.exceptions.Timeout:
        return {"success": False, "error": "AI 响应超时，请重试"}
    except json.JSONDecodeError:
        return {"success": False, "error": "AI 返回格式错误，请重试"}
    except Exception as e:
        return {"success": False, "error": f"发生错误：{str(e)}"}
```

### 在 app.py 中添加路由

```python
from ai_service import decompose_task

@app.route('/api/ai/decompose', methods=['POST'])
def api_decompose_task():
    data = request.json
    task_title = data.get('task_title', '').strip()
    context = data.get('context', '').strip()
    
    if not task_title:
        return jsonify({"success": False, "error": "请输入任务标题"})
    
    result = decompose_task(task_title, context)
    return jsonify(result)
```

### 错误处理

| 情况 | 后端返回 | 前端显示 |
|------|----------|----------|
| API Key 未配置 | `{"success": false, "error": "AI 功能未配置"}` | 显示配置提示 |
| API 调用超时 | `{"success": false, "error": "AI 响应超时"}` | 显示重试按钮 |
| API 返回异常 | `{"success": false, "error": "..."}` | 显示错误信息和重试按钮 |
| 用户未输入 | `{"success": false, "error": "请输入任务标题"}` | 输入框显示提示 |

---

## 前端实现要点

### HTML 结构

```html
<!-- 侧边栏中添加 AI 按钮 -->
<nav class="sidebar">
    <a href="#" class="nav-item" data-view="week"><!-- 周视图图标 --></a>
    <a href="#" class="nav-item" data-view="list"><!-- 列表图标 --></a>
    <a href="#" class="nav-item" id="ai-assistant-btn"><!-- AI 图标 --></a>
</nav>

<!-- AI 面板（独立于主内容） -->
<aside id="ai-panel" class="ai-panel">
    <div class="ai-panel-header">
        <h3>AI 任务助手</h3>
        <button class="close-btn" id="ai-panel-close">✕</button>
    </div>
    <div class="ai-panel-content">
        <!-- 输入区域 / 结果区域 -->
    </div>
</aside>

<!-- 遮罩层（可选） -->
<div id="ai-panel-overlay" class="ai-panel-overlay"></div>
```

### CSS 要点

```css
.ai-panel {
    position: fixed;
    top: 0;
    right: -360px;  /* 初始隐藏在右侧外 */
    width: 360px;
    height: 100vh;
    background: white;
    box-shadow: -2px 0 10px rgba(0,0,0,0.1);
    transition: right 0.3s ease;
    z-index: 1000;
}

.ai-panel.open {
    right: 0;  /* 显示 */
}

/* 主内容区域在面板打开时不需要收缩，面板覆盖在上面即可 */
```

### JavaScript 要点

```javascript
// Toggle AI 面板
document.getElementById('ai-assistant-btn').addEventListener('click', () => {
    const panel = document.getElementById('ai-panel');
    panel.classList.toggle('open');
});

// 关闭面板
document.getElementById('ai-panel-close').addEventListener('click', () => {
    document.getElementById('ai-panel').classList.remove('open');
});
```

---

## 新增文件清单

- `src/ai_service.py` - AI API 调用逻辑
- 修改 `src/app.py` - 添加 `/api/ai/decompose` 路由
- 修改 `src/templates/index.html` - 添加侧边栏 AI 按钮和面板 HTML
- 修改 `src/static/style.css` - 添加面板样式
- 修改 `src/static/app.js` - 添加面板交互逻辑

请实现完整的 AI 助手功能。

---

# 第四部分：数据结构更新

为支持新功能，需要更新 Task 数据结构。

## 新增字段

```json
{
  "id": "uuid-string",
  "title": "任务名称",
  "done": false,
  "day": "2026-04-07",
  "deadline": "2026-04-07T18:00",
  "reminded": false,
  "priority": "normal",
  "parent_id": null,
  "children": [],
  "color": null,
  "notes": "",
  "recurring": null,
  "order": 0,
  
  // 新增字段
  "created_at": "2026-04-07T10:30:00",  // 创建时间，用于排序
  "estimated_time": null                 // 预估时间（分钟），用于 AI 拆解
}
```

## 迁移逻辑

在 models.py 中，加载旧数据时自动补充新字段：

```python
def migrate_task(task: dict) -> dict:
    """确保任务包含所有必要字段"""
    if "created_at" not in task:
        task["created_at"] = task.get("day", "") + "T00:00:00"
    if "estimated_time" not in task:
        task["estimated_time"] = None
    return task
```

请更新 models.py，确保向后兼容。

---

# 第五部分：环境配置说明

## 环境变量配置

在项目根目录创建 `.env` 文件：

```env
# DeepSeek AI API 配置
DEEPSEEK_API_KEY=sk-9efe909f9ef445bf841d1476b125499c
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
```

## 安装新依赖

更新 requirements.txt，添加：

```
requests>=2.31.0
python-dotenv>=1.0.0
```

然后运行：

```bash
pip install -r requirements.txt
```

## 加载环境变量

在 app.py 开头添加：

```python
from dotenv import load_dotenv
load_dotenv()
```

请更新项目配置，确保 AI 功能可以正常使用。
