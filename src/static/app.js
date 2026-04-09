'use strict';
/* ═══════════════════════════════════════════════════════════════
   极简周计划 — Frontend Logic
   ═══════════════════════════════════════════════════════════════ */

// ── Constants ──────────────────────────────────────────────────────
const WEEKDAYS_EN  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const WEEKDAYS_CN  = ['周一','周二','周三','周四','周五','周六','周日'];
const COLOR_MAP    = { blue:'#4A90D9', green:'#52B788', red:'#E8524A', yellow:'#F5A623', purple:'#9B59B6' };
const SAVE_DELAY   = 600;
const DELETE_GRACE = 5000;

// ── State ──────────────────────────────────────────────────────────
const state = {
  weekStart:      readHashWeek(),
  tasks:          [],
  modalTaskId:    null,
  inlineDay:      null,
  pendingDeletes: new Map(),
};

// Drag state (module-level, not inside `state` to avoid JSON clone issues)
let drag = { taskId: null, sourceDay: null, indicatorEl: null };

// Context-menu target
let ctxTaskId = null;

// ── URL hash ───────────────────────────────────────────────────────
function readHashWeek() {
  const m = location.hash.match(/#week=(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : getThisMonday();
}

function writeHashWeek(ws) {
  history.replaceState(null, '', `#week=${ws}`);
}

// ── Utility ────────────────────────────────────────────────────────
function getThisMonday() {
  const d = new Date();
  const dow = d.getDay() || 7;
  d.setDate(d.getDate() - dow + 1);
  return toDateStr(d);
}
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDays(s, n) {
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}
function todayStr()    { return toDateStr(new Date()); }
function dayIndex(s)   { return (new Date(s + 'T00:00:00').getDay() + 6) % 7; }
function formatDateLabel(s) {
  const d = new Date(s + 'T00:00:00');
  return `${d.getMonth() + 1}月${d.getDate()}日  ${WEEKDAYS_CN[dayIndex(s)]}`;
}
function getTask(id)       { return state.tasks.find(t => t.id === id); }
function getChildren(pid)  { return state.tasks.filter(t => t.parent_id === pid).sort((a, b) => a.order - b.order); }
function getRootTasks(day) { return state.tasks.filter(t => t.day === day && !t.parent_id).sort((a, b) => a.order - b.order); }

// ── Collapse state (localStorage) ─────────────────────────────────
function getCollapseMap() {
  try { return JSON.parse(localStorage.getItem('collapse_done') || '{}'); } catch { return {}; }
}
function setCollapse(day, collapsed) {
  const m = getCollapseMap();
  m[day] = collapsed;
  localStorage.setItem('collapse_done', JSON.stringify(m));
}
function isDoneCollapsed(day) {
  const m = getCollapseMap();
  return day in m ? m[day] : true; // default: collapsed
}

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
  getTasks(ws)          { return this.call('GET', `/api/tasks?week_start=${ws}`); },
  createTask(data)      { return this.call('POST', '/api/tasks', data); },
  updateTask(id, data)  { return this.call('PUT', `/api/tasks/${id}`, data); },
  deleteTask(id)        { return this.call('DELETE', `/api/tasks/${id}`); },
  createSubtask(id, t)  { return this.call('POST', `/api/tasks/${id}/subtasks`, { title: t }); },
  reorder(items)        { return this.call('POST', '/api/tasks/reorder', items); },
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
  } catch (e) { showToast('加载失败：' + e.message, true); }
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
  const grid  = document.getElementById('week-grid');
  grid.innerHTML = '';
  const today = todayStr();

  for (let i = 0; i < 5; i++) {
    const day = addDays(state.weekStart, i);
    grid.appendChild(buildDayCol(day, day === today));
  }

  const wknd = document.createElement('div');
  wknd.className = 'weekend-col';
  wknd.appendChild(buildDayCol(addDays(state.weekStart, 5), addDays(state.weekStart, 5) === today));
  wknd.appendChild(buildDayCol(addDays(state.weekStart, 6), addDays(state.weekStart, 6) === today));
  grid.appendChild(wknd);
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

  // Split tasks into active and done
  const all    = getRootTasks(day);
  const active = all.filter(t => !t.done);
  const done   = all.filter(t => t.done);

  // Task list (active tasks + inline input)
  const list = document.createElement('div');
  list.className = 'task-list';
  list.dataset.day = day;
  active.forEach(t => list.appendChild(buildTaskItem(t)));
  if (state.inlineDay === day) list.appendChild(buildInlineInput(day));
  col.appendChild(list);

  // Completed-tasks section
  if (done.length > 0) {
    col.appendChild(buildDoneSection(day, done));
  }

  return col;
}

