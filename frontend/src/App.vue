<template>
  <div v-if="authLoading" class="auth-loading">
    <div class="auth-pulse"></div>
    <div class="auth-loading-text">正在检查登录状态</div>
  </div>

  <div v-else-if="!authenticated" class="login-page">
    <form class="login-panel" @submit.prevent="login">
      <div class="login-brand">
        <span class="brand-mark"></span>
        Random_API
      </div>
      <h1>登录控制台</h1>
      <p>用管理员账号进入聊天、翻译和模型中转。</p>

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
        {{ loginSubmitting ? '登录中...' : '进入' }}
      </button>
    </form>
  </div>

  <div v-else class="app">
    <nav class="navbar">
      <div class="nav-brand">
        <span class="brand-mark"></span>
        <div class="brand-copy">
          <strong>Random_API</strong>
          <span v-if="currentUser" class="nav-user">{{ currentUser.displayName || currentUser.username }}</span>
        </div>
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
        <router-link to="/"><PhChatTeardrop :size="18" weight="bold" />聊天</router-link>
        <router-link to="/translate"><PhTranslate :size="18" weight="bold" />翻译</router-link>
        <router-link to="/settings/apis"><PhPlugs :size="18" weight="bold" />API 管理</router-link>
        <router-link to="/settings/polling"><PhArrowsClockwise :size="18" weight="bold" />轮询配置</router-link>
        <router-link to="/settings/proxy-keys"><PhKey :size="18" weight="bold" />代理密钥</router-link>
        <router-link to="/settings/defaults"><PhGearSix :size="18" weight="bold" />用户设置</router-link>
        <router-link to="/prompts"><PhBookOpenText :size="18" weight="bold" />提示词库</router-link>
        <router-link to="/logs"><PhScroll :size="18" weight="bold" />日志</router-link>
        <router-link to="/stats"><PhChartLine :size="18" weight="bold" />统计</router-link>
        <button class="nav-logout" type="button" @click="logout">
          <PhSignOut :size="18" weight="bold" />退出
        </button>
      </div>
    </nav>
    <main class="main-content">
      <router-view v-slot="{ Component, route }">
        <transition name="page" mode="out-in">
          <component :is="Component" :key="route.path" />
        </transition>
      </router-view>
    </main>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import {
  PhArrowsClockwise,
  PhBookOpenText,
  PhChartLine,
  PhChatTeardrop,
  PhGearSix,
  PhKey,
  PhPlugs,
  PhScroll,
  PhSignOut,
  PhTranslate
} from '@phosphor-icons/vue'

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
  background: var(--bg);
  color: var(--ink);
}

.auth-pulse {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: var(--accent);
  margin-bottom: 12px;
  animation: pulse 1s var(--ease) infinite;
}

@keyframes pulse {
  50% { transform: scale(0.7); opacity: 0.6; }
}

.auth-loading {
  flex-direction: column;
}

.auth-loading-text {
  color: var(--muted);
  font-size: 0.88rem;
}

.login-panel {
  width: min(100%, 360px);
  background: var(--surface);
  border: 1px solid transparent;
  border-radius: 8px;
  box-shadow: var(--shadow);
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  color: var(--ink);
}

.login-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink);
  font-size: 0.84rem;
  font-weight: 700;
}

.brand-mark {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: var(--accent);
  display: inline-block;
}

.login-panel h1 {
  font-size: 1.35rem;
  color: var(--ink);
  letter-spacing: 0;
}

.login-panel p {
  color: var(--muted);
  font-size: 0.88rem;
  line-height: 1.5;
}

.login-panel label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  color: var(--ink-soft);
  font-size: 0.82rem;
  font-weight: 600;
}

.login-panel input {
  height: 38px;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 0 0.7rem;
  font: inherit;
  color: var(--ink);
  background: var(--surface);
  outline: none;
}

.login-panel input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(57, 132, 91, 0.16);
}

.login-error {
  color: var(--bad);
  background: #fff1f1;
  border: 1px solid #ffd0d0;
  border-radius: 6px;
  padding: 0.55rem 0.7rem;
  font-size: 0.84rem;
}

.login-panel button,
.nav-logout {
  border: none;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}

.login-panel button {
  height: 38px;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
}

.login-panel button:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.brand-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand-copy strong {
  font-size: 0.92rem;
  color: var(--nav-text);
  font-weight: 750;
}

.nav-user {
  color: var(--nav-dim);
  font-size: 0.72rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-logout {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--nav-dim);
  background: transparent;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
  width: 100%;
  text-align: left;
}

.nav-logout:hover {
  color: var(--ink);
  background: var(--accent-soft);
}
</style>
