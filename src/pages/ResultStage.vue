<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Download, RotateCcw } from 'lucide-vue-next'
import AgentCertificate from '../components/AgentCertificate.vue'
import { useAgentFlowStore } from '../stores/agentFlow'
import { faceSwapClient } from '../services/faceSwapClient'
import { FaceSwapServiceError } from '../services/errors'
import certificateTemplate from '../assets/certificate-template.webp'

const router = useRouter()
const flow = useAgentFlowStore()
const exportedImage = ref<string | null>(null)
const exportMessage = ref('')
const isExporting = ref(false)
const isDownloading = ref(false)
const teaserMode = (import.meta.env.VITE_APP_MODE ?? 'FULL') === 'TEASER'
const generationProgress = ref(18)
const errorHint = ref('')
const zh = {
  resultTitle: '\u6210\u679c\u5c55\u793a',
  resultPreview: '\u6362\u8138\u7ed3\u679c\u9884\u89c8',
  analyzing: '\u6b63\u5728\u89e3\u6790\u751f\u7269\u7279\u5f81...',
  saving: '\u4fdd\u5b58\u4e2d...',
  tapToSave: '\u70b9\u51fb\u4fdd\u5b58\u56fe\u7247',
  teaserHidden: '\u6f14\u793a\u6a21\u5f0f\u4e0b\u9690\u85cf\u8bc1\u4e66\u5bfc\u51fa\u533a\uff0c\u4ec5\u5c55\u793a\u6362\u8138\u7ed3\u679c\u3002',
  exporting: '\u5bfc\u51fa\u4e2d...',
  saveCertificate: '\u4fdd\u5b58\u8bc1\u4e66\u81f3\u6863\u6848',
  longPressSave: '\u957f\u6309\u56fe\u7247\u4fdd\u5b58',
  regenerate: '\u91cd\u65b0\u751f\u6210',
  authExpired: '\u8bf7\u91cd\u65b0\u767b\u5f55\u540e\u518d\u6b21\u5c1d\u8bd5\u8c03\u7528\u4e91\u51fd\u6570\u3002',
  cloudTimeout: '\u5efa\u8bae\u5207\u6362\u7f51\u7edc\u73af\u5883\uff0c\u6216\u4e34\u65f6\u4f7f\u7528 mock \u6a21\u5f0f\u7ee7\u7eed\u8054\u8c03\u3002',
  corsBlocked: '\u8bf7\u8ba9\u4e91\u7aef\u8fd4\u56de\u4e34\u65f6\u6388\u6743\u94fe\u63a5\uff0c\u6216\u5c06\u7ed3\u679c\u56fe\u5148\u8f6c\u4e3a base64\u3002',
  unknownCloud: '\u8bf7\u67e5\u770b\u63a7\u5236\u53f0\u65e5\u5fd7\u5e76\u68c0\u67e5\u4e91\u51fd\u6570\u8fd4\u56de\u7ed3\u6784\u3002',
  generateFail: '\u751f\u6210\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002',
  unknownError: '\u672a\u77e5\u9519\u8bef\uff0c\u8bf7\u5148\u786e\u8ba4\u4e91\u51fd\u6570\u53ef\u7528\u6027\u3002',
  uploadFirst: '\u8bf7\u5148\u4e0a\u4f20\u56fe\u7247\u518d\u8fdb\u884c\u6362\u8138\u3002',
  teaserExportOff: '\u6f14\u793a\u6a21\u5f0f\u4e0b\u5bfc\u51fa\u529f\u80fd\u5df2\u5173\u95ed\u3002',
  certDownloaded: '\u8bc1\u4e66\u5df2\u5f00\u59cb\u4e0b\u8f7d\uff0c\u8bf7\u5728\u7cfb\u7edf\u4e0b\u8f7d/\u76f8\u518c\u4e2d\u67e5\u770b\u3002',
  certFallback: '\u5df2\u964d\u7ea7\u5bfc\u51fa\u5e76\u5f00\u59cb\u4e0b\u8f7d\uff0c\u82e5\u6e05\u6670\u5ea6\u4e0d\u8db3\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002',
  certFail: '\u5bfc\u51fa\u5931\u8d25\uff1a\u53ef\u80fd\u662f\u8de8\u57df\u56fe\u7247\u9650\u5236\u3002\u8bf7\u5207\u6362\u53ef\u8bbf\u95ee\u94fe\u63a5\u6216\u5148\u8f6c base64\u3002',
}
const floatingBubbles = Array.from({ length: 20 }, (_, index) => ({
  id: index,
  size: 16 + (index % 5) * 8,
  left: `${(index * 13 + 7) % 100}%`,
  top: `${(index * 17 + 11) % 100}%`,
  delay: `${(index % 7) * 0.8}s`,
  duration: `${14 + (index % 6) * 3}s`,
  breatheDuration: `${3 + ((index * 7) % 20) / 10}s`,
}))