function buildDoneSection(day, doneTasks) {
  const collapsed = isDoneCollapsed(day);
  const section   = document.createElement('div');
  section.className = 'done-section';

  const toggle = document.createElement('div');
  toggle.className = 'done-toggle' + (collapsed ? '' : ' is-open');
  toggle.dataset.day = day;
  toggle.innerHTML = `<span>已完成 ${doneTasks.length} 项</span>
                      <span class="done-toggle-arrow">▲</span>`;
  section.appendChild(toggle);

  const wrapper = document.createElement('div');
  wrapper.className = 'done-list-wrapper' + (collapsed ? '' : ' is-open');
  const inner = document.createElement('div');
  inner.className = 'done-list-inner';

  const doneList = document.createElement('div');
  doneList.className = 'task-list';
  doneList.dataset.day = day;
  doneTasks.forEach(t => doneList.appendChild(buildTaskItem(t)));
  inner.appendChild(doneList);
  wrapper.appendChild(inner);
  section.appendChild(wrapper);

  return section;
}

// ── Task item ──────────────────────────────────────────────────────
function buildTaskItem(task) {
  const children = getChildren(task.id);
  const allDone  = children.length > 0 && children.every(c => c.done);
  const someDone = children.length > 0 && children.some(c => c.done) && !allDone;

  const item = document.createElement('div');
  item.className = 'task-item' + (task.done ? ' is-done' : '');
  item.dataset.id = task.id;
  item.draggable  = !task.parent_id; // only root tasks are draggable

  const row = document.createElement('div');
  row.className = 'task-row';

  // Priority dot
  if (task.priority && task.priority !== 'normal') {
    const dot = document.createElement('span');
    dot.className = 'task-priority-dot';
    dot.dataset.priority = task.priority;
    row.appendChild(dot);
  }

  // Title (with optional color pill)
  const title = document.createElement('span');
  title.className = 'task-title';
  title.dataset.action = 'open-modal';
  if (task.color) {
    const pill = document.createElement('span');
    pill.className = 'task-title-pill';
    pill.dataset.color = task.color;
    pill.dataset.action = 'open-modal';
    pill.textContent = task.title;
    title.appendChild(pill);
  } else {
    title.textContent = task.title;
  }
  row.appendChild(title);

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'task-actions';
  actions.appendChild(makeActionBtn('reminder', svgBell(), '设置提醒'));
  if (!task.parent_id) {
    actions.appendChild(makeActionBtn('add-sub', svgPlus(), '添加子任务'));
  }
  actions.appendChild(makeActionBtn('delete', svgTrash(), '删除', 'btn-action--delete'));
  row.appendChild(actions);

  // Checkbox
  const check = document.createElement('input');
  check.type    = 'checkbox';
  check.checked = task.done;
  check.dataset.id = task.id;
  if (children.length > 0) {
    check.className = 'task-check task-check--parent' + (someDone ? ' task-check--partial' : '');
    check.disabled  = true;
    if (allDone) { check.checked = true; check.classList.remove('task-check--partial'); }
  } else {
    check.className = 'task-check';
  }
  row.appendChild(check);
  item.appendChild(row);

  // Subtask expand wrapper
  if (children.length > 0) {
    const wrapper = document.createElement('div');
    wrapper.className = 'subtask-wrapper';
    const inner = document.createElement('div');
    inner.className = 'subtask-inner';
    const subList = document.createElement('div');
    subList.className = 'subtask-list';
    children.forEach(c => subList.appendChild(buildSubtaskItem(c)));
    inner.appendChild(subList);
    wrapper.appendChild(inner);
    item.appendChild(wrapper);
  }

  return item;
}

