import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer'
import sharp from 'sharp'
import path from 'node:path'
import fs from 'node:fs/promises'

// ─── 开发环境图片 CORS 代理（镜像 /api/proxy-image Vercel 函数）──────────────
const devImageProxyPlugin: Plugin = {
  name: 'dev-image-proxy',
  configureServer(server) {
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

// ─── 构建期 PNG/JPG → WebP 转换 ──────────────────────────────────────────────
// Vite 8 底层换成 Rolldown，generateBundle 不允许直接写 bundle key，
// 改用 writeBundle：文件写到磁盘后再做转换 + 引用替换。
const webpConverterPlugin = (): Plugin => ({
  name: 'vite-webp-converter',
  enforce: 'post',
  apply: 'build',
  async writeBundle(options, bundle) {
    const outDir = options.dir ?? 'dist'
    const fileMap = new Map<string, string>() // old basename → new basename

    // 1. 转换 PNG/JPG → WebP（仅当更小时替换）
    await Promise.all(
      Object.entries(bundle)
        .filter(([name]) => /\.(png|jpe?g)$/i.test(name))
        .map(async ([relName]) => {
          const fullPath = path.join(outDir, relName)
          try {
            const buf = await fs.readFile(fullPath)
            const webpBuf = await sharp(buf).webp({ quality: 80 }).toBuffer()
            if (webpBuf.byteLength >= buf.byteLength) return
            const webpRel = relName.replace(/\.(png|jpe?g)$/i, '.webp')
            await fs.writeFile(path.join(outDir, webpRel), webpBuf)
            await fs.unlink(fullPath)
            fileMap.set(path.basename(relName), path.basename(webpRel))
          } catch { /* 保留原文件 */ }
        }),
    )

    if (fileMap.size === 0) return

    // 2. 修正 JS chunk 中的文件名引用
    await Promise.all(
      Object.entries(bundle)
        .filter(([, chunk]) => chunk.type === 'chunk')
        .map(async ([relName]) => {
          const fullPath = path.join(outDir, relName)
          let code = await fs.readFile(fullPath, 'utf-8')
          let changed = false
          for (const [o, n] of fileMap) {
            if (code.includes(o)) { code = code.replaceAll(o, n); changed = true }
          }
          if (changed) await fs.writeFile(fullPath, code, 'utf-8')
        }),
    )

    // 简单报告
    for (const [o, n] of fileMap) {
      console.log(`[webp-converter] ${o} → ${n}`)
    }
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    devImageProxyPlugin,
    // 先转 WebP（替换文件），再压缩（压缩已存在的 WebP）
    webpConverterPlugin(),
    ViteImageOptimizer({
      webp: { lossless: false, quality: 80 },
      svg: { plugins: [{ name: 'preset-default' }] },
      includePublic: true,
    }),
  ],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('@tensorflow/tfjs-core') ||
            id.includes('@tensorflow/tfjs-backend-webgl') ||
            id.includes('@tensorflow/tfjs-converter')
          ) return 'tf-core'
          if (id.includes('@tensorflow-models/pose-detection')) return 'tf-pose'
          if (
            id.includes('node_modules/vue/') ||
            id.includes('node_modules/vue-router/') ||
            id.includes('node_modules/pinia/')
          ) return 'vue-vendor'
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
      '/piapi-proxy': {
        target: 'https://api.piapi.ai',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/piapi-proxy/, ''),
      },
      '/jimeng-proxy': {
        target: 'https://ark.cn-beijing.volces.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/jimeng-proxy/, ''),
      },
      '/api/proxy': {
        target: process.env.VITE_CLOUD_BASE_URL ?? 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/proxy/, ''),
      },
    },
  },
})
