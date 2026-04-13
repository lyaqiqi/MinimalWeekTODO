# Supabase 用户系统集成

请为项目添加用户注册/登录系统，使用 Supabase 作为后端服务。

---

## 第一步：环境配置

### 更新 `.env` 文件

在现有 `.env` 文件中添加：

```env
# Supabase 配置
SUPABASE_URL=https://tuiidrysfeqhygbtjabp.supabase.co
SUPABASE_ANON_KEY=sb_publishable__-LZbuAMoXV1C3ncBfB4zA_Jx_xiMxC
SUPABASE_SECRET_KEY=sb_secret_abylIj_1x9-7KplLyAOQxw_ubde-NPp
```

### 安装依赖

更新 `requirements.txt`，添加：

```
supabase>=2.0.0
```

然后运行：
```bash
pip install supabase
```

---

## 第二步：创建数据库表

在 Supabase 控制台中执行以下 SQL（点击左侧 SQL Editor → New Query）：

```sql
-- 创建 tasks 表
CREATE TABLE tasks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    done BOOLEAN DEFAULT FALSE,
    day DATE NOT NULL,
    deadline TIMESTAMPTZ,
    reminded BOOLEAN DEFAULT FALSE,
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('normal', 'important', 'urgent')),
    parent_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    color TEXT,
    notes TEXT DEFAULT '',
    recurring TEXT CHECK (recurring IN ('daily', 'weekly', 'monthly', NULL)),
    recurring_end DATE,
    completed_dates DATE[] DEFAULT '{}',
    "order" INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    estimated_time INTEGER
);

-- 创建索引
CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_day ON tasks(day);
CREATE INDEX idx_tasks_parent_id ON tasks(parent_id);

-- 启用 Row Level Security (RLS)
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- 创建 RLS 策略：用户只能访问自己的任务
CREATE POLICY "Users can view own tasks" ON tasks
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tasks" ON tasks
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tasks" ON tasks
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own tasks" ON tasks
    FOR DELETE USING (auth.uid() = user_id);
```

---

## 第三步：后端改造

### 新建 `src/supabase_client.py`

```python
import os
from supabase import create_client, Client

def get_supabase_client() -> Client:
    """获取 Supabase 客户端"""
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SECRET_KEY")  # 后端使用 secret key
    return create_client(url, key)

def get_supabase_anon_client() -> Client:
    """获取 Supabase 匿名客户端（用于用户认证）"""
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_ANON_KEY")
    return create_client(url, key)
```

### 修改 `src/models.py`

将 JSON 文件操作改为 Supabase 数据库操作：

```python
from supabase_client import get_supabase_client
from datetime import datetime, date
import uuid

supabase = get_supabase_client()

def get_tasks_for_user(user_id: str, week_start: str = None) -> list:
    """获取用户的任务"""
    query = supabase.table('tasks').select('*').eq('user_id', user_id)
    
    if week_start:
        # 计算一周的日期范围
        from datetime import datetime, timedelta
        start = datetime.strptime(week_start, '%Y-%m-%d').date()
        end = start + timedelta(days=6)
        query = query.gte('day', week_start).lte('day', end.isoformat())
    
    result = query.order('order').execute()
    return result.data

def get_all_tasks_for_user(user_id: str) -> list:
    """获取用户的所有任务"""
    result = supabase.table('tasks').select('*').eq('user_id', user_id).order('day', desc=True).execute()
    return result.data

def create_task(user_id: str, task_data: dict) -> dict:
    """创建任务"""
    task_data['user_id'] = user_id
    task_data['id'] = str(uuid.uuid4())
    task_data['created_at'] = datetime.now().isoformat()
    
    result = supabase.table('tasks').insert(task_data).execute()
    return result.data[0] if result.data else None

def update_task(user_id: str, task_id: str, updates: dict) -> dict:
    """更新任务"""
    result = supabase.table('tasks').update(updates).eq('id', task_id).eq('user_id', user_id).execute()
    return result.data[0] if result.data else None

def delete_task(user_id: str, task_id: str) -> bool:
    """删除任务"""
    # 先删除子任务
    supabase.table('tasks').delete().eq('parent_id', task_id).eq('user_id', user_id).execute()
    # 再删除任务本身
    result = supabase.table('tasks').delete().eq('id', task_id).eq('user_id', user_id).execute()
    return len(result.data) > 0

def get_task_by_id(user_id: str, task_id: str) -> dict:
    """获取单个任务"""
    result = supabase.table('tasks').select('*').eq('id', task_id).eq('user_id', user_id).single().execute()
    return result.data

def create_subtask(user_id: str, parent_id: str, subtask_data: dict) -> dict:
    """创建子任务"""
    parent = get_task_by_id(user_id, parent_id)
    if not parent:
        return None
    
    subtask_data['user_id'] = user_id
    subtask_data['parent_id'] = parent_id
    subtask_data['day'] = parent['day']  # 继承父任务日期
    subtask_data['id'] = str(uuid.uuid4())
    subtask_data['created_at'] = datetime.now().isoformat()
    
    result = supabase.table('tasks').insert(subtask_data).execute()
    return result.data[0] if result.data else None
```

