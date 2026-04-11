'use strict';
/* ═══════════════════════════════════════════════════════════════
   极简周计划 — Frontend Logic
   ═══════════════════════════════════════════════════════════════ */

// ── Constants ──────────────────────────────────────────────────────
const WEEKDAYS_EN  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const WEEKDAYS_CN  = ['周一','周二','周三','周四','周五','周六','周日'];
// ── Color system (merges built-ins with localStorage user colors) ──
const BUILTIN_COLORS = [
  { key: 'blue',   hex: '#4A90D9', name: 'Study'    },
  { key: 'green',  hex: '#52B788', name: 'Relax'    },
  { key: 'red',    hex: '#E8524A', name: 'Urgent'   },
  { key: 'yellow', hex: '#F5A623', name: 'Focus'    },
  { key: 'purple', hex: '#9B59B6', name: 'Personal' },
];

function getUserColors() {
  try {
    const saved = localStorage.getItem('user-colors');
    if (saved) return JSON.parse(saved);
  } catch {}
  return BUILTIN_COLORS.map(c => ({ ...c }));
}

function saveUserColors(colors) {
  localStorage.setItem('user-colors', JSON.stringify(colors));
}

function getColorHex(key) {
  const c = getUserColors().find(c => c.key === key);
  return c ? c.hex : '#BBBBB6';
}

function getColorName(key) {
  const c = getUserColors().find(c => c.key === key);
  return c ? c.name : key;
}

// Inject <style> tag with color pill rules for all user colors
function injectColorStyles() {
  let el = document.getElementById('dynamic-color-styles');
  if (!el) {
    el = document.createElement('style');
    el.id = 'dynamic-color-styles';
    document.head.appendChild(el);
  }
  const colors = getUserColors();
  el.textContent = colors.map(({ key, hex }) => {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    const bg   = `rgba(${r},${g},${b},0.25)`;
    const text = hex;
    return `.task-title-pill[data-color="${key}"]{background:${bg};color:${text};}`;
  }).join('\n');
}

// Legacy alias used throughout the file
const COLOR_MAP = new Proxy({}, { get: (_, key) => getColorHex(key) });
const SAVE_DELAY   = 600;
const DELETE_GRACE = 5000;

// ── State ──────────────────────────────────────────────────────────
const state = {
  view:           'week',        // updated in init()
  weekStart:      readHashWeek(),
  tasks:          [],
  modalTaskId:    null,
  inlineDay:      null,
  pendingDeletes: new Map(),
};

// Drag state (module-level, not inside `state` to avoid JSON clone issues)
let drag = { taskId: null, sourceDay: null, indicatorEl: null };

