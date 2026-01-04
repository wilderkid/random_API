<template>
  <div class="app">
    <nav class="navbar">
      <div class="nav-brand">Random_API</div>
      <div class="nav-links">
        <router-link to="/">聊天</router-link>
        <router-link to="/settings/apis">API 管理</router-link>
        <router-link to="/settings/polling">轮询配置</router-link>
        <router-link to="/settings/defaults">用户设置</router-link>
        <router-link to="/logs">日志</router-link>
      </div>
    </nav>
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<script setup>
</script>
