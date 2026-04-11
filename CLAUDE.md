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
| 认证 | Supabase Auth | 邮箱+密码注册/登录，JWT Bearer Token |
| 数据存储 | Supabase PostgreSQL | tasks 表，Row Level Security |
| 定时任务 | APScheduler | 每分钟检查任务提醒 |
| 前端 | 原生 HTML/CSS/JS | 单页应用，fetch 调用 API |
| AI 服务 | DeepSeek API | 任务拆解功能 |

---

## 目录结构

```
项目根目录/
├── src/
│   ├── app.py                  # Flask 主程序 + 所有路由（含认证路由）
│   ├── models.py               # Task 数据模型 + Supabase 读写
│   ├── supabase_client.py      # Supabase 客户端工厂（service key / anon key）
│   ├── scheduler.py            # APScheduler 定时提醒（直接查 Supabase）
│   ├── ai_service.py           # AI 任务拆解服务
│   ├── templates/
│   │   └── index.html          # 单页前端入口（含认证页）
│   └── static/
│       ├── style.css           # 全局样式（含深色主题、Dashboard、认证页）
│       ├── auth.js             # 认证模块：Auth 对象、登录/注册表单逻辑
│       └── app.js              # 前端主逻辑（周视图、所有任务、Dashboard、设置）
├── data/
│   └── tasks.json              # 已弃用（迁移至 Supabase 后保留作备份）
├── .env                        # 环境变量（API Key，已加入 .gitignore）
├── requirements.txt
└── CLAUDE.md                   # 本文件
```

---

## 数据结构

### Task 对象

`children` 字段**不存储**在 Supabase，每次从数据库加载后由 `_rebuild_children()` 根据 `parent_id` 动态重建。

