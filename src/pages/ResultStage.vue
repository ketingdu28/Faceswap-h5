<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Download, RotateCcw } from 'lucide-vue-next'
import AgentCertificate from '../components/AgentCertificate.vue'
import SceneComposite from '../components/SceneComposite.vue'
import { useAgentFlowStore } from '../stores/agentFlow'
import { faceSwapClient } from '../services/faceSwapClient'
import { generateCartoonAvatar, generateCertificateFromPhoto } from '../services/cloudFaceSwapClient'
import { FaceSwapServiceError } from '../services/errors'
import textOverlay from '../assets/certificate-template.png'

const router = useRouter()
const flow = useAgentFlowStore()
const sceneCompositeRef = ref<InstanceType<typeof SceneComposite> | null>(null)
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
  saveScene: '\u4fdd\u5b58\u573a\u666f\u81f3\u6863\u6848',
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
  if (!resultImage.value || isDownloading.value) return
  isDownloading.value = true
  try {
    // 优先从 SceneComposite 取合成 Blob（换脸结果 + 前景遮罩）
    const blob = await sceneCompositeRef.value?.compositeToBlob() ?? null
    if (!blob) throw new Error('composite blob unavailable')
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = `xmeta-result-${Date.now()}.png`
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
  } catch {
    // SceneComposite 不可用时降级直接打开原图
    window.open(resultImage.value, '_blank', 'noopener')
  } finally {
    isDownloading.value = false
  }
}

function triggerCertificateDownload(url: string) {
  const fileName = `xmeta-certificate-${Date.now()}.png`
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




const cartoonFailed = ref(false)
const cartoonErrorMsg = ref('')

// AI 证书生成状态
const certGenFailed = ref(false)
const certGenMsg = ref('')
const isCertGenerating = ref(false)

// 证书显示优先级：AI 生成证书 > Canvas 合成证书
const aiCertUrl = computed(() => flow.aiCertificateUrl)
const certPhotoUrl = computed(() => flow.cartoonAvatarUrl)

// 证书模板 URL（从环境变量读取，上传到 ImgBB 后配置）
const CERT_TEMPLATE_URL = (import.meta.env.VITE_CERTIFICATE_TEMPLATE_URL as string | undefined)?.trim() ?? ''

// 预生成证书 blob：result 就绪后立即在后台合成，用户点下载时直接取用
const cachedCertBlob = ref<Blob | null>(null)

async function buildCertBlob(): Promise<Blob | null> {
  const baseSrc = aiCertUrl.value || certPhotoUrl.value
  if (!baseSrc) return null
  try {
    const resolvedBase = baseSrc.startsWith('data:') || baseSrc.startsWith('blob:')
      ? baseSrc
      : await toDataUrl(baseSrc).catch(() => baseSrc)
    // 本地静态资源不走 crossOrigin（Vite dev 不对静态文件返回 CORS 头时会导致 naturalWidth=0）
    // 改用 fetch → blobURL，blob 天然同源，canvas 不被污染
    const overlayBlobUrl = await fetch(textOverlay)
      .then(r => r.blob())
      .then(b => URL.createObjectURL(b))
    const [baseImg, overlayImg] = await Promise.all([
      loadImg(resolvedBase),
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.onload = () => { URL.revokeObjectURL(overlayBlobUrl); resolve(img) }
        img.onerror = () => { URL.revokeObjectURL(overlayBlobUrl); reject(new Error('overlay load failed')) }
        img.src = overlayBlobUrl
      }),
    ])
    // 以前景遮罩 PNG 的原始尺寸为基准（设计尺寸，不受 AI 生成分辨率影响）
    // AI 底图缩放填充至同尺寸，确保两层像素级对齐
    const W = overlayImg.naturalWidth
    const H = overlayImg.naturalHeight
    console.log('[CertBlob] 底图尺寸:', baseImg.naturalWidth, '×', baseImg.naturalHeight,
                '前景遮罩尺寸:', W, '×', H)
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')!
    // Layer 1（底层）：AI 皮克斯肖像，缩放到遮罩尺寸
    ctx.drawImage(baseImg, 0, 0, W, H)
    // Layer 2（顶层）：纯文字透明遮罩，原始尺寸绘制
    ctx.drawImage(overlayImg, 0, 0, W, H)
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png')
    })
  } catch {
    return null
  }
}

// 卡通头像就绪后重新预生成证书 blob（卡通头像比换脸结果晚到）
function triggerCertPregen() {
  buildCertBlob().then((blob) => {
    if (blob) {
      cachedCertBlob.value = blob
    } else {
      setTimeout(() => {
        buildCertBlob().then((b) => { if (b) cachedCertBlob.value = b })
      }, 3000)
    }
  })
}
// 换脸结果就绪时先用换脸图预生成一次（卡通头像还未到时的兜底）
watch(isReady, (ready) => { if (ready) triggerCertPregen() })
// 卡通头像就绪后刷新证书 blob
watch(() => flow.cartoonAvatarUrl, (url) => { if (url) triggerCertPregen() })
const visibleLogs = computed(() => {
  const start = currentLogOffset.value
  return Array.from({ length: logWindowSize }).map((_, index) => logs.value[(start + index) % logs.value.length])
})