// ── Theme management ───────────────────────────────────────────────
const _mq = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(mode) {
  const isDark = mode === 'dark' || (mode === 'system' && _mq.matches);
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

function getThemeMode() {
  return localStorage.getItem('theme-mode') || 'light';
}

function setThemeMode(mode) {
  localStorage.setItem('theme-mode', mode);
  applyTheme(mode);
  renderThemeOptions(mode);
}

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

function readView() {
  return location.hash === '#all' ? 'all' : 'week';
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
    const token = (typeof Auth !== 'undefined') ? Auth.getToken() : null;
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (res.status === 401) {
      if (typeof Auth !== 'undefined') Auth.clearToken();
      if (typeof showAuthPage === 'function') showAuthPage();
      return;
    }
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
  createSubtask(id, t, scope = 'single') { return this.call('POST', `/api/tasks/${id}/subtasks`, { title: t, scope }); },
  reorder(items)        { return this.call('POST', '/api/tasks/reorder', items); },
};

// ── Data loading ───────────────────────────────────────────────────
async function loadWeek(keepModal = false) {
  try {
    if (state.view === 'all') {
      state.tasks = await api.call('GET', '/api/tasks/all');
      renderAllTasks();
    } else {
      state.tasks = await api.getTasks(state.weekStart);
      renderGrid();
      updateWeekLabel();
    }
    if (keepModal && state.modalTaskId) {
      const t = getTask(state.modalTaskId);
      if (t) renderModalContent(t);
    }
  } catch (e) { showToast('加载失败：' + e.message, true); }
}

function renderCurrentView() {
  if (state.view === 'all') renderAllTasks();
  else renderGrid();
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
  renderCurrentView();
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

  let scope = 'single';
  if (task.recurring_origin) {
    scope = await showRecurScopeDialog('如何修改优先级？');
    if (scope === null) return;
  } else if (task.ai_group_id) {
    scope = await showScopeDialog('如何修改优先级？', '仅此任务', 'single', '同组所有任务', 'ai_group');
    if (scope === null) return;
  }

  // Optimistic update
  if (scope === 'future' && task.recurring_origin) {
    state.tasks.filter(t => t.recurring_origin === task.recurring_origin && t.day >= task.day)
      .forEach(t => { t.priority = priority; });
  } else if (scope === 'ai_group' && task.ai_group_id) {
    state.tasks.filter(t => t.ai_group_id === task.ai_group_id)
      .forEach(t => { t.priority = priority; });
  } else {
    task.priority = priority;
  }
  renderCurrentView();
  if (state.modalTaskId === taskId) {
    document.querySelectorAll('.priority-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.priority === priority));
  }
  try {
    await api.updateTask(taskId, { priority, scope });
  } catch (e) { showToast('设置失败', true); await loadWeek(true); }
}

// ── Delete with undo ───────────────────────────────────────────────
async function deleteTask(taskId) {
  const task = getTask(taskId);
  if (!task) return;

  // Ask scope
  let scope = 'single';
  if (task.recurring_origin) {
    scope = await showRecurScopeDialog('如何删除这个循环任务？');
    if (scope === null) return;
  } else if (!task.parent_id && task.ai_group_id) {
    scope = await showScopeDialog('如何删除这个任务？', '仅此任务', 'single', '删除同组所有任务', 'ai_group');
    if (scope === null) return;
  } else if (task.parent_id) {
    const parent = getTask(task.parent_id);
    if (parent?.recurring_origin) {
      scope = await showScopeDialog('如何删除这个子任务？', '仅此任务', 'single', '此任务及之后所有同类实例', 'future');
      if (scope === null) return;
    }
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
    renderCurrentView();
    try { await api.call('DELETE', `/api/tasks/${taskId}?scope=future`); }
    catch { showToast('删除失败', true); await loadWeek(true); }
    return;
  }

  // "ai_group" scope: remove all tasks in same AI group
  if (scope === 'ai_group' && task.ai_group_id) {
    const groupId = task.ai_group_id;
    state.tasks = state.tasks.filter(t => t.ai_group_id !== groupId);
    if (state.modalTaskId === taskId) closeModal();
    renderCurrentView();
    try { await api.call('DELETE', `/api/tasks/${taskId}?scope=ai_group`); }
    catch { showToast('删除失败', true); await loadWeek(true); }
    return;
  }

  // "future" scope on a subtask: remove same-titled subtasks from future parent instances
  if (scope === 'future' && task.parent_id) {
    const parent = getTask(task.parent_id);
    if (parent?.recurring_origin) {
      const originId = parent.recurring_origin;
      const fromDay  = parent.day;
      // Remove matching subtasks from future parent instances
      state.tasks = state.tasks.filter(t => {
        if (!t.parent_id) return true;
        const tParent = getTask(t.parent_id);
        return !(tParent?.recurring_origin === originId &&
                 tParent.day > fromDay &&
                 t.title === task.title);
      });
    }
    // Fall through to also remove the original subtask with undo
  }

  const toRemove = new Set();
  (function collect(id) {
    toRemove.add(id);
    getChildren(id).forEach(c => collect(c.id));
  })(taskId);

  const snapshot = [...state.tasks];
  state.tasks = state.tasks.filter(t => !toRemove.has(t.id));
  if (state.modalTaskId && toRemove.has(state.modalTaskId)) closeModal();
  renderCurrentView();

  const toast = showUndoToast(`已删除"${task.title.slice(0, 18)}"`, () => {
    clearTimeout(entry.timer);
    state.pendingDeletes.delete(taskId);
    state.tasks = snapshot;
    renderCurrentView();
  });

  const entry = {
    snapshot, toastEl: toast,
    timer: setTimeout(async () => {
      state.pendingDeletes.delete(taskId);
      const scopeParam = scope !== 'single' ? `?scope=${scope}` : '';
      try { await api.call('DELETE', `/api/tasks/${taskId}${scopeParam}`); }
      catch { state.tasks = snapshot; renderCurrentView(); showToast('删除失败', true); }
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
  renderModalColorPicker();
  // Close sub-panels
  ['modal-color-picker','modal-recurring-picker','modal-reminder-picker'].forEach(id =>
    document.getElementById(id).classList.add('hidden'));
  document.querySelectorAll('.modal-tool-btn').forEach(b => b.classList.remove('active'));
}

let _closingModal = false;
async function closeModal() {
  if (_closingModal) return;
  _closingModal = true;
  clearTimeout(_saveTimer);

  const id   = state.modalTaskId;
  const task = id ? getTask(id) : null;
  const hasPending = Object.keys(_pendingSaveData).length > 0;

  if (task && task.recurring_origin && hasPending) {
    const scope = await showRecurScopeDialog('如何保存这些修改？');
    if (scope !== null) {
      await flushSave(scope);
    } else {
      _pendingSaveData = {}; // discard changes
    }
  } else {
    await flushSave('single');
  }

  state.modalTaskId = null;
  document.getElementById('modal-backdrop').classList.remove('visible');
  document.getElementById('modal').classList.remove('visible');
  _closingModal = false;
}

function renderModalContent(task) {
  document.getElementById('modal-date-label').textContent = formatDateLabel(task.day);
  document.getElementById('modal-title-input').value       = task.title;
  document.getElementById('modal-notes-input').value       = task.notes || '';

  // Color btn tint (swatches updated separately in renderModalColorPicker)
  const colorBtn = document.getElementById('modal-btn-color');
  colorBtn.style.color = task.color ? getColorHex(task.color) : '';

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
  // For recurring instances, defer save to modal close so we can ask scope once
  const task = state.modalTaskId ? getTask(state.modalTaskId) : null;
  if (task?.recurring_origin) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => flushSave('single'), SAVE_DELAY);
}

async function flushSave(scope = 'single') {
  clearTimeout(_saveTimer);
  const id = state.modalTaskId;
  if (!id || Object.keys(_pendingSaveData).length === 0) return;
  const payload = { ..._pendingSaveData };
  _pendingSaveData = {};
  if ('title' in payload && !payload.title.trim()) return;

  // Apply optimistically to state
  const task = getTask(id);
  if (task) {
    if (scope === 'future' && task.recurring_origin) {
      state.tasks.filter(t => t.recurring_origin === task.recurring_origin && t.day >= task.day)
        .forEach(t => Object.assign(t, payload));
    } else {
      Object.assign(task, payload);
    }
    renderCurrentView();
  }

  try {
    const res = await api.updateTask(id, { ...payload, scope });
    if (task && res?.task) Object.assign(task, res.task);
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

  let scope = 'single';
  if (task.recurring_origin) {
    scope = await showRecurScopeDialog('如何修改颜色？');
    if (scope === null) return;
  } else if (task.ai_group_id) {
    scope = await showScopeDialog('如何修改颜色？', '仅此任务', 'single', '同组所有任务', 'ai_group');
    if (scope === null) return;
  }

  const newColor = color || null;
  // Optimistic update in state
  if (scope === 'future' && task.recurring_origin) {
    state.tasks.filter(t => t.recurring_origin === task.recurring_origin && t.day >= task.day)
      .forEach(t => { t.color = newColor; });
  } else if (scope === 'ai_group' && task.ai_group_id) {
    state.tasks.filter(t => t.ai_group_id === task.ai_group_id)
      .forEach(t => { t.color = newColor; });
  } else {
    task.color = newColor;
  }
  renderModalContent(getTask(id)); renderModalColorPicker(); renderCurrentView();
  try { await api.updateTask(id, { color: newColor, scope }); }
  catch (e) { showToast('颜色设置失败', true); await loadWeek(true); }
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

  let scope = 'single';
  if (task.recurring_origin) {
    scope = await showRecurScopeDialog('如何修改提醒时间？');
    if (scope === null) return;
  }

  const newDeadline = deadline || null;
  if (scope === 'future' && task.recurring_origin) {
    state.tasks.filter(t => t.recurring_origin === task.recurring_origin && t.day >= task.day)
      .forEach(t => { t.deadline = newDeadline; t.reminded = false; });
  } else {
    task.deadline = newDeadline;
    task.reminded = false;
  }
  try { await api.updateTask(id, { deadline: newDeadline, reminded: false, scope }); }
  catch (e) { showToast('提醒设置失败', true); }
}

// ── All-tasks view ─────────────────────────────────────────────────

// Filter / sort state (persisted in URL search params)
const allFilter = {
  status:   '',    // '' | 'todo' | 'done'
  priority: '',    // '' | 'urgent' | 'important' | 'normal'
  date:     '',    // '' | 'today' | 'week' | 'month'
  search:   '',
  sort:     'date_asc',  // 'date_asc' | 'date_desc' | 'priority'
};

function syncFilterFromURL() {
  const p = new URLSearchParams(location.search);
  if (p.has('status'))   allFilter.status   = p.get('status');
  if (p.has('priority')) allFilter.priority = p.get('priority');
  if (p.has('date'))     allFilter.date     = p.get('date');
  if (p.has('search'))   allFilter.search   = p.get('search');
  if (p.has('sort'))     allFilter.sort     = p.get('sort');
}

function pushFilterToURL() {
  const p = new URLSearchParams();
  if (allFilter.status)   p.set('status',   allFilter.status);
  if (allFilter.priority) p.set('priority', allFilter.priority);
  if (allFilter.date)     p.set('date',     allFilter.date);
  if (allFilter.search)   p.set('search',   allFilter.search);
  if (allFilter.sort !== 'date_asc') p.set('sort', allFilter.sort);
  const qs = p.toString();
  history.replaceState(null, '', '#all' + (qs ? '?' + qs : ''));
}

const PRIORITY_ORDER = { urgent: 0, important: 1, normal: 2 };

function applyFiltersAndSort(tasks) {
  const today   = todayStr();
  const monday  = state.weekStart; // current week start
  const mon1st  = today.slice(0, 8) + '01'; // first of month

  let list = tasks.filter(t => !t.parent_id);

  if (allFilter.status === 'todo')  list = list.filter(t => !t.done);
  if (allFilter.status === 'done')  list = list.filter(t =>  t.done);

  if (allFilter.priority) list = list.filter(t => (t.priority || 'normal') === allFilter.priority);

  if (allFilter.date === 'today') list = list.filter(t => t.day === today);
  if (allFilter.date === 'week')  list = list.filter(t => t.day >= monday && t.day <= addDays(monday, 6));
  if (allFilter.date === 'month') list = list.filter(t => t.day >= mon1st && t.day <= today.slice(0,8) + '31');

  if (allFilter.search) {
    const q = allFilter.search.toLowerCase();
    list = list.filter(t => t.title.toLowerCase().includes(q));
  }

  if (allFilter.sort === 'date_asc')  list.sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : a.order - b.order);
  if (allFilter.sort === 'date_desc') list.sort((a, b) => a.day > b.day ? -1 : a.day < b.day ? 1 : b.order - a.order);
  if (allFilter.sort === 'priority')  list.sort((a, b) => (PRIORITY_ORDER[a.priority||'normal'] - PRIORITY_ORDER[b.priority||'normal']) || (a.day < b.day ? -1 : 1));

  return list;
}

function syncFilterUI() {
  document.querySelectorAll('.filter-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.value === allFilter[el.dataset.filter]);
  });
  const sortEl = document.getElementById('all-sort');
  if (sortEl) sortEl.value = allFilter.sort;
  const searchEl = document.getElementById('all-search');
  if (searchEl) searchEl.value = allFilter.search;
}

function buildAllTaskCard(task) {
  const children = getChildren(task.id);
  const doneSubs = children.filter(c => c.done).length;
  const allDone  = children.length > 0 && doneSubs === children.length;
  const someDone = children.length > 0 && doneSubs > 0 && !allDone;

  const card = document.createElement('div');
  card.className = 'all-task-card' + (task.done ? ' is-done' : '');
  card.dataset.id = task.id;

  // ── Main row
  const main = document.createElement('div');
  main.className = 'all-task-main';

  // Round checkbox
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'task-check task-check--round';
  check.dataset.id = task.id;
  check.checked = task.done || allDone;
  if (children.length > 0) {
    check.classList.add('task-check--parent');
    if (someDone) check.classList.add('task-check--partial');
    check.disabled = true;
  }
  main.appendChild(check);

  // Body
  const body = document.createElement('div');
  body.className = 'all-task-body';

  // Title row: left (title + date) | right (color dot + priority + recurring)
  const titleRow = document.createElement('div');
  titleRow.className = 'all-task-title-row';

  // Left: title + date
  const titleLeft = document.createElement('div');
  titleLeft.className = 'all-task-title-left';

  const titleEl = document.createElement('span');
  titleEl.className = 'all-task-title-text';
  titleEl.textContent = task.title;
  titleEl.dataset.action = 'open-modal';
  titleLeft.appendChild(titleEl);

  const d = new Date(task.day + 'T00:00:00');
  const today = todayStr();
  const diff = Math.round((new Date(task.day + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
  let dateLabel = `${d.getMonth()+1}月${d.getDate()}日 ${WEEKDAYS_CN[dayIndex(task.day)]}`;
  if (diff === 0) dateLabel = '今天';
  else if (diff === 1) dateLabel = '明天';
  else if (diff === -1) dateLabel = '昨天';
  const dateEl = document.createElement('span');
  dateEl.className = 'all-task-date';
  dateEl.textContent = dateLabel;
  titleLeft.appendChild(dateEl);

  titleRow.appendChild(titleLeft);

  // Right: color dot + priority pill + recurring pill
  const titleRight = document.createElement('div');
  titleRight.className = 'all-task-title-right';

  if (task.color) {
    const dot = document.createElement('span');
    dot.className = 'all-color-dot';
    dot.style.background = COLOR_MAP[task.color] || '#ccc';
    titleRight.appendChild(dot);
  }
  if (task.priority && task.priority !== 'normal') {
    const pill = document.createElement('span');
    pill.className = `all-priority-pill all-priority-pill--${task.priority}`;
    pill.textContent = task.priority === 'urgent' ? '紧急' : '重要';
    titleRight.appendChild(pill);
  }
  if (task.recurring) {
    const MAP = { daily: '每天', weekly: '每周', monthly: '每月' };
    const pill = document.createElement('span');
    pill.className = 'all-recur-pill';
    pill.textContent = MAP[task.recurring] || task.recurring;
    titleRight.appendChild(pill);
  }

  titleRow.appendChild(titleRight);
  body.appendChild(titleRow);

  // Notes (always shown if present)
  if (task.notes && task.notes.trim()) {
    const notes = document.createElement('p');
    notes.className = 'all-task-notes-text';
    notes.textContent = task.notes;
    body.appendChild(notes);
  }

  main.appendChild(body);

  // Hover actions
  const acts = document.createElement('div');
  acts.className = 'all-task-actions';
  acts.appendChild(makeActionBtn('reminder', svgBell(), '设置提醒'));
  acts.appendChild(makeActionBtn('delete', svgTrash(), '删除', 'btn-action--delete'));
  main.appendChild(acts);

  card.appendChild(main);

  // ── Subtask section (always visible)
  if (children.length > 0) {
    const section = document.createElement('div');
    section.className = 'all-subtask-section';
    children.forEach(c => {
      const row = document.createElement('div');
      row.className = 'all-subtask-row' + (c.done ? ' is-done' : '');
      row.dataset.id = c.id;
      const ck = document.createElement('input');
      ck.type = 'checkbox';
      ck.className = 'task-check task-check--round task-check--sm';
      ck.dataset.id = c.id;
      ck.checked = c.done;
      const sp = document.createElement('span');
      sp.textContent = c.title;
      row.appendChild(ck);
      row.appendChild(sp);
      section.appendChild(row);
    });
    card.appendChild(section);
  }

  return card;
}

function renderAllTasks() {
  const container = document.getElementById('all-tasks-list');
  if (!container) return;
  container.innerHTML = '';

  syncFilterUI();

  const filtered = applyFiltersAndSort(state.tasks);
  const total    = state.tasks.filter(t => !t.parent_id).length;

  renderDashboard(filtered);

  if (filtered.length === 0) {
    const msg = total === 0
      ? '暂无任务，点击「新增任务」创建第一个任务'
      : '没有符合筛选条件的任务';
    container.innerHTML = `<div class="all-tasks-empty">${msg}</div>`;
    return;
  }

  // Show as flat list (sorted) — no day-group headers when sorted by priority
  filtered.forEach(t => container.appendChild(buildAllTaskCard(t)));
}

// ── Dashboard (right panel) ───────────────────────────────────────

// Sine-wave path: two full cycles across 200% width so the loop is seamless
const WAVE_PATH = (() => {
  const W = 200, A = 8, steps = 80;
  let d = `M0,${A}`;
  for (let i = 1; i <= steps; i++) {
    const x = (i / steps) * W;
    const y = A - Math.sin((i / steps) * Math.PI * 4) * A;
    d += ` L${x.toFixed(2)},${y.toFixed(2)}`;
  }
  d += ` L${W},100 L0,100 Z`;
  return d;
})();

function getDashColorHex(key) {
  if (key === 'none') return '#BBBBB6';
  return getColorHex(key);
}
function getDashColorLabel(key) {
  if (key === 'none') return '无标签';
  return getColorName(key);
}

let _dashBarInit = false;

function initDashboard() {
  const right = document.getElementById('all-tasks-right');
  if (!right || right.querySelector('#dash-wave-card')) return;

  right.innerHTML = `
    <div class="dash-card" id="dash-wave-card">
      <div class="dash-card-title">完成进度</div>
      <div class="dash-wave-wrap">
        <div class="dash-wave-circle" id="dash-wave-circle">
          <svg class="dash-wave-svg" id="dash-wave-svg"
               viewBox="0 0 200 100" preserveAspectRatio="none"
               xmlns="http://www.w3.org/2000/svg">
            <path d="${WAVE_PATH}"/>
          </svg>
          <span class="dash-wave-pct" id="dash-wave-pct">—</span>
        </div>
      </div>
    </div>

    <div class="dash-card" id="dash-bar-card">
      <div class="dash-card-title">本周日程
        <span class="dash-bar-week" id="dash-bar-week"></span>
      </div>
      <canvas id="dash-bar-canvas"></canvas>
    </div>

    <div class="dash-card" id="dash-tree-card">
      <div class="dash-card-title">模块分布</div>
      <svg id="dash-tree-svg" class="dash-tree-svg"
           xmlns="http://www.w3.org/2000/svg"></svg>
    </div>

    <div id="dash-tooltip" class="dash-tooltip hidden"></div>
  `;
}

function renderDashboard(filtered) {
  if (!document.getElementById('dash-wave-card')) return;
  renderDashWave(filtered);
  renderDashBar();
  renderDashTreemap(filtered);
}

function renderDashWave(tasks) {
  const circle = document.getElementById('dash-wave-circle');
  const label  = document.getElementById('dash-wave-pct');
  const svg    = document.getElementById('dash-wave-svg');
  if (!circle) return;

  const total = tasks.length;
  const done  = tasks.filter(t => t.done).length;
  const pct   = total ? done / total : 0;

  circle.style.setProperty('--wave-pct', pct);
  label.textContent = total ? Math.round(pct * 100) + '%' : '—';
  if (svg) {
    svg.style.fill = pct >= 1
      ? 'rgba(82,183,136,0.45)'
      : 'rgba(74,144,217,0.35)';
  }
}

function renderDashBar() {
  const canvas = document.getElementById('dash-bar-canvas');
  const weekLabel = document.getElementById('dash-bar-week');
  if (!canvas) return;

  // Compute Mon–Sun for current week
  const days = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
  const today = todayStr();

  // Week label
  if (weekLabel) {
    const fmt = d => {
      const dt = new Date(d + 'T00:00:00');
      return `${dt.getMonth() + 1}月${dt.getDate()}日`;
    };
    weekLabel.textContent = `${fmt(days[0])} – ${fmt(days[6])}`;
  }

  // Count root tasks per day (use all state.tasks, no date filter)
  const rootTasks = state.tasks.filter(t => !t.parent_id);
  const counts = days.map(d => {
    const dayTasks = rootTasks.filter(t => t.day === d);
    return { total: dayTasks.length, done: dayTasks.filter(t => t.done).length };
  });

  // HiDPI sizing
  const dpr    = window.devicePixelRatio || 1;
  const cssW   = canvas.parentElement.clientWidth - 32; // card padding
  const cssH   = 110;
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
  const LABEL_H = 20;
  const chartH  = cssH - LABEL_H;
  const maxVal  = Math.max(...counts.map(c => c.total), 1);
  const barW    = Math.floor((cssW / 7) * 0.55);
  const gap     = cssW / 7;

  counts.forEach((c, i) => {
    const cx     = gap * i + gap / 2;
    const isToday = days[i] === today;

    // Total bar (background)
    const totalH = Math.round((c.total / maxVal) * chartH * 0.85);
    if (totalH > 0) {
      ctx.fillStyle = isToday ? 'rgba(74,144,217,0.18)' : 'rgba(187,187,182,0.25)';
      const x = cx - barW / 2;
      const y = chartH - totalH;
      _roundRect(ctx, x, y, barW, totalH, 3);
      ctx.fill();
    }

    // Done bar (foreground)
    const doneH = Math.round((c.done / maxVal) * chartH * 0.85);
    if (doneH > 0) {
      ctx.fillStyle = isToday ? 'rgba(74,144,217,0.80)' : 'rgba(74,144,217,0.50)';
      const x = cx - barW / 2;
      const y = chartH - doneH;
      _roundRect(ctx, x, y, barW, doneH, 3);
      ctx.fill();
    }

    // Day label
    ctx.fillStyle = isToday ? '#4A90D9' : '#BBBBB6';
    ctx.font = `${isToday ? 400 : 300} 10px var(--font, system-ui)`;
    ctx.textAlign = 'center';
    ctx.fillText(DAY_LABELS[i], cx, cssH - 4);
  });

  // Register mouse / click listeners once
  if (!_dashBarInit) {
    _dashBarInit = true;
    canvas.addEventListener('mousemove', e => {
      const rect   = canvas.getBoundingClientRect();
      const x      = e.clientX - rect.left;
      const col    = Math.floor(x / (rect.width / 7));
      if (col < 0 || col > 6) { hideDashTooltip(); return; }
      const c = counts[col];
      showDashTooltip(e.clientX, e.clientY,
        `${['周一','周二','周三','周四','周五','周六','周日'][col]}：${c.done} 已完成 / ${c.total} 个任务`);
    });
    canvas.addEventListener('mouseleave', hideDashTooltip);
    canvas.addEventListener('click', e => {
      const rect = canvas.getBoundingClientRect();
      const x    = e.clientX - rect.left;
      const col  = Math.floor(x / (rect.width / 7));
      if (col >= 0 && col <= 6) {
        state.weekStart = days[0]; // already the week start
        switchView('week');
      }
    });
  }
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Treemap ──────────────────────────────────────────────────────

function squarify(items, rect) {
  // items: [{value, ...meta}] sorted descending
  // returns: [{x, y, w, h, ...meta}]
  if (!items.length) return [];

  const total = items.reduce((s, it) => s + it.value, 0);
  if (!total) return [];

  const result = [];

  function layout(its, { x, y, w, h }) {
    if (!its.length) return;
    if (its.length === 1) {
      result.push({ ...its[0], x, y, w, h });
      return;
    }

    // Try to split into two groups that minimize aspect ratio
    const area = w * h;
    let bestIdx = 1;
    let bestAR  = Infinity;

    for (let split = 1; split < its.length; split++) {
      const aVal = its.slice(0, split).reduce((s, it) => s + it.value, 0);
      const bVal = its.slice(split).reduce((s, it) => s + it.value, 0);
      const aFrac = aVal / total;
      const bFrac = bVal / total;

      let aW, aH, bW, bH;
      if (w >= h) {
        aW = w * aFrac / (aVal / total) * (aVal / total); // = w * aFrac
        // Recalculate properly:
        aW = w * (aVal / (aVal + bVal));
        aH = h;
        bW = w - aW;
        bH = h;
      } else {
        aW = w;
        aH = h * (aVal / (aVal + bVal));
        bW = w;
        bH = h - aH;
      }

      const aAR = Math.max(aW / aH, aH / aW);
      const bAR = Math.max(bW / bH, bH / bW);
      const ar  = Math.max(aAR, bAR);
      if (ar < bestAR) { bestAR = ar; bestIdx = split; }
    }

    const aItems = its.slice(0, bestIdx);
    const bItems = its.slice(bestIdx);
    const aVal = aItems.reduce((s, it) => s + it.value, 0);
    const bVal = bItems.reduce((s, it) => s + it.value, 0);

    let aRect, bRect;
    if (w >= h) {
      const aW = w * (aVal / (aVal + bVal));
      aRect = { x,      y, w: aW,      h };
      bRect = { x: x + aW, y, w: w - aW, h };
    } else {
      const aH = h * (aVal / (aVal + bVal));
      aRect = { x, y,      w, h: aH      };
      bRect = { x, y: y + aH, w, h: h - aH };
    }

    layout(aItems, aRect);
    layout(bItems, bRect);
  }

  layout(items, rect);
  return result;
}

function renderDashTreemap(tasks) {
  const card = document.getElementById('dash-tree-card');
  const svg  = document.getElementById('dash-tree-svg');
  if (!svg || !card) return;
  svg.innerHTML = '';

  // Remove any existing legend
  const oldLegend = card.querySelector('.dash-tree-legend');
  if (oldLegend) oldLegend.remove();

  // Group root tasks by color
  const rootTasks = tasks.filter(t => !t.parent_id);
  const groups = {};
  for (const t of rootTasks) {
    const key = t.color || 'none';
    groups[key] = (groups[key] || 0) + 1;
  }

  const items = Object.entries(groups)
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value);

  if (!items.length) {
    svg.setAttribute('viewBox', '0 0 1 1');
    svg.style.height = '0';
    return;
  }

  // Measure container width
  const W = svg.parentElement.clientWidth - 32;
  const H = Math.max(80, Math.round(W * 0.5));
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.height = H + 'px';

  const total = items.reduce((s, it) => s + it.value, 0);
  const tiles = squarify(items, { x: 0, y: 0, w: W, h: H });

  const NS = 'http://www.w3.org/2000/svg';

  tiles.forEach(tile => {
    const hex = getDashColorHex(tile.key);
    const pad = 2;
    const x = tile.x + pad, y = tile.y + pad;
    const w = tile.w - pad * 2, h = tile.h - pad * 2;
    if (w < 4 || h < 4) return;

    // Rect
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', w);
    rect.setAttribute('height', h);
    rect.setAttribute('rx', 4);
    rect.setAttribute('fill', hex);
    rect.setAttribute('fill-opacity', '0.55');
    svg.appendChild(rect);

    // Count number only (no color name text)
    if (w > 28 && h > 20) {
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', x + w / 2);
      label.setAttribute('y', y + h / 2 + 1);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'middle');
      label.setAttribute('font-size', Math.min(13, Math.max(10, Math.floor(Math.min(w, h) / 3))));
      label.setAttribute('font-family', 'system-ui, sans-serif');
      label.setAttribute('font-weight', '300');
      label.setAttribute('fill', '#333330');
      label.setAttribute('fill-opacity', '0.7');
      label.setAttribute('pointer-events', 'none');
      label.textContent = tile.value;
      svg.appendChild(label);
    }

    // Hover
    rect.addEventListener('mouseenter', e => {
      const pct = Math.round((tile.value / total) * 100);
      showDashTooltip(e.clientX, e.clientY,
        `${getDashColorLabel(tile.key)}：${tile.value} 个任务（${pct}%）`);
      rect.setAttribute('fill-opacity', '0.75');
    });
    rect.addEventListener('mousemove', e => moveDashTooltip(e.clientX, e.clientY));
    rect.addEventListener('mouseleave', () => {
      hideDashTooltip();
      rect.setAttribute('fill-opacity', '0.55');
    });
  });

  // Legend below SVG
  const legend = document.createElement('div');
  legend.className = 'dash-tree-legend';
  items.forEach(it => {
    const item = document.createElement('span');
    item.className = 'dash-tree-legend-item';
    const dot = document.createElement('span');
    dot.className = 'dash-tree-legend-dot';
    dot.style.background = getDashColorHex(it.key);
    dot.style.opacity = '0.7';
    const txt = document.createTextNode(`${getDashColorLabel(it.key)} ${it.value}`);
    item.appendChild(dot);
    item.appendChild(txt);
    legend.appendChild(item);
  });
  card.appendChild(legend);
}

function showDashTooltip(x, y, text) {
  const tip = document.getElementById('dash-tooltip');
  if (!tip) return;
  tip.textContent = text;
  tip.classList.remove('hidden');
  moveDashTooltip(x, y);
}

function moveDashTooltip(x, y) {
  const tip = document.getElementById('dash-tooltip');
  if (!tip) return;
  tip.style.left = (x + 12) + 'px';
  tip.style.top  = (y - 8)  + 'px';
}

function hideDashTooltip() {
  const tip = document.getElementById('dash-tooltip');
  if (tip) tip.classList.add('hidden');
}

function setupAllTasksEvents() {
  initDashboard();

  const container = document.getElementById('all-tasks-list');

  // Click delegation on the list
  container.addEventListener('click', e => {
    if (state.modalTaskId) return;
    const card = e.target.closest('.all-task-card');
    if (!card) return;

    // Action buttons
    const actionBtn = e.target.closest('.btn-action');
    if (actionBtn) {
      e.stopPropagation();
      const a = actionBtn.dataset.action;
      if (a === 'delete')  { deleteTask(card.dataset.id); return; }
      if (a === 'reminder') {
        openModal(card.dataset.id);
        setTimeout(() => document.getElementById('modal-btn-reminder').click(), 50);
        return;
      }
    }

    // Open modal on title click
    if (e.target.closest('[data-action="open-modal"]')) {
      openModal(card.dataset.id); return;
    }
  });

  // Checkbox changes (root tasks and subtasks)
  container.addEventListener('change', e => {
    if (!e.target.classList.contains('task-check') || e.target.disabled) return;
    const row = e.target.closest('[data-id]');
    if (row) toggleDone(row.dataset.id, e.target.checked);
  });

  // Right-click
  container.addEventListener('contextmenu', e => {
    const card = e.target.closest('.all-task-card');
    if (card) { e.preventDefault(); showContextMenu(e.clientX, e.clientY, card.dataset.id); }
  });

  // ── Filter chips
  document.getElementById('all-filters').addEventListener('click', e => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    allFilter[chip.dataset.filter] = chip.dataset.value;
    pushFilterToURL();
    renderAllTasks();
  });

  // ── Sort
  document.getElementById('all-sort').addEventListener('change', e => {
    allFilter.sort = e.target.value;
    pushFilterToURL();
    renderAllTasks();
  });

  // ── Search (debounced)
  let _searchTimer;
  document.getElementById('all-search').addEventListener('input', e => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => {
      allFilter.search = e.target.value.trim();
      pushFilterToURL();
      renderAllTasks();
    }, 250);
  });

  // ── New task button
  document.getElementById('all-btn-new').addEventListener('click', () => {
    const qa = document.getElementById('all-quick-add');
    qa.classList.remove('hidden');
    const dateInput = document.getElementById('all-qa-date');
    if (!dateInput.value) dateInput.value = todayStr();
    document.getElementById('all-qa-title').focus();
  });

  // ── Quick-add submit
  document.getElementById('all-qa-submit').addEventListener('click', submitQuickAdd);
  document.getElementById('all-qa-title').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitQuickAdd();
    if (e.key === 'Escape') closeQuickAdd();
  });
  document.getElementById('all-qa-cancel').addEventListener('click', closeQuickAdd);
}

