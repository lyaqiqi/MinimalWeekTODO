"""
Task data model + JSON persistence for the Weekly Planner app.
"""

import json
import os
import uuid
from datetime import datetime, date, timedelta
from typing import Optional

DATA_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'tasks.json')


def _ensure_data_file():
    os.makedirs(os.path.dirname(os.path.abspath(DATA_FILE)), exist_ok=True)
    if not os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump([], f)


def load_tasks() -> list[dict]:
    _ensure_data_file()
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_tasks(tasks: list[dict]):
    _ensure_data_file()
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(tasks, f, ensure_ascii=False, indent=2)


def make_task(
    title: str,
    day: str,
    parent_id: Optional[str] = None,
    priority: str = 'normal',
    color: Optional[str] = None,
    deadline: Optional[str] = None,
    notes: str = '',
    recurring: Optional[str] = None,
    order: int = 0,
) -> dict:
    return {
        'id': str(uuid.uuid4()),
        'title': title,
        'done': False,
        'day': day,
        'deadline': deadline,
        'reminded': False,
        'priority': priority,
        'parent_id': parent_id,
        'children': [],
        'color': color,
        'notes': notes,
        'recurring': recurring,
        'order': order,
    }


def get_task_by_id(tasks: list[dict], task_id: str) -> Optional[dict]:
    for t in tasks:
        if t['id'] == task_id:
            return t
    return None


def delete_task_recursive(tasks: list[dict], task_id: str) -> list[dict]:
    """Delete a task and all its descendants."""
    task = get_task_by_id(tasks, task_id)
    if task is None:
        return tasks

    ids_to_delete = set()

    def collect(tid):
        ids_to_delete.add(tid)
        t = get_task_by_id(tasks, tid)
        if t:
            for child_id in t.get('children', []):
                collect(child_id)

    collect(task_id)

    # Remove from parent's children list
    if task.get('parent_id'):
        parent = get_task_by_id(tasks, task['parent_id'])
        if parent:
            parent['children'] = [c for c in parent['children'] if c not in ids_to_delete]

    return [t for t in tasks if t['id'] not in ids_to_delete]


def update_parent_done_state(tasks: list[dict], parent_id: str):
    """Auto-complete parent if all children are done."""
    parent = get_task_by_id(tasks, parent_id)
    if parent is None:
        return
    children = [get_task_by_id(tasks, cid) for cid in parent.get('children', [])]
    children = [c for c in children if c is not None]
    if children and all(c['done'] for c in children):
        parent['done'] = True
    else:
        parent['done'] = False


def get_week_tasks(tasks: list[dict], week_start: str) -> list[dict]:
    """Return tasks whose day falls in the 7-day window starting at week_start."""
    try:
        start = date.fromisoformat(week_start)
    except ValueError:
        return tasks
    days = {str(start + timedelta(days=i)) for i in range(7)}
    return [t for t in tasks if t.get('day') in days]


if __name__ == '__main__':
    # Quick self-test
    tasks = load_tasks()
    print(f'Loaded {len(tasks)} tasks from {DATA_FILE}')

    t1 = make_task('Test parent', '2026-04-07', priority='important')
    t2 = make_task('Test child', '2026-04-07', parent_id=t1['id'])
    t1['children'].append(t2['id'])

    tasks.extend([t1, t2])
    save_tasks(tasks)
    print(f'Saved {len(tasks)} tasks')

    t2['done'] = True
    update_parent_done_state(tasks, t1['id'])
    print(f'Parent done after child done: {t1["done"]}')

    tasks = delete_task_recursive(tasks, t1['id'])
    save_tasks(tasks)
    print(f'After delete: {len(tasks)} tasks')
