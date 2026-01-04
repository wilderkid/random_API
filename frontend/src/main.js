import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import Chat from './views/Chat.vue'
import ApiSettings from './views/ApiSettings.vue'
import PollingSettings from './views/PollingSettings.vue'
import UserSettings from './views/UserSettings.vue'
import Logs from './views/Logs.vue'
import './style.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Chat },
    { path: '/settings/apis', component: ApiSettings },
    { path: '/settings/polling', component: PollingSettings },
    { path: '/settings/defaults', component: UserSettings },
    { path: '/logs', component: Logs }
  ]
})

createApp(App).use(router).mount('#app')