### 修改 `src/app.py`

添加用户认证和修改 API 路由：

```python
from flask import Flask, request, jsonify, render_template, session
from functools import wraps
from dotenv import load_dotenv
from supabase_client import get_supabase_anon_client
import models
import os

load_dotenv()

app = Flask(__name__)
app.secret_key = os.urandom(24)  # 用于 session

# ============ 认证相关 ============

def login_required(f):
    """登录验证装饰器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'error': '未登录'}), 401
        
        token = auth_header.split(' ')[1]
        
        try:
            # 验证 token
            supabase = get_supabase_anon_client()
            user = supabase.auth.get_user(token)
            if not user:
                return jsonify({'error': '登录已过期'}), 401
            request.user_id = user.user.id
        except Exception as e:
            return jsonify({'error': '登录验证失败'}), 401
        
        return f(*args, **kwargs)
    return decorated_function

def get_current_user_id():
    """获取当前用户 ID"""
    return request.user_id

# ============ 认证 API ============

@app.route('/api/auth/register', methods=['POST'])
def register():
    """用户注册"""
    data = request.json
    email = data.get('email', '').strip()
    password = data.get('password', '').strip()
    
    if not email or not password:
        return jsonify({'success': False, 'error': '请输入邮箱和密码'})
    
    if len(password) < 6:
        return jsonify({'success': False, 'error': '密码至少6位'})
    
    try:
        supabase = get_supabase_anon_client()
        result = supabase.auth.sign_up({
            'email': email,
            'password': password
        })
        
        if result.user:
            return jsonify({
                'success': True,
                'message': '注册成功！请查收验证邮件',
                'user': {
                    'id': result.user.id,
                    'email': result.user.email
                }
            })
        else:
            return jsonify({'success': False, 'error': '注册失败'})
            
    except Exception as e:
        error_msg = str(e)
        if 'already registered' in error_msg.lower():
            return jsonify({'success': False, 'error': '该邮箱已注册'})
        return jsonify({'success': False, 'error': f'注册失败: {error_msg}'})

@app.route('/api/auth/login', methods=['POST'])
def login():
    """用户登录"""
    data = request.json
    email = data.get('email', '').strip()
    password = data.get('password', '').strip()
    
    if not email or not password:
        return jsonify({'success': False, 'error': '请输入邮箱和密码'})
    
    try:
        supabase = get_supabase_anon_client()
        result = supabase.auth.sign_in_with_password({
            'email': email,
            'password': password
        })
        
        if result.user and result.session:
            return jsonify({
                'success': True,
                'user': {
                    'id': result.user.id,
                    'email': result.user.email
                },
                'access_token': result.session.access_token,
                'refresh_token': result.session.refresh_token
            })
        else:
            return jsonify({'success': False, 'error': '登录失败'})
            
    except Exception as e:
        error_msg = str(e)
        if 'invalid' in error_msg.lower():
            return jsonify({'success': False, 'error': '邮箱或密码错误'})
        return jsonify({'success': False, 'error': f'登录失败: {error_msg}'})

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    """用户登出"""
    return jsonify({'success': True})

@app.route('/api/auth/me', methods=['GET'])
@login_required
def get_current_user():
    """获取当前用户信息"""
    auth_header = request.headers.get('Authorization')
    token = auth_header.split(' ')[1]
    
    try:
        supabase = get_supabase_anon_client()
        user = supabase.auth.get_user(token)
        return jsonify({
            'success': True,
            'user': {
                'id': user.user.id,
                'email': user.user.email
            }
        })
    except:
        return jsonify({'success': False, 'error': '获取用户信息失败'}), 401

# ============ 任务 API（需要登录） ============

@app.route('/api/tasks', methods=['GET'])
@login_required
def get_tasks():
    """获取任务列表"""
    user_id = get_current_user_id()
    week_start = request.args.get('week_start')
    
    tasks = models.get_tasks_for_user(user_id, week_start)
    return jsonify(tasks)

@app.route('/api/tasks/all', methods=['GET'])
@login_required
def get_all_tasks():
    """获取所有任务"""
    user_id = get_current_user_id()
    tasks = models.get_all_tasks_for_user(user_id)
    return jsonify(tasks)

@app.route('/api/tasks', methods=['POST'])
@login_required
def create_task():
    """创建任务"""
    user_id = get_current_user_id()
    data = request.json
    
    task = models.create_task(user_id, data)
    if task:
        return jsonify({'success': True, 'task': task})
    return jsonify({'success': False, 'error': '创建失败'}), 400

@app.route('/api/tasks/<task_id>', methods=['PUT'])
@login_required
def update_task(task_id):
    """更新任务"""
    user_id = get_current_user_id()
    data = request.json
    
    task = models.update_task(user_id, task_id, data)
    if task:
        return jsonify({'success': True, 'task': task})
    return jsonify({'success': False, 'error': '更新失败'}), 400

@app.route('/api/tasks/<task_id>', methods=['DELETE'])
@login_required
def delete_task(task_id):
    """删除任务"""
    user_id = get_current_user_id()
    
    if models.delete_task(user_id, task_id):
        return jsonify({'success': True})
    return jsonify({'success': False, 'error': '删除失败'}), 400

@app.route('/api/tasks/<task_id>/subtasks', methods=['POST'])
@login_required
def create_subtask(task_id):
    """创建子任务"""
    user_id = get_current_user_id()
    data = request.json
    
    subtask = models.create_subtask(user_id, task_id, data)
    if subtask:
        return jsonify({'success': True, 'task': subtask})
    return jsonify({'success': False, 'error': '创建子任务失败'}), 400

# AI 拆解接口也需要登录
@app.route('/api/ai/decompose', methods=['POST'])
@login_required
def api_decompose_task():
    """AI 任务拆解"""
    from ai_service import decompose_task
    
    data = request.json
    task_title = data.get('task_title', '').strip()
    context = data.get('context', '').strip()
    
    if not task_title:
        return jsonify({"success": False, "error": "请输入任务标题"})
    
    result = decompose_task(task_title, context)
    return jsonify(result)
```

