# CLAUDE.md — Project Reference for Claude Code

> This file is read automatically by Claude Code at the start of every session.

---

## Project Overview

**WeekTODO** — A minimal week-view task manager. Think of it as a digital notebook: ruled lines, a paper-like aesthetic, and a simple week grid as the primary interface.

Design inspiration:
- **Tweek.so**: paper texture, notebook ruled lines, minimal chrome
- **WeekToDo**: parent/child task interaction model
- **Notion**: design system tokens, Inter font, warm neutrals, multi-layer shadows

Core philosophy: restore the clarity of a physical week planner in digital form.

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Backend | Flask 3.x | REST API + SSE push |
| Auth | Supabase Auth | Email/password + OAuth (Google, GitHub); JWT Bearer tokens |
| Database | Supabase PostgreSQL | `tasks` table, Row Level Security |
| Scheduler | APScheduler | Per-minute deadline reminders |
| Frontend | Vanilla HTML/CSS/JS | SPA, fetch-based API calls |
| AI | DeepSeek API | Task decomposition |

---

## Directory Structure

```
project-root/
├── src/
│   ├── app.py                  # Flask entry point — all REST routes + SSE
│   ├── models.py               # Task data model + Supabase read/write
│   ├── supabase_client.py      # Supabase client factory (strips proxy env vars)
│   ├── scheduler.py            # APScheduler deadline reminders
│   ├── ai_service.py           # AI task decomposition (DeepSeek)
│   ├── templates/
│   │   └── index.html          # Single-page app entry (auth + app views)
│   └── static/
│       ├── style.css           # All styles (Notion design system, dark theme, auth page)
│       ├── auth.js             # Auth module: Auth object, email forms, OAuth flow
│       └── app.js              # App logic: week view, all-tasks, dashboard, settings
├── data/
│   └── tasks.json              # Deprecated (kept as backup after Supabase migration)
├── .env                        # Secret env vars — never commit
├── requirements.txt
├── DESIGN.md                   # Notion-inspired design system specification
└── CLAUDE.md                   # This file
```

---

## Data Structure

### Task Object

The `children` field is **not stored** in Supabase. It is rebuilt at runtime by `_rebuild_children()` from `parent_id` relationships after every `load_tasks()` call.

```json
{
  "id": "uuid-string",
  "user_id": "supabase-auth-uuid",
  "title": "Task title",
  "done": false,
  "day": "2026-04-09",
  "deadline": "2026-04-09T18:00",
  "reminded": false,
  "priority": "normal",
  "parent_id": null,
  "children": [],
  "color": "blue",
  "notes": "Optional notes",
  "recurring": "daily",
  "recurring_origin": null,
  "recurring_end": null,
  "deleted_dates": [],
  "order": 0,
  "created_at": "2026-04-09T10:30:00",
  "estimated_time": 120,
  "ai_group_id": null
}
```

### Field Reference

| Field | Type | Description |
|-------|------|-------------|
| id | string | UUID primary key |
| user_id | string | Supabase auth.users UUID |
| title | string | Task title |
| done | boolean | Completion state |
| day | string | Date YYYY-MM-DD |
| deadline | string/null | Reminder time ISO format |
| reminded | boolean | Whether reminder has fired |
| priority | string | `normal` / `important` / `urgent` |
| parent_id | string/null | Parent task ID |
| children | array | Runtime-rebuilt, never stored |
| color | string/null | Color label key (see color system) |
| notes | string | Free-form notes |
| recurring | string/null | `daily` / `weekly` / `monthly` |
| recurring_origin | string/null | Instance → template task ID |
| recurring_end | string/null | Recurrence end date YYYY-MM-DD |
| deleted_dates | array | Dates skipped on template task |
| order | number | Sort order within day column |
| created_at | string | Creation time ISO |
| estimated_time | number/null | Estimated minutes |
| ai_group_id | string/null | AI decomposition batch ID |

### Supabase Table SQL

