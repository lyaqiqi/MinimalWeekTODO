# 极简周计划待办管理器 - Claude Code 完整开发 Prompt

## 使用说明

将下面的内容复制到 Claude Code 中作为初始 Prompt。建议分阶段执行：
1. 先发送「第一部分：项目概述与架构」
2. 等后端完成后，发送「第二部分：前端实现」
3. 最后发送「第三部分：提醒与扩展功能」

---

# 第一部分：项目概述与架构（Day 1）

```
我要开发一个「极简周计划待办管理器」，设计灵感来源于 Tweek.so 的纸张质感美学，以及 WeekToDo 的父子任务交互逻辑。

核心理念：用数字化的方式还原一张真实的周计划纸，让任务管理回归简洁。

## 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| 后端框架 | Flask 3.x | REST API + SSE 推送 |
| 定时任务 | APScheduler | 每分钟检查任务 deadline |
| 数据存储 | JSON 文件 | 轻量持久化，无需数据库 |
| 前端 | 原生 HTML/CSS/JS | 单页应用，fetch 调用 API |
| 推送通知 | SSE | 后端主动推送提醒到前端 |

## 目录结构

请严格按照以下结构创建项目：

```
项目根目录/
├── src/
│   ├── app.py              # Flask 主程序 + 所有路由
│   ├── models.py           # Task 数据模型 + JSON 读写
│   ├── scheduler.py        # APScheduler 定时提醒
│   ├── templates/
│   │   └── index.html      # 单页前端入口
│   └── static/
│       ├── style.css       # 全局样式
│       └── app.js          # 前端交互逻辑
├── data/
│   └── tasks.json          # 持久化数据文件
├── README.md
└── requirements.txt
```

## Task 数据结构

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
  "order": 0
}
```

字段说明：
- id: UUID 字符串，唯一标识
- title: 任务名称
- done: 完成状态
- day: 归属日期（YYYY-MM-DD 格式）
- deadline: 提醒时间（ISO 格式，可为 null）
- reminded: 是否已提醒过
- priority: 优先级（normal / important / urgent）
- parent_id: 父任务 ID，顶级任务为 null
- children: 子任务 ID 列表
- color: 颜色标签（可为 null）
- notes: 备注内容
- recurring: 循环规则（daily/weekly/monthly，可为 null）
- order: 排序顺序（用于拖拽排序）

## API 设计

| 方法 | 路由 | 功能 | 请求体/参数 |
|------|------|------|-------------|
| GET | /api/tasks | 获取任务 | ?week_start=2026-04-07（可选，默认本周） |
| POST | /api/tasks | 新增任务 | { title, day, parent_id?, priority?, color? } |
| PUT | /api/tasks/<id> | 修改任务 | { title?, done?, deadline?, priority?, color?, notes?, order? } |
| DELETE | /api/tasks/<id> | 删除任务 | - |
| POST | /api/tasks/<id>/subtasks | 添加子任务 | { title } |
| GET | /api/stream | SSE 流 | 推送提醒事件 |

## 父子任务逻辑（重要！）

1. 子任务以缩进+细线方式视觉区分，层级最多 2 级
2. 子任务全部勾选 → 父任务自动变为完成状态
3. 父任务完成状态不能手动直接勾选（只能通过子任务驱动）
4. 删除父任务时，所有子任务一并删除
5. 子任务的 day 字段继承父任务

## 数据持久化逻辑

1. Flask 启动时自动加载 data/tasks.json
2. 如果文件不存在，创建空的 tasks.json（内容为 []）
3. 任何增删改操作后立即写入磁盘，无需手动保存
4. 支持跨周查看历史任务

请先创建 models.py（包含 Task 类和 JSON 读写逻辑），然后创建 app.py（包含所有 API 路由），最后创建 scheduler.py（APScheduler 配置）。每个文件创建后都要能独立运行测试。
```

---

# 第二部分：前端实现（Day 2）

```
现在请实现前端部分。

## 核心界面要求

### 周视图布局
- 6 列横向排列
- 前 5 列每列对应一天（周一至周五）
- 第 6 列对应两天（周六和周日），内部再分为上下两个区域
- 使用自然周（周一到周日）
- 响应式宽度，支持常见屏幕尺寸

