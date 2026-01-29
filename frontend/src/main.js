import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import Chat from './views/Chat.vue'
import ApiSettings from './views/ApiSettings.vue'
import PollingSettings from './views/PollingSettings.vue'
import ProxyKeys from './views/ProxyKeys.vue'
import UserSettings from './views/UserSettings.vue'
import Logs from './views/Logs.vue'
import PromptLibrary from './views/PromptLibrary.vue'
import Translate from './views/Translate.vue'
import './style.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Chat },
    { path: '/translate', component: Translate },
    { path: '/settings/apis', component: ApiSettings },
    { path: '/settings/polling', component: PollingSettings },
    { path: '/settings/proxy-keys', component: ProxyKeys },
    { path: '/settings/defaults', component: UserSettings },
    { path: '/prompts', component: PromptLibrary },
    { path: '/logs', component: Logs }
  ]
})

createApp(App).use(router).mount('#app')
