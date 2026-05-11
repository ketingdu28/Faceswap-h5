import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      {
        find: /^@mediapipe\/pose$/,
        replacement: fileURLToPath(new URL('./src/shims/mediapipePose.ts', import.meta.url)),
      },
    ],
  },
  server: {
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      // PiAPI 代理：绕过浏览器 CORS 限制，仅开发环境生效
      // /piapi-proxy/... → https://api.piapi.ai/...
      '/piapi-proxy': {
        target: 'https://api.piapi.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/piapi-proxy/, ''),
      },
      // 即梦（火山引擎 Ark）代理：绕过浏览器 CORS 限制，仅开发环境生效
      // /jimeng-proxy/... → https://ark.cn-beijing.volces.com/...
      '/jimeng-proxy': {
        target: 'https://ark.cn-beijing.volces.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/jimeng-proxy/, ''),
      },
      // 自定义后端代理（可选）
      '/api/proxy': {
        target: process.env.VITE_CLOUD_BASE_URL ?? 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/proxy/, ''),
      },
    },
  },
})