### 任务卡片交互
- 点击列空白处 → 在该天新增一条任务（inline 输入框出现）
- 回车确认输入 / ESC 取消输入
- 输入内容之后，悬停右侧会出现 CheckBox
- 单击任务文字出现编辑弹窗
- hover 任务时右侧浮现操作图标（删除、添加子任务、设置提醒）

### 编辑弹窗
- 左上角：日期 + 星期
- 右上角工具栏：删除按钮、循环设置、颜色设置、提醒设置
- 弹窗内容：
  - 任务标题（可编辑）
  - 备注输入框
  - 子任务列表（可添加/删除/勾选）
- 点击弹窗外部关闭弹窗

### 父子任务展示
- 参考 WeekToDo 交互：悬停任务可展开子任务列表
- 子任务以缩进 + 细线方式视觉区分
- 展开/折叠子任务列表有 200ms ease 动画

## UI 设计规范（严格遵守！）

### 设计风格
参考 Tweek.so 的纸张质感极简美学：
- 大量留白，信息密度低于一般 todo app
- 任务卡片：无边框，仅用极浅的分隔线区分
- 字体：使用系统字体栈，细字重（font-weight: 300~400）
- 完成状态：文字加删除线 + 透明度降低至 0.4，无色块填充

### 颜色系统（必须使用这些精确色值）

| 用途 | 色值 | 说明 |
|------|------|------|
| 背景 | #FAFAF8 | 主背景，米白纸张感 |
| 列分隔线 | #E8E8E4 | 极浅灰，若有若无 |
| 星期标题 | #AAAAAA | 浅灰，不抢眼 |
| 今日列高亮 | #F0EEE8 | 比背景稍深一点点 |
| 主强调色 | #4A90D9 | 蓝色，用于按钮/焦点 |
| 紧急标签 | #E8524A | 红色，仅用于 urgent 优先级 |
| 重要标签 | #F5A623 | 橙色，用于 important 优先级 |

### 交互细节
- 所有动画使用 200ms ease
- 输入框获得焦点时有淡蓝色边框
- 按钮 hover 时透明度变化，不要用背景色变化
- 删除操作需要确认（或使用 undo 机制）

请创建 templates/index.html、static/style.css、static/app.js 三个文件。确保：
1. 前端通过 fetch 调用后端 API
2. 使用事件委托处理动态元素
3. 所有状态变化实时同步到后端
```

---

# 第三部分：提醒与扩展功能（Day 3-4）

```
现在请实现任务提醒和扩展功能。

## 任务提醒系统

### 后端（scheduler.py）
1. 使用 APScheduler 做定时轮询，每分钟检查一次
2. 检查逻辑：
   - 遍历所有 deadline 不为 null 且 reminded 为 false 的任务
   - 如果当前时间 >= deadline，触发提醒
   - 触发后将 reminded 设为 true 并保存
3. 通过 Flask SSE（Server-Sent Events）推送到前端
4. SSE 消息格式：
   ```json
   {
     "type": "reminder",
     "task_id": "uuid",
     "title": "任务名称",
     "timestamp": "2026-04-07T18:00:00"
   }
   ```

### 前端提醒展示
1. 连接 /api/stream 的 EventSource
2. 收到提醒时：
   - 方式一：右下角弹出浮动提醒卡片，3秒后自动消失（或用户手动关闭）
   - 方式二：同时触发浏览器原生 Notification（需要用户授权）
3. 提醒卡片样式：
   - 白色背景，轻微阴影
   - 显示任务名称和时间
   - 右上角关闭按钮
   - 从右侧滑入动画

## 循环任务功能

### 循环规则
- daily: 每天重复
- weekly: 每周同一天重复
- monthly: 每月同一天重复

### 实现逻辑
1. 任务完成时，如果有 recurring 规则：
   - 自动创建下一个周期的相同任务
   - 新任务的 day 和 deadline 根据规则计算
   - 新任务的 done 和 reminded 重置为 false

## 拖拽排序功能（重要！）

