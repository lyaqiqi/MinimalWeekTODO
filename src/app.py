"""
Flask main application — all REST API routes + SSE stream.
"""

import json
import queue
import threading
from datetime import date, timedelta
from functools import wraps

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, Response, g, jsonify, render_template, request, stream_with_context

from ai_service import decompose_task
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


# ── Auth decorator ────────────────────────────────────────────────────────────

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Unauthorized'}), 401
        token = auth_header[7:]
        try:
            from supabase_client import get_auth
            user_resp = get_auth().auth.get_user(token)
            g.user_id = user_resp.user.id
        except Exception:
            return jsonify({'error': 'Invalid or expired token'}), 401
        return f(*args, **kwargs)
    return decorated


# ── Frontend ──────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    import os
    return render_template('index.html',
        supabase_url=os.environ.get('SUPABASE_URL', ''),
        supabase_anon_key=os.environ.get('SUPABASE_ANON_KEY', ''),
    )


# ── Auth routes ───────────────────────────────────────────────────────────────

@app.route('/api/auth/register', methods=['POST'])
def auth_register():
    body = request.get_json(force=True)
    email    = (body.get('email') or '').strip()
    password = (body.get('password') or '').strip()
    if not email or not password:
        return jsonify({'error': '请填写邮箱和密码'}), 400
    try:
        from supabase_client import get_auth
        result = get_auth().auth.sign_up({'email': email, 'password': password})
        if not result.session:
            return jsonify({'error': '注册成功，请查收确认邮件后登录'}), 200
        return jsonify({
            'access_token': result.session.access_token,
            'user_id': result.user.id,
            'email': result.user.email,
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    body = request.get_json(force=True)
    email    = (body.get('email') or '').strip()
    password = (body.get('password') or '').strip()
    if not email or not password:
        return jsonify({'error': '请填写邮箱和密码'}), 400
    try:
        from supabase_client import get_auth
        result = get_auth().auth.sign_in_with_password({'email': email, 'password': password})
        return jsonify({
            'access_token': result.session.access_token,
            'user_id': result.user.id,
            'email': result.user.email,
        })
    except Exception as e:
        return jsonify({'error': '邮箱或密码错误'}), 401


@app.route('/api/auth/logout', methods=['POST'])
@login_required
def auth_logout():
    return jsonify({'ok': True})


@app.route('/api/auth/me', methods=['GET'])
@login_required
def auth_me():
    return jsonify({'user_id': g.user_id})


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
@login_required
def get_tasks():
    week_start = request.args.get('week_start')
    if not week_start:
        today = date.today()
        week_start = str(today - timedelta(days=today.weekday()))

    tasks = load_tasks(g.user_id)
    new_instances = generate_recurring_instances(tasks, week_start)
    if new_instances:
        tasks.extend(new_instances)
        save_tasks(tasks, g.user_id)
    return jsonify(get_week_tasks(tasks, week_start))


# ── POST /api/tasks ───────────────────────────────────────────────────────────

@app.route('/api/tasks', methods=['POST'])
@login_required
def create_task():
    body = request.get_json(force=True)
    title = (body.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'title is required'}), 400

    day            = body.get('day') or str(date.today())
    parent_id      = body.get('parent_id')
    priority       = body.get('priority', 'normal')
    color          = body.get('color')
    deadline       = body.get('deadline')
    notes          = body.get('notes', '')
    recurring      = body.get('recurring')
    estimated_time = body.get('estimated_time')
    ai_group_id    = body.get('ai_group_id')

    tasks = load_tasks(g.user_id)

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
                     recurring=recurring, order=order,
                     estimated_time=estimated_time, ai_group_id=ai_group_id)

    if parent_id:
        get_task_by_id(tasks, parent_id)['children'].append(task['id'])

    tasks.append(task)
    save_tasks(tasks, g.user_id)
    return jsonify(task), 201


# ── PUT /api/tasks/<id> ───────────────────────────────────────────────────────