async function submitQuickAdd() {
  const title    = document.getElementById('all-qa-title').value.trim();
  const day      = document.getElementById('all-qa-date').value  || todayStr();
  const priority = document.getElementById('all-qa-priority').value || 'normal';
  if (!title) { document.getElementById('all-qa-title').focus(); return; }
  try {
    await api.createTask({ title, day, priority });
    closeQuickAdd();
    await loadWeek(false);
  } catch (e) { showToast('创建失败：' + e.message, true); }
}

function closeQuickAdd() {
  document.getElementById('all-quick-add').classList.add('hidden');
  document.getElementById('all-qa-title').value = '';
}

// ── View switching ─────────────────────────────────────────────────
function switchView(v) {
  if (state.view === v) return;
  state.view = v;

  if (v === 'all') {
    pushFilterToURL();
  } else {
    writeHashWeek(state.weekStart);
  }

  document.getElementById('week-header').hidden    = (v !== 'week');
  document.getElementById('week-grid').hidden      = (v !== 'week');
  document.getElementById('all-tasks-view').hidden = (v !== 'all');

  document.querySelectorAll('.sidebar-item[data-view]').forEach(el =>
    el.classList.toggle('active', el.dataset.view === v));

  loadWeek();
}

// ── Generic scope dialog ───────────────────────────────────────────
// Returns val1, val2, or null (cancel).
function showScopeDialog(msg, label1, val1, label2, val2) {
  return new Promise(resolve => {
    document.getElementById('recur-scope-msg').textContent = msg;
    document.getElementById('recur-scope-single').textContent = label1;
    document.getElementById('recur-scope-future').textContent = label2;
    document.getElementById('recur-scope-dialog').classList.add('visible');
    document.getElementById('recur-scope-backdrop').classList.add('visible');

    function close(val) {
      document.getElementById('recur-scope-dialog').classList.remove('visible');
      document.getElementById('recur-scope-backdrop').classList.remove('visible');
      resolve(val);
    }

    document.getElementById('recur-scope-single').onclick   = () => close(val1);
    document.getElementById('recur-scope-future').onclick   = () => close(val2);
    document.getElementById('recur-scope-cancel').onclick   = () => close(null);
    document.getElementById('recur-scope-backdrop').onclick = () => close(null);
  });
}