function buildSubtaskItem(task) {
  const item = document.createElement('div');
  item.className = 'task-item subtask-item' + (task.done ? ' is-done' : '');
  item.dataset.id = task.id;

  const row = document.createElement('div');
  row.className = 'task-row';

  if (task.priority && task.priority !== 'normal') {
    const dot = document.createElement('span');
    dot.className = 'task-priority-dot';
    dot.dataset.priority = task.priority;
    row.appendChild(dot);
  }

  const title = document.createElement('span');
  title.className = 'task-title';
  title.textContent = task.title;
  title.dataset.action = 'open-modal';
  row.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'task-actions';
  actions.appendChild(makeActionBtn('delete', svgTrash(), '删除', 'btn-action--delete'));
  row.appendChild(actions);

  const check = document.createElement('input');
  check.type = 'checkbox'; check.className = 'task-check';
  check.checked = task.done; check.dataset.id = task.id;
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

// SVG helpers
function svgBell()  { return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2a5 5 0 0 1 5 5v2l1 2H2l1-2V7a5 5 0 0 1 5-5z"/><path d="M6.5 13.5a1.5 1.5 0 0 0 3 0"/></svg>`; }
function svgPlus()  { return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>`; }
function svgTrash() { return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M6 4V2h4v2M5 4l.5 9h5L11 4"/></svg>`; }

// ── Inline input ───────────────────────────────────────────────────
function buildInlineInput(day) {
  const row   = document.createElement('div');
  row.className = 'inline-input-row';
  const input = document.createElement('input');
  input.className = 'inline-input';
  input.placeholder = '新任务名称…';
  input.type = 'text'; input.autocomplete = 'off';
  row.appendChild(input);
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
    setTimeout(() => {
      if (state.inlineDay === day && document.activeElement !== input) cancelInlineInput();
    }, 150);
  });
  return row;
}

function showInlineInput(day) {
  if (state.inlineDay === day) return;
  state.inlineDay = day;
  renderGrid();
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
  } catch (e) { showToast('创建失败：' + e.message, true); await loadWeek(true); }
}

// ── Toggle done ────────────────────────────────────────────────────
async function toggleDone(taskId, done) {
  const task = getTask(taskId);
  if (!task) return;
  task.done = done;
  if (task.parent_id) {
    const sibs = getChildren(task.parent_id);
    const par  = getTask(task.parent_id);
    if (par) par.done = sibs.every(s => s.done);
  }
  renderGrid();
  try {
    const res = await api.updateTask(taskId, { done });
    // If server spawned a recurring next task, add it to local state
    if (res && res.next_task) {
      state.tasks.push(res.next_task);
    }
    // Re-sync the actual task from server response
    if (res && res.task) {
      const idx = state.tasks.findIndex(t => t.id === taskId);
      if (idx !== -1) state.tasks[idx] = res.task;
    }
    await loadWeek(state.modalTaskId != null);
  } catch (e) { showToast('更新失败', true); await loadWeek(true); }
}