### 功能要求
1. 同列内任务可拖拽排序
2. 任务可跨列拖拽，改变其归属日期
3. 父任务拖拽时，子任务一起移动

### 实现方式
- 使用原生 HTML5 Drag and Drop API
- 拖拽时显示半透明占位符
- 放置时更新 order 字段和 day 字段
- 立即同步到后端

## 周切换导航

### UI
- 页面顶部显示当前周的日期范围（如：2026年4月7日 - 4月13日）
- 左右箭头按钮切换上周/下周
- 「今天」按钮快速回到本周

### 逻辑
- 切换周时调用 GET /api/tasks?week_start=YYYY-MM-DD
- URL 中使用 hash 或 query 参数保存当前周状态，支持刷新保持

## 优先级标记

### 显示方式
- 任务左侧显示小圆点，颜色对应优先级
- normal: 不显示圆点
- important: 橙色圆点 #F5A623
- urgent: 红色圆点 #E8524A

### 设置方式
- 在编辑弹窗中选择优先级
- 或者右键任务快速切换

## 已完成任务折叠

- 每列底部显示「已完成 N 项」
- 默认折叠已完成任务
- 点击可展开/收起
- 使用 localStorage 记住用户偏好

请逐一实现以上功能，每完成一个功能后测试确保正常工作。
```

---

# 附录：关键实现细节补充

如果 Claude Code 在某些地方实现不准确，可以用以下补充 Prompt：

## 补充1：SSE 实现细节

```
SSE 的实现需要注意：

1. Flask 路由：
```python
@app.route('/api/stream')
def stream():
    def generate():
        while True:
            # 检查是否有新提醒
            reminder = reminder_queue.get()  # 使用 queue.Queue
            if reminder:
                yield f"data: {json.dumps(reminder)}\n\n"
    return Response(generate(), mimetype='text/event-stream')
```

2. 前端连接：
```javascript
const eventSource = new EventSource('/api/stream');
eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    showReminder(data);
};
```

3. 需要使用线程安全的队列在 scheduler 和 Flask 之间通信
```

## 补充2：周六日合并列的布局

```
第6列（周末）的 HTML 结构应该是：

<div class="day-column weekend-column">
    <div class="weekend-day" data-date="2026-04-12">
        <div class="day-header">周六 4/12</div>
        <div class="task-list">...</div>
    </div>
    <div class="weekend-day" data-date="2026-04-13">
        <div class="day-header">周日 4/13</div>
        <div class="task-list">...</div>
    </div>
</div>

CSS：
.weekend-column {
    display: flex;
    flex-direction: column;
}
.weekend-day {
    flex: 1;
    border-top: 1px solid #E8E8E4;
}
.weekend-day:first-child {
    border-top: none;
}
```

## 补充3：父任务自动完成逻辑

```
在 models.py 中，更新任务状态时需要检查父子关系：

def update_task(task_id, updates):
    task = get_task_by_id(task_id)
    
    # 如果是子任务且更新了 done 状态
    if task['parent_id'] and 'done' in updates:
        parent = get_task_by_id(task['parent_id'])
        # 检查所有子任务是否都完成
        all_children_done = all(
            get_task_by_id(child_id)['done'] 
            for child_id in parent['children']
        )
        if all_children_done:
            parent['done'] = True
        else:
            parent['done'] = False
        save_task(parent)
    
    # 如果是父任务，不允许直接修改 done 状态
    if task['children'] and 'done' in updates:
        del updates['done']  # 忽略这个更新
    
    # 应用其他更新
    task.update(updates)
    save_task(task)
```

---

# 开发顺序建议

1. **后端 API** → 用 Postman/curl 测试所有接口
2. **静态周视图** → 先用假数据渲染出 UI
3. **前后端联调** → 接入真实 API
4. **父子任务** → 实现展开折叠和自动完成
5. **编辑弹窗** → 完整的任务编辑功能
6. **提醒系统** → SSE + Notification
7. **拖拽排序** → Drag and Drop
8. **周切换** → 导航和历史任务
9. **UI 打磨** → 动画、响应式、细节

祝开发顺利！🚀
