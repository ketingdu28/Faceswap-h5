<script setup lang="ts">
/**
 * SceneComposite — 9 场景动态切换合成组件
 *
 * 场景编号 → 模板映射：1=A1 2=A2 3=A3 / 4=B1 5=B2 6=B3 / 7=C1 8=C2 9=C3
 * 前景图放置：public/scenes/scene-{1-9}-fg.png（含透明通道）
 *
 * 绘制顺序：① AI 换脸结果（已含场景背景）② 透明前景遮罩
 * 展示方式：canvas 作离屏合成，结果转为 data URL 用 <img> 显示，规避 canvas CSS 比例失真
 */
import { ref, computed, onMounted, watch } from 'vue'

interface SceneConfig { id: number; fgUrl: string }

const SCENE_CONFIG: SceneConfig[] = [
  { id: 1, fgUrl: '/scenes/scene-1-fg.png' }, // A1
  { id: 2, fgUrl: '/scenes/scene-2-fg.png' }, // A2
  { id: 3, fgUrl: '/scenes/scene-3-fg.png' }, // A3
  { id: 4, fgUrl: '/scenes/scene-4-fg.png' }, // B1
  { id: 5, fgUrl: '/scenes/scene-5-fg.png' }, // B2
  { id: 6, fgUrl: '/scenes/scene-6-fg.png' }, // B3
  { id: 7, fgUrl: '/scenes/scene-7-fg.png' }, // C1
  { id: 8, fgUrl: '/scenes/scene-8-fg.png' }, // C2
  { id: 9, fgUrl: '/scenes/scene-9-fg.png' }, // C3
]

// defineProps 默认值不能引用 setup 内变量（会被提升），
// 改为 prop 不设默认，computed 内读取 env 变量兜底
const props = defineProps<{
  faceUrl: string
  sceneId?: number
  /** 饱和度（%），未传则读 VITE_SCENE_FILTER_SATURATE，默认 100 */
  saturate?: number
  /** 对比度（%），未传则读 VITE_SCENE_FILTER_CONTRAST，默认 100 */
  contrast?: number
  /** 亮度（%），未传则读 VITE_SCENE_FILTER_BRIGHTNESS，默认 100 */
  brightness?: number
}>()

// 滤镜实际值：prop > env 变量 > 内置默认值
// 注意：.env.local 被 gitignore，Vercel 构建时不含该文件；
// 需在 Vercel 控制台 Environment Variables 中单独配置，或在此修改内置默认值。
const filterSaturate   = computed(() => props.saturate   ?? Number(import.meta.env.VITE_SCENE_FILTER_SATURATE   ?? 125))
const filterContrast   = computed(() => props.contrast   ?? Number(import.meta.env.VITE_SCENE_FILTER_CONTRAST   ?? 105))
const filterBrightness = computed(() => props.brightness ?? Number(import.meta.env.VITE_SCENE_FILTER_BRIGHTNESS ?? 100))

const emit = defineEmits<{
  ready: [blob: Blob]
  error: [message: string]
}>()

const canvasRef  = ref<HTMLCanvasElement | null>(null)
const resultUrl  = ref('')   // 合成结果的 data URL，驱动 <img> 展示，保证比例正确
const fallbackFaceUrl = ref('')  // canvas 被污染时降级：直接显示换脸图（无前景遮罩）
const isDrawing  = ref(false)
const drawError  = ref('')

