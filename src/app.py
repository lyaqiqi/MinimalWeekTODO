"""
Flask main application — all REST API routes + SSE stream.
"""

import json
import queue
import threading
from datetime import date, timedelta

from flask import Flask, Response, jsonify, render_template, request, stream_with_context

from models import (
    delete_task_recursive,
    generate_recurring_instances,
    get_task_by_id,
    get_week_tasks,
    load_tasks,
    make_task,
    save_tasks,
    update_parent_done_state,
)

app = Flask(__name__, template_folder='templates', static_folder='static')

# ── SSE client registry ───────────────────────────────────────────────────────
_sse_clients: list[queue.Queue] = []
_sse_lock = threading.Lock()


def broadcast(event: str, data: dict):
    payload = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
    with _sse_lock:
        dead = []
        for q in _sse_clients:
            try:
                q.put_nowait(payload)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _sse_clients.remove(q)


# ── Frontend ──────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


# ── SSE stream ────────────────────────────────────────────────────────────────

@app.route('/api/stream')
def sse_stream():
    q: queue.Queue = queue.Queue(maxsize=50)
    with _sse_lock:
        _sse_clients.append(q)

    def generate():
        yield 'data: {"type":"connected"}\n\n'
        try:
            while True:
                try:
                    yield q.get(timeout=25)
                except queue.Empty:
                    yield ': keep-alive\n\n'
        except GeneratorExit:
            pass
        finally:
            with _sse_lock:
                if q in _sse_clients:
                    _sse_clients.remove(q)

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


# ── GET /api/tasks ────────────────────────────────────────────────────────────

@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    week_start = request.args.get('week_start')
    if not week_start:
        today = date.today()
        week_start = str(today - timedelta(days=today.weekday()))

    tasks = load_tasks()
    new_instances = generate_recurring_instances(tasks, week_start)
    if new_instances:
        tasks.extend(new_instances)
        save_tasks(tasks)
    return jsonify(get_week_tasks(tasks, week_start))


# ── POST /api/tasks ───────────────────────────────────────────────────────────

@app.route('/api/tasks', methods=['POST'])
def create_task():
    body = request.get_json(force=True)
    title = (body.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'title is required'}), 400

    day      = body.get('day') or str(date.today())
    parent_id = body.get('parent_id')
    priority  = body.get('priority', 'normal')
    color     = body.get('color')
    deadline  = body.get('deadline')
    notes     = body.get('notes', '')
    recurring = body.get('recurring')

    tasks = load_tasks()

    if parent_id:
        parent = get_task_by_id(tasks, parent_id)
        if parent is None:
            return jsonify({'error': 'parent not found'}), 404
        if parent.get('parent_id'):
            return jsonify({'error': 'max nesting depth is 2 levels'}), 400
        day = parent['day']

    order = max((t['order'] for t in tasks if t.get('day') == day and not t.get('parent_id')), default=-1) + 1
    task = make_task(title, day, parent_id=parent_id, priority=priority,
                     color=color, deadline=deadline, notes=notes,
                     recurring=recurring, order=order)

    if parent_id:
        get_task_by_id(tasks, parent_id)['children'].append(task['id'])

    tasks.append(task)
    save_tasks(tasks)
    return jsonify(task), 201


# ── PUT /api/tasks/<id> ───────────────────────────────────────────────────────

@app.route('/api/tasks/<task_id>', methods=['PUT'])
def update_task(task_id):
    tasks = load_tasks()
    task = get_task_by_id(tasks, task_id)
    if task is None:
        return jsonify({'error': 'task not found'}), 404

    body = request.get_json(force=True)

    # Parent tasks: `done` can only be set via child propagation, not directly
    if task.get('children') and 'done' in body:
        return jsonify({'error': 'parent done state is driven by its children'}), 400

    scope = body.get('scope', 'single')  # 'single' | 'future'

    # Recurring change on an instance: handle scope before normal field updates
    if 'recurring' in body and task.get('recurring_origin'):
        template = get_task_by_id(tasks, task['recurring_origin'])
        if scope == 'future' and template:
            # Update template's recurring rule
            template['recurring'] = body['recurring'] or None
            # Delete all instances from this day onward to let them regenerate
            origin_id = task['recurring_origin']
            day_str   = task['day']
            tasks = [t for t in tasks if not (
                t.get('recurring_origin') == origin_id and t['day'] >= day_str
            )]
            save_tasks(tasks)
            return jsonify({'task': template})
        else:
            # Detach this instance from the series
            task['recurring_origin'] = None
            # The recurring field will be set below in the normal loop

    updatable = [
        'title', 'done', 'deadline', 'priority', 'color',
        'notes', 'order', 'reminded', 'recurring', 'day',
    ]
    for field in updatable:
        if field not in body:
            continue
        # When day changes on a parent, cascade to all children
        if field == 'day' and body['day'] != task.get('day'):
            new_day = body['day']
            for child_id in task.get('children', []):
                child = get_task_by_id(tasks, child_id)
                if child:
                    child['day'] = new_day
        task[field] = body[field]

    # Propagate done state upward when a child is toggled
    if 'done' in body and task.get('parent_id'):
        update_parent_done_state(tasks, task['parent_id'])

    save_tasks(tasks)
    return jsonify({'task': task})