function showRecurScopeDialog(msg) {
  return showScopeDialog(msg, '仅此任务', 'single', '此任务及之后所有任务', 'future');
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
      const parentTask = getTask(state.modalTaskId);
      let scope = 'single';
      if (parentTask?.recurring_origin) {
        scope = await showScopeDialog(
          '为循环任务添加子任务',
          '仅此任务', 'single',
          '此任务及之后所有任务', 'future'
        );
        if (!scope) return;
      }
      try {
        await api.createSubtask(state.modalTaskId, val, scope);
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

  // ── Sidebar navigation
  document.getElementById('sidebar').addEventListener('click', e => {
    const item = e.target.closest('.sidebar-item[data-view]');
    if (item) switchView(item.dataset.view);
  });

  // ── All-tasks-specific events
  setupAllTasksEvents();

  // ── AI panel events
  setupAIPanelEvents();

  // ── Settings panel events
  setupSettingsEvents();

  // ── Hash navigation (browser back/forward)
  window.addEventListener('hashchange', () => {
    const newView = readView();
    if (newView !== state.view) { switchView(newView); return; }
    if (state.view === 'week') {
      const w = readHashWeek();
      if (w !== state.weekStart) { state.weekStart = w; loadWeek(); }
    }
  });
}

// ── Init ───────────────────────────────────────────────────────────
async function init() {
  // Bootstrap color styles + theme before first render
  injectColorStyles();
  applyTheme(getThemeMode());
  _mq.addEventListener('change', () => {
    if (getThemeMode() === 'system') applyTheme('system');
  });

  state.view = readView();
  if (state.view === 'all') syncFilterFromURL();

  const isAll = state.view === 'all';
  document.getElementById('week-header').hidden    = isAll;
  document.getElementById('week-grid').hidden      = isAll;
  document.getElementById('all-tasks-view').hidden = !isAll;
  document.querySelectorAll('.sidebar-item[data-view]').forEach(el =>
    el.classList.toggle('active', el.dataset.view === state.view));

  setupEvents();
  if (!isAll) writeHashWeek(state.weekStart);
  await loadWeek();
  connectSSE();
  requestNotificationPermission();
}

// init() is called by auth.js after login, or immediately if already authenticated.
// Fall back to calling it directly only when auth.js is not present.
if (typeof Auth === 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}

// ── Modal color picker ────────────────────────────────────────────

function renderModalColorPicker() {
  const picker = document.getElementById('modal-color-picker');
  if (!picker) return;

  // Keep the "no color" swatch, replace the rest
  const noColor = picker.querySelector('[data-color=""]');
  picker.innerHTML = '';
  if (noColor) picker.appendChild(noColor);

  const colors = getUserColors();
  colors.forEach(({ key, hex, name }) => {
    const s = document.createElement('span');
    s.className = 'color-swatch';
    s.dataset.color = key;
    s.style.background = hex;
    s.title = name;
    picker.appendChild(s);
  });

  // Restore selected state for current modal task
  const task = state.modalTaskId ? state.tasks.find(t => t.id === state.modalTaskId) : null;
  const cur  = task ? (task.color || '') : '';
  picker.querySelectorAll('.color-swatch').forEach(s =>
    s.classList.toggle('selected', s.dataset.color === cur));
}

// ── Settings panel ────────────────────────────────────────────────

const settingsState = { open: false };

function openSettingsPanel() {
  settingsState.open = true;
  document.getElementById('settings-panel').classList.add('open');
  document.getElementById('settings-overlay').classList.add('visible');
  renderThemeOptions(getThemeMode());
  renderColorManager();
}

function closeSettingsPanel() {
  settingsState.open = false;
  document.getElementById('settings-panel').classList.remove('open');
  document.getElementById('settings-overlay').classList.remove('visible');
}

function toggleSettingsPanel() {
  if (settingsState.open) closeSettingsPanel();
  else openSettingsPanel();
}

function renderThemeOptions(activeMode) {
  document.querySelectorAll('.theme-option').forEach(el => {
    el.classList.toggle('active', el.dataset.themeVal === activeMode);
  });
}

function renderColorManager() {
  const mgr = document.getElementById('color-manager');
  if (!mgr) return;
  mgr.innerHTML = '';

  const colors = getUserColors();
  colors.forEach((color, idx) => {
    const row = document.createElement('div');
    row.className = 'color-mgr-row';

    // Color swatch (click opens native color picker)
    const swatchWrap = document.createElement('label');
    swatchWrap.className = 'color-mgr-swatch';
    swatchWrap.style.background = color.hex;
    swatchWrap.title = '点击更改颜色';
    const colorInput = document.createElement('input');
    colorInput.type  = 'color';
    colorInput.value = color.hex;
    colorInput.addEventListener('input', e => {
      swatchWrap.style.background = e.target.value;
    });
    colorInput.addEventListener('change', e => {
      const colors2 = getUserColors();
      colors2[idx].hex = e.target.value;
      saveUserColors(colors2);
      injectColorStyles();
      renderDashboard(applyFiltersAndSort(state.tasks));
    });
    swatchWrap.appendChild(colorInput);
    row.appendChild(swatchWrap);

    // Name input
    const nameInput = document.createElement('input');
    nameInput.type      = 'text';
    nameInput.className = 'color-mgr-name';
    nameInput.value     = color.name;
    nameInput.placeholder = '标签名称';
    nameInput.addEventListener('change', e => {
      const colors2 = getUserColors();
      colors2[idx].name = e.target.value.trim() || color.key;
      saveUserColors(colors2);
      renderModalColorPicker();
      renderDashboard(applyFiltersAndSort(state.tasks));
    });
    row.appendChild(nameInput);

    // Key label (fixed for built-ins)
    const keyLabel = document.createElement('span');
    keyLabel.className   = 'color-mgr-key';
    keyLabel.textContent = color.key;
    row.appendChild(keyLabel);

    // Delete button (disabled for built-ins)
    const delBtn = document.createElement('button');
    delBtn.className = 'color-mgr-del';
    delBtn.title     = '删除';
    delBtn.innerHTML = '✕';
    const isBuiltin = BUILTIN_COLORS.some(b => b.key === color.key);
    if (isBuiltin) {
      delBtn.disabled = true;
    } else {
      delBtn.addEventListener('click', () => {
        const colors2 = getUserColors().filter(c => c.key !== color.key);
        saveUserColors(colors2);
        injectColorStyles();
        renderColorManager();
        renderModalColorPicker();
        renderDashboard(applyFiltersAndSort(state.tasks));
      });
    }
    row.appendChild(delBtn);

    mgr.appendChild(row);
  });
}

function addCustomColor() {
  const colors = getUserColors();
  // Generate a unique key
  let n = 1;
  while (colors.find(c => c.key === `custom${n}`)) n++;
  const key  = `custom${n}`;
  const hue  = Math.round(Math.random() * 360);
  const hex  = hslToHex(hue, 60, 58);
  colors.push({ key, hex, name: `标签${n}` });
  saveUserColors(colors);
  injectColorStyles();
  renderColorManager();
  renderModalColorPicker();
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function setupSettingsEvents() {
  document.getElementById('btn-settings').addEventListener('click', toggleSettingsPanel);
  document.getElementById('settings-close').addEventListener('click', closeSettingsPanel);
  document.getElementById('settings-overlay').addEventListener('click', closeSettingsPanel);

  document.getElementById('theme-options').addEventListener('click', e => {
    const opt = e.target.closest('.theme-option');
    if (opt) setThemeMode(opt.dataset.themeVal);
  });

  document.getElementById('color-add-btn').addEventListener('click', addCustomColor);

  document.getElementById('btn-logout').addEventListener('click', async () => {
    if (typeof Auth !== 'undefined') await Auth.logout();
    location.reload();
  });
}

// ── AI Panel ────────────────────────────────────────────────────────

const PRIORITY_LABELS = { urgent: '紧急', important: '重要', normal: '普通' };
const PRIORITY_COLORS = { urgent: '#E8524A', important: '#F5A623', normal: '#BBBBB6' };

const aiState = {
  open:      false,
  subtasks:  [],   // [{title, estimated_time, priority, suggested_date, selected}]
  lastInput: '',
};

function openAIPanel() {
  aiState.open = true;
  document.getElementById('ai-panel').classList.add('open');
  document.getElementById('ai-overlay').classList.add('visible');
  setTimeout(() => document.getElementById('ai-task-input').focus(), 280);
}

function closeAIPanel() {
  aiState.open = false;
  document.getElementById('ai-panel').classList.remove('open');
  document.getElementById('ai-overlay').classList.remove('visible');
  // Reset state on close (next open starts fresh)
  aiState.subtasks  = [];
  aiState.lastInput = '';
  document.getElementById('ai-task-input').value = '';
  showAISection('ai-input-section');
}

function toggleAIPanel() {
  if (aiState.open) closeAIPanel();
  else openAIPanel();
}

function showAISection(id) {
  ['ai-input-section', 'ai-loading', 'ai-error', 'ai-result'].forEach(sid => {
    const el = document.getElementById(sid);
    if (el) el.classList.toggle('hidden', sid !== id);
  });
}

async function runDecompose() {
  const input = document.getElementById('ai-task-input').value.trim();
  if (!input) { document.getElementById('ai-task-input').focus(); return; }
  aiState.lastInput = input;
  showAISection('ai-loading');

  try {
    const result = await api.call('POST', '/api/ai/decompose', { task_title: input });
    if (!result.success) {
      document.getElementById('ai-error-msg').textContent = result.error;
      showAISection('ai-error');
      return;
    }
    aiState.subtasks = result.subtasks.map(s => ({ ...s, selected: true }));
    renderAIResult(input);
    showAISection('ai-result');
  } catch (e) {
    document.getElementById('ai-error-msg').textContent = '请求失败：' + e.message;
    showAISection('ai-error');
  }
}

function renderAIResult(title) {
  document.getElementById('ai-result-task-name').textContent = '📝 ' + title;
  const list = document.getElementById('ai-subtasks');
  list.innerHTML = '';
  aiState.subtasks.forEach((s, i) => list.appendChild(buildAISubtaskCard(s, i)));
}

function buildAISubtaskCard(subtask, idx) {
  const card = document.createElement('div');
  card.className = 'ai-subtask-card' + (subtask.selected ? '' : ' unselected');
  card.dataset.idx = idx;

  const main = document.createElement('div');
  main.className = 'ai-subtask-main';

  // Checkbox
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'ai-subtask-check';
  check.checked = subtask.selected;
  check.addEventListener('change', () => {
    aiState.subtasks[idx].selected = check.checked;
    card.classList.toggle('unselected', !check.checked);
  });
  main.appendChild(check);

  // Content
  const content = document.createElement('div');
  content.className = 'ai-subtask-content';

  const titleEl = document.createElement('div');
  titleEl.className = 'ai-subtask-title';
  titleEl.textContent = subtask.title;
  content.appendChild(titleEl);

  const meta = document.createElement('div');
  meta.className = 'ai-subtask-meta';
  if (subtask.estimated_time) {
    const t = document.createElement('span');
    t.className = 'ai-meta-item';
    t.textContent = '⏱ ' + subtask.estimated_time;
    meta.appendChild(t);
  }
  if (subtask.priority && subtask.priority !== 'normal') {
    const p = document.createElement('span');
    p.className = 'ai-meta-item ai-meta-priority';
    p.style.color = PRIORITY_COLORS[subtask.priority];
    p.textContent = (subtask.priority === 'urgent' ? '🔴' : '🟡') + ' ' + PRIORITY_LABELS[subtask.priority];
    meta.appendChild(p);
  }
  if (subtask.suggested_date) {
    const d = new Date(subtask.suggested_date + 'T00:00:00');
    const ds = document.createElement('span');
    ds.className = 'ai-meta-item';
    ds.textContent = `📅 ${d.getMonth() + 1}月${d.getDate()}日`;
    meta.appendChild(ds);
  }
  content.appendChild(meta);
  main.appendChild(content);

  // Edit button
  const editBtn = document.createElement('button');
  editBtn.className = 'ai-edit-btn';
  editBtn.textContent = '编辑';
  editBtn.addEventListener('click', () => showAIEditForm(card, idx));
  main.appendChild(editBtn);

  card.appendChild(main);
  return card;
}

function showAIEditForm(card, idx) {
  const s = aiState.subtasks[idx];
  card.querySelector('.ai-subtask-main').style.display = 'none';

  const form = document.createElement('div');
  form.className = 'ai-edit-form';
  form.innerHTML = `
    <div class="ai-edit-field">
      <label>标题</label>
      <input class="ai-edit-input ai-edit-title" type="text" value="${escHtml(s.title)}" />
    </div>
    <div class="ai-edit-field">
      <label>预估时间</label>
      <input class="ai-edit-input ai-edit-time" type="text"
             value="${escHtml(s.estimated_time || '')}" placeholder="如：2小时" />
    </div>
    <div class="ai-edit-field ai-edit-priority-row">
      <label>优先级</label>
      <div class="ai-priority-btns">
        <button class="ai-priority-opt${s.priority === 'urgent'    ? ' active' : ''}" data-p="urgent">紧急</button>
        <button class="ai-priority-opt${s.priority === 'important' ? ' active' : ''}" data-p="important">重要</button>
        <button class="ai-priority-opt${(!s.priority || s.priority === 'normal') ? ' active' : ''}" data-p="normal">普通</button>
      </div>
    </div>
    <div class="ai-edit-field">
      <label>日期</label>
      <input class="ai-edit-input ai-edit-date" type="date" value="${s.suggested_date || ''}" />
    </div>
    <div class="ai-edit-actions">
      <button class="ai-save-btn">保存</button>
      <button class="ai-cancel-btn">取消</button>
    </div>`;

  form.querySelectorAll('.ai-priority-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      form.querySelectorAll('.ai-priority-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  form.querySelector('.ai-save-btn').addEventListener('click', () => {
    aiState.subtasks[idx].title          = form.querySelector('.ai-edit-title').value.trim() || s.title;
    aiState.subtasks[idx].estimated_time = form.querySelector('.ai-edit-time').value.trim();
    aiState.subtasks[idx].priority       = form.querySelector('.ai-priority-opt.active')?.dataset.p || 'normal';
    aiState.subtasks[idx].suggested_date = form.querySelector('.ai-edit-date').value;
    // Replace card in DOM
    const list    = document.getElementById('ai-subtasks');
    const newCard = buildAISubtaskCard(aiState.subtasks[idx], idx);
    list.replaceChild(newCard, card);
  });

  form.querySelector('.ai-cancel-btn').addEventListener('click', () => {
    form.remove();
    card.querySelector('.ai-subtask-main').style.display = '';
  });

  card.appendChild(form);
}

function parseEstimatedMins(str) {
  if (!str) return null;
  const h = str.match(/(\d+(?:\.\d+)?)\s*小时/);
  const m = str.match(/(\d+)\s*分钟/);
  const d = str.match(/(\d+)\s*天/);
  if (h) return Math.round(parseFloat(h[1]) * 60);
  if (m) return parseInt(m[1]);
  if (d) return parseInt(d[1]) * 480;
  return null;
}

async function addAllToSchedule() {
  const selected = aiState.subtasks.filter(s => s.selected);
  if (!selected.length) { showToast('请至少选择一个任务', true); return; }

  const btn = document.getElementById('ai-add-all-btn');
  btn.disabled    = true;
  btn.textContent = '添加中…';

  // Group subtasks by suggested_date
  const byDate = new Map();
  for (const s of selected) {
    const day = s.suggested_date || todayStr();
    if (!byDate.has(day)) byDate.set(day, []);
    byDate.get(day).push(s);
  }

  const parentTitle = aiState.lastInput;
  const groupId = crypto.randomUUID();

  try {
    let subCount = 0;
    for (const [day, subs] of byDate) {
      // Build notes from estimated times
      const notes = subs
        .filter(s => s.estimated_time)
        .map(s => `${s.title}：${s.estimated_time}`)
        .join('\n');

      // Create parent task for this date
      const parent = await api.createTask({
        title: parentTitle,
        day,
        notes,
        ai_group_id: groupId,
      });

      // Create each subtask under this parent
      for (const s of subs) {
        await api.call('POST', `/api/tasks/${parent.id}/subtasks`, {
          title:    s.title,
          priority: s.priority || 'normal',
        });
        subCount++;
      }
    }
    showToast(`已添加 ${byDate.size} 个父任务、${subCount} 个子任务到日程`);
    closeAIPanel();
    if (state.view === 'week') {
      await loadWeek();
    } else {
      switchView('week');
    }
  } catch (e) {
    showToast('添加失败：' + e.message, true);
  } finally {
    btn.disabled    = false;
    btn.textContent = '全部添加到日程';
  }
}

function setupAIPanelEvents() {
  document.getElementById('btn-ai').addEventListener('click', toggleAIPanel);
  document.getElementById('ai-panel-close').addEventListener('click', closeAIPanel);
  document.getElementById('ai-overlay').addEventListener('click', closeAIPanel);

  document.getElementById('ai-decompose-btn').addEventListener('click', runDecompose);
  document.getElementById('ai-task-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') runDecompose();
  });

  document.getElementById('ai-retry-btn').addEventListener('click', runDecompose);
  document.getElementById('ai-back-btn').addEventListener('click', () => showAISection('ai-input-section'));

  document.getElementById('ai-add-all-btn').addEventListener('click', addAllToSchedule);
  document.getElementById('ai-regen-btn').addEventListener('click', () => {
    document.getElementById('ai-task-input').value = aiState.lastInput;
    runDecompose();
  });
}