async function downloadResultImage() {
  const url = resultImage.value
  if (!url || isDownloading.value) return
  isDownloading.value = true
  try {
    const response = await fetch(url, { mode: 'cors' })
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = `xmeta-result-${Date.now()}.png`
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(objectUrl)
  } catch {
    window.open(url, '_blank', 'noopener')
  } finally {
    isDownloading.value = false
  }
}

function triggerCertificateDownload(url: string) {
  const fileName = `xmeta-certificate-${Date.now()}.jpg`
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

const logs = ref<string[]>([
  '> Decrypting facial grid...',
  '> Synthesizing neural layers...',
  '> Stabilizing expression vectors...',
  '> Calibrating cinematic style profile...',
  '> Archiving mission signature...',
])
const logWindowSize = 4
const currentLogOffset = ref(0)
let logTimer: number | undefined

const isReady = computed(() => Boolean(flow.resultImageUrl))
const resultImage = computed(() => flow.resultImageUrl ?? flow.sourceImageUrl)

// 预生成证书 blob：result 就绪后立即在后台合成，用户点下载时直接取用
const cachedCertBlob = ref<Blob | null>(null)

async function buildCertBlob(): Promise<Blob | null> {
  let photoSrc = flow.resultImageUrl
  if (!photoSrc) return null
  try {
    // 先确保照片是 data: URL，否则 loadImg 的 crossOrigin='anonymous'
    // 遇到无 CORS 头的 CDN 会直接失败（同 exportCertificate 旧逻辑）
    if (!photoSrc.startsWith('data:') && !photoSrc.startsWith('blob:')) {
      photoSrc = await toDataUrl(photoSrc) // 直连 CORS 或走 /api/proxy-image
    }
    const [templateImg, photoImg] = await Promise.all([
      loadImg(certificateTemplate),
      loadImg(photoSrc),
    ])
    const W = templateImg.naturalWidth
    const H = templateImg.naturalHeight
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#050c1d'
    ctx.fillRect(0, 0, W, H)
    const destX = 0
    const destY = H * 0.25
    const destW = W * 0.50
    const destH = H * 0.55
    const imgAspect = photoImg.naturalWidth / photoImg.naturalHeight
    const destAspect = destW / destH
    let sx = 0, sy = 0
    let sw = photoImg.naturalWidth, sh = photoImg.naturalHeight
    if (imgAspect > destAspect) {
      sw = Math.round(photoImg.naturalHeight * destAspect)
      sx = Math.round((photoImg.naturalWidth - sw) / 2)
    } else {
      sh = Math.round(photoImg.naturalWidth / destAspect)
    }
    ctx.drawImage(photoImg, sx, sy, sw, sh, destX, destY, destW, destH)
    ctx.drawImage(templateImg, 0, 0, W, H)
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    })
  } catch {
    return null
  }
}

// result 就绪后静默预生成，不影响 UI；失败则 3 秒后自动重试一次（代理可能需要冷启动）
watch(isReady, (ready) => {
  if (!ready) return
  buildCertBlob().then((blob) => {
    if (blob) {
      cachedCertBlob.value = blob
    } else {
      setTimeout(() => {
        buildCertBlob().then((b) => { if (b) cachedCertBlob.value = b })
      }, 3000)
    }
  })
})
const visibleLogs = computed(() => {
  const start = currentLogOffset.value
  return Array.from({ length: logWindowSize }).map((_, index) => logs.value[(start + index) % logs.value.length])
})