// ── Priority ───────────────────────────────────────────────────────
async function setPriority(taskId, priority) {
  const task = getTask(taskId);
  if (!task) return;
  task.priority = priority;
  renderGrid();
  if (state.modalTaskId === taskId) {
    document.querySelectorAll('.priority-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.priority === priority));
  }
  try {
    await api.updateTask(taskId, { priority });
  } catch (e) { showToast('设置失败', true); await loadWeek(true); }
}

// ── Delete with undo ───────────────────────────────────────────────
async function deleteTask(taskId) {
  const task = getTask(taskId);
  if (!task) return;

  // Ask scope for recurring instances
  let scope = 'single';
  if (task.recurring_origin) {
    scope = await showRecurScopeDialog('如何删除这个循环任务？');
    if (scope === null) return; // cancelled
  }

  if (state.pendingDeletes.has(taskId)) {
    const prev = state.pendingDeletes.get(taskId);
    clearTimeout(prev.timer);
    prev.toastEl?.remove();
  }

  // "Future" scope: remove all instances of same origin from this day onward
  if (scope === 'future' && task.recurring_origin) {
    const originId = task.recurring_origin;
    const fromDay  = task.day;
    state.tasks = state.tasks.filter(t =>
      !(t.recurring_origin === originId && t.day >= fromDay));
    if (state.modalTaskId === taskId) closeModal();
    renderGrid();
    try { await api.call('DELETE', `/api/tasks/${taskId}?scope=future`); }
    catch { showToast('删除失败', true); await loadWeek(true); }
    return;
  }

  if (state.pendingDeletes.has(taskId)) {
    const prev = state.pendingDeletes.get(taskId);
    clearTimeout(prev.timer);
    prev.toastEl?.remove();
  }

  const toRemove = new Set();
  (function collect(id) {
    toRemove.add(id);
    getChildren(id).forEach(c => collect(c.id));
  })(taskId);

  const snapshot = [...state.tasks];
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
    snapshot, toastEl: toast,
    timer: setTimeout(async () => {
      state.pendingDeletes.delete(taskId);
      try { await api.deleteTask(taskId); }
      catch { state.tasks = snapshot; renderGrid(); showToast('删除失败', true); }
    }, DELETE_GRACE),
  };
  state.pendingDeletes.set(taskId, entry);
}

// ── Drag-and-drop ──────────────────────────────────────────────────
function removeDropIndicator() {
  if (drag.indicatorEl) { drag.indicatorEl.remove(); drag.indicatorEl = null; }
}

function placeDropIndicator(referenceEl, before) {
  removeDropIndicator();
  const ind = document.createElement('div');
  ind.className = 'drop-indicator';
  drag.indicatorEl = ind;
  if (before) {
    referenceEl.closest('.task-list, .subtask-list, .done-list-inner .task-list')
      ?.insertBefore(ind, referenceEl);
  } else {
    referenceEl.closest('.task-list, .subtask-list, .done-list-inner .task-list')
      ?.insertBefore(ind, referenceEl.nextSibling);
  }
}

function placeDropIndicatorAtEnd(listEl) {
  removeDropIndicator();
  const ind = document.createElement('div');
  ind.className = 'drop-indicator';
  drag.indicatorEl = ind;
  listEl.appendChild(ind);
}

async function handleDrop(taskId, targetDay, overTaskId, insertBefore) {
  const task = getTask(taskId);
  if (!task) return;

  let targetTasks = getRootTasks(targetDay).filter(t => t.id !== taskId);
  let insertIdx;
  if (overTaskId) {
    const oi = targetTasks.findIndex(t => t.id === overTaskId);
    insertIdx = insertBefore ? Math.max(oi, 0) : oi + 1;
  } else {
    insertIdx = targetTasks.length;
  }
  targetTasks.splice(insertIdx, 0, task);

  // Collect reorder payload
  const reorderPayload = targetTasks.map((t, i) => ({ id: t.id, order: i, day: targetDay }));

  // Optimistic update
  task.day   = targetDay;
  task.order = insertIdx;
  targetTasks.forEach((t, i) => { t.order = i; });
  getChildren(task.id).forEach(c => { c.day = targetDay; });
  renderGrid();

  try {
    await api.reorder(reorderPayload);
  } catch (e) {
    showToast('排序失败', true);
    await loadWeek(true);
  }
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
  // Close sub-panels
  ['modal-color-picker','modal-recurring-picker','modal-reminder-picker'].forEach(id =>
    document.getElementById(id).classList.add('hidden'));
  document.querySelectorAll('.modal-tool-btn').forEach(b => b.classList.remove('active'));
}

function closeModal() {
  flushSave();
  state.modalTaskId = null;
  document.getElementById('modal-backdrop').classList.remove('visible');
  document.getElementById('modal').classList.remove('visible');
}