---

## 第四步：前端改造

### 新增 `src/static/auth.js`

```javascript
// ============ 认证状态管理 ============

const Auth = {
    // 获取存储的 token
    getToken() {
        return localStorage.getItem('access_token');
    },
    
    // 获取用户信息
    getUser() {
        const user = localStorage.getItem('user');
        return user ? JSON.parse(user) : null;
    },
    
    // 保存登录信息
    saveAuth(data) {
        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('refresh_token', data.refresh_token);
        localStorage.setItem('user', JSON.stringify(data.user));
    },
    
    // 清除登录信息
    clearAuth() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
    },
    
    // 是否已登录
    isLoggedIn() {
        return !!this.getToken();
    },
    
    // 带认证的 fetch 请求
    async fetch(url, options = {}) {
        const token = this.getToken();
        
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        const response = await fetch(url, {
            ...options,
            headers
        });
        
        // 如果 401，说明 token 过期，需要重新登录
        if (response.status === 401) {
            this.clearAuth();
            showAuthPage();
            throw new Error('登录已过期，请重新登录');
        }
        
        return response;
    },
    
    // 注册
    async register(email, password) {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        return response.json();
    },
    
    // 登录
    async login(email, password) {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();
        
        if (data.success) {
            this.saveAuth(data);
        }
        
        return data;
    },
    
    // 登出
    logout() {
        this.clearAuth();
        showAuthPage();
    }
};

// ============ 页面切换 ============

function showAuthPage() {
    document.getElementById('auth-page').style.display = 'flex';
    document.getElementById('app-container').style.display = 'none';
}

function showAppPage() {
    document.getElementById('auth-page').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    // 加载任务数据
    loadTasks();
}

// ============ 页面初始化 ============

document.addEventListener('DOMContentLoaded', () => {
    if (Auth.isLoggedIn()) {
        showAppPage();
    } else {
        showAuthPage();
    }
});
```

### 修改 `src/templates/index.html`

在 `<body>` 开头添加登录页面：

