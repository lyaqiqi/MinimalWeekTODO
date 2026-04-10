"""
AI task decomposition service — calls DeepSeek API.
"""

import json
import os
import re
from datetime import datetime

import requests


def decompose_task(task_title: str, context: str = "") -> dict:
    """Call DeepSeek API to decompose a task into sub-tasks."""

    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        return {"success": False, "error": "AI 功能未配置，请在 .env 文件中设置 DEEPSEEK_API_KEY"}

    model    = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
    today    = datetime.now().strftime("%Y-%m-%d")

    prompt = f"""你是一个任务规划专家。用户给你一个任务，请将其拆解为 3-6 个可执行的子任务。

对于每个子任务，请提供：
1. 子任务标题（简洁明确，不超过 20 字）
2. 预估完成时间（如：30分钟、2小时、1天）
3. 优先级（urgent 紧急 / important 重要 / normal 普通）
4. 建议完成日期（从 {today} 开始合理安排，格式 YYYY-MM-DD）

用户任务：{task_title}
{f'补充说明：{context}' if context else ''}

请以 JSON 格式返回，格式如下，只返回 JSON，不要其他任何内容：
{{
  "subtasks": [
    {{
      "title": "子任务标题",
      "estimated_time": "预估时间",
      "priority": "优先级",
      "suggested_date": "YYYY-MM-DD"
    }}
  ]
}}"""

    try:
        response = requests.post(
            f"{base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.7,
                "max_tokens": 1000,
            },
            timeout=30,
        )

        if response.status_code != 200:
            return {"success": False, "error": f"AI 服务暂时不可用（{response.status_code}），请稍后重试"}

        content = response.json()["choices"][0]["message"]["content"].strip()

        # Strip markdown code fences if present
        content = re.sub(r'^```(?:json)?\s*', '', content)
        content = re.sub(r'\s*```$', '', content)

        parsed = json.loads(content)
        subtasks = parsed.get("subtasks", [])

        # Normalise priority values
        valid_priorities = {"urgent", "important", "normal"}
        for s in subtasks:
            if s.get("priority") not in valid_priorities:
                s["priority"] = "normal"

        return {
            "success": True,
            "parent_task": task_title,
            "subtasks": subtasks,
        }

    except requests.exceptions.Timeout:
        return {"success": False, "error": "AI 响应超时，请重试"}
    except json.JSONDecodeError:
        return {"success": False, "error": "AI 返回格式错误，请重试"}
    except Exception as e:
        return {"success": False, "error": f"发生错误：{str(e)}"}