function renderModalContent(task) {
  document.getElementById('modal-date-label').textContent = formatDateLabel(task.day);
  document.getElementById('modal-title-input').value       = task.title;
  document.getElementById('modal-notes-input').value       = task.notes || '';

  // Color btn tint + swatches
  const colorBtn = document.getElementById('modal-btn-color');
  colorBtn.style.color = task.color ? COLOR_MAP[task.color] : '';
  document.querySelectorAll('.color-swatch').forEach(s =>
    s.classList.toggle('selected', s.dataset.color === (task.color || '')));

  // Recurring
  document.querySelectorAll('.recur-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.value === (task.recurring || '')));

  // Reminder
  document.getElementById('modal-reminder-input').value = task.deadline || '';

  // Priority
  document.querySelectorAll('.priority-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.priority === (task.priority || 'normal')));

  // Subtask section (hidden for subtasks)
  document.getElementById('modal-subtasks-section').style.display =
    task.parent_id ? 'none' : 'flex';
  if (!task.parent_id) renderModalSubtasks(task.id);
}

function renderModalSubtasks(parentId) {
  const list = document.getElementById('modal-subtask-list');
  list.innerHTML = '';
  getChildren(parentId).forEach(child => {
    const item = document.createElement('div');
    item.className = 'modal-subtask-item' + (child.done ? ' is-done' : '');
    item.dataset.id = child.id;

    const check = document.createElement('input');
    check.type = 'checkbox'; check.className = 'modal-subtask-check';
    check.checked = child.done;

    const t = document.createElement('span');
    t.className = 'modal-subtask-title'; t.textContent = child.title;

    const del = document.createElement('button');
    del.className = 'modal-subtask-del'; del.textContent = '✕'; del.title = '删除';

    item.appendChild(check); item.appendChild(t); item.appendChild(del);
    list.appendChild(item);
  });
}

// Auto-save
let _pendingSaveData = {};
function scheduleSave(field, value) {
  _pendingSaveData[field] = value;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(flushSave, SAVE_DELAY);
}

async function flushSave() {
  clearTimeout(_saveTimer);
  const id = state.modalTaskId;
  if (!id || Object.keys(_pendingSaveData).length === 0) return;
  const payload = { ..._pendingSaveData };
  _pendingSaveData = {};
  if ('title' in payload && !payload.title.trim()) return;
  try {
    const res = await api.updateTask(id, payload);
    const t = getTask(id);
    if (t && res && res.task) Object.assign(t, res.task);
    else if (t) Object.assign(t, payload);
    renderGrid();
  } catch (e) { showToast('保存失败', true); }
}

// ── Modal sub-pickers ──────────────────────────────────────────────
function togglePicker(pickerId, btnId) {
  const pickerEl = document.getElementById(pickerId);
  const isOpen   = !pickerEl.classList.contains('hidden');
  ['modal-color-picker','modal-recurring-picker','modal-reminder-picker'].forEach(p =>
    document.getElementById(p).classList.add('hidden'));
  document.querySelectorAll('.modal-tool-btn').forEach(b => b.classList.remove('active'));
  if (!isOpen) {
    pickerEl.classList.remove('hidden');
    document.getElementById(btnId).classList.add('active');
  }
}

async function setColor(color) {
  const id = state.modalTaskId; if (!id) return;
  const task = getTask(id); if (!task) return;
  task.color = color || null;
  renderModalContent(task); renderGrid();
  try { await api.updateTask(id, { color: color || null }); }
  catch (e) { showToast('颜色设置失败', true); }
}

async function setRecurring(value) {
  const id = state.modalTaskId; if (!id) return;
  const task = getTask(id); if (!task) return;

  let scope = 'single';
  if (task.recurring_origin) {
    scope = await showRecurScopeDialog('如何修改这个循环任务？');
    if (scope === null) return; // cancelled
  }

  task.recurring = value || null;
  document.querySelectorAll('.recur-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.value === value));
  try {
    await api.updateTask(id, { recurring: value || null, scope });
    await loadWeek(true);
  }
  catch (e) { showToast('循环设置失败', true); }
}

async function setReminder(deadline) {
  const id = state.modalTaskId; if (!id) return;
  const task = getTask(id); if (!task) return;
  task.deadline = deadline || null;
  task.reminded = false;
  try { await api.updateTask(id, { deadline: deadline || null, reminded: false }); }
  catch (e) { showToast('提醒设置失败', true); }
}

// ── Recurring scope dialog ─────────────────────────────────────────
function showRecurScopeDialog(msg) {
  return new Promise(resolve => {
    document.getElementById('recur-scope-msg').textContent = msg;
    document.getElementById('recur-scope-dialog').classList.add('visible');
    document.getElementById('recur-scope-backdrop').classList.add('visible');

    function close(val) {
      document.getElementById('recur-scope-dialog').classList.remove('visible');
      document.getElementById('recur-scope-backdrop').classList.remove('visible');
      resolve(val);
    }

    document.getElementById('recur-scope-single').onclick  = () => close('single');
    document.getElementById('recur-scope-future').onclick  = () => close('future');
    document.getElementById('recur-scope-cancel').onclick  = () => close(null);
    document.getElementById('recur-scope-backdrop').onclick = () => close(null);
  });
}

// ── Context menu ───────────────────────────────────────────────────
function showContextMenu(x, y, taskId) {
  ctxTaskId = taskId;
  const menu = document.getElementById('context-menu');
  // Highlight current priority
  const task = getTask(taskId);
  menu.querySelectorAll('.ctx-item').forEach(i =>
    i.classList.toggle('active', i.dataset.priority === (task?.priority || 'normal')));
  // Position (keep on screen)
  menu.style.left = Math.min(x, window.innerWidth  - 120) + 'px';
  menu.style.top  = Math.min(y, window.innerHeight - 120) + 'px';
  menu.classList.add('visible');
}

function hideContextMenu() {
  document.getElementById('context-menu').classList.remove('visible');
  ctxTaskId = null;
}

// ── SSE + Reminder cards ───────────────────────────────────────────
function connectSSE() {
  const es = new EventSource('/api/stream');
  es.addEventListener('reminder', e => {
    const data = JSON.parse(e.data);
    showReminderCard(data);
    triggerBrowserNotification(data);
  });
  es.onerror = () => setTimeout(connectSSE, 5000);
}

function showReminderCard(data) {
  const container = document.getElementById('reminder-container');
  const card = document.createElement('div');
  card.className = 'reminder-card';

  const time = data.timestamp ? data.timestamp.slice(11, 16) : '';
  card.innerHTML = `
    <div class="reminder-card-header">
      <span class="reminder-icon">⏰</span>
      <span class="reminder-label">任务提醒</span>
      <button class="reminder-close" title="关闭">✕</button>
    </div>
    <div class="reminder-card-body">
      <div class="reminder-task-name">${escHtml(data.title)}</div>
      <div class="reminder-task-time">${time}</div>
    </div>`;

  card.querySelector('.reminder-close').addEventListener('click', () => dismissCard(card));
  container.appendChild(card);

  // Auto-dismiss after 10 s
  setTimeout(() => dismissCard(card), 10000);
}

function dismissCard(card) {
  card.style.animation = 'slideOutRight 200ms ease forwards';
  setTimeout(() => card.remove(), 200);
}

// ── Browser notifications ──────────────────────────────────────────
async function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

function triggerBrowserNotification(data) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const time = data.timestamp ? data.timestamp.slice(11, 16) : '';
  new Notification('⏰ 任务提醒', {
    body: `${data.title}${time ? '  ' + time : ''}`,
    icon: '/static/favicon.ico',
  });
}

// ── Week navigation ────────────────────────────────────────────────
function navWeek(delta) {
  state.weekStart = addDays(state.weekStart, delta);
  writeHashWeek(state.weekStart);
  loadWeek();
}

// ── Toast ──────────────────────────────────────────────────────────
function showToast(msg, isError = false) {
  const c     = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast' + (isError ? ' is-error' : '');
  toast.textContent = msg;
  c.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 200ms ease forwards';
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

function showUndoToast(msg, onUndo) {
  const c     = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  const text = document.createElement('span');
  text.textContent = msg;
  const btn  = document.createElement('button');
  btn.className = 'toast-undo'; btn.textContent = '撤销';
  toast.appendChild(text); toast.appendChild(btn);
  c.appendChild(toast);
  btn.addEventListener('click', () => { toast.remove(); onUndo(); });
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = 'toastOut 200ms ease forwards';
      setTimeout(() => toast.remove(), 200);
    }
  }, DELETE_GRACE);
  return toast;
}