@app.route('/api/tasks/<task_id>', methods=['PUT'])
@login_required
def update_task(task_id):
    tasks = load_tasks(g.user_id)
    task = get_task_by_id(tasks, task_id)
    if task is None:
        return jsonify({'error': 'task not found'}), 404

    body = request.get_json(force=True)

    if task.get('children') and 'done' in body:
        return jsonify({'error': 'parent done state is driven by its children'}), 400

    scope = body.get('scope', 'single')

    if scope == 'future' and task.get('recurring_origin') and 'recurring' not in body:
        origin_id = task['recurring_origin']
        day_str   = task['day']
        future    = [t for t in tasks
                     if t.get('recurring_origin') == origin_id and t['day'] >= day_str]
        batch_fields = ['color', 'priority', 'title', 'notes', 'deadline', 'reminded', 'estimated_time']
        for ft in future:
            for field in batch_fields:
                if field in body:
                    ft[field] = body[field]
        save_tasks(tasks, g.user_id)
        return jsonify({'task': task})

    if scope == 'ai_group' and task.get('ai_group_id'):
        group_id    = task['ai_group_id']
        group_tasks = [t for t in tasks if t.get('ai_group_id') == group_id]
        for gt in group_tasks:
            for field in ['color', 'priority']:
                if field in body:
                    gt[field] = body[field]
        save_tasks(tasks, g.user_id)
        return jsonify({'task': task})

    if 'recurring' in body and task.get('recurring_origin'):
        template = get_task_by_id(tasks, task['recurring_origin'])
        if scope == 'future' and template:
            template['recurring'] = body['recurring'] or None
            origin_id = task['recurring_origin']
            day_str   = task['day']
            tasks = [t for t in tasks if not (
                t.get('recurring_origin') == origin_id and t['day'] >= day_str
            )]
            save_tasks(tasks, g.user_id)
            return jsonify({'task': template})
        else:
            task['recurring_origin'] = None

    updatable = [
        'title', 'done', 'deadline', 'priority', 'color',
        'notes', 'order', 'reminded', 'recurring', 'day', 'estimated_time',
    ]
    for field in updatable:
        if field not in body:
            continue
        if field == 'day' and body['day'] != task.get('day'):
            new_day = body['day']
            for child_id in task.get('children', []):
                child = get_task_by_id(tasks, child_id)
                if child:
                    child['day'] = new_day
        task[field] = body[field]

    if 'done' in body and task.get('parent_id'):
        update_parent_done_state(tasks, task['parent_id'])

    save_tasks(tasks, g.user_id)
    return jsonify({'task': task})


# ── DELETE /api/tasks/<id> ────────────────────────────────────────────────────

@app.route('/api/tasks/<task_id>', methods=['DELETE'])
@login_required
def delete_task(task_id):
    tasks = load_tasks(g.user_id)
    task = get_task_by_id(tasks, task_id)
    if task is None:
        return jsonify({'error': 'task not found'}), 404

    scope = request.args.get('scope', 'single')

    if scope == 'ai_group' and task.get('ai_group_id'):
        group_id   = task['ai_group_id']
        root_tasks = [t for t in tasks
                      if t.get('ai_group_id') == group_id and not t.get('parent_id')]
        for rt in root_tasks:
            tasks = delete_task_recursive(tasks, rt['id'])
        save_tasks(tasks, g.user_id)
        return jsonify({'deleted': task_id})

    if scope == 'future' and task.get('parent_id') and not task.get('recurring_origin'):
        parent_task = get_task_by_id(tasks, task['parent_id'])
        if parent_task and parent_task.get('recurring_origin'):
            origin_id   = parent_task['recurring_origin']
            day_str     = parent_task['day']
            future_pars = [t for t in tasks
                           if t.get('recurring_origin') == origin_id and t['day'] > day_str]
            for fp in future_pars:
                matching = [t for t in tasks
                            if t.get('parent_id') == fp['id'] and t.get('title') == task['title']]
                for m in matching:
                    tasks = delete_task_recursive(tasks, m['id'])
        tasks = delete_task_recursive(tasks, task_id)
        save_tasks(tasks, g.user_id)
        return jsonify({'deleted': task_id})

    if task.get('recurring_origin'):
        template_id = task['recurring_origin']
        template = get_task_by_id(tasks, template_id)
        if scope == 'future':
            if template:
                from datetime import date as _date, timedelta as _td
                try:
                    end = _date.fromisoformat(task['day']) - _td(days=1)
                    template['recurring_end'] = str(end)
                except ValueError:
                    pass
            tasks = [t for t in tasks if not (
                t.get('recurring_origin') == template_id and t['day'] >= task['day']
            )]
        else:
            if template:
                deleted_dates = list(template.get('deleted_dates') or [])
                if task['day'] not in deleted_dates:
                    deleted_dates.append(task['day'])
                template['deleted_dates'] = deleted_dates
            tasks = [t for t in tasks if t['id'] != task_id]
    else:
        tasks = delete_task_recursive(tasks, task_id)
        if task.get('recurring') and not task.get('recurring_origin'):
            tasks = [t for t in tasks if t.get('recurring_origin') != task_id]

    save_tasks(tasks, g.user_id)
    return jsonify({'deleted': task_id})


