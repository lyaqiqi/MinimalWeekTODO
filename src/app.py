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
    get_task_by_id,
    get_week_tasks,
    load_tasks,
    make_task,
    save_tasks,
    update_parent_done_state,
)

app = Flask(__name__, template_folder='templates', static_folder='static')

# SSE subscriber queues
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
        yield "data: {\"type\": \"connected\"}\n\n"
        try:
            while True:
                try:
                    msg = q.get(timeout=25)
                    yield msg
                except queue.Empty:
                    yield ": keep-alive\n\n"
        except GeneratorExit:
            pass
        finally:
            with _sse_lock:
                if q in _sse_clients:
                    _sse_clients.remove(q)

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
        },
    )


# ── GET /api/tasks ────────────────────────────────────────────────────────────

@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    week_start = request.args.get('week_start')
    if not week_start:
        today = date.today()
        week_start = str(today - timedelta(days=today.weekday()))

    tasks = load_tasks()
    week_tasks = get_week_tasks(tasks, week_start)
    return jsonify(week_tasks)


# ── POST /api/tasks ───────────────────────────────────────────────────────────

@app.route('/api/tasks', methods=['POST'])
def create_task():
    body = request.get_json(force=True)
    title = (body.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'title is required'}), 400

    day = body.get('day') or str(date.today())
    parent_id = body.get('parent_id')
    priority = body.get('priority', 'normal')
    color = body.get('color')
    deadline = body.get('deadline')
    notes = body.get('notes', '')
    recurring = body.get('recurring')

    tasks = load_tasks()

    # Validate parent
    if parent_id:
        parent = get_task_by_id(tasks, parent_id)
        if parent is None:
            return jsonify({'error': 'parent not found'}), 404
        if parent.get('parent_id'):
            return jsonify({'error': 'max nesting depth is 2 levels'}), 400
        day = parent['day']  # inherit day from parent

    order = max((t['order'] for t in tasks if t.get('day') == day), default=-1) + 1
    task = make_task(title, day, parent_id=parent_id, priority=priority,
                     color=color, deadline=deadline, notes=notes,
                     recurring=recurring, order=order)

    if parent_id:
        parent = get_task_by_id(tasks, parent_id)
        parent['children'].append(task['id'])

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

    # Parent tasks: done state is read-only (driven by children)
    if task.get('children') and 'done' in body:
        return jsonify({'error': 'parent done state is driven by its children'}), 400

    updatable = ['title', 'done', 'deadline', 'priority', 'color', 'notes', 'order', 'reminded', 'recurring']
    for field in updatable:
        if field in body:
            task[field] = body[field]

    # If a child task was just toggled, update parent
    if 'done' in body and task.get('parent_id'):
        update_parent_done_state(tasks, task['parent_id'])

    save_tasks(tasks)
    return jsonify(task)


# ── DELETE /api/tasks/<id> ────────────────────────────────────────────────────

@app.route('/api/tasks/<task_id>', methods=['DELETE'])
def delete_task(task_id):
    tasks = load_tasks()
    if get_task_by_id(tasks, task_id) is None:
        return jsonify({'error': 'task not found'}), 404

    tasks = delete_task_recursive(tasks, task_id)
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

    order = len(parent['children'])
    subtask = make_task(title, parent['day'], parent_id=task_id, order=order)
    parent['children'].append(subtask['id'])
    tasks.append(subtask)
    save_tasks(tasks)
    return jsonify(subtask), 201


if __name__ == '__main__':
    from scheduler import start_scheduler
    start_scheduler(broadcast)
    app.run(debug=True, use_reloader=False, port=5000)
