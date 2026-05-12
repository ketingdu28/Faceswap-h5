import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles/tailwind.css'
import { initTcb } from './api/faceSwap'

// 预热 TCB 匿名登录（VITE_API_MODE=tcb 时生效，其余模式为空操作）
initTcb()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