# ── DELETE /api/tasks/<id> ────────────────────────────────────────────────────

@app.route('/api/tasks/<task_id>', methods=['DELETE'])
def delete_task(task_id):
    tasks = load_tasks()
    task = get_task_by_id(tasks, task_id)
    if task is None:
        return jsonify({'error': 'task not found'}), 404

    scope = request.args.get('scope', 'single')  # 'single' | 'future'

    if task.get('recurring_origin'):
        template_id = task['recurring_origin']
        template = get_task_by_id(tasks, template_id)
        if scope == 'future':
            # Set recurring_end on template to day before this instance
            if template:
                from datetime import date as _date, timedelta as _td
                try:
                    end = _date.fromisoformat(task['day']) - _td(days=1)
                    template['recurring_end'] = str(end)
                except ValueError:
                    pass
            # Remove all instances of this series from this day onward
            tasks = [t for t in tasks if not (
                t.get('recurring_origin') == template_id and t['day'] >= task['day']
            )]
        else:
            # Single: mark date in deleted_dates so it won't regenerate
            if template:
                deleted_dates = template.get('deleted_dates', [])
                if task['day'] not in deleted_dates:
                    deleted_dates.append(task['day'])
                template['deleted_dates'] = deleted_dates
            tasks = [t for t in tasks if t['id'] != task_id]
    else:
        tasks = delete_task_recursive(tasks, task_id)
        # If deleting a recurring template, remove all its instances too
        if task.get('recurring') and not task.get('recurring_origin'):
            tasks = [t for t in tasks if t.get('recurring_origin') != task_id]

    save_tasks(tasks)
    return jsonify({'deleted': task_id})


# ── POST /api/tasks/<id>/subtasks ─────────────────────────────────────────────

@app.route('/api/tasks/<task_id>/subtasks', methods=['POST'])
def create_subtask(task_id):
    tasks = load_tasks()
    parent = get_task_by_id(tasks, task_id)
    if parent is None:
        return jsonify({'error': 'parent not found'}), 404
    if parent.get('parent_id'):
        return jsonify({'error': 'max nesting depth is 2 levels'}), 400

    body = request.get_json(force=True)
    title = (body.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'title is required'}), 400

    subtask = make_task(title, parent['day'], parent_id=task_id, order=len(parent['children']))
    parent['children'].append(subtask['id'])
    tasks.append(subtask)
    save_tasks(tasks)
    return jsonify(subtask), 201


# ── POST /api/tasks/reorder  (batch order update for drag-and-drop) ────────────

@app.route('/api/tasks/reorder', methods=['POST'])
def reorder_tasks():
    """Body: [{id, order, day}, ...]"""
    body = request.get_json(force=True)
    if not isinstance(body, list):
        return jsonify({'error': 'expected array'}), 400

    tasks = load_tasks()
    for item in body:
        task = get_task_by_id(tasks, item.get('id', ''))
        if task is None:
            continue
        new_day = item.get('day')
        if new_day and new_day != task.get('day'):
            task['day'] = new_day
            for child_id in task.get('children', []):
                child = get_task_by_id(tasks, child_id)
                if child:
                    child['day'] = new_day
        if 'order' in item:
            task['order'] = item['order']

    save_tasks(tasks)
    return jsonify({'ok': True})


if __name__ == '__main__':
    from scheduler import start_scheduler
    start_scheduler(broadcast)
    app.run(debug=True, use_reloader=False, port=5000)