// Escape HTML for use in innerHTML
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Event delegation setup ─────────────────────────────────────────
function setupEvents() {
  const grid = document.getElementById('week-grid');

  // ── Click delegation
  grid.addEventListener('click', e => {
    // Prevent inline input opening when clicking elsewhere while modal is open
    if (state.modalTaskId) return;

    const taskItem  = e.target.closest('.task-item');
    const taskList  = e.target.closest('.task-list');
    const actionBtn = e.target.closest('.btn-action');

    if (e.target.dataset.action === 'open-modal' && taskItem) {
      openModal(taskItem.dataset.id); return;
    }
    if (actionBtn && taskItem) {
      e.stopPropagation();
      const a = actionBtn.dataset.action, id = taskItem.dataset.id;
      if (a === 'delete')  { deleteTask(id); return; }
      if (a === 'add-sub') { openModal(id);  return; }
      if (a === 'reminder') {
        openModal(id);
        setTimeout(() => document.getElementById('modal-btn-reminder').click(), 50);
        return;
      }
    }
    // Done-section toggle
    const doneToggle = e.target.closest('.done-toggle');
    if (doneToggle) {
      const day = doneToggle.dataset.day;
      const wasCollapsed = isDoneCollapsed(day);
      setCollapse(day, !wasCollapsed);
      doneToggle.classList.toggle('is-open', wasCollapsed);
      doneToggle.nextElementSibling?.classList.toggle('is-open', wasCollapsed);
      return;
    }
    // Empty task-list area → new task input
    if (taskList && !taskItem && !e.target.closest('.inline-input-row')) {
      showInlineInput(taskList.dataset.day);
    }
  });

  // ── Checkbox changes
  grid.addEventListener('change', e => {
    if (e.target.classList.contains('task-check') && !e.target.disabled) {
      const item = e.target.closest('.task-item');
      if (item) toggleDone(item.dataset.id, e.target.checked);
    }
  });

  // ── Right-click context menu
  grid.addEventListener('contextmenu', e => {
    const taskItem = e.target.closest('.task-item');
    if (taskItem) { e.preventDefault(); showContextMenu(e.clientX, e.clientY, taskItem.dataset.id); }
  });

  // ── Drag-and-drop
  grid.addEventListener('dragstart', e => {
    const item = e.target.closest('.task-item[draggable="true"]');
    if (!item) return;
    drag.taskId    = item.dataset.id;
    drag.sourceDay = item.closest('.task-list')?.dataset.day;
    e.dataTransfer.setData('text/plain', drag.taskId);
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => item.classList.add('is-dragging'));
  });

  grid.addEventListener('dragend', () => {
    document.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging'));
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    removeDropIndicator();
    drag = { taskId: null, sourceDay: null, indicatorEl: null };
  });

  grid.addEventListener('dragover', e => {
    if (!drag.taskId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const overItem = e.target.closest('.task-item');
    const overList = e.target.closest('.task-list');
    if (!overList) return;

    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    overList.classList.add('drag-over');

    if (overItem && overItem.dataset.id !== drag.taskId) {
      const rect = overItem.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      placeDropIndicator(overItem, before);
      drag._overTaskId    = overItem.dataset.id;
      drag._insertBefore  = before;
    } else if (!overItem) {
      placeDropIndicatorAtEnd(overList);
      drag._overTaskId   = null;
      drag._insertBefore = false;
    }
  });

  grid.addEventListener('dragleave', e => {
    if (!e.relatedTarget || !e.relatedTarget.closest('.week-grid, #week-grid')) return;
  });

  grid.addEventListener('drop', async e => {
    e.preventDefault();
    const list = e.target.closest('.task-list');
    if (!list || !drag.taskId) return;
    const targetDay = list.dataset.day;
    removeDropIndicator();
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    await handleDrop(drag.taskId, targetDay, drag._overTaskId || null, drag._insertBefore !== false);
    drag = { taskId: null, sourceDay: null, indicatorEl: null };
  });

  // ── Modal backdrop
  document.getElementById('modal-backdrop').addEventListener('click', closeModal);

  // ── Modal toolbar
  document.getElementById('modal-btn-close').addEventListener('click', closeModal);
  document.getElementById('modal-btn-delete').addEventListener('click', () => {
    if (state.modalTaskId) deleteTask(state.modalTaskId);
  });
  document.getElementById('modal-btn-color').addEventListener('click', () =>
    togglePicker('modal-color-picker', 'modal-btn-color'));
  document.getElementById('modal-btn-recurring').addEventListener('click', () =>
    togglePicker('modal-recurring-picker', 'modal-btn-recurring'));
  document.getElementById('modal-btn-reminder').addEventListener('click', () => {
    togglePicker('modal-reminder-picker', 'modal-btn-reminder');
    setTimeout(() => document.getElementById('modal-reminder-input').focus(), 50);
  });

  // ── Color swatches
  document.getElementById('modal-color-picker').addEventListener('click', e => {
    const s = e.target.closest('.color-swatch');
    if (s) setColor(s.dataset.color);
  });

  // ── Recurring
  document.getElementById('modal-recurring-picker').addEventListener('click', e => {
    const b = e.target.closest('.recur-btn');
    if (b) setRecurring(b.dataset.value);
  });

  // ── Reminder
  document.getElementById('modal-reminder-input').addEventListener('change', e =>
    setReminder(e.target.value));
  document.getElementById('modal-reminder-clear').addEventListener('click', () => {
    document.getElementById('modal-reminder-input').value = '';
    setReminder(null);
  });

  // ── Priority picker
  document.getElementById('modal-priority-row').addEventListener('click', e => {
    const b = e.target.closest('.priority-btn');
    if (b && state.modalTaskId) setPriority(state.modalTaskId, b.dataset.priority);
  });

  // ── Modal title + notes auto-save
  document.getElementById('modal-title-input').addEventListener('input', e =>
    scheduleSave('title', e.target.value.trim()));
  document.getElementById('modal-notes-input').addEventListener('input', e =>
    scheduleSave('notes', e.target.value));

  // ── Modal subtask toggle
  document.getElementById('modal-subtask-list').addEventListener('change', e => {
    if (e.target.classList.contains('modal-subtask-check')) {
      const item = e.target.closest('.modal-subtask-item');
      if (item) toggleDone(item.dataset.id, e.target.checked)
        .then(() => { if (state.modalTaskId) renderModalSubtasks(state.modalTaskId); });
    }
  });

  // ── Modal subtask delete
  document.getElementById('modal-subtask-list').addEventListener('click', e => {
    const del = e.target.closest('.modal-subtask-del');
    if (del) {
      const item = del.closest('.modal-subtask-item');
      if (item) deleteTask(item.dataset.id);
    }
  });

  // ── Modal subtask add
  document.getElementById('modal-subtask-input').addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (!val || !state.modalTaskId) return;
      e.target.value = '';
      try {
        await api.createSubtask(state.modalTaskId, val);
        await loadWeek(true);
      } catch (err) { showToast('添加失败', true); }
    }
  });

  // ── Context menu
  document.getElementById('context-menu').addEventListener('click', e => {
    const item = e.target.closest('.ctx-item');
    if (item && ctxTaskId) { setPriority(ctxTaskId, item.dataset.priority); hideContextMenu(); }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#context-menu')) hideContextMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      hideContextMenu();
      if (state.modalTaskId) { closeModal(); return; }
      if (state.inlineDay)   { cancelInlineInput(); }
    }
  });

  // ── Week navigation
  document.getElementById('btn-prev').addEventListener('click',  () => navWeek(-7));
  document.getElementById('btn-next').addEventListener('click',  () => navWeek( 7));
  document.getElementById('btn-today').addEventListener('click', () => {
    state.weekStart = getThisMonday();
    writeHashWeek(state.weekStart);
    loadWeek();
  });

  // ── Hash navigation (browser back/forward)
  window.addEventListener('hashchange', () => {
    const w = readHashWeek();
    if (w !== state.weekStart) { state.weekStart = w; loadWeek(); }
  });
}

// ── Init ───────────────────────────────────────────────────────────
async function init() {
  setupEvents();
  writeHashWeek(state.weekStart);
  await loadWeek();
  connectSSE();
  requestNotificationPermission();
}

document.addEventListener('DOMContentLoaded', init);