async function runGenerationIfNeeded() {
  // If result already exists, render it directly and avoid redirect loops.
  if (flow.resultImageUrl) return
  if (!flow.sourceImageUrl) {
    errorHint.value = zh.uploadFirst
    return
  }
  if (flow.isGenerating) return

  flow.setGenerating(true)
  generationProgress.value = 12
  try {
    const response = await faceSwapClient.generateFaceSwap({
      imageUrl: flow.sourceImageUrl,
      style: flow.selectedStyle,
      cloudFileID: flow.cloudFileID,   // TCB mode: use PreStage uploaded fileID
      onProgress: (event) => {
        generationProgress.value = Math.max(8, Math.min(98, event.progress))
        if (event.detail) {
          logs.value = [`> ${event.detail}`, ...logs.value].slice(0, 10)
        }
      },
    })
    // 换脸结果拿到后立即转 base64，后续 canvas 导出无跨域问题
    let resultUrl = response.resultUrl
    try {
      resultUrl = await toDataUrl(resultUrl)
    } catch {
      // CORS fetch 失败则保留原始 URL，导出时再降级处理
    }
    flow.setResultImage(resultUrl)
    flow.certificateMeta = response.meta
    generationProgress.value = 100
  } catch (error) {
    if (error instanceof FaceSwapServiceError) {
      exportMessage.value = error.message
      if (error.code === 'AUTH_EXPIRED') {
        errorHint.value = zh.authExpired
      } else if (error.code === 'CLOUD_TIMEOUT') {
        errorHint.value = zh.cloudTimeout
      } else if (error.code === 'CORS_BLOCKED') {
        errorHint.value = zh.corsBlocked
      } else {
        errorHint.value = zh.unknownCloud
      }
    } else {
      exportMessage.value = error instanceof Error ? error.message : zh.generateFail
      errorHint.value = zh.unknownError
    }
  } finally {
    flow.setGenerating(false)
  }
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    // 加时间戳绕过浏览器非 CORS 缓存，强制发起新请求以携带 CORS 头
    img.src = src.startsWith('data:') || src.startsWith('blob:')
      ? src
      : `${src}${src.includes('?') ? '&' : '?'}_t=${Date.now()}`
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function toDataUrl(url: string): Promise<string> {
  // data: / blob: 已在本地，直接返回
  if (url.startsWith('data:') || url.startsWith('blob:')) return url

  // 先尝试直连（加时间戳绕过非 CORS 缓存）
  const fetchUrl = `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`
  try {
    const res = await fetch(fetchUrl, {
      mode: 'cors',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await blobToDataUrl(await res.blob())
  } catch {
    // 直连 CORS 失败，通过 Vercel 服务端代理转换（/api/proxy-image）
  }

  const proxyRes = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`)
  if (!proxyRes.ok) throw new Error(`proxy ${proxyRes.status}`)
  return blobToDataUrl(await proxyRes.blob())
}

async function exportCertificate() {
  if (teaserMode) {
    exportMessage.value = zh.teaserExportOff
    return
  }
  isExporting.value = true
  exportMessage.value = ''
  exportedImage.value = null

  try {
    // 优先使用预生成的 blob（result 就绪时已在后台合成好）
    let blob = cachedCertBlob.value
    if (!blob) {
      // 预生成尚未完成（极少发生），此时实时合成作为兜底
      blob = await buildCertBlob()
    }
    if (!blob) throw new Error('Canvas encoding failed')

    const objectUrl = URL.createObjectURL(blob)
    triggerCertificateDownload(objectUrl)
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
    exportMessage.value = zh.certDownloaded
  } catch (err) {
    console.error('[Export]', err)
    exportMessage.value = zh.certFail
  } finally {
    isExporting.value = false
  }
}

async function regenerate() {
  flow.resetResult()
  await router.push('/pre-stage')
}

onMounted(() => {
  runGenerationIfNeeded()
  logTimer = window.setInterval(() => {
    currentLogOffset.value = (currentLogOffset.value + 1) % logs.value.length
  }, 900)
})

onUnmounted(() => {
  if (logTimer) window.clearInterval(logTimer)
})
</script>

<template>
  <section class="result-stage-bg relative min-h-screen w-full overflow-hidden px-3 pt-4 pb-3">
    <div class="pointer-events-none absolute inset-0 -z-0">
      <div class="glow-blob blob-a"></div>
      <div class="glow-blob blob-b"></div>
      <div class="bubble-field">
        <span
          v-for="bubble in floatingBubbles"
          :key="bubble.id"
          class="bubble-dot"
          :style="{
            width: `${bubble.size}px`,
            height: `${bubble.size}px`,
            left: bubble.left,
            top: bubble.top,
            animationDelay: bubble.delay,
            animationDuration: bubble.duration,
            '--breathe-duration': bubble.breatheDuration,
          }"
        />
      </div>
    </div>
    <div class="mx-auto flex min-h-[calc(100vh-1.75rem)] w-full max-w-[420px] flex-col gap-4">
      <header class="flex items-center justify-between">
        <div class="hero-heading">
          <p class="hero-heading__eyebrow">Magic Makeover Archive</p>
          <h1 class="title-halo">{{ zh.resultTitle }}</h1>
        </div>
        <span class="v2-halo text-[10px] text-[#f8ddb0]/80">Style {{ flow.selectedStyle }}</span>
      </header>

      <div class="card-shell overflow-hidden rounded-[30px] p-3">
        <div class="section-heading section-heading--result mb-2">
          <div class="section-heading__row">
            <p class="section-heading__title">{{ zh.resultPreview }}</p>
            <p class="section-heading__eyebrow">Preview Archive</p>
          </div>
          <p class="section-heading__subline">查看你的魔法变身最终成果</p>
        </div>
        <div class="result-frame relative overflow-hidden rounded-[30px]">
          <template v-if="!isReady">
            <div class="relative aspect-[3/4] min-h-[420px] overflow-hidden">
              <img :src="resultImage || ''" alt="source preview" class="h-full w-full object-cover opacity-90" />
              <div class="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,10,24,0.35),rgba(3,10,24,0.78))]" />
              <div class="absolute inset-0 grid place-items-center px-3">
                <div class="loading-panel w-[88%] rounded-[30px] p-4">
                  <p class="mb-3 font-mono text-sm text-cyan-100">{{ zh.analyzing }}</p>
                  <div class="mb-3 h-2 overflow-hidden rounded-[30px] bg-[rgba(5,12,29,0.72)]">
                    <div
                      class="h-full animate-[pixelPulse_1.4s_ease-in-out_infinite] transition-all"
                      :style="{ width: `${generationProgress}%`, background: 'linear-gradient(90deg, #00F2FF, #60A5FA)', boxShadow: '0 0 12px rgba(0,242,255,0.7)' }"
                    />
                  </div>
                  <div class="space-y-1 font-mono text-[11px] text-cyan-100/75">
                    <p v-for="line in visibleLogs" :key="line">{{ line }}</p>
                  </div>
                </div>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="particle-ascension pointer-events-none absolute inset-x-0 bottom-0 h-full" />
            <div class="particle-ascension particle-ascension--b pointer-events-none absolute inset-x-0 bottom-0 h-full" />
            <button type="button" class="group relative z-10 block w-full" :disabled="isDownloading" @click="downloadResultImage">
              <img :src="resultImage || ''" alt="AI result" class="w-full object-contain" style="max-height:70vh;min-height:300px;background:#0a1228;" />
              <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/0 transition-colors duration-200 group-hover:bg-black/35">
                <Download class="h-8 w-8 text-white opacity-0 drop-shadow-lg transition-opacity duration-200 group-hover:opacity-100" />
                <span class="font-mono text-xs tracking-wider text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  {{ isDownloading ? zh.saving : zh.tapToSave }}
                </span>
              </div>
            </button>
          </template>
        </div>
      </div>

      <div
        v-if="!teaserMode"
        class="card-shell rounded-[30px] p-0 w-full"
      >
        <AgentCertificate
          :codename="flow.certificateMeta.codename"
          :code="flow.certificateMeta.code"
          :joined-date="flow.certificateMeta.joinedDate"
          :image-url="resultImage || ''"
        />
      </div>
      <div v-else class="card-shell rounded-[30px] p-3 text-xs text-cyan-100/80">
        {{ zh.teaserHidden }}
      </div>

      <div class="card-shell rounded-[30px] p-3">
        <button
          type="button"
          class="amber-action mb-2 w-full rounded-[30px] px-4 py-3 font-mono text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="isExporting || teaserMode"
          @click="exportCertificate"
        >
          <span class="inline-flex items-center gap-2">
            <Download class="h-4 w-4" />
            {{ isExporting ? zh.exporting : zh.saveCertificate }}
          </span>
        </button>
        <div class="flex items-center justify-between text-[11px] text-cyan-100/70">
          <p>{{ zh.longPressSave }}</p>
          <button type="button" class="inline-flex items-center gap-1 text-cyan-300" @click="regenerate">
            <RotateCcw class="h-3 w-3" />
            {{ zh.regenerate }}
          </button>
        </div>
        <p v-if="exportMessage" class="mt-2 text-xs text-cyan-100/85">{{ exportMessage }}</p>
        <p v-if="errorHint" class="mt-1 text-[11px] text-cyan-100/70">{{ errorHint }}</p>
      </div>

      <div v-if="exportedImage" class="card-shell rounded-[30px] p-2">
        <img :src="exportedImage" alt="certificate export preview" class="w-full rounded-[30px]" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.result-stage-bg {
  position: relative;
  background:
    radial-gradient(circle at top, rgba(255, 218, 170, 0.06) 0%, rgba(255, 218, 170, 0) 28%),
    radial-gradient(circle at 78% 18%, rgba(182, 122, 255, 0.08) 0%, rgba(182, 122, 255, 0) 24%),
    linear-gradient(135deg, rgba(9, 24, 48, 0.16) 0%, rgba(15, 52, 94, 0.14) 100%),
    url('/magic-bg.png') center center / cover no-repeat;
}


.glow-blob {
  position: absolute;
  border-radius: 9999px;
  filter: blur(58px);
  opacity: 0.28;
  animation: blobFloat 16s ease-in-out infinite alternate;
}

.blob-a {
  width: 300px;
  height: 300px;
  top: 8%;
  left: -12%;
  background: radial-gradient(circle, rgba(68, 217, 255, 0.26) 0%, rgba(68, 217, 255, 0) 72%);
}

.blob-b {
  width: 340px;
  height: 340px;
  bottom: -20%;
  right: -10%;
  background: radial-gradient(circle, rgba(182, 122, 255, 0.18) 0%, rgba(182, 122, 255, 0) 74%);
}

.bubble-field {
  position: absolute;
  inset: 0;
}

.bubble-dot {
  position: absolute;
  border-radius: 9999px;
  background: radial-gradient(circle, rgba(255, 247, 229, 0.95) 0%, rgba(68, 217, 255, 0.5) 42%, rgba(201, 114, 255, 0.16) 70%, transparent 76%);
  box-shadow: 0 0 12px rgba(255, 244, 223, 0.38), 0 0 28px rgba(68, 217, 255, 0.22);
  filter: blur(1px);
  animation:
    bubbleDrift ease-in-out infinite alternate,
    bubbleBreathe var(--breathe-duration, 4s) ease-in-out infinite;
}

.bubble-dot:nth-child(3n) {
  background: radial-gradient(circle, rgba(201, 114, 255, 0.72) 0%, rgba(154, 107, 197, 0.3) 60%, transparent 72%);
  box-shadow: 0 0 12px rgba(201, 114, 255, 0.24), 0 0 22px rgba(154, 107, 197, 0.12);
  filter: blur(1px);
  animation:
    bubbleDrift ease-in-out infinite alternate,
    bubbleBreathePurple var(--breathe-duration, 4.5s) ease-in-out infinite;
}

.bubble-dot:nth-child(3n + 2) {
  background: rgba(255, 231, 160, 0.5);
  box-shadow: 0 0 12px rgba(255, 224, 178, 0.4);
  filter: blur(0.8px);
  animation:
    bubbleDrift ease-in-out infinite alternate,
    bubbleBreathe var(--breathe-duration, 3.8s) ease-in-out infinite;
}

.hero-heading {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hero-heading__eyebrow {
  margin: 0;
  font-size: 10px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(255, 231, 160, 0.76);
  text-shadow: 0 0 10px rgba(255, 231, 160, 0.22);
}

.title-halo {
  margin: 0;
  font-family: 'Courier New', Consolas, monospace;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: rgba(255, 249, 240, 0.98);
  text-shadow:
    0 0 18px rgba(255, 249, 240, 0.92),
    0 0 34px rgba(154, 107, 197, 0.34),
    0 0 64px rgba(255, 238, 195, 0.22);
}

.v2-halo {
  text-shadow: 0 0 12px rgba(255, 224, 178, 0.48);
}

.section-heading {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 14px 8px 16px;
  border-radius: 18px;
  background: linear-gradient(90deg, rgba(255, 245, 220, 0.08), rgba(190, 151, 255, 0.05) 58%, transparent 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    0 0 18px rgba(68, 217, 255, 0.06);
}

.section-heading__row {
  display: inline-flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  position: relative;
}

.section-heading__row::after {
  content: '';
  display: block;
  width: 52px;
  height: 1px;
  margin-left: 4px;
  align-self: center;
  background: linear-gradient(90deg, rgba(255, 231, 160, 0.55), rgba(68, 217, 255, 0.16), transparent);
}

.section-heading__eyebrow {
  margin: 0;
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(255, 231, 160, 0.78);
  text-shadow: 0 0 10px rgba(255, 231, 160, 0.24);
}

.section-heading__title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(255, 249, 240, 0.98);
  text-shadow:
    0 0 14px rgba(255, 249, 240, 0.46),
    0 0 28px rgba(68, 217, 255, 0.18),
    0 0 32px rgba(201, 114, 255, 0.14);
}

.section-heading__subline {
  margin: 0;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: rgba(229, 239, 255, 0.72);
  text-shadow: 0 0 10px rgba(68, 217, 255, 0.08);
}

.section-heading--result {
  min-width: 220px;
}

/* Unified jewel-glass spec */
.card-shell {
  position: relative;
  border: none;
  background: linear-gradient(180deg, rgba(120, 177, 255, 0.12), rgba(88, 131, 228, 0.08));
  box-shadow:
    0 10px 30px rgba(8, 18, 48, 0.4),
    0 0 30px rgba(68, 217, 255, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.28);
  backdrop-filter: blur(12px);
  border: 0.5px solid rgba(214, 232, 255, 0.22);
  border-top: 0.5px solid rgba(255, 245, 220, 0.2);
  border-radius: 30px;
}

.card-shell::after {
  content: none;
}

.result-frame {
  border: none;
  box-shadow:
    0 0 18px rgba(68, 217, 255, 0.18),
    0 0 38px rgba(201, 114, 255, 0.16);
  border-radius: 30px;
}

.loading-panel {
  border: none;
  background: linear-gradient(180deg, rgba(120, 177, 255, 0.12), rgba(88, 131, 228, 0.08));
  backdrop-filter: blur(12px);
  border: 0.5px solid rgba(214, 232, 255, 0.22);
  border-top: 0.5px solid rgba(255, 245, 220, 0.2);
  box-shadow:
    0 10px 24px rgba(8, 18, 48, 0.28),
    0 0 24px rgba(68, 217, 255, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.28);
  border-radius: 30px;
}

/* Rising digital particles - two offset layers for continuity */
.particle-ascension {
  background:
    radial-gradient(circle 2px at 12% 90%, rgba(68, 217, 255, 0.9), transparent 100%),
    radial-gradient(circle 1.5px at 28% 96%, rgba(201, 114, 255, 0.18), transparent 100%),
    radial-gradient(circle 2px at 48% 88%, rgba(255, 138, 214, 0.2), transparent 100%),
    radial-gradient(circle 1px at 63% 94%, rgba(255, 231, 160, 0.7), transparent 100%),
    radial-gradient(circle 2px at 78% 87%, rgba(201, 114, 255, 0.18), transparent 100%),
    radial-gradient(circle 1.5px at 92% 91%, rgba(68, 217, 255, 0.68), transparent 100%),
    radial-gradient(circle 1px at 38% 82%, rgba(255, 138, 214, 0.16), transparent 100%),
    radial-gradient(circle 1.5px at 55% 93%, rgba(201, 114, 255, 0.14), transparent 100%);
  animation: particleAscend 4s linear infinite;
}

.particle-ascension--b {
  background:
    radial-gradient(circle 1.5px at 20% 85%, rgba(201, 114, 255, 0.14), transparent 100%),
    radial-gradient(circle 2px at 40% 92%, rgba(68, 217, 255, 0.82), transparent 100%),
    radial-gradient(circle 1px at 60% 88%, rgba(255, 138, 214, 0.16), transparent 100%),
    radial-gradient(circle 2px at 72% 95%, rgba(255, 231, 160, 0.72), transparent 100%),
    radial-gradient(circle 1.5px at 85% 83%, rgba(201, 114, 255, 0.14), transparent 100%);
  animation-delay: -2s;
}

.amber-action {
  position: relative;
  background: linear-gradient(135deg, rgba(255, 245, 220, 0.18), rgba(190, 151, 255, 0.16));
  border: 2px solid transparent;
  box-shadow:
    0 0 24px rgba(68, 217, 255, 0.18),
    0 0 28px rgba(201, 114, 255, 0.16),
    inset 0 0 14px rgba(255, 245, 220, 0.16);
  backdrop-filter: blur(10px);
  text-shadow: 0 0 10px rgba(255, 249, 240, 0.52);
  overflow: hidden;
  transition:
    transform 420ms cubic-bezier(0.22, 1.25, 0.3, 1),
    box-shadow 420ms cubic-bezier(0.22, 1.25, 0.3, 1),
    background 420ms cubic-bezier(0.22, 1.25, 0.3, 1);
}

.amber-action:hover,
.amber-action:active {
  transform: scale(1.05);
  box-shadow:
    0 0 34px rgba(68, 217, 255, 0.26),
    0 0 38px rgba(201, 114, 255, 0.24),
    inset 0 0 18px rgba(255, 245, 220, 0.24);
}

.amber-action::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 2px;
  background: linear-gradient(135deg, rgba(255, 231, 160, 0.58), rgba(201, 114, 255, 0.34));
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}

.amber-action:active::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(circle at center, rgba(255, 231, 160, 0.22), transparent 62%);
  animation: purpleRipple 0.45s ease-out;
  pointer-events: none;
}

@keyframes purpleRipple {
  from {
    transform: scale(0.7);
    opacity: 1;
  }
  to {
    transform: scale(1.25);
    opacity: 0;
  }
}

@keyframes blobFloat {
  from {
    transform: translate3d(0, 0, 0) scale(1);
  }
  to {
    transform: translate3d(18px, -24px, 0) scale(1.08);
  }
}

@keyframes bubbleDrift {
  0% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  100% {
    transform: translate3d(22px, -28px, 0) scale(1.12);
  }
}

@keyframes bubbleBreathe {
  0%,
  100% {
    opacity: 0.5;
    filter: blur(1px);
  }
  50% {
    opacity: 1;
    filter: blur(0.3px);
  }
}

@keyframes bubbleBreathePurple {
  0%,
  100% {
    opacity: 0.45;
    filter: blur(0.5px);
  }
  50% {
    opacity: 0.9;
    filter: blur(0);
  }
}
</style>