Run this in Supabase SQL Editor on every new deployment:

```sql
CREATE TABLE IF NOT EXISTS public.tasks (
  id                text        PRIMARY KEY,
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title             text        NOT NULL DEFAULT '',
  done              boolean     NOT NULL DEFAULT false,
  day               text,
  deadline          text,
  reminded          boolean     NOT NULL DEFAULT false,
  priority          text        NOT NULL DEFAULT 'normal',
  parent_id         text,
  color             text,
  notes             text        NOT NULL DEFAULT '',
  recurring         text,
  recurring_origin  text,
  recurring_end     text,
  deleted_dates     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "order"           integer     NOT NULL DEFAULT 0,
  created_at        text,
  estimated_time    integer,
  ai_group_id       text
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own tasks"
  ON public.tasks FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON public.tasks(user_id);
CREATE INDEX IF NOT EXISTS tasks_day_idx     ON public.tasks(day);
```

---

## API Routes

All task routes require `Authorization: Bearer <token>`.

### Auth Routes (no token required)

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/auth/register | Register with email + password |
| POST | /api/auth/login | Login, returns `access_token` |
| POST | /api/auth/logout | Invalidate session |
| GET | /api/auth/me | Returns `user_id` for current token |

### Task Routes (token required)

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/tasks | Get week tasks (`?week_start=YYYY-MM-DD`) |
| GET | /api/tasks/all | Get all tasks (all-tasks view) |
| POST | /api/tasks | Create task |
| PUT | /api/tasks/\<id\> | Update task (supports `scope`) |
| DELETE | /api/tasks/\<id\> | Delete task (supports `scope`) |
| POST | /api/tasks/\<id\>/subtasks | Add subtask |
| POST | /api/tasks/reorder | Bulk reorder (drag-and-drop) |
| GET | /api/stream | SSE reminder stream (no token needed) |
| POST | /api/ai/decompose | AI task decomposition |

### `scope` Parameter

Carried in PUT/DELETE request body (or query string for DELETE):

| scope | Behavior |
|-------|----------|
| `single` (default) | Current task only |
| `future` | This task and all future instances in the series |
| `ai_group` | All tasks in the same AI decomposition batch |

---

## Auth System

### Frontend (auth.js)

- `Auth` object manages JWT token in `localStorage['wp_auth_token']`
- `Auth.login()` / `Auth.register()` / `Auth.logout()` / `Auth.signInWithOAuth(provider)`
- `showAuthPage()` / `showAppPage()` toggle between auth and app views
- On load: if token present → show app and call `init()`; if not → show auth page
- OAuth (Google/GitHub): uses Supabase JS SDK (`supabase.createClient()`)
  - `signInWithOAuth({ provider, redirectTo })` triggers browser redirect
  - `_handleOAuthCallback()` checks URL hash on return, calls `client.auth.getSession()`, stores token
  - Hash is cleaned from URL with `history.replaceState()` after extraction

### Frontend (app.js)

- `api.call()` automatically injects `Authorization: Bearer <token>`
- 401 response → clears token, shows auth page
- `init()` is called by `auth.js`, not bound to `DOMContentLoaded` directly

### Backend (app.py)

- `@login_required` decorator: validates Bearer token → sets `flask.g.user_id`
- Uses `supabase_client.get_auth().auth.get_user(token)` for JWT validation

### Supabase Client (supabase_client.py)

| Function | Key Used | Purpose |
|----------|----------|---------|
| `get_db()` | `SUPABASE_SECRET_KEY` | All DB read/write (bypasses RLS) |
| `get_auth()` | `SUPABASE_ANON_KEY` | User registration, login, token validation |

**Proxy stripping**: `supabase_client.py` removes `HTTP_PROXY`, `HTTPS_PROXY`, and related env vars at module load time. This prevents system VPN/proxy settings (e.g. Clash) from intercepting and breaking Supabase HTTPS connections.

### OAuth Setup (Supabase Dashboard)

