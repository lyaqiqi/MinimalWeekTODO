"""
Task data model + Supabase persistence for the Weekly Planner app.
"""

import calendar
import uuid
from datetime import datetime, date, timedelta
from typing import Optional


# ── Persistence ───────────────────────────────────────────────────────────────

def _rebuild_children(tasks: list[dict]) -> list[dict]:
    """Derive children[] arrays from parent_id — not stored in DB."""
    for t in tasks:
        t['children'] = []
    id_map = {t['id']: t for t in tasks}
    for t in tasks:
        pid = t.get('parent_id')
        if pid and pid in id_map:
            id_map[pid]['children'].append(t['id'])
    return tasks


def load_tasks(user_id: str) -> list[dict]:
    from supabase_client import get_db
    result = get_db().table('tasks').select('*').eq('user_id', user_id).execute()
    tasks = result.data or []
    return _rebuild_children(tasks)


def save_tasks(tasks: list[dict], user_id: str):
    from supabase_client import get_db
    db = get_db()

    existing = db.table('tasks').select('id').eq('user_id', user_id).execute()
    existing_ids = {r['id'] for r in existing.data or []}

    current_ids: set[str] = set()
    to_upsert: list[dict] = []
    for t in tasks:
        row = {k: v for k, v in t.items() if k != 'children'}
        row['user_id'] = user_id
        to_upsert.append(row)
        current_ids.add(t['id'])

    if to_upsert:
        db.table('tasks').upsert(to_upsert).execute()

    to_delete = existing_ids - current_ids
    if to_delete:
        db.table('tasks').delete().in_('id', list(to_delete)).execute()


# ── Task factory ──────────────────────────────────────────────────────────────

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
        'recurring_end': None,
        'deleted_dates': [],
        'order': order,
        'created_at': datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),
        'estimated_time': estimated_time,
        'ai_group_id': ai_group_id,
    }


# ── Lookup helpers ────────────────────────────────────────────────────────────

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

    ids_to_delete: set[str] = set()

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


# ── Recurring logic ───────────────────────────────────────────────────────────

def should_show_recurring_on_date(task: dict, d: date) -> bool:
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
    """Create concrete task instances for recurring templates missing for the week."""
    try:
        start = date.fromisoformat(week_start)
    except ValueError:
        return []
    week_dates = [start + timedelta(days=i) for i in range(7)]

    templates = [
        t for t in tasks
        if t.get('recurring') and not t.get('recurring_origin') and not t.get('parent_id')
    ]
    if not templates:
        return []

    covered: set[tuple[str, str]] = set()
    for t in tasks:
        if t.get('recurring'):
            origin = t.get('recurring_origin') or t['id']
            covered.add((origin, t['day']))

    new_instances: list[dict] = []
    for tmpl in templates:
        deleted_dates = set(tmpl.get('deleted_dates') or [])
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
                covered.add((tmpl['id'], date_str))

    return new_instances


def get_week_tasks(tasks: list[dict], week_start: str) -> list[dict]:
    try:
        start = date.fromisoformat(week_start)
    except ValueError:
        return tasks
    days = {str(start + timedelta(days=i)) for i in range(7)}
    return [t for t in tasks if t.get('day') in days]