async function runGenerationIfNeeded() {
  // 换脸结果已存在（sessionStorage 恢复）时，补触发未完成的生成步骤
  if (flow.resultImageUrl) {
    if (!flow.aiCertificateUrl && CERT_TEMPLATE_URL && flow.sourceImageUrl) {
      // 模板已配置：直接触发一体化证书生成（卡通+证书合并）
      generateCartoonForCertificate(flow.sourceImageUrl)
    } else if (!flow.cartoonAvatarUrl && !CERT_TEMPLATE_URL && flow.sourceImageUrl) {
      // 无模板降级：触发卡通头像 → Canvas 合成
      generateCartoonForCertificate(flow.sourceImageUrl)
    }
    return
  }
  if (!flow.sourceImageUrl) {
    errorHint.value = zh.uploadFirst
    return
  }
  if (flow.isGenerating) return

  flow.setGenerating(true)
  generationProgress.value = 12

  // 换脸提交后立即并行启动证书/卡通生成，避免串行等待
  let bgTaskTriggered = false
  function tryTriggerBgTask(sourceUrl: string) {
    if (bgTaskTriggered || !sourceUrl) return
    bgTaskTriggered = true
    // 无论是否配置模板，都先生成皮克斯卡通头像（与换脸并行）
    // 有模板时：卡通头像生成完成后自动触发证书融合（generateCartoonForCertificate 内部处理）
    // 无模板时：卡通头像生成完成后降级 Canvas 合成
    generateCartoonForCertificate(sourceUrl)
  }

  try {
    const response = await faceSwapClient.generateFaceSwap({
      imageUrl: flow.sourceImageUrl,
      style: flow.selectedStyle,
      cloudFileID: flow.cloudFileID,
      targetImageUrl: flow.templateTargetUrl ?? undefined,
      onProgress: (event) => {
        generationProgress.value = Math.max(8, Math.min(98, event.progress))
        if (event.detail) {
          logs.value = [`> ${event.detail}`, ...logs.value].slice(0, 10)
        }
        // 换脸已提交 Jimeng（ImgBB 上传完毕），立即并行启动后台任务
        if (event.stage === 'submit') {
          tryTriggerBgTask(flow.sourceImageUrl ?? '')
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

    // 兜底：若 onProgress 未触发 submit（极少数 provider），在这里补启动
    tryTriggerBgTask(response.swapImageUrl ?? flow.sourceImageUrl ?? '')
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

// 后台生成证书：有模板时一步到位（皮克斯转换 + 融合），无模板时仅生成卡通头像供 Canvas 合成
async function generateCartoonForCertificate(sourceImageUrl: string) {
  if (!sourceImageUrl) return

  if (CERT_TEMPLATE_URL) {
    // 一体化：单次 API 调用完成皮克斯头像生成 + 证书融合
    console.log('[Certificate] 一步生成模式：皮克斯头像 + 证书融合（单次 API 调用）')
    isCertGenerating.value = true
    certGenFailed.value = false
    certGenMsg.value = ''
    try {
      const certUrl = await generateCertificateFromPhoto(sourceImageUrl, CERT_TEMPLATE_URL)
      flow.setAiCertificate(certUrl)
      triggerCertPregen()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[AiCertificate] 生成失败：', msg)
      certGenMsg.value = msg
      certGenFailed.value = true
    } finally {
      isCertGenerating.value = false
    }
    return
  }

  // 无模板降级：仅生成卡通头像，供 Canvas 合成
  cartoonFailed.value = false
  try {
    const cartoonUrl = await generateCartoonAvatar(sourceImageUrl)
    let localUrl = cartoonUrl
    try { localUrl = await toDataUrl(cartoonUrl) } catch { /* keep original */ }
    flow.setCartoonAvatar(localUrl)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[CartoonAvatar] 生成失败：', msg)
    cartoonErrorMsg.value = msg
    cartoonFailed.value = true
  }
}

async function retryCartoon() {
  cartoonFailed.value = false
  cartoonErrorMsg.value = ''
  generateCartoonForCertificate(flow.sourceImageUrl ?? '')
}

async function retryCert() {
  if (!flow.sourceImageUrl) return
  generateCartoonForCertificate(flow.sourceImageUrl)
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'Anonymous'
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
  flow.resetSourceImage()   // 清除所有状态（含来源图、模板选择、生成结果）
  await router.replace('/')  // 跳回主界面，replace 避免用户回退到旧结果页
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

      <div class="card-shell rounded-[30px] p-3">
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
              <!-- 换脸结果 + 前景遮罩叠加，sceneId 对应所选模板 -->
              <SceneComposite
                ref="sceneCompositeRef"
                :face-url="resultImage || ''"
                :scene-id="flow.currentSceneId"
                class="w-full"
              />
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
        <!-- ── AI 证书路径（CERT_TEMPLATE_URL 已配置）──────────────────── -->
        <!-- AI 证书已生成：底层 AI 肖像 + 顶层文字透明遮罩 -->
        <AgentCertificate
          v-if="isReady && aiCertUrl"
          :image-url="aiCertUrl"
        />
        <!-- AI 证书生成中 -->
        <div v-else-if="isReady && CERT_TEMPLATE_URL && isCertGenerating" class="cartoon-loading">
          <div class="cartoon-loading-orb"></div>
          <p class="cartoon-loading-text">正在生成游戏证书...</p>
        </div>
        <!-- AI 证书生成失败 -->
        <div v-else-if="isReady && certGenFailed" class="cartoon-loading">
          <div class="cartoon-error-icon">✕</div>
          <p class="cartoon-loading-text">游戏证书生成失败</p>
          <p v-if="certGenMsg" class="cartoon-error-detail">{{ certGenMsg }}</p>
          <button type="button" class="cartoon-retry-btn" @click="retryCert">重新生成证书</button>
        </div>
        <!-- AI 证书等待中（模板已配置但尚未收到结果）-->
        <div v-else-if="isReady && CERT_TEMPLATE_URL && !aiCertUrl" class="cartoon-loading">
          <div class="cartoon-loading-orb"></div>
          <p class="cartoon-loading-text">正在生成游戏证书...</p>
        </div>

        <!-- ── 降级路径（无模板，使用卡通头像 + Canvas 合成）──────────── -->
        <!-- 卡通头像生成失败 -->
        <div v-else-if="isReady && cartoonFailed" class="cartoon-loading">
          <div class="cartoon-error-icon">✕</div>
          <p class="cartoon-loading-text">卡通头像生成失败</p>
          <p v-if="cartoonErrorMsg" class="cartoon-error-detail">{{ cartoonErrorMsg }}</p>
          <button type="button" class="cartoon-retry-btn" @click="retryCartoon">重新生成</button>
        </div>
        <!-- Canvas 合成证书（降级：无 AI 证书时用卡通头像兜底） -->
        <AgentCertificate
          v-else-if="isReady && certPhotoUrl"
          :image-url="certPhotoUrl || ''"
        />
        <!-- 卡通头像生成中（降级兜底）-->
        <div v-else class="cartoon-loading">
          <div class="cartoon-loading-orb"></div>
          <p class="cartoon-loading-text">正在生成卡通头像...</p>
        </div>
      </div>
      <div v-else class="card-shell rounded-[30px] p-3 text-xs text-cyan-100/80">
        {{ zh.teaserHidden }}
      </div>

      <div class="card-shell rounded-[30px] p-3">
        <!-- 保存场景照片（换脸结果 + 前景遮罩合成图） -->
        <button
          type="button"
          class="amber-action mb-2 w-full rounded-[30px] px-4 py-3 font-mono text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="isDownloading || !isReady || teaserMode"
          @click="downloadResultImage"
        >
          <span class="inline-flex items-center gap-2">
            <Download class="h-4 w-4" />
            {{ isDownloading ? zh.saving : zh.saveScene }}
          </span>
        </button>
        <!-- 保存游戏证书 -->
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
    url('/magic-bg.webp') center center / cover no-repeat;
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

/* 卡通头像生成中的 loading 占位 */
.cartoon-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 16px;
  border-radius: 30px;
}
.cartoon-loading-orb {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 3px solid rgba(68, 217, 255, 0.25);
  border-top-color: rgba(68, 217, 255, 0.9);
  animation: cartoonSpin 0.9s linear infinite;
  will-change: transform;
}
.cartoon-loading-text {
  margin: 0;
  font-size: 13px;
  letter-spacing: 0.06em;
  color: rgba(200, 230, 255, 0.7);
}
.cartoon-error-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 2px solid rgba(255, 100, 100, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: rgba(255, 130, 130, 0.85);
}
.cartoon-error-detail {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: rgba(255, 160, 160, 0.7);
  max-width: 280px;
  text-align: center;
  word-break: break-all;
}
.cartoon-retry-btn {
  margin-top: 4px;
  padding: 6px 20px;
  border-radius: 20px;
  font-size: 12px;
  letter-spacing: 0.06em;
  color: rgba(200, 230, 255, 0.9);
  background: rgba(68, 217, 255, 0.12);
  border: 0.5px solid rgba(68, 217, 255, 0.35);
  cursor: pointer;
  transition: background 0.2s;
}
.cartoon-retry-btn:hover {
  background: rgba(68, 217, 255, 0.22);
}
@keyframes cartoonSpin {
  to { transform: rotate(360deg); }
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
