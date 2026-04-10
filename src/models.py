"""
Task data model + JSON persistence for the Weekly Planner app.
"""

import calendar
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
        tasks = json.load(f)
    return [migrate_task(t) for t in tasks]


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
    recurring_origin: Optional[str] = None,
    estimated_time: Optional[int] = None,
    ai_group_id: Optional[str] = None,
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
        'recurring_origin': recurring_origin,
        'deleted_dates': [],
        'order': order,
        'created_at': datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),
        'estimated_time': estimated_time,
        'ai_group_id': ai_group_id,
    }


def migrate_task(task: dict) -> dict:
    """Ensure a task loaded from disk has all current fields (backward compat)."""
    if 'created_at' not in task:
        task['created_at'] = task.get('day', '') + 'T00:00:00'
    if 'estimated_time' not in task:
        task['estimated_time'] = None
    if 'ai_group_id' not in task:
        task['ai_group_id'] = None
    return task


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


def next_recurring_task(task: dict, tasks: list[dict]) -> Optional[dict]:
    """Create the next periodic instance of a completed task.

    Returns a new task dict, or None if one already exists or rule is unknown.
    """
    recurring = task.get('recurring')
    if not recurring:
        return None

    try:
        day = date.fromisoformat(task['day'])
    except (ValueError, KeyError):
        return None

    if recurring == 'daily':
        next_day = day + timedelta(days=1)
    elif recurring == 'weekly':
        next_day = day + timedelta(weeks=1)
    elif recurring == 'monthly':
        month = day.month + 1
        year  = day.year
        if month > 12:
            month = 1
            year += 1
        last = calendar.monthrange(year, month)[1]
        next_day = day.replace(year=year, month=month, day=min(day.day, last))
    else:
        return None

    next_day_str = str(next_day)

    # Avoid duplicate: same title + day + not yet done
    for t in tasks:
        if (t.get('title') == task['title']
                and t.get('day') == next_day_str
                and not t.get('done')
                and not t.get('parent_id')):
            return None

    # Shift deadline by the same delta
    next_deadline: Optional[str] = None
    if task.get('deadline'):
        try:
            dl    = datetime.fromisoformat(task['deadline'])
            delta = next_day - day
            next_deadline = (dl + timedelta(days=delta.days)).strftime('%Y-%m-%dT%H:%M')
        except (ValueError, TypeError):
            pass

    return make_task(
        task['title'],
        next_day_str,
        priority=task.get('priority', 'normal'),
        color=task.get('color'),
        deadline=next_deadline,
        notes=task.get('notes', ''),
        recurring=recurring,
        order=task.get('order', 0),
    )


def should_show_recurring_on_date(task: dict, d: date) -> bool:
    """Return True if the recurring task (template) should appear on date d."""
    try:
        start = date.fromisoformat(task['day'])
    except (ValueError, KeyError):
        return False
    if d < start:
        return False
    recurring_end = task.get('recurring_end')
    if recurring_end:
        try:
            if d > date.fromisoformat(recurring_end):
                return False
        except ValueError:
            pass
    recurring = task.get('recurring')
    if recurring == 'daily':
        return True
    if recurring == 'weekly':
        return d.weekday() == start.weekday()
    if recurring == 'monthly':
        return d.day == start.day
    return False


def generate_recurring_instances(tasks: list[dict], week_start: str) -> list[dict]:
    """Create concrete task instances for recurring templates that are missing for the week.

    Returns a list of new task dicts (caller must extend tasks list and save).
    """
    try:
        start = date.fromisoformat(week_start)
    except ValueError:
        return []
    week_dates = [start + timedelta(days=i) for i in range(7)]

    # Templates: recurring tasks that are not themselves instances
    templates = [
        t for t in tasks
        if t.get('recurring') and not t.get('recurring_origin') and not t.get('parent_id')
    ]
    if not templates:
        return []

    # Build covered set: (origin_id, day) that already exist
    covered: set[tuple[str, str]] = set()
    for t in tasks:
        if t.get('recurring'):
            origin = t.get('recurring_origin') or t['id']
            covered.add((origin, t['day']))

    new_instances: list[dict] = []
    for tmpl in templates:
        deleted_dates = set(tmpl.get('deleted_dates', []))
        for d in week_dates:
            date_str = str(d)
            if date_str in deleted_dates:
                continue
            if (tmpl['id'], date_str) in covered:
                continue
            if should_show_recurring_on_date(tmpl, d):
                instance = make_task(
                    tmpl['title'],
                    date_str,
                    priority=tmpl.get('priority', 'normal'),
                    color=tmpl.get('color'),
                    notes=tmpl.get('notes', ''),
                    recurring=tmpl.get('recurring'),
                    order=tmpl.get('order', 0),
                    recurring_origin=tmpl['id'],
                )
                new_instances.append(instance)
                covered.add((tmpl['id'], date_str))  # prevent duplicate in same batch

    return new_instances


def get_week_tasks(tasks: list[dict], week_start: str) -> list[dict]:
    """Return tasks whose day falls in the 7-day window starting at week_start."""
    try:
        start = date.fromisoformat(week_start)
    except ValueError:
        return tasks
    days = {str(start + timedelta(days=i)) for i in range(7)}
    return [t for t in tasks if t.get('day') in days]
