"""
APScheduler — checks task deadlines every minute and broadcasts SSE reminders.
"""

from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler

_broadcast = None


def _check_deadlines():
    from supabase_client import get_db
    now = datetime.now().strftime('%Y-%m-%dT%H:%M')
    db = get_db()

    # Fetch all unreminded, undone tasks that have a deadline
    result = db.table('tasks').select('id, title, deadline, user_id') \
        .eq('reminded', False).eq('done', False).not_.is_('deadline', 'null').execute()
    tasks = result.data or []

    for task in tasks:
        deadline = task.get('deadline', '')
        if not deadline:
            continue
        if deadline[:16] <= now:
            db.table('tasks').update({'reminded': True}).eq('id', task['id']).execute()
            if _broadcast:
                _broadcast('reminder', {
                    'type':      'reminder',
                    'task_id':   task['id'],
                    'title':     task['title'],
                    'timestamp': task['deadline'],
                })


def start_scheduler(broadcast_fn):
    global _broadcast
    _broadcast = broadcast_fn

    scheduler = BackgroundScheduler()
    scheduler.add_job(_check_deadlines, 'interval', minutes=1, id='deadline_check')
    scheduler.start()
    return scheduler


if __name__ == '__main__':
    import time
    from dotenv import load_dotenv
    load_dotenv()

    def fake_broadcast(event, data):
        print(f'[SSE] event={event} data={data}')

    sched = start_scheduler(fake_broadcast)
    print('Scheduler running. Press Ctrl+C to stop.')
    try:
        while True:
            time.sleep(5)
    except KeyboardInterrupt:
        sched.shutdown()
