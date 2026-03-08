<template>
  <div class="app">
    <nav class="navbar">
      <div class="nav-brand">Random_API</div>
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
      </div>
    </nav>
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const mobileMenuOpen = ref(false)
</script>
