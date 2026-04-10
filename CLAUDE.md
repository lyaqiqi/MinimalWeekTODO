# CLAUDE.md - 项目说明文件

> 这个文件是给 Claude Code 阅读的项目上下文。每次开始新对话时，Claude Code 会自动读取此文件。

---

## 项目概述

**极简周计划待办管理器** - 一款以「极简周视图」为核心的待办事项管理器。

设计灵感：
- **Tweek.so**：纸张质感美学、横线背景、极简风格
- **WeekToDo**：父子任务交互逻辑

核心理念：用数字化的方式还原一张真实的周计划纸，让任务管理回归简洁。

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 后端 | Flask 3.x | REST API + SSE 推送 |
| 定时任务 | APScheduler | 每分钟检查任务提醒 |
| 数据存储 | JSON 文件 | data/tasks.json |
| 前端 | 原生 HTML/CSS/JS | 单页应用，fetch 调用 API |
| AI 服务 | 硅基流动 API | 任务拆解功能 |

---

## 目录结构

```
项目根目录/
├── src/
│   ├── app.py              # Flask 主程序 + 所有路由
│   ├── models.py           # Task 数据模型 + JSON 读写
│   ├── scheduler.py        # APScheduler 定时提醒
│   ├── ai_service.py       # AI 任务拆解服务
│   ├── templates/
│   │   └── index.html      # 单页前端入口
│   └── static/
│       ├── style.css       # 全局样式
│       └── app.js          # 前端交互逻辑
├── data/
│   └── tasks.json          # 持久化数据
├── .env                    # 环境变量（API Key 等）
├── requirements.txt
├── README.md
└── CLAUDE.md               # 本文件
```

---

## 数据结构

### Task 对象

```json
{
  "id": "uuid-string",
  "title": "任务名称",
  "done": false,
  "day": "2026-04-09",
  "deadline": "2026-04-09T18:00",
  "reminded": false,
  "priority": "normal",
  "parent_id": null,
  "children": [],
  "color": "yellow",
  "notes": "备注内容",
  "recurring": "daily",
  "recurring_end": null,
  "completed_dates": ["2026-04-09"],
  "order": 0,
  "created_at": "2026-04-09T10:30:00",
  "estimated_time": 120
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | UUID，唯一标识 |
| title | string | 任务标题 |
| done | boolean | 完成状态（循环任务此字段不使用） |
| day | string | 归属日期 YYYY-MM-DD |
| deadline | string/null | 提醒时间 ISO 格式 |
| reminded | boolean | 是否已提醒 |
| priority | string | normal / important / urgent |
| parent_id | string/null | 父任务 ID |
| children | array | 子任务 ID 列表 |
| color | string/null | 背景颜色：yellow/blue/green/pink/purple |
| notes | string | 备注 |
| recurring | string/null | 循环规则：daily/weekly/monthly |
| recurring_end | string/null | 循环结束日期 |
| completed_dates | array | 循环任务已完成的日期列表 |
| order | number | 排序顺序 |
| created_at | string | 创建时间 |
| estimated_time | number/null | 预估时间（分钟） |

---

## API 接口

| 方法 | 路由 | 功能 |
|------|------|------|
| GET | /api/tasks | 获取任务（支持 ?week_start=YYYY-MM-DD） |
| POST | /api/tasks | 新增任务 |
| PUT | /api/tasks/<id> | 修改任务 |
| DELETE | /api/tasks/<id> | 删除任务 |
| POST | /api/tasks/<id>/subtasks | 添加子任务 |
| GET | /api/stream | SSE 提醒推送 |
| POST | /api/ai/decompose | AI 任务拆解 |

---

## 核心功能与逻辑

### 1. 周视图布局

- **6 列**：周一到周五各一列，周六+周日合并为第六列
- **横线背景**：类似笔记本内页效果
- **今日高亮**：当前日期列背景色 #F0EEE8

### 2. 父子任务

- 最多 2 级（父 → 子）
- 子任务全部完成 → 父任务自动完成
- 父任务不能直接勾选，只能通过子任务驱动
- 删除父任务时，子任务一并删除

### 3. 循环任务（重要！）

采用**虚拟任务方案**：

- 数据库只存储一条原始任务
- 使用 `completed_dates` 记录哪些日期已完成
- 查询时动态生成每一天的虚拟实例
- 虚拟任务 ID 格式：`{原始ID}_{日期}`

```python
# 判断循环任务是否应在某日期显示
def should_show_on_date(task, date):
    if date < task["day"]:
        return False
    if recurring == "daily":
        return True
    if recurring == "weekly":
        return weekday(date) == weekday(task["day"])
    if recurring == "monthly":
        return day_of_month(date) == day_of_month(task["day"])
```

### 4. 任务颜色

- 颜色作为**任务卡片背景色**（便签效果）
- 可选颜色：yellow/blue/green/pink/purple
- 与优先级圆点是**独立功能**

### 5. 任务提醒

- APScheduler 每分钟检查
- 通过 SSE 推送到前端
- 同时支持浏览器 Notification

---

## UI 设计规范

### 颜色系统

| 用途 | 色值 |
|------|------|
| 主背景 | #FAFAF8 |
| 列分隔线/横线 | #E8E8E4 |
| 星期标题 | #AAAAAA |
| 今日高亮 | #F0EEE8 |
| 主强调色 | #4A90D9 |
| 紧急优先级 | #E8524A |
| 重要优先级 | #F5A623 |

### 任务背景色

| 颜色名 | 色值 |
|--------|------|
| yellow | #FFF9C4 |
| blue | #E3F2FD |
| green | #E8F5E9 |
| pink | #FCE4EC |
| purple | #F3E5F5 |

### 交互规范

- 动画时长：200ms ease
- 完成任务：删除线 + 透明度 0.4
- 字体：系统字体，字重 300-400
- 大量留白，极简风格

---

## 环境变量

```env
# .env 文件
SILICONFLOW_API_KEY=sk-xxx
SILICONFLOW_MODEL=deepseek-ai/DeepSeek-V3
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
```

---

## 开发注意事项

### 修改代码时请注意

1. **保持极简风格**：不要添加过多装饰元素
2. **颜色严格使用规范中的色值**
3. **循环任务使用虚拟任务方案**：不要实际创建多条记录
4. **父子任务逻辑**：父任务完成状态由子任务驱动
5. **数据持久化**：任何修改后立即写入 JSON 文件

### 常见问题

**Q: 循环任务如何删除单个实例？**
A: 在 completed_dates 同级添加 deleted_dates 字段记录

**Q: 周视图从哪天开始？**
A: 自然周，从周一开始到周日

**Q: 任务颜色和优先级的关系？**
A: 完全独立。颜色是背景色（用户自选），优先级是左侧小圆点（紧急红/重要橙）

---

## 待开发功能

- [x] 周视图核心功能
- [x] 父子任务
- [x] 任务提醒
- [x] 循环任务
- [x] 拖拽排序
- [x] 侧边栏导航
- [ ] 信息流页面（所有任务列表）
- [ ] AI 任务拆解助手

---

## 文件修改记录

| 日期 | 修改内容 |
|------|----------|
| 2026-04-09 | 初始版本，完成核心功能 |
| 2026-04-10 | 修复循环任务逻辑，改为虚拟任务方案 |
| 2026-04-10 | UI 调整：颜色改为背景色，添加横线 |

---

*最后更新：2026-04-10*