```html
<body>
    <!-- ========== 登录/注册页面 ========== -->
    <div id="auth-page" class="auth-page">
        <div class="auth-container">
            <h1 class="auth-title">📅 极简周计划</h1>
            <p class="auth-subtitle">让任务管理回归简洁</p>
            
            <!-- 登录表单 -->
            <div id="login-form" class="auth-form">
                <h2>登录</h2>
                <div class="form-group">
                    <input type="email" id="login-email" placeholder="邮箱" autocomplete="email">
                </div>
                <div class="form-group">
                    <input type="password" id="login-password" placeholder="密码" autocomplete="current-password">
                </div>
                <div id="login-error" class="auth-error"></div>
                <button id="login-btn" class="auth-btn primary">登录</button>
                <p class="auth-switch">
                    还没有账号？<a href="#" id="show-register">立即注册</a>
                </p>
            </div>
            
            <!-- 注册表单 -->
            <div id="register-form" class="auth-form" style="display: none;">
                <h2>注册</h2>
                <div class="form-group">
                    <input type="email" id="register-email" placeholder="邮箱" autocomplete="email">
                </div>
                <div class="form-group">
                    <input type="password" id="register-password" placeholder="密码（至少6位）" autocomplete="new-password">
                </div>
                <div class="form-group">
                    <input type="password" id="register-password-confirm" placeholder="确认密码" autocomplete="new-password">
                </div>
                <div id="register-error" class="auth-error"></div>
                <button id="register-btn" class="auth-btn primary">注册</button>
                <p class="auth-switch">
                    已有账号？<a href="#" id="show-login">返回登录</a>
                </p>
            </div>
        </div>
    </div>
    
    <!-- ========== 主应用（原有内容） ========== -->
    <div id="app-container" class="app-container" style="display: none;">
        <!-- 原有的侧边栏和主内容 -->
        ...
    </div>
    
    <!-- 引入 auth.js（在 app.js 之前） -->
    <script src="/static/auth.js"></script>
    <script src="/static/app.js"></script>
</body>
```

### 新增样式 `src/static/style.css`（添加到末尾）

```css
/* ============ 登录/注册页面 ============ */

.auth-page {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    background-color: #FAFAF8;
}

.auth-container {
    width: 100%;
    max-width: 400px;
    padding: 40px;
    text-align: center;
}

.auth-title {
    font-size: 28px;
    font-weight: 400;
    color: #333;
    margin-bottom: 8px;
}

.auth-subtitle {
    font-size: 14px;
    color: #AAAAAA;
    margin-bottom: 40px;
}

.auth-form {
    background: white;
    padding: 32px;
    border-radius: 12px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.auth-form h2 {
    font-size: 20px;
    font-weight: 400;
    margin-bottom: 24px;
    color: #333;
}

.form-group {
    margin-bottom: 16px;
}

.form-group input {
    width: 100%;
    padding: 12px 16px;
    border: 1px solid #E8E8E4;
    border-radius: 8px;
    font-size: 14px;
    transition: border-color 0.2s ease;
    box-sizing: border-box;
}

.form-group input:focus {
    outline: none;
    border-color: #4A90D9;
}

.auth-error {
    color: #E8524A;
    font-size: 13px;
    margin-bottom: 16px;
    min-height: 20px;
}

.auth-btn {
    width: 100%;
    padding: 12px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    cursor: pointer;
    transition: opacity 0.2s ease;
}

.auth-btn.primary {
    background-color: #4A90D9;
    color: white;
}

.auth-btn.primary:hover {
    opacity: 0.9;
}

.auth-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.auth-switch {
    margin-top: 20px;
    font-size: 13px;
    color: #AAAAAA;
}

.auth-switch a {
    color: #4A90D9;
    text-decoration: none;
}

.auth-switch a:hover {
    text-decoration: underline;
}

/* 用户信息（显示在侧边栏底部或顶部） */
.user-info {
    padding: 12px;
    border-top: 1px solid #E8E8E4;
    font-size: 12px;
    color: #AAAAAA;
}

.logout-btn {
    background: none;
    border: none;
    color: #4A90D9;
    cursor: pointer;
    font-size: 12px;
    padding: 4px 8px;
}

.logout-btn:hover {
    text-decoration: underline;
}
```

### 添加登录交互逻辑（在 `auth.js` 末尾添加）

