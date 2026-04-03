'use strict';
/* ═══════════════════════════════════════════════════════════════
   极简周计划 — Frontend Logic
   ═══════════════════════════════════════════════════════════════ */

// ── Constants ──────────────────────────────────────────────────────
const WEEKDAYS_EN  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const WEEKDAYS_CN  = ['周一','周二','周三','周四','周五','周六','周日'];
const COLOR_MAP    = { blue:'#4A90D9', green:'#52B788', red:'#E8524A', yellow:'#F5A623', purple:'#9B59B6' };
const SAVE_DELAY   = 600; // ms debounce for title/notes auto-save
const DELETE_GRACE = 5000; // ms undo window

// ── State ──────────────────────────────────────────────────────────
const state = {
  weekStart:      getThisMonday(),
  tasks:          [],       // flat array, all tasks for current week
  modalTaskId:    null,
  inlineDay:      null,     // day currently showing inline input
  pendingDeletes: new Map(),// id → { tasks_snapshot, timer, toastEl }
};

// ── Utility ────────────────────────────────────────────────────────
function getThisMonday() {
  const d = new Date();
  const dow = d.getDay() || 7;
  d.setDate(d.getDate() - dow + 1);
  return toDateStr(d);
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function todayStr() { return toDateStr(new Date()); }

function dayIndex(dateStr) {
  // 0=Mon … 6=Sun
  const d = new Date(dateStr + 'T00:00:00');
  return (d.getDay() + 6) % 7;
}

function formatDateLabel(dateStr) {
  const d  = new Date(dateStr + 'T00:00:00');
  const wi = dayIndex(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日  ${WEEKDAYS_CN[wi]}`;
}

function getTask(id)       { return state.tasks.find(t => t.id === id); }
function getChildren(pid)  { return state.tasks.filter(t => t.parent_id === pid).sort((a, b) => a.order - b.order); }
function getRootTasks(day) { return state.tasks.filter(t => t.day === day && !t.parent_id).sort((a, b) => a.order - b.order); }

// ── API ────────────────────────────────────────────────────────────
const api = {
  async call(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || res.statusText);
    }
    return res.status === 204 ? null : res.json();
  },
  getTasks(weekStart)      { return this.call('GET', `/api/tasks?week_start=${weekStart}`); },
  createTask(data)         { return this.call('POST', '/api/tasks', data); },
  updateTask(id, data)     { return this.call('PUT', `/api/tasks/${id}`, data); },
  deleteTask(id)           { return this.call('DELETE', `/api/tasks/${id}`); },
  createSubtask(id, title) { return this.call('POST', `/api/tasks/${id}/subtasks`, { title }); },
};

// ── Data loading ───────────────────────────────────────────────────
async function loadWeek(keepModal = false) {
  try {
    state.tasks = await api.getTasks(state.weekStart);
    renderGrid();
    updateWeekLabel();
    if (keepModal && state.modalTaskId) {
      const t = getTask(state.modalTaskId);
      if (t) renderModalContent(t);
    }
  } catch (e) {
    showToast('加载失败：' + e.message, true);
  }
}

// ── Week header label ──────────────────────────────────────────────
function updateWeekLabel() {
  const end = addDays(state.weekStart, 6);
  const s   = new Date(state.weekStart + 'T00:00:00');
  const e   = new Date(end + 'T00:00:00');
  const fmt = d => `${d.getMonth() + 1}月${d.getDate()}日`;
  document.getElementById('week-label').textContent =
    `${s.getFullYear()}  /  ${fmt(s)} — ${fmt(e)}`;
}

// ── Grid rendering ─────────────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';
  const today = todayStr();

  // Columns 0-4: Mon-Fri
  for (let i = 0; i < 5; i++) {
    const day = addDays(state.weekStart, i);
    grid.appendChild(buildDayCol(day, day === today));
  }

  // Column 5: weekend (Sat + Sun)
  const weekendCol = document.createElement('div');
  weekendCol.className = 'weekend-col';
  const sat = addDays(state.weekStart, 5);
  const sun = addDays(state.weekStart, 6);
  weekendCol.appendChild(buildDayCol(sat, sat === today));
  weekendCol.appendChild(buildDayCol(sun, sun === today));
  grid.appendChild(weekendCol);
}

function buildDayCol(day, isToday) {
  const wi  = dayIndex(day);
  const num = new Date(day + 'T00:00:00').getDate();

  const col = document.createElement('div');
  col.className = 'day-col' + (isToday ? ' is-today' : '');
  col.dataset.day = day;

  // Header
  const header = document.createElement('div');
  header.className = 'day-header';
  header.innerHTML = `<div class="day-weekday">${WEEKDAYS_EN[wi]}</div>
                      <div class="day-num">${num}</div>`;
  col.appendChild(header);

  // Task list
  const list = document.createElement('div');
  list.className = 'task-list';
  list.dataset.day = day;

  getRootTasks(day).forEach(t => list.appendChild(buildTaskItem(t)));

  // Inline input placeholder (if active)
  if (state.inlineDay === day) {
    list.appendChild(buildInlineInput(day));
  }

  col.appendChild(list);
  return col;
}

// ── Task item ──────────────────────────────────────────────────────
function buildTaskItem(task) {
  const children = getChildren(task.id);
  const allDone  = children.length > 0 && children.every(c => c.done);

  const item = document.createElement('div');
  item.className = 'task-item' + (task.done ? ' is-done' : '');
  item.dataset.id       = task.id;
  item.dataset.priority = task.priority || 'normal';

  // ── Task row
  const row = document.createElement('div');
  row.className = 'task-row';

  // Color dot
  if (task.color) {
    const dot = document.createElement('span');
    dot.className = 'task-color-dot';
    dot.dataset.color = task.color;
    row.appendChild(dot);
  }

  // Title
  const title = document.createElement('span');
  title.className = 'task-title';
  title.textContent = task.title;
  title.dataset.action = 'open-modal';
  row.appendChild(title);

  // Action buttons (visible on hover)
  const actions = document.createElement('div');
  actions.className = 'task-actions';

  actions.appendChild(makeActionBtn('reminder', `
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M8 2a5 5 0 0 1 5 5v2l1 2H2l1-2V7a5 5 0 0 1 5-5z"/>
      <path d="M6.5 13.5a1.5 1.5 0 0 0 3 0"/>
    </svg>`, '设置提醒'));

  if (!task.parent_id) {
    actions.appendChild(makeActionBtn('add-sub', `
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/>
      </svg>`, '添加子任务'));
  }

  actions.appendChild(makeActionBtn('delete', `
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M3 4h10M6 4V2h4v2M5 4l.5 9h5L11 4"/>
    </svg>`, '删除', 'btn-action--delete'));

  row.appendChild(actions);

  // Checkbox
  const check = document.createElement('input');
  check.type      = 'checkbox';
  check.className = 'task-check' + (children.length > 0 ? ' task-check--parent' : '');
  check.checked   = task.done;
  check.dataset.id = task.id;

  if (children.length > 0) {
    check.disabled = true;
    // Show partial state if some (not all) children are done
    const someDone = children.some(c => c.done);
    if (someDone && !allDone) check.classList.add('task-check--partial');
    if (allDone) check.classList.add('task-check--partial'); // remove partial, show full
    if (allDone) { check.classList.remove('task-check--partial'); check.checked = true; }
  }

  row.appendChild(check);
  item.appendChild(row);

  // ── Subtask expand wrapper
  if (children.length > 0) {
    const wrapper = document.createElement('div');
    wrapper.className = 'subtask-wrapper';

    const inner = document.createElement('div');
    inner.className = 'subtask-inner';

    const subList = document.createElement('div');
    subList.className = 'subtask-list';
    children.forEach(child => subList.appendChild(buildSubtaskItem(child)));

    inner.appendChild(subList);
    wrapper.appendChild(inner);
    item.appendChild(wrapper);
  }

  return item;
}

function buildSubtaskItem(task) {
  const item = document.createElement('div');
  item.className = 'task-item subtask-item' + (task.done ? ' is-done' : '');
  item.dataset.id       = task.id;
  item.dataset.priority = task.priority || 'normal';

  const row = document.createElement('div');
  row.className = 'task-row';

  if (task.color) {
    const dot = document.createElement('span');
    dot.className = 'task-color-dot';
    dot.dataset.color = task.color;
    row.appendChild(dot);
  }

  const title = document.createElement('span');
  title.className = 'task-title';
  title.textContent = task.title;
  title.dataset.action = 'open-modal';
  row.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'task-actions';
  actions.appendChild(makeActionBtn('delete', `
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M3 4h10M6 4V2h4v2M5 4l.5 9h5L11 4"/>
    </svg>`, '删除', 'btn-action--delete'));
  row.appendChild(actions);

  const check = document.createElement('input');
  check.type       = 'checkbox';
  check.className  = 'task-check';
  check.checked    = task.done;
  check.dataset.id = task.id;
  row.appendChild(check);

  item.appendChild(row);
  return item;
}

function makeActionBtn(action, svgHtml, title, extraClass = '') {
  const btn = document.createElement('button');
  btn.className = 'btn-action ' + extraClass;
  btn.dataset.action = action;
  btn.title = title;
  btn.innerHTML = svgHtml;
  return btn;
}

// ── Inline input ───────────────────────────────────────────────────
function buildInlineInput(day) {
  const row = document.createElement('div');
  row.className = 'inline-input-row';

  const input = document.createElement('input');
  input.className   = 'inline-input';
  input.placeholder = '新任务名称…';
  input.type        = 'text';
  input.autocomplete = 'off';
  row.appendChild(input);

  // Must focus AFTER appended to DOM — see callers
  requestAnimationFrame(() => input.focus());

  input.addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      const title = input.value.trim();
      if (!title) { cancelInlineInput(); return; }
      await submitNewTask(day, title);
    }
    if (e.key === 'Escape') cancelInlineInput();
  });

  input.addEventListener('blur', () => {
    // Small delay so click events on task-list fire first
    setTimeout(() => {
      if (state.inlineDay === day && document.activeElement !== input) {
        cancelInlineInput();
      }
    }, 150);
  });

  return row;
}

function showInlineInput(day) {
  if (state.inlineDay === day) return;
  state.inlineDay = day;
  renderGrid();
  // Focus is handled inside buildInlineInput via requestAnimationFrame
}

function cancelInlineInput() {
  if (!state.inlineDay) return;
  state.inlineDay = null;
  renderGrid();
}

async function submitNewTask(day, title) {
  state.inlineDay = null;
  try {
    await api.createTask({ title, day });
    await loadWeek(true);
  } catch (e) {
    showToast('创建失败：' + e.message, true);
    await loadWeek(true);
  }
}

// ── Toggle done ────────────────────────────────────────────────────
async function toggleDone(taskId, done) {
  const task = getTask(taskId);
  if (!task) return;

  // Optimistic update
  task.done = done;
  if (task.parent_id) {
    const siblings = getChildren(task.parent_id);
    const parent   = getTask(task.parent_id);
    if (parent) parent.done = siblings.every(s => s.done);
  }
  renderGrid();

  try {
    await api.updateTask(taskId, { done });
    await loadWeek(state.modalTaskId != null);
  } catch (e) {
    showToast('更新失败', true);
    await loadWeek(true);
  }
}

// ── Delete with undo ───────────────────────────────────────────────
function deleteTask(taskId) {
  const task = getTask(taskId);
  if (!task) return;

  // Cancel any existing pending delete for this id
  if (state.pendingDeletes.has(taskId)) {
    const prev = state.pendingDeletes.get(taskId);
    clearTimeout(prev.timer);
    prev.toastEl?.remove();
  }

  // Collect ids to remove (task + its children)
  const toRemove = new Set();
  function collect(id) {
    toRemove.add(id);
    getChildren(id).forEach(c => collect(c.id));
  }
  collect(taskId);

  const snapshot = [...state.tasks];

  // Optimistic removal
  state.tasks = state.tasks.filter(t => !toRemove.has(t.id));
  if (state.modalTaskId && toRemove.has(state.modalTaskId)) closeModal();
  renderGrid();

  const toast = showUndoToast(`已删除"${task.title.slice(0, 18)}"`, () => {
    clearTimeout(entry.timer);
    state.pendingDeletes.delete(taskId);
    state.tasks = snapshot;
    renderGrid();
  });

  const entry = {
    snapshot,
    toastEl: toast,
    timer: setTimeout(async () => {
      state.pendingDeletes.delete(taskId);
      try {
        await api.deleteTask(taskId);
      } catch {
        // Restore on failure
        state.tasks = snapshot;
        renderGrid();
        showToast('删除失败', true);
      }
    }, DELETE_GRACE),
  };
  state.pendingDeletes.set(taskId, entry);
}

// ── Modal ──────────────────────────────────────────────────────────
let _saveTimer = null;

function openModal(taskId) {
  const task = getTask(taskId);
  if (!task) return;
  state.modalTaskId = taskId;

  document.getElementById('modal-backdrop').classList.add('visible');
  document.getElementById('modal').classList.add('visible');
  renderModalContent(task);

  // Close open sub-panels
  ['modal-color-picker','modal-recurring-picker','modal-reminder-picker'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
  document.querySelectorAll('.modal-tool-btn').forEach(b => b.classList.remove('active'));
}

function closeModal() {
  flushSave();
  state.modalTaskId = null;
  document.getElementById('modal-backdrop').classList.remove('visible');
  document.getElementById('modal').classList.remove('visible');
}

function renderModalContent(task) {
  // Date label
  document.getElementById('modal-date-label').textContent = formatDateLabel(task.day);

  // Title
  document.getElementById('modal-title-input').value = task.title;

  // Notes
  document.getElementById('modal-notes-input').value = task.notes || '';

  // Color button tint
  const colorBtn = document.getElementById('modal-btn-color');
  colorBtn.style.color = task.color ? COLOR_MAP[task.color] : '';

  // Color swatches selected state
  document.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('selected', s.dataset.color === (task.color || ''));
  });

  // Recurring buttons
  document.querySelectorAll('.recur-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === (task.recurring || ''));
  });

  // Reminder input
  document.getElementById('modal-reminder-input').value = task.deadline || '';

  // Subtask section
  const section = document.getElementById('modal-subtasks-section');
  section.style.display = task.parent_id ? 'none' : 'flex';

  if (!task.parent_id) {
    renderModalSubtasks(task.id);
  }
}

function renderModalSubtasks(parentId) {
  const list     = document.getElementById('modal-subtask-list');
  const children = getChildren(parentId);
  list.innerHTML  = '';

  children.forEach(child => {
    const item = document.createElement('div');
    item.className = 'modal-subtask-item' + (child.done ? ' is-done' : '');
    item.dataset.id = child.id;

    const check = document.createElement('input');
    check.type      = 'checkbox';
    check.className = 'modal-subtask-check';
    check.checked   = child.done;

    const titleEl = document.createElement('span');
    titleEl.className   = 'modal-subtask-title';
    titleEl.textContent = child.title;

    const delBtn = document.createElement('button');
    delBtn.className   = 'modal-subtask-del';
    delBtn.textContent = '✕';
    delBtn.title       = '删除子任务';

    item.appendChild(check);
    item.appendChild(titleEl);
    item.appendChild(delBtn);
    list.appendChild(item);
  });
}

// ── Modal auto-save ────────────────────────────────────────────────
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(flushSave, SAVE_DELAY);
}

async function flushSave() {
  clearTimeout(_saveTimer);
  const id = state.modalTaskId;
  if (!id) return;

  const title = document.getElementById('modal-title-input').value.trim();
  const notes = document.getElementById('modal-notes-input').value;
  if (!title) return;

  try {
    await api.updateTask(id, { title, notes });
    const task = getTask(id);
    if (task) { task.title = title; task.notes = notes; }
    renderGrid();
  } catch (e) {
    showToast('保存失败', true);
  }
}

// ── Modal sub-pickers ──────────────────────────────────────────────
function togglePicker(pickerId, btnId) {
  const pickerEl = document.getElementById(pickerId);
  const allPickers = ['modal-color-picker','modal-recurring-picker','modal-reminder-picker'];
  const allBtns    = ['modal-btn-color','modal-btn-recurring','modal-btn-reminder'];

  const isOpen = !pickerEl.classList.contains('hidden');

  // Close all
  allPickers.forEach(p => document.getElementById(p).classList.add('hidden'));
  allBtns.forEach(b    => document.getElementById(b).classList.remove('active'));

  if (!isOpen) {
    pickerEl.classList.remove('hidden');
    document.getElementById(btnId).classList.add('active');
  }
}

async function setColor(color) {
  const id = state.modalTaskId;
  if (!id) return;
  try {
    await api.updateTask(id, { color: color || null });
    const task = getTask(id);
    if (task) task.color = color || null;
    renderModalContent(getTask(id));
    renderGrid();
  } catch (e) { showToast('颜色设置失败', true); }
}

async function setRecurring(value) {
  const id = state.modalTaskId;
  if (!id) return;
  try {
    await api.updateTask(id, { recurring: value || null });
    const task = getTask(id);
    if (task) task.recurring = value || null;
    document.querySelectorAll('.recur-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.value === value);
    });
  } catch (e) { showToast('循环设置失败', true); }
}

async function setReminder(deadline) {
  const id = state.modalTaskId;
  if (!id) return;
  try {
    await api.updateTask(id, { deadline: deadline || null, reminded: false });
    const task = getTask(id);
    if (task) { task.deadline = deadline || null; task.reminded = false; }
  } catch (e) { showToast('提醒设置失败', true); }
}

// ── Event delegation ───────────────────────────────────────────────
function setupEvents() {
  const grid = document.getElementById('week-grid');

  // ── Clicks on the week grid
  grid.addEventListener('click', e => {
    const taskItem = e.target.closest('.task-item');
    const taskList = e.target.closest('.task-list');

    // Open modal on task title click
    if (e.target.dataset.action === 'open-modal') {
      openModal(taskItem.dataset.id);
      return;
    }

    // Action buttons
    const actionBtn = e.target.closest('.btn-action');
    if (actionBtn && taskItem) {
      e.stopPropagation();
      const action = actionBtn.dataset.action;
      const id     = taskItem.dataset.id;
      if (action === 'delete')  { deleteTask(id); return; }
      if (action === 'add-sub') { openModal(id);  return; } // open modal to add subtask
      if (action === 'reminder'){ openModal(id);  document.getElementById('modal-btn-reminder').click(); return; }
    }

    // Click on empty area of task-list → new task input
    if (taskList && !taskItem && !e.target.closest('.inline-input-row')) {
      showInlineInput(taskList.dataset.day);
    }
  });

  // ── Checkbox changes (event delegation)
  grid.addEventListener('change', e => {
    if (e.target.classList.contains('task-check') && !e.target.disabled) {
      const taskItem = e.target.closest('.task-item');
      if (taskItem) toggleDone(taskItem.dataset.id, e.target.checked);
    }
  });

  // ── Modal backdrop click → close
  document.getElementById('modal-backdrop').addEventListener('click', closeModal);

  // ── Modal toolbar buttons
  document.getElementById('modal-btn-close').addEventListener('click', closeModal);

  document.getElementById('modal-btn-delete').addEventListener('click', () => {
    if (state.modalTaskId) { deleteTask(state.modalTaskId); }
  });

  document.getElementById('modal-btn-color').addEventListener('click', () => {
    togglePicker('modal-color-picker', 'modal-btn-color');
  });

  document.getElementById('modal-btn-recurring').addEventListener('click', () => {
    togglePicker('modal-recurring-picker', 'modal-btn-recurring');
  });

  document.getElementById('modal-btn-reminder').addEventListener('click', () => {
    togglePicker('modal-reminder-picker', 'modal-btn-reminder');
    // Focus the datetime input when opened
    setTimeout(() => document.getElementById('modal-reminder-input').focus(), 50);
  });

  // ── Color swatches
  document.getElementById('modal-color-picker').addEventListener('click', e => {
    const swatch = e.target.closest('.color-swatch');
    if (swatch) setColor(swatch.dataset.color);
  });

  // ── Recurring buttons
  document.getElementById('modal-recurring-picker').addEventListener('click', e => {
    const btn = e.target.closest('.recur-btn');
    if (btn) setRecurring(btn.dataset.value);
  });

  // ── Reminder
  document.getElementById('modal-reminder-input').addEventListener('change', e => {
    setReminder(e.target.value);
  });
  document.getElementById('modal-reminder-clear').addEventListener('click', () => {
    document.getElementById('modal-reminder-input').value = '';
    setReminder(null);
  });

  // ── Modal title & notes auto-save
  document.getElementById('modal-title-input').addEventListener('input', scheduleSave);
  document.getElementById('modal-notes-input').addEventListener('input', scheduleSave);

  // ── Modal subtask: toggle done
  document.getElementById('modal-subtask-list').addEventListener('change', e => {
    if (e.target.classList.contains('modal-subtask-check')) {
      const item = e.target.closest('.modal-subtask-item');
      if (item) {
        toggleDone(item.dataset.id, e.target.checked).then(() => {
          if (state.modalTaskId) renderModalSubtasks(state.modalTaskId);
        });
      }
    }
  });

  // ── Modal subtask: delete
  document.getElementById('modal-subtask-list').addEventListener('click', e => {
    const delBtn = e.target.closest('.modal-subtask-del');
    if (delBtn) {
      const item = delBtn.closest('.modal-subtask-item');
      if (item) deleteTask(item.dataset.id);
    }
  });

  // ── Modal subtask: add
  document.getElementById('modal-subtask-input').addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (!val || !state.modalTaskId) return;
      e.target.value = '';
      try {
        await api.createSubtask(state.modalTaskId, val);
        await loadWeek(true);
      } catch (err) { showToast('添加子任务失败', true); }
    }
  });

  // ── Week navigation buttons
  document.getElementById('btn-prev').addEventListener('click',  () => { state.weekStart = addDays(state.weekStart, -7); loadWeek(); });
  document.getElementById('btn-next').addEventListener('click',  () => { state.weekStart = addDays(state.weekStart,  7); loadWeek(); });
  document.getElementById('btn-today').addEventListener('click', () => { state.weekStart = getThisMonday(); loadWeek(); });

  // ── Global keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (state.modalTaskId) { closeModal(); return; }
      if (state.inlineDay)   { cancelInlineInput(); return; }
    }
  });
}

// ── Toast ──────────────────────────────────────────────────────────
function showToast(msg, isError = false) {
  const container = document.getElementById('toast-container');
  const toast     = document.createElement('div');
  toast.className = 'toast' + (isError ? ' is-error' : '');
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = `toastOut ${200}ms ease forwards`;
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

function showUndoToast(msg, onUndo) {
  const container = document.getElementById('toast-container');
  const toast     = document.createElement('div');
  toast.className = 'toast';

  const text = document.createElement('span');
  text.textContent = msg;

  const undoBtn = document.createElement('button');
  undoBtn.className   = 'toast-undo';
  undoBtn.textContent = '撤销';

  toast.appendChild(text);
  toast.appendChild(undoBtn);
  container.appendChild(toast);

  undoBtn.addEventListener('click', () => {
    toast.remove();
    onUndo();
  });

  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = `toastOut ${200}ms ease forwards`;
      setTimeout(() => toast.remove(), 200);
    }
  }, DELETE_GRACE);

  return toast;
}

// ── SSE ────────────────────────────────────────────────────────────
function connectSSE() {
  const es = new EventSource('/api/stream');

  es.addEventListener('reminder', e => {
    const data  = JSON.parse(e.data);
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast is-reminder';
    toast.textContent = `⏰  ${data.title}  （${data.deadline.slice(11,16)}）`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 8000);
  });

  es.onerror = () => setTimeout(connectSSE, 5000);
}

// ── Init ───────────────────────────────────────────────────────────
async function init() {
  setupEvents();
  await loadWeek();
  connectSSE();
}

document.addEventListener('DOMContentLoaded', init);
