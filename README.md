# 极简周计划待办管理器

设计灵感来自 Tweek.so 的纸张质感美学与 WeekToDo 的父子任务逻辑。

## 快速开始

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 启动服务
cd src
python app.py
```

浏览器访问 http://localhost:5000

## 项目结构

```
week-planner/
├── src/
│   ├── app.py          # Flask + 全部 API 路由
│   ├── models.py       # Task 模型 + JSON 读写
│   ├── scheduler.py    # APScheduler 定时提醒
│   ├── templates/
│   │   └── index.html  # 单页前端
│   └── static/
│       ├── style.css
│       └── app.js
├── data/
│   └── tasks.json
└── requirements.txt
```

## 功能特性

- 七列周视图，纸张质感设计
- 父子任务（最多两级）：子任务全勾 → 父任务自动完成
- 任务优先级（普通 / 重要 / 紧急）与颜色标签
- 截止时间提醒（APScheduler 每分钟检查，SSE 推送到前端）
- 双击任务标题原地编辑
- 任务详情面板（截止时间、循环、备注、颜色）
- 数据实时写入 data/tasks.json，无需数据库