```javascript
// ============ 登录/注册表单交互 ============

document.addEventListener('DOMContentLoaded', () => {
    // 切换到注册表单
    document.getElementById('show-register')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('register-form').style.display = 'block';
    });
    
    // 切换到登录表单
    document.getElementById('show-login')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('login-form').style.display = 'block';
    });
    
    // 登录
    document.getElementById('login-btn')?.addEventListener('click', async () => {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const errorEl = document.getElementById('login-error');
        const btn = document.getElementById('login-btn');
        
        errorEl.textContent = '';
        btn.disabled = true;
        btn.textContent = '登录中...';
        
        try {
            const result = await Auth.login(email, password);
            if (result.success) {
                showAppPage();
            } else {
                errorEl.textContent = result.error;
            }
        } catch (e) {
            errorEl.textContent = '登录失败，请重试';
        } finally {
            btn.disabled = false;
            btn.textContent = '登录';
        }
    });
    
    // 注册
    document.getElementById('register-btn')?.addEventListener('click', async () => {
        const email = document.getElementById('register-email').value.trim();
        const password = document.getElementById('register-password').value;
        const passwordConfirm = document.getElementById('register-password-confirm').value;
        const errorEl = document.getElementById('register-error');
        const btn = document.getElementById('register-btn');
        
        errorEl.textContent = '';
        
        if (password !== passwordConfirm) {
            errorEl.textContent = '两次密码输入不一致';
            return;
        }
        
        btn.disabled = true;
        btn.textContent = '注册中...';
        
        try {
            const result = await Auth.register(email, password);
            if (result.success) {
                // 注册成功，提示用户验证邮箱（或直接登录）
                errorEl.style.color = '#52C41A';
                errorEl.textContent = '注册成功！请查收验证邮件，然后登录';
                // 切换到登录表单
                setTimeout(() => {
                    document.getElementById('register-form').style.display = 'none';
                    document.getElementById('login-form').style.display = 'block';
                    errorEl.style.color = '#E8524A';
                }, 2000);
            } else {
                errorEl.textContent = result.error;
            }
        } catch (e) {
            errorEl.textContent = '注册失败，请重试';
        } finally {
            btn.disabled = false;
            btn.textContent = '注册';
        }
    });
    
    // 回车提交
    document.getElementById('login-password')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('login-btn').click();
    });
    
    document.getElementById('register-password-confirm')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('register-btn').click();
    });
});
```

### 修改 `app.js` 中的 fetch 调用

将所有 `fetch('/api/...')` 改为 `Auth.fetch('/api/...')`：

```javascript
// 例如，原来是：
fetch('/api/tasks')

// 改为：
Auth.fetch('/api/tasks')
```

### 在侧边栏底部添加登出按钮

```html
<nav class="sidebar">
    <!-- 现有导航项 -->
    <a href="#" class="nav-item" data-view="week">...</a>
    <a href="#" class="nav-item" data-view="list">...</a>
    <a href="#" class="nav-item" id="ai-assistant-btn">...</a>
    
    <!-- 底部用户区域 -->
    <div class="sidebar-bottom">
        <button class="logout-btn" onclick="Auth.logout()" title="退出登录">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
        </button>
    </div>
</nav>
```

---

## 第五步：禁用邮箱验证（可选，方便测试）

如果你希望注册后不需要验证邮箱就能登录：

1. 打开 Supabase 控制台
2. 左侧 **Authentication** → **Providers** → **Email**
3. 关闭 **Confirm email** 选项

---

## 验证清单

修改完成后，请测试：

- [ ] 打开页面显示登录界面
- [ ] 可以切换到注册界面
- [ ] 注册新用户成功
- [ ] 登录成功后进入主应用
- [ ] 创建任务成功（数据保存到 Supabase）
- [ ] 刷新页面后仍保持登录状态
- [ ] 任务数据仍然存在
- [ ] 点击登出按钮返回登录页
- [ ] 不同用户的数据相互隔离

---

## 文件修改清单

| 文件 | 操作 |
|------|------|
| `.env` | 添加 Supabase 配置 |
| `requirements.txt` | 添加 supabase |
| `src/supabase_client.py` | 新建 |
| `src/models.py` | 重写，改用 Supabase |
| `src/app.py` | 添加认证路由和装饰器 |
| `src/static/auth.js` | 新建 |
| `src/static/style.css` | 添加登录页样式 |
| `src/static/app.js` | fetch 改为 Auth.fetch |
| `src/templates/index.html` | 添加登录页 HTML |

请按照以上步骤实现用户系统。
