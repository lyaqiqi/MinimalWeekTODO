"""
APScheduler — checks task deadlines every minute and broadcasts SSE reminders.
"""

from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler

from models import load_tasks, save_tasks


def _broadcast_fn_ref():
    """Indirection wrapper — replaced at startup."""
    pass


_broadcast = None


def _check_deadlines():
    now = datetime.now().strftime('%Y-%m-%dT%H:%M')
    tasks = load_tasks()
    changed = False

    for task in tasks:
        deadline = task.get('deadline')
        if not deadline or task.get('reminded') or task.get('done'):
            continue
        # Fire for exact minute OR any overdue deadline not yet reminded
        if deadline[:16] <= now:
            task['reminded'] = True
            changed = True
            if _broadcast:
                _broadcast('reminder', {
                    'type':      'reminder',
                    'task_id':   task['id'],
                    'title':     task['title'],
                    'timestamp': task['deadline'],
                })

    if changed:
        save_tasks(tasks)


def start_scheduler(broadcast_fn):
    global _broadcast
    _broadcast = broadcast_fn

    scheduler = BackgroundScheduler()
    scheduler.add_job(_check_deadlines, 'interval', minutes=1, id='deadline_check')
    scheduler.start()
    return scheduler


if __name__ == '__main__':
    import time

    def fake_broadcast(event, data):
        print(f'[SSE] event={event} data={data}')

    sched = start_scheduler(fake_broadcast)
    print('Scheduler running. Press Ctrl+C to stop.')
    try:
        while True:
            time.sleep(5)
    except KeyboardInterrupt:
        sched.shutdown()
