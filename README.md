# WeekTODO

A minimal week-view task manager that feels like writing on paper.

---

## Overview

WeekTODO gives you a clean, ruled-line week grid as your primary workspace. No dashboards cluttering your focus — just seven days, your tasks, and a calm, Notion-inspired interface.

**Key features:**
- Paper-like week view with notebook ruled lines
- Parent/child task hierarchy (up to 2 levels)
- Recurring tasks (daily / weekly / monthly)
- AI-powered task decomposition (DeepSeek)
- Statistics dashboard with progress circle, weekly bar chart, and color treemap
- Deadline reminders via browser notifications + SSE push
- Fully customizable color labels
- Light / Dark / System theme (Notion Warm Dark palette)
- Cloud sync via Supabase (multi-user, each user sees only their own tasks)
- Sign in with Google or GitHub (OAuth)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11 + Flask 3.x |
| Auth | Supabase Auth (email/password + OAuth) |
| Database | Supabase PostgreSQL (Row Level Security) |
| Scheduler | APScheduler (deadline reminders) |
| Frontend | Vanilla HTML / CSS / JavaScript (no framework) |
| AI | DeepSeek API |
| Fonts | Inter (Google Fonts) |

---

## Getting Started

### 1. Prerequisites

- Python 3.11+
- A [Supabase](https://supabase.com) project (free tier is fine)
- A [DeepSeek](https://platform.deepseek.com) API key (for AI decomposition)

### 2. Clone & Install

```bash
git clone https://github.com/your-username/week-planner.git
cd week-planner
pip install -r requirements.txt
```

### 3. Configure Environment Variables

Create a `.env` file in the project root:

```env
# AI service
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...     # Publishable / anon key
SUPABASE_SECRET_KEY=eyJ...   # service_role / secret key
```

> **Where to find your Supabase keys:** Project Settings → API

### 4. Initialize the Database

In [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql), run:

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

### 5. Run

```bash
python src/app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000).

---

## OAuth Setup (Google & GitHub)

To enable "Continue with Google / GitHub":

### Google

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Add authorized redirect URI: `https://<your-supabase-project>.supabase.co/auth/v1/callback`
4. Copy Client ID and Client Secret
5. In Supabase Dashboard → Authentication → Providers → Google: enable, paste credentials

### GitHub

1. Go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Set Authorization callback URL: `https://<your-supabase-project>.supabase.co/auth/v1/callback`
3. Copy Client ID and Client Secret
4. In Supabase Dashboard → Authentication → Providers → GitHub: enable, paste credentials

### Allowed Redirect URLs

In Supabase Dashboard → Authentication → URL Configuration, add your app's origin:

```
http://localhost:5000
https://your-production-domain.com
```

---

## Project Structure

```
src/
├── app.py              # Flask routes (REST API + SSE stream)
├── models.py           # Task model, Supabase read/write, recurring logic
├── supabase_client.py  # Supabase client factory (proxy-safe)
├── scheduler.py        # APScheduler — fires deadline reminders
├── ai_service.py       # DeepSeek task decomposition
├── templates/
│   └── index.html      # Single-page app shell
└── static/
    ├── style.css        # All styles (Notion design tokens, dark theme)
    ├── auth.js          # Auth: login/register forms + OAuth flow
    └── app.js           # App: week view, all-tasks, dashboard, settings
```

---

## API Reference

All task endpoints require `Authorization: Bearer <token>`.

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register with email + password |
| POST | `/api/auth/login` | Login → returns `access_token` |
| POST | `/api/auth/logout` | Invalidate session |
| GET | `/api/auth/me` | Get current user info |

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | Week tasks (`?week_start=YYYY-MM-DD`) |
| GET | `/api/tasks/all` | All tasks |
| POST | `/api/tasks` | Create task |
| PUT | `/api/tasks/<id>` | Update task |
| DELETE | `/api/tasks/<id>` | Delete task |
| POST | `/api/tasks/<id>/subtasks` | Add subtask |
| POST | `/api/tasks/reorder` | Bulk reorder (drag-and-drop) |
| GET | `/api/stream` | SSE reminder push stream |
| POST | `/api/ai/decompose` | AI task decomposition |

**`scope` parameter** (for PUT/DELETE):

| Value | Behavior |
|-------|----------|
| `single` | Current task only (default) |
| `future` | This task + all future recurrences |
| `ai_group` | All tasks in the same AI batch |

---

## Color Labels

WeekTODO uses a user-customizable color label system. Five built-in labels (key is fixed; name and hex can be changed in Settings):

| Key | Default Name | Default Color |
|-----|-------------|---------------|
| `blue` | Study | #4A90D9 |
| `green` | Relax | #52B788 |
| `red` | Urgent | #E8524A |
| `yellow` | Focus | #F5A623 |
| `purple` | Personal | #9B59B6 |

Colors are stored as keys (not hex values) in the database, so renaming a label updates everywhere automatically.

---

## Recurring Tasks

WeekTODO uses an **instantiation model**:

- One **template task** is stored in the database (`recurring_origin = null`)
- When you navigate to a week, real instances are generated and saved (`recurring_origin = template_id`)
- Skipping one occurrence records the date in `deleted_dates` on the template
- `recurring_end` stops the series after a given date

Recurrence modes: `daily`, `weekly` (same weekday), `monthly` (same day-of-month).

---

## Design System

Styles follow a Notion-inspired design system (`DESIGN.md`):

- **Font**: Inter 400/500/600/700 (Google Fonts)
- **Accent**: Notion Blue `#0075de`
- **Light theme**: warm white canvas (`#ffffff`), whisper borders (`rgba(0,0,0,0.1)`), 4-layer card shadow
- **Dark theme**: Notion Warm Dark — brown-tinted neutrals (`#31302e` / `#282624`)
- **Radii**: 4px buttons, 8px standard, 12px cards/modals
- **Animations**: `150ms ease` — fast and understated

---

## Known Limitations

- Data is stored per-user in Supabase; no sharing or collaboration
- AI decomposition requires a valid DeepSeek API key
- Browser notifications require user permission grant
- OAuth providers must be manually enabled in Supabase Dashboard

---

## License

MIT