# ── POST /api/tasks/<id>/subtasks ─────────────────────────────────────────────

@app.route('/api/tasks/<task_id>/subtasks', methods=['POST'])
@login_required
def create_subtask(task_id):
    tasks = load_tasks(g.user_id)
    parent = get_task_by_id(tasks, task_id)
    if parent is None:
        return jsonify({'error': 'parent not found'}), 404
    if parent.get('parent_id'):
        return jsonify({'error': 'max nesting depth is 2 levels'}), 400

    body = request.get_json(force=True)
    title = (body.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'title is required'}), 400

    scope = body.get('scope', 'single')

    subtask = make_task(title, parent['day'], parent_id=task_id, order=len(parent['children']))
    parent['children'].append(subtask['id'])
    tasks.append(subtask)

    if scope == 'future' and parent.get('recurring_origin'):
        origin_id   = parent['recurring_origin']
        day_str     = parent['day']
        future_pars = [t for t in tasks
                       if t.get('recurring_origin') == origin_id and t['day'] > day_str]
        for fp in future_pars:
            fs = make_task(title, fp['day'], parent_id=fp['id'], order=len(fp['children']))
            fp['children'].append(fs['id'])
            tasks.append(fs)

    save_tasks(tasks, g.user_id)
    return jsonify(subtask), 201


# ── POST /api/tasks/reorder ───────────────────────────────────────────────────

@app.route('/api/tasks/reorder', methods=['POST'])
@login_required
def reorder_tasks():
    body = request.get_json(force=True)
    if not isinstance(body, list):
        return jsonify({'error': 'expected array'}), 400

    tasks = load_tasks(g.user_id)
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

    save_tasks(tasks, g.user_id)
    return jsonify({'ok': True})


# ── GET /api/tasks/all ───────────────────────────────────────────────────────

@app.route('/api/tasks/all', methods=['GET'])
@login_required
def get_all_tasks():
    tasks = load_tasks(g.user_id)
    tasks.sort(key=lambda t: (t.get('day', ''), t.get('order', 0)))
    return jsonify(tasks)


# ── POST /api/ai/decompose ───────────────────────────────────────────────────

@app.route('/api/ai/decompose', methods=['POST'])
@login_required
def api_decompose_task():
    body = request.get_json(force=True)
    task_title = (body.get('task_title') or '').strip()
    context    = (body.get('context')    or '').strip()

    if not task_title:
        return jsonify({'success': False, 'error': '请输入任务标题'})

    result = decompose_task(task_title, context)
    return jsonify(result)


if __name__ == '__main__':
    from scheduler import start_scheduler
    start_scheduler(broadcast)
    app.run(debug=True, use_reloader=False, port=5000)