To enable Google/GitHub login:
1. Supabase Dashboard → Authentication → Providers
2. Enable Google: create OAuth app in Google Cloud Console, paste Client ID + Secret
3. Enable GitHub: create OAuth app in GitHub Developer Settings, paste Client ID + Secret
4. Add your app's redirect URL to each provider's allowlist: `https://your-domain.com/`
5. Add the Supabase callback URL to each provider (shown in Supabase Dashboard)

---

## Core Features & Logic

### 1. Week View Layout

- **6 columns**: Mon–Fri one column each, Sat+Sun merged into column 6 (`.weekend-col`)
- **Ruled lines**: `repeating-linear-gradient` every 40px, simulating notebook paper
- **Today highlight**: current date column gets `var(--today-bg)` background
- **Row height**: `.task-row { height: 40px }` must be exact — `min-height` causes misalignment with ruled lines when color pills are present

### 2. Parent/Child Tasks

- Max 2 levels (parent → child only)
- All children done → parent auto-completes
- Parent cannot be checked directly; state is driven by children
- Deleting a parent deletes all children (`delete_task_recursive`)

### 3. Recurring Tasks

Uses an **instantiation approach** (not virtual/computed tasks):

- DB stores one **template task** (`recurring_origin = null`)
- `generate_recurring_instances()` creates **real instances** (`recurring_origin = template_id`) for each week when the week view is loaded
- `deleted_dates` on the template records skipped dates
- `recurring_end` limits the series end date

```
daily   → show every day
weekly  → show on same weekday as template
monthly → show on same day-of-month as template
```

### 4. Color Label System (User-Customizable)

Colors are a user-defined label system, not a static enum:

- 5 built-in colors (keys are fixed; name/hex are user-editable):
  - `blue` → #4A90D9 (default: "Study")
  - `green` → #52B788 (default: "Relax")
  - `red` → #E8524A (default: "Urgent")
  - `yellow` → #F5A623 (default: "Focus")
  - `purple` → #9B59B6 (default: "Personal")
- Stored in `localStorage['user-colors']` as `[{key, hex, name}]`
- CSS rules injected dynamically by `injectColorStyles()` into `<style id="dynamic-color-styles">`
- `COLOR_MAP` is a Proxy object for backwards compatibility

### 5. Theme System

- `localStorage['theme-mode']`: `'light'` / `'dark'` / `'system'`
- `html[data-theme="dark"]` selector triggers dark variables
- Dark theme is **Notion Warm Dark** (brown-tinted neutrals, not deep blue):
  - `--bg: #31302e`, `--bg-subtle: #282624`
  - `--divider: rgba(255,255,255,0.1)`
  - `--ink: rgba(255,255,255,0.92)`, `--ink-light: rgba(255,255,255,0.58)`
- `applyTheme()` is called at the start of `init()` to prevent flash

### 6. Dashboard (All-Tasks view right panel)

Three data cards updated in real time with `renderDashboard(filtered)`:

| Card | Content | Data source |
|------|---------|-------------|
| Completion | Wave-animation circle, % done | Filtered root tasks |
| Weekly Schedule | Canvas bar chart, 7-day done/total | `state.tasks` full set (ignores date filter) |
| Color Distribution | SVG treemap + legend | Filtered root tasks |

- Treemap uses `squarify()` algorithm; tiles show count only
- Bar chart click → navigates to that week in week view

### 7. AI Task Decomposition

- Calls `/api/ai/decompose` → DeepSeek API
- Returns subtask list; user can bulk-add to schedule
- Batch tasks share an `ai_group_id` (`crypto.randomUUID()`)
- `scope=ai_group` operates on all tasks in a batch

### 8. Task Reminders

- APScheduler polls Supabase every minute for tasks where `reminded=false, done=false, deadline ≤ now`
- Updates `reminded=true` directly on the single record
- Broadcasts via SSE to all connected clients
- Frontend triggers browser `Notification` API

---

## UI Design System