```json
{
  "id": "uuid-string",
  "user_id": "supabase-auth-uuid",
  "title": "任务名称",
  "done": false,
  "day": "2026-04-09",
  "deadline": "2026-04-09T18:00",
  "reminded": false,
  "priority": "normal",
  "parent_id": null,
  "children": [],
  "color": "blue",
  "notes": "备注内容",
  "recurring": "daily",
  "recurring_origin": null,
  "recurring_end": null,
  "deleted_dates": [],
  "order": 0,
  "created_at": "2026-04-09T10:30:00",
  "estimated_time": 120,
  "ai_group_id": null
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | UUID，主键 |
| user_id | string | Supabase auth.users 的 UUID |
| title | string | 任务标题 |
| done | boolean | 完成状态 |
| day | string | 归属日期 YYYY-MM-DD |
| deadline | string/null | 提醒时间 ISO 格式 |
| reminded | boolean | 是否已提醒 |
| priority | string | normal / important / urgent |
| parent_id | string/null | 父任务 ID |
| children | array | 运行时重建，不入库 |
| color | string/null | 颜色标签 key（见颜色系统） |
| notes | string | 备注 |
| recurring | string/null | 循环规则：daily/weekly/monthly |
| recurring_origin | string/null | 循环实例指向模板任务的 ID |
| recurring_end | string/null | 循环结束日期 YYYY-MM-DD |
| deleted_dates | array | 模板任务上记录已跳过的日期 |
| order | number | 排序顺序（同日列内） |
| created_at | string | 创建时间 ISO |
| estimated_time | number/null | 预估时间（分钟） |
| ai_group_id | string/null | AI 拆解批次 ID，同组任务共享 |

### Supabase 建表 SQL

每次新部署或新 Supabase 项目时需在 SQL Editor 中执行：

```sql
CREATE TABLE IF NOT EXISTS public.tasks (
  id                text        PRIMARY KEY,
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title             text        NOT NULL DEFAULT '',
  done              boolean     NOT NULL DEFAULT false,
  day               text,
  deadline          text,
  reminded          boolean     NOT NULL DEFAULT false,
  priority          text        NOT NULL DEFAULT 'normal',
  parent_id         text,
  color             text,
  notes             text        NOT NULL DEFAULT '',
  recurring         text,
  recurring_origin  text,
  recurring_end     text,
  deleted_dates     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "order"           integer     NOT NULL DEFAULT 0,
  created_at        text,
  estimated_time    integer,
  ai_group_id       text
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own tasks"
  ON public.tasks FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON public.tasks(user_id);
CREATE INDEX IF NOT EXISTS tasks_day_idx     ON public.tasks(day);
```

---

## API 接口

所有任务相关接口均需要 `Authorization: Bearer <token>` 请求头。

### 认证接口（无需 Token）

| 方法 | 路由 | 功能 |
|------|------|------|
| POST | /api/auth/register | 注册（邮箱+密码） |
| POST | /api/auth/login | 登录，返回 access_token |

### 任务接口（需要 Token）

| 方法 | 路由 | 功能 |
|------|------|------|
| GET | /api/tasks | 获取周任务（?week_start=YYYY-MM-DD） |
| GET | /api/tasks/all | 获取全部任务（所有任务视图用） |
| POST | /api/tasks | 新增任务 |
| PUT | /api/tasks/\<id\> | 修改任务（支持 scope） |
| DELETE | /api/tasks/\<id\> | 删除任务（支持 scope） |
| POST | /api/tasks/\<id\>/subtasks | 添加子任务 |
| POST | /api/tasks/reorder | 批量更新排序（拖拽用） |
| GET | /api/stream | SSE 提醒推送（无需 Token） |
| POST | /api/ai/decompose | AI 任务拆解 |

### scope 参数说明

`PUT` 和 `DELETE` 请求中可携带 `scope` 字段：

| scope | 说明 |
|-------|------|
| `single`（默认）| 仅操作当前任务 |
| `future` | 当前任务及其之后所有同系列循环实例 |
| `ai_group` | 操作同一 AI 拆解批次的所有任务 |

---

## 认证系统

### 前端（auth.js）

- `Auth` 对象统一管理 JWT Token（存于 `localStorage['wp_auth_token']`）
- `Auth.login(email, password)` / `Auth.register()` / `Auth.logout()`
- `showAuthPage()` / `showAppPage()` 切换认证页与应用页
- 页面加载时：已登录 → 直接显示应用并调用 `init()`；未登录 → 显示认证页
- 认证成功后调用 `init()` 启动应用

### 前端（app.js）

- `api.call()` 自动注入 `Authorization: Bearer <token>` 请求头
- 收到 401 响应时自动清除 Token 并跳转认证页
- `init()` 不再直接绑定 `DOMContentLoaded`，由 `auth.js` 控制调用时机

### 后端（app.py）

- `@login_required` 装饰器：验证 Bearer Token → 写入 `flask.g.user_id`
- 使用 `supabase_client.get_auth().auth.get_user(token)` 验证 JWT

### 客户端分工（supabase_client.py）

| 函数 | 使用的 Key | 用途 |
|------|-----------|------|
| `get_db()` | SUPABASE_SECRET_KEY | 所有数据库读写（绕过 RLS） |
| `get_auth()` | SUPABASE_ANON_KEY | 用户注册/登录/Token 验证 |

---

## 核心功能与逻辑

### 1. 周视图布局

- **6 列**：周一到周五各一列，周六+周日合并为第六列（`.weekend-col`）
- **横线背景**：`repeating-linear-gradient` 每 40px 一条，模拟笔记本内页
- **今日高亮**：当前日期列背景色 `#F0EEE8`
- **行高必须是精确值**：`.task-row { height: 40px }` 而非 `min-height`，否则有颜色 pill 时行高溢出导致横线错位

### 2. 父子任务

- 最多 2 级（父 → 子）
- 子任务全部完成 → 父任务自动完成
- 父任务不能直接勾选，只能通过子任务驱动
- 删除父任务时，子任务一并删除（`delete_task_recursive`）

### 3. 循环任务（重要！）

采用**实例化方案**（非虚拟任务）：

- 数据库存储一条**模板任务**（`recurring_origin = null`）
- 每次查询周视图时，`generate_recurring_instances()` 为当周各日期生成**实际实例**（`recurring_origin = 模板ID`）并写入数据库
- `deleted_dates`（在模板任务上）记录已跳过的日期，防止重新生成
- `recurring_end` 控制循环终止日期

```python
# 判断模板是否应在某日显示（should_show_recurring_on_date）
daily   → 始终显示
weekly  → 与模板同星期几
monthly → 与模板同日期
```

### 4. 颜色标签系统（可自定义）

颜色不再是静态枚举，而是**用户可自定义**的标签系统：

- 内置 5 个颜色（key 固定，名称/色值可改）：
  - `blue` → #4A90D9（默认名：Study）
  - `green` → #52B788（默认名：Relax）
  - `red` → #E8524A（默认名：Urgent）
  - `yellow` → #F5A623（默认名：Focus）
  - `purple` → #9B59B6（默认名：Personal）
- 用户可通过设置面板修改名称、色值，或新增自定义颜色
- 数据存储于 `localStorage['user-colors']`，格式：`[{key, hex, name}]`
- CSS 颜色规则由 `injectColorStyles()` 动态注入 `<style id="dynamic-color-styles">`
- `COLOR_MAP` 是 Proxy 对象，兼容旧代码引用方式

### 5. 主题系统（深色/浅色/跟随系统）

- `localStorage['theme-mode']`：`'light'` / `'dark'` / `'system'`
- 通过 `html[data-theme="dark"]` 选择器切换深色变量
- 深色主题基调：`#0D1521`（主背景）、`#1B2D3E`（分隔线）
- `applyTheme()` 在 `init()` 最开始调用，避免闪烁

### 6. Dashboard（所有任务视图右侧面板）

三张数据卡片，随筛选条件实时更新（`renderDashboard(filtered)`）：

| 卡片 | 内容 | 数据来源 |
|------|------|---------|
| 完成进度 | 水波纹动画圆形，显示完成百分比 | 当前筛选后的根任务 |
| 本周日程 | Canvas 柱状图，7 天已完成/总数 | `state.tasks` 全量（忽略日期筛选） |
| 颜色分布 | SVG 矩阵树图 + 图例 | 当前筛选后的根任务 |

- 矩阵树图使用 `squarify()` 算法，tile 内只显示数量（不显示颜色名）
- 柱状图点击列 → 跳转到对应周的周视图

### 7. AI 任务拆解

- 调用 DeepSeek API（`/api/ai/decompose`）
- 返回子任务列表，用户可全部添加到日程
- 同一批次任务共享 `ai_group_id`（`crypto.randomUUID()` 生成）
- 支持 `scope=ai_group` 批量操作整批任务

### 8. 任务提醒

- APScheduler 每分钟查询 Supabase 中 `reminded=false, done=false` 且 `deadline ≤ now` 的任务
- 直接 update 单条记录的 `reminded=true`（不再 load+save 全量）
- 通过 SSE 广播到所有连接的客户端
- 前端同时触发浏览器 Notification

---

## UI 设计规范

### CSS 变量（浅色主题）

| 变量 | 色值 | 用途 |
|------|------|------|
| `--bg` | #FAFAF8 | 主背景 |
| `--divider` | #E8E8E4 | 分隔线/横线 |
| `--header-text` | #AAAAAA | 星期标题 |
| `--today-bg` | #F0EEE8 | 今日列背景 |
| `--accent` | #4A90D9 | 主强调色 |
| `--urgent` | #E8524A | 紧急优先级 |
| `--important` | #F5A623 | 重要优先级 |
| `--ink` | #333330 | 正文颜色 |
| `--ink-light` | #888880 | 次要文字 |
| `--ink-faint` | #BBBBB6 | 辅助/占位文字 |

### CSS 变量（深色主题 `html[data-theme="dark"]`）

| 变量 | 色值 |
|------|------|
| `--bg` | #0D1521 |
| `--divider` | #1B2D3E |
| `--ink` | #BED0E2 |
| `--ink-light` | #7A9AB5 |
| `--today-bg` | #0F1E30 |

### 交互规范

- 动画时长：`200ms ease`（`--ease` 变量）
- 完成任务：删除线 + `opacity: 0.4`
- 字体：系统字体，字重 300-400，极简风格
- 大量留白，不添加多余装饰

---

## 环境变量

```env
# .env 文件（不提交到 git）

# AI 服务
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=sb_publishable_xxx   # 用于用户注册/登录/Token 验证
SUPABASE_SECRET_KEY=sb_secret_xxx      # 用于后端数据读写（绕过 RLS）
```

---

## 开发注意事项

1. **保持极简风格**：不添加过多装饰元素，动画克制
2. **颜色使用动态系统**：通过 `getColorHex(key)` 和 `getColorName(key)` 获取，不要硬编码色值
3. **循环任务**：`generate_recurring_instances()` 会生成实际数据库记录；删除/修改循环任务时注意 `scope` 参数
4. **children 字段**：不存入 Supabase，每次 `load_tasks()` 后由 `_rebuild_children()` 重建，勿手动维护
5. **行高对齐**：周视图 `.task-row` 必须使用精确 `height: 40px`，确保横线不错位
6. **auth.js 加载顺序**：`auth.js` 必须在 `app.js` 之前加载，负责决定何时调用 `init()`
7. **API 调用**：所有 `api.call()` 自动带 Token，无需手动添加；新增 API 路由时记得加 `@login_required`
8. **save_tasks 性能**：每次调用会 upsert 全量任务并 delete 移除的任务，对单用户小数据量可接受

### 常见问题

**Q: 循环任务如何跳过某一天？**
A: 在**模板任务**的 `deleted_dates` 数组中添加该日期字符串，`generate_recurring_instances()` 会跳过它

**Q: 周视图从哪天开始？**
A: 自然周，周一到周日

**Q: 任务颜色和优先级的关系？**
A: 完全独立。颜色是卡片背景色（用户自选，可自定义），优先级是左侧小圆点（紧急红/重要橙）

**Q: 新部署如何初始化数据库？**
A: 在 Supabase SQL Editor 中执行本文件「数据结构」章节中的建表 SQL

**Q: 为什么 color 字段存的是 key（如 "blue"）而不是 hex？**
A: 颜色名称和 hex 由用户自定义，存 key 可保持数据与展示解耦

---

## 已完成功能

- [x] 周视图核心功能（6 列布局、横线背景、今日高亮）
- [x] 父子任务（最多 2 级，子驱动父）
- [x] 任务提醒（APScheduler + SSE + 浏览器通知）
- [x] 循环任务（实例化方案，支持 daily/weekly/monthly）
- [x] 拖拽排序
- [x] 侧边栏导航（周视图 / 所有任务）
- [x] 所有任务视图（筛选、搜索、排序）
- [x] Dashboard 面板（水波纹进度圈、周日程柱状图、颜色矩阵树图）
- [x] AI 任务拆解助手（DeepSeek API）
- [x] 设置面板（主题切换、颜色标签自定义）
- [x] 深色主题
- [x] 用户认证系统（Supabase Auth，邮箱+密码）
- [x] 云端数据持久化（Supabase PostgreSQL）

---

## 文件修改记录

| 日期 | 修改内容 |
|------|----------|
| 2026-04-09 | 初始版本，完成核心功能 |
| 2026-04-10 | 修复循环任务逻辑，改为实例化方案 |
| 2026-04-10 | UI 调整：颜色改为背景色，添加横线 |
| 2026-04-11 | Dashboard、设置面板、深色主题、颜色标签自定义 |
| 2026-04-11 | Supabase 用户认证 + 云端数据持久化 |

---

*最后更新：2026-04-11*
