"""
APScheduler — checks task deadlines every minute and broadcasts SSE reminders.
"""

from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler

from models import load_tasks, save_tasks, get_task_by_id

_broadcast_fn = None


def _check_deadlines():
    now = datetime.now().strftime('%Y-%m-%dT%H:%M')
    tasks = load_tasks()
    changed = False

    for task in tasks:
        deadline = task.get('deadline')
        if deadline and not task.get('reminded') and not task.get('done'):
            # Compare up to the minute
            if deadline[:16] == now:
                task['reminded'] = True
                changed = True
                if _broadcast_fn:
                    _broadcast_fn('reminder', {
                        'id': task['id'],
                        'title': task['title'],
                        'deadline': deadline,
                        'day': task['day'],
                    })

    if changed:
        save_tasks(tasks)


def start_scheduler(broadcast_fn):
    global _broadcast_fn
    _broadcast_fn = broadcast_fn

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
