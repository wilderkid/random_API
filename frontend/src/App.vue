<template>
  <div v-if="authLoading" class="auth-loading">
    <div class="auth-loading-text">正在检查登录状态...</div>
  </div>

  <div v-else-if="!authenticated" class="login-page">
    <form class="login-panel" @submit.prevent="login">
      <div class="login-brand">Random_API</div>
      <h1>登录</h1>
      <p>请输入管理员账号以继续访问控制台。</p>

      <label>
        <span>用户名</span>
        <input v-model.trim="loginForm.username" type="text" autocomplete="username" required>
      </label>

      <label>
        <span>密码</span>
        <input v-model="loginForm.password" type="password" autocomplete="current-password" required>
      </label>

      <div v-if="loginError" class="login-error">{{ loginError }}</div>

      <button type="submit" :disabled="loginSubmitting">
        {{ loginSubmitting ? '登录中...' : '登录' }}
      </button>
    </form>
  </div>

  <div v-else class="app">
    <nav class="navbar">
      <div class="nav-brand">
        <span>Random_API</span>
        <span v-if="currentUser" class="nav-user">{{ currentUser.displayName || currentUser.username }}</span>
      </div>
      <button
        class="nav-menu-toggle"
        type="button"
        :aria-expanded="mobileMenuOpen ? 'true' : 'false'"
        aria-label="切换导航菜单"
        @click="mobileMenuOpen = !mobileMenuOpen"
      >
        <span></span>
        <span></span>
        <span></span>
      </button>
      <div :class="['nav-links', { 'is-open': mobileMenuOpen }]" @click="mobileMenuOpen = false">
        <router-link to="/">聊天</router-link>
        <router-link to="/translate">翻译</router-link>
        <router-link to="/settings/apis">API 管理</router-link>
        <router-link to="/settings/polling">轮询配置</router-link>
        <router-link to="/settings/proxy-keys">代理密钥</router-link>
        <router-link to="/settings/defaults">用户设置</router-link>
        <router-link to="/prompts">提示词库</router-link>
        <router-link to="/logs">日志</router-link>
        <router-link to="/stats">统计</router-link>
        <button class="nav-logout" type="button" @click="logout">退出</button>
      </div>
    </nav>
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'

const mobileMenuOpen = ref(false)
const authLoading = ref(true)
const authenticated = ref(false)
const currentUser = ref(null)
const loginSubmitting = ref(false)
const loginError = ref('')
const loginForm = ref({
  username: '',
  password: ''
})

async function checkAuth() {
  authLoading.value = true
  try {
    const response = await fetch('/api/auth/me')
    if (!response.ok) {
      authenticated.value = false
      currentUser.value = null
      return
    }

    const data = await response.json()
    authenticated.value = Boolean(data.authenticated)
    currentUser.value = data.user || null
  } catch {
    authenticated.value = false
    currentUser.value = null
  } finally {
    authLoading.value = false
  }
}

async function login() {
  loginSubmitting.value = true
  loginError.value = ''

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginForm.value)
    })
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      loginError.value = data.error || '登录失败'
      return
    }

    authenticated.value = true
    currentUser.value = data.user || null
    loginForm.value.password = ''
  } catch {
    loginError.value = '无法连接后端服务'
  } finally {
    loginSubmitting.value = false
  }
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' })
  } finally {
    authenticated.value = false
    currentUser.value = null
    mobileMenuOpen.value = false
  }
}

onMounted(checkAuth)
</script>

<style scoped>
.auth-loading,
.login-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.auth-loading-text {
  color: #475569;
  font-size: 0.95rem;
}

.login-panel {
  width: min(100%, 380px);
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(203, 213, 225, 0.9);
  border-radius: 8px;
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.1);
  padding: 1.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.login-brand {
  color: #0891b2;
  font-size: 0.92rem;
  font-weight: 700;
}

.login-panel h1 {
  font-size: 1.45rem;
  color: #0f172a;
}

.login-panel p {
  color: #64748b;
  font-size: 0.92rem;
  line-height: 1.5;
}

.login-panel label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  color: #334155;
  font-size: 0.9rem;
  font-weight: 600;
}

.login-panel input {
  height: 42px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 0 0.75rem;
  font: inherit;
  color: #0f172a;
  background: #fff;
  outline: none;
}

.login-panel input:focus {
  border-color: #0891b2;
  box-shadow: 0 0 0 3px rgba(8, 145, 178, 0.12);
}

.login-error {
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 0.65rem 0.75rem;
  font-size: 0.88rem;
}

.login-panel button,
.nav-logout {
  border: none;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}

.login-panel button {
  height: 42px;
  border-radius: 6px;
  background: #0891b2;
  color: #fff;
}

.login-panel button:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.nav-brand {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

.nav-user {
  color: #64748b;
  font-size: 0.78rem;
  font-weight: 600;
}

.nav-logout {
  color: #5b6b80;
  background: rgba(226, 232, 240, 0.6);
  padding: 0.48rem 0.86rem;
  border-radius: 999px;
  font-size: 0.9rem;
}

.nav-logout:hover {
  color: #0f172a;
  background: rgba(226, 232, 240, 0.9);
}
</style>