Styles follow the specification in `DESIGN.md` (Notion-inspired warm neutral system).

### CSS Tokens — Light Theme (`:root`)

| Variable | Value | Purpose |
|----------|-------|---------|
| `--bg` | `#ffffff` | Main canvas |
| `--bg-subtle` | `#f6f5f4` | Warm white surface / today column |
| `--divider` | `rgba(0,0,0,0.1)` | Borders, ruled lines |
| `--header-text` | `#a39e98` | Weekday header labels |
| `--today-bg` | `#f6f5f4` | Today column background |
| `--accent` | `#0075de` | Notion Blue — primary CTA |
| `--accent-hover` | `#005bab` | Button hover state |
| `--accent-focus` | `#097fe8` | Focus ring |
| `--badge-bg` | `#f2f9ff` | Pill badge background |
| `--badge-text` | `#097fe8` | Pill badge text |
| `--urgent` | `#e53935` | Urgent priority |
| `--important` | `#f59e0b` | Important priority |
| `--ink` | `rgba(0,0,0,0.92)` | Body text |
| `--ink-light` | `#615d59` | Secondary text |
| `--ink-faint` | `#a39e98` | Placeholder / tertiary |
| `--radius` | `8px` | Standard radius |
| `--radius-sm` | `4px` | Button/input radius |
| `--radius-lg` | `12px` | Card/modal radius |
| `--shadow-card` | 4-layer warm shadow | Cards, menus |
| `--shadow-modal` | 5-layer deep shadow | Modals, panels |

### CSS Tokens — Dark Theme (`html[data-theme="dark"]`)

| Variable | Value |
|----------|-------|
| `--bg` | `#31302e` |
| `--bg-subtle` | `#282624` |
| `--divider` | `rgba(255,255,255,0.1)` |
| `--header-text` | `#6b6560` |
| `--today-bg` | `#282624` |
| `--accent` | `#62aef0` |
| `--accent-hover` | `#7fbff5` |
| `--badge-bg` | `rgba(98,174,240,0.18)` |
| `--badge-text` | `#62aef0` |
| `--ink` | `rgba(255,255,255,0.92)` |
| `--ink-light` | `rgba(255,255,255,0.58)` |
| `--ink-faint` | `rgba(255,255,255,0.3)` |

### Typography

- Font: `'Inter'` (Google Fonts, 400/500/600/700), with system fallbacks
- Font stack excludes CJK system fonts (Chinese chars render via Unicode fallback)
- Weight scale: 400 body, 500 UI interactive, 600 headings/labels, 700 display numbers

### Button Variants

| Variant | Style |
|---------|-------|
| Primary | `--accent` bg, white text, 4px radius, `scale(0.9)` active |
| Secondary | `rgba(0,0,0,0.05)` bg, `--ink` text |
| Ghost | Transparent, `--ink-light` text, underline on hover |
| Pill Badge (filter chips active) | `--badge-bg` bg, `--badge-text` text, 9999px radius, 600 weight |
| Destructive (sign out) | Ghost style, turns `--urgent` on hover with red-tinted border |

### Auth Page (Two-Column Layout)

- **Left column** (55%, `#f6f5f4`): WeekTODO logo + branding, headline, feature bullet points, decorative week-grid SVG illustration
- **Right column** (45%, `#ffffff`): OAuth buttons (Google, GitHub), email/password form with tab switcher
- Stacks vertically on screens ≤ 768px

### Sidebar

- Width: `64px`, fixed left
- WeekTODO SVG logo at top (36×36 white "W" on Notion Blue rounded square)
- Icon-only nav items, 40×40 touch target, 20px SVG icons
- `#app` has `margin-left: 64px`

### Sign Out

Sign out button lives in the Settings panel ("Account" section), not the sidebar. Uses ghost-destructive button style per DESIGN.md.

---

## Environment Variables

```env
# .env (never commit to git)

# AI service
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...   # Used for user auth + token validation (anon/publishable)
SUPABASE_SECRET_KEY=eyJ... # Used for DB read/write server-side (service_role/secret)
```

