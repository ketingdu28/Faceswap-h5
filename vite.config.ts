import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// 开发环境图片 CORS 代理插件（镜像 /api/proxy-image Vercel 函数）
// 允许 canvas 导出在 localhost 正常工作，无需部署到 Vercel
const devImageProxyPlugin = {
  name: 'dev-image-proxy',
  configureServer(server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void } }) {
    server.middlewares.use(async (req: any, res: any, next: () => void) => {
      if (!req.url?.startsWith('/api/proxy-image')) return next()
      const qs = req.url.split('?')[1] ?? ''
      const imageUrl = new URLSearchParams(qs).get('url') ?? ''
      if (!imageUrl.startsWith('https://')) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'Only HTTPS URLs are supported' }))
        return
      }
      try {
        const upstream = await fetch(imageUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 XMeta-Proxy/1.0' },
        })
        const contentType = upstream.headers.get('content-type') ?? 'image/jpeg'
        const buffer = await upstream.arrayBuffer()
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Content-Type', contentType)
        res.setHeader('Cache-Control', 'public, max-age=3600')
        res.end(Buffer.from(buffer))
      } catch (err) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: String(err) }))
      }
    })
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), devImageProxyPlugin],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // TF.js 单独分包（~4MB），不阻塞首屏渲染
          if (
            id.includes('@tensorflow/tfjs-core') ||
            id.includes('@tensorflow/tfjs-backend-webgl') ||
            id.includes('@tensorflow/tfjs-converter')
          ) return 'tf-core'
          if (id.includes('@tensorflow-models/pose-detection')) return 'tf-pose'
          // Vue 生态单独分包
          if (id.includes('node_modules/vue/') || id.includes('node_modules/vue-router/') || id.includes('node_modules/pinia/')) return 'vue-vendor'
        },
      },
    },
  },
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