const currentScene = computed(() => SCENE_CONFIG.find((s) => s.id === props.sceneId))

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/** 将 HTTP URL 转为 data: URL，规避 Volces CDN 无 CORS 头的跨域限制 */
async function ensureDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:') || url.startsWith('blob:')) return url
  const stamped = `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`
  try {
    const res = await fetch(stamped, { mode: 'cors', cache: 'no-store' })
    if (res.ok) return blobToDataUrl(await res.blob())
  } catch { /* 直连失败，尝试代理 */ }
  try {
    const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`)
    if (res.ok) return blobToDataUrl(await res.blob())
  } catch { /* 忽略 */ }
  return url
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'Anonymous'
    img.onload  = () => resolve(img)
    img.onerror = () => {
      // CORS failed (CDN无CORS头) — 降级为无crossOrigin，图片可正常加载但canvas会被污染
      const img2 = new Image()
      img2.onload  = () => resolve(img2)
      img2.onerror = () => reject(new Error(`图片加载失败：${src.slice(0, 80)}`))
      img2.src = src
    }
    img.src = src
  })
}

/** 加载本地 public/ 静态资源，用 fetch+blob URL 规避 crossOrigin='Anonymous' 导致的加载失败 */
async function loadLocalAsset(url: string): Promise<HTMLImageElement> {
  let blobUrl: string | null = null
  try {
    const blob = await fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.blob()
    })
    blobUrl = URL.createObjectURL(blob)
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload  = () => { URL.revokeObjectURL(blobUrl!); resolve(img) }
      img.onerror = () => { URL.revokeObjectURL(blobUrl!); reject(new Error(`图片加载失败：${url}`)) }
      img.src = blobUrl!
    })
  } catch (err) {
    if (blobUrl) URL.revokeObjectURL(blobUrl)
    throw err instanceof Error ? err : new Error(`图片加载失败：${url}`)
  }
}

// ─── 核心渲染函数 ─────────────────────────────────────────────────────────────

async function draw() {
  const canvas = canvasRef.value
  const scene  = currentScene.value
  if (!canvas || !scene || !props.faceUrl) return

  isDrawing.value = true
  drawError.value = ''

  try {
    const resolvedFaceUrl = await ensureDataUrl(props.faceUrl)
    console.log('[SceneComposite] faceUrl:', props.faceUrl.slice(0, 60), '→ resolved:', resolvedFaceUrl.slice(0, 60))
    console.log('[SceneComposite] fgUrl:', scene.fgUrl)

    let faceImg: HTMLImageElement
    try {
      faceImg = await loadImage(resolvedFaceUrl)
    } catch (e) {
      throw new Error(`换脸图加载失败：${String(e)}`)
    }
    let fgImg: HTMLImageElement
    try {
      fgImg = await loadLocalAsset(scene.fgUrl)
    } catch (e) {
      throw new Error(`前景图加载失败（${scene.fgUrl}）：${String(e)}`)
    }

    // Canvas 以前景图尺寸为准（前景图定义了正确的宽高比，通常为 9:16）
    // 人脸图拉伸到同尺寸；若两图设计上对齐，则人脸内容自然落在正确位置
    const W = fgImg.naturalWidth
    const H = fgImg.naturalHeight
    canvas.width  = W
    canvas.height = H

    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, W, H)

    // ① 换脸结果：烘焙滤镜（饱和度 / 对比度 / 亮度），下载图片同样包含此滤镜
    ctx.filter = `saturate(${filterSaturate.value}%) contrast(${filterContrast.value}%) brightness(${filterBrightness.value}%)`
    ctx.drawImage(faceImg, 0, 0, W, H)

    // ② 透明前景遮罩：重置滤镜，防止染色前景透明通道
    ctx.filter = 'none'
    ctx.drawImage(fgImg, 0, 0, W, H)

    // 转为 data URL 驱动 <img> 展示，彻底解决 canvas CSS 比例失真
    // 若换脸图无 CORS 头（即梦 CDN），canvas 会被污染，toDataURL 抛 SecurityError
    try {
      resultUrl.value = canvas.toDataURL('image/png')
      fallbackFaceUrl.value = ''
      canvas.toBlob(
        (blob) => { if (blob) emit('ready', blob) },
        'image/png', 1.0,
      )
    } catch {
      // canvas 被污染 — 降级：直接展示换脸图（无前景遮罩），不报错
      console.warn('[SceneComposite] canvas 被污染，降级展示换脸图')
      fallbackFaceUrl.value = resolvedFaceUrl
      resultUrl.value = ''
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[SceneComposite] draw error:', err)
    drawError.value = msg
    emit('error', msg)
  } finally {
    isDrawing.value = false
  }
}

async function compositeToBlob(): Promise<Blob | null> {
  if (!resultUrl.value && !fallbackFaceUrl.value) await draw()
  const canvas = canvasRef.value
  if (!canvas) return null
  // canvas 被污染时 toBlob 会抛 SecurityError，返回 null 让调用方降级处理
  return new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, 'image/png', 1.0)
    } catch {
      resolve(null)
    }
  })
}

defineExpose({ compositeToBlob })

onMounted(draw)
watch([() => props.faceUrl, () => props.sceneId, filterSaturate, filterContrast, filterBrightness], draw)
</script>

<template>
  <div class="scene-composite">
    <!-- 离屏 canvas，仅用于合成，不用于展示 -->
    <canvas ref="canvasRef" class="sr-only" />
    <!-- 合成结果以 <img> 展示，width:100% + height:auto 保证比例正确 -->
    <img
      v-if="resultUrl"
      :src="resultUrl"
      alt="scene composite"
      class="scene-img"
      :class="{ 'scene-img--loading': isDrawing }"
    />
    <!-- canvas 被污染降级：CSS 双层模拟 canvas 合成效果 -->
    <div
      v-else-if="fallbackFaceUrl"
      class="scene-fallback"
      :class="{ 'scene-img--loading': isDrawing }"
    >
      <img :src="fallbackFaceUrl" alt="scene composite" class="scene-fallback-face" />
      <img
        v-if="currentScene"
        :src="currentScene.fgUrl"
        alt=""
        aria-hidden="true"
        class="scene-fallback-fg"
      />
    </div>
    <!-- 加载中占位（保持宽高比，避免布局跳动） -->
    <div v-else class="scene-placeholder" :class="{ 'scene-placeholder--drawing': isDrawing }" />
    <p v-if="drawError" class="scene-error">{{ drawError }}</p>
  </div>
</template>

<style scoped>
.scene-composite {
  position: relative;
  width: 100%;
}

/* <img> 展示：width:100% + height:auto 正确还原原始宽高比 */
.scene-img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 30px;
  transition: opacity 0.2s;
}

.scene-img--loading {
  opacity: 0.5;
}

/* 首次加载前的占位区域，aspect-ratio 与场景图保持一致（9:16） */
.scene-placeholder {
  width: 100%;
  aspect-ratio: 9 / 16;
  background: rgba(8, 18, 48, 0.4);
}

.scene-placeholder--drawing {
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50%       { opacity: 0.8; }
}

.scene-fallback {
  position: relative;
  width: 100%;
  aspect-ratio: 941 / 1672;
  border-radius: 30px;
  overflow: hidden;
  transition: opacity 0.2s;
}

.scene-fallback-face {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.scene-fallback-fg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.scene-error {
  margin-top: 8px;
  font-size: 12px;
  color: rgba(255, 100, 100, 0.9);
  text-align: center;
}
</style>