---

## Development Notes

1. **Keep it minimal**: no unnecessary decorations; animations are constrained (`150ms ease`)
2. **Color system**: always use `getColorHex(key)` / `getColorName(key)` — never hardcode hex values for task colors
3. **Recurring tasks**: `generate_recurring_instances()` writes real DB records; always pass correct `scope` on mutations
4. **`children` field**: never store in Supabase; always rebuilt by `_rebuild_children()` after `load_tasks()`
5. **Row height**: `.task-row` must use exact `height: 40px` — not `min-height` — or ruled lines misalign
6. **Script load order**: `auth.js` must load before `app.js`; it controls when `init()` is called
7. **API calls**: `api.call()` auto-injects the token; new routes must have `@login_required`
8. **Proxy env vars**: `supabase_client.py` strips `HTTP_PROXY`/`HTTPS_PROXY` at import time — do not remove this
9. **Supabase JS SDK**: loaded from CDN in `index.html`; `window.SUPABASE_URL` and `window.SUPABASE_ANON_KEY` are injected as template variables by Flask

### FAQs

**Q: How do I skip one occurrence of a recurring task?**
A: Add the date string to `deleted_dates` on the **template task**. `generate_recurring_instances()` will skip it.

**Q: What day does the week start on?**
A: Monday (ISO week). The last column is Sat+Sun merged.

**Q: What's the relationship between color and priority?**
A: Independent. Color is the task's background pill (user-chosen label). Priority is the left-edge dot (urgent = red, important = orange).

**Q: Why does `color` store a key like `"blue"` instead of a hex?**
A: Users can rename/recolor labels. Storing the key decouples data from presentation.

**Q: Why does OAuth fail with "Unsupported provider"?**
A: The provider hasn't been enabled in Supabase Dashboard. See the OAuth Setup section above.

---

## Completed Features

- [x] Week view (6-column layout, ruled lines, today highlight)
- [x] Parent/child tasks (max 2 levels, child-driven completion)
- [x] Task reminders (APScheduler + SSE + browser Notification)
- [x] Recurring tasks (instantiation model: daily/weekly/monthly)
- [x] Drag-and-drop reorder
- [x] Sidebar navigation (week view / all tasks)
- [x] All-tasks view (filter, search, sort)
- [x] Dashboard panel (wave progress circle, weekly bar chart, color treemap)
- [x] AI task decomposition (DeepSeek API)
- [x] Settings panel (theme switcher, color label customization)
- [x] Light/dark/system theme (Notion Warm Dark palette)
- [x] User auth (Supabase Auth — email/password + OAuth Google/GitHub)
- [x] Cloud persistence (Supabase PostgreSQL + RLS)
- [x] Notion-inspired UI redesign (Inter font, warm neutrals, multi-layer shadows, DESIGN.md)
- [x] English-only UI
- [x] Two-column auth page (WeekTODO branding + feature marketing)
- [x] WeekTODO logo (SVG, inline)
- [x] Sign Out moved to Settings panel (ghost-destructive button)

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-04-09 | Initial version — core week view features |
| 2026-04-10 | Recurring task fix — switched to instantiation model |
| 2026-04-10 | UI: color as background pill, add ruled lines |
| 2026-04-11 | Dashboard, settings panel, dark theme, color label customization |
| 2026-04-11 | Supabase auth + cloud persistence |
| 2026-04-11 | Notion UI redesign: DESIGN.md tokens, Inter font, Warm Dark theme |
| 2026-04-11 | English-only UI, two-column auth page, WeekTODO branding |
| 2026-04-11 | OAuth (Google/GitHub) via Supabase JS SDK |
| 2026-04-11 | Sidebar: 64px width, WeekTODO logo, sign out moved to settings |
| 2026-04-11 | Supabase proxy stripping fix (VPN/Clash compatibility) |

---

*Last updated: 2026-04-11*
