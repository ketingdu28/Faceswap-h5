<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Camera, ImagePlus, Play } from 'lucide-vue-next'
import TerminalLoader from '../components/TerminalLoader.vue'
import FaceSwapProcessLoader from '../components/FaceSwapProcessLoader.vue'
import { useAgentFlowStore, type StyleOption } from '../stores/agentFlow'
import { faceSwapClient } from '../services/faceSwapClient'
import sceneImgA from '../assets/style-a.webp'
import sceneImgB from '../assets/style-b.webp'
import sceneImgC from '../assets/style-c.webp'

// ─── 每个场景的换脸模板图片 ─────────────────────────────────────────────────────
// 使用方法：将图片放到 src/assets/，在下方对应场景数组里填写 import 即可。
// 未配置的场景会显示白色占位框，等待后续补充。
//
// 场景 A（风起洛阳）模板
import templateA1 from '../assets/template-a-1.webp'
import templateA2 from '../assets/template-a-2.webp'
import templateA3 from '../assets/template-a-3.webp'
//
// 场景 B（魔法冰堡）模板 ← 取消下面三行注释并放入图片文件即可生效
import templateB1 from '../assets/template-b-1.webp'
import templateB2 from '../assets/template-b-2.webp'
import templateB3 from '../assets/template-b-3.webp'
//
// 场景 C（冰龙寻珠）模板
import templateC1 from '../assets/template-c-1.webp'
import templateC2 from '../assets/template-c-2.webp'
import templateC3 from '../assets/template-c-3.webp'

const PoseGuideLayer = defineAsyncComponent(() => import('../components/PoseGuideLayer.vue'))

const router = useRouter()
const route = useRoute()
const flow = useAgentFlowStore()
const heroPlaceholder = '/hero-placeholder.png'
const stageBackgroundStyle = {
  backgroundImage: `radial-gradient(circle at top, rgba(255, 218, 170, 0.06) 0%, rgba(255, 218, 170, 0) 28%), radial-gradient(circle at 78% 18%, rgba(182, 122, 255, 0.08) 0%, rgba(182, 122, 255, 0) 24%), linear-gradient(135deg, rgba(9, 24, 48, 0.16) 0%, rgba(15, 52, 94, 0.14) 100%), url("/magic-bg.webp")`,
  backgroundPosition: 'center center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: 'cover',
}
const zh = {
  tactical: '\u9b54\u6cd5\u53d8\u8eab\u4e2d\u5fc3',
  teaserOnly: '\u5f53\u524d\u4e3a\u6f14\u793a\u6a21\u5f0f\uff1a\u4ec5\u4fdd\u7559\u4e0a\u4f20\u3001\u6362\u8138\u4e0e\u7ed3\u679c\u6d4f\u89c8\u80fd\u529b\u3002',
  uploadArea: '\u65f6\u7a7a\u95e8',
  frontFace: '\u8bf7\u653e\u5165\u4f60\u7684\u5192\u9669\u8005\u6b63\u9762\u7167',
  supportCameraAlbum: '\u53ef\u4ece\u76f8\u673a\u6216\u76f8\u518c\u5f00\u542f\u63a2\u7d22',
  authAndOpenCamera: '\u5524\u9192\u9b54\u955c\uff08\u6253\u5f00\u76f8\u673a\uff09',
  fromAlbum: '\u4ece\u65f6\u5149\u76f8\u518c\u6311\u9009',
  styleMatrix: '\u65f6\u7a7a\u95e8\u56fe\u9274',
  startSwap: '\u5f00\u542f\u9b54\u6cd5\u53d8\u8eab',
  styleA: '\u98ce\u8d77\u6d1b\u9633',
  styleB: '\u9b54\u6cd5\u51b0\u5821',
  styleC: '\u51b0\u9f99\u5bfb\u73e0',
  styleADesc: '\u8ddf\u968f\u4e0d\u826f\u4eba\u63a2\u79d8\u5927\u5510\uff0c\u7834\u89e3\u5929\u73e0\u7684\u5965\u79d8',
  styleBDesc: '\u8fdb\u5165\u5947\u5e7b\u51b0\u96ea\u738b\u56fd\uff0c\u65bd\u5c55\u9b54\u6cd5\u5bfb\u627e\u6bcd\u4eb2',
  styleCDesc: '\u968f\u51b0\u9f99\u4e00\u540c\u63a2\u9669\uff0c\u52a9\u9f99\u65cf\u91cd\u65b0\u593a\u56de\u5b9d\u73e0',
  iosHint: 'iOS Safari \u53ef\u80fd\u4e8c\u6b21\u5f39\u7a97\u6388\u6743\uff0c\u82e5\u5931\u8d25\u8bf7\u6539\u7528\"\u4ece\u76f8\u518c\u4e0a\u4f20\"\u3002',
  cameraHint: '\u8bf7\u6388\u6743\u6444\u50cf\u5934\u540e\u7ee7\u7eed\uff0c\u5931\u8d25\u65f6\u53ef\u6539\u7528\u76f8\u518c\u4e0a\u4f20\u3002',
  uploadReadFail: '\u56fe\u7247\u8bfb\u53d6\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5',
  uploadFirst: '\u8bf7\u5148\u4e0a\u4f20\u56fe\u7247',
  processFail: 'AI \u5904\u7406\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5',
}
const fileInputRef = ref<HTMLInputElement | null>(null)
const captureMode = ref<'user' | undefined>(undefined)
const permissionHint = ref('')
const uploadError = ref('')
const showTerminalLoader = ref(true)

const poseGuideEnabled = (import.meta.env.VITE_POSE_GUIDE ?? '0') === '1'
const poseGuideDebugNoCamera = (import.meta.env.VITE_POSE_GUIDE_DEBUG_NO_CAMERA ?? '0') === '1'
const showPoseGuide = ref(false)
const poseGuideOpening = ref(false)

const styles: Array<{ id: StyleOption; title: string; description: string }> = [
  { id: 'A', title: zh.styleA, description: zh.styleADesc },
  { id: 'B', title: zh.styleB, description: zh.styleBDesc },
  { id: 'C', title: zh.styleC, description: zh.styleCDesc },
]

const teaserMode = (import.meta.env.VITE_APP_MODE ?? 'FULL') === 'TEASER'
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
const uploadPreview = computed(() => flow.sourceImageUrl)

// 场景选择状态：用户必须主动点击传送门并选择后才允许开始换脸
const sceneConfirmed = ref(false)
const sceneModalOpen = ref(false)
const sceneImages: Record<StyleOption, string> = { A: sceneImgA, B: sceneImgB, C: sceneImgC }

// 每个场景的 3 张换脸模板，null 表示显示白色占位框
// 图片备好后：1) 取消上方注释中的 import  2) 填入下方对应位置
const sceneTemplates: Partial<Record<StyleOption, [string | null, string | null, string | null]>> = {
   A: [templateA1, templateA2, templateA3],
   B: [templateB1, templateB2, templateB3],  // ← 魔法冰堡，图片就绪后填这行
   C: [templateC1, templateC2, templateC3],
}

// 模板图片的内联样式（Teleport 内 scoped CSS 不可靠，全部改为 inline style）
// 修改圆角：borderRadius | 图片位置：objectPosition | 其余属性保证布局正常
const templateImgStyle = {
  width: '100%',
  aspectRatio: '3 / 4',
  display: 'block',
  objectFit: 'cover' as const,
  objectPosition: 'center 10%',   // 数值越大图片越靠下
  borderRadius: '0px',            // 0px = 无圆角；改为 '12px' 等恢复圆角
}

// AI 换脸专用高清底图 URL（独立于预览缩略图，可在 .env.local 中单独配置）
// 未配置时自动降级为预览缩略图的本地路径
const env = import.meta.env as Record<string, string | undefined>
const aiTemplateUrls: Record<StyleOption, [string, string, string]> = {
  A: [env.VITE_AI_TEMPLATE_A1 ?? '', env.VITE_AI_TEMPLATE_A2 ?? '', env.VITE_AI_TEMPLATE_A3 ?? ''],
  B: [env.VITE_AI_TEMPLATE_B1 ?? '', env.VITE_AI_TEMPLATE_B2 ?? '', env.VITE_AI_TEMPLATE_B3 ?? ''],
  C: [env.VITE_AI_TEMPLATE_C1 ?? '', env.VITE_AI_TEMPLATE_C2 ?? '', env.VITE_AI_TEMPLATE_C3 ?? ''],
}
const selectedScene = computed(() => styles.find((s) => s.id === flow.selectedStyle) ?? null)

// 两步流程：step1 选场景 → step2 选模板
const sheetStep = ref<'scene' | 'template'>('scene')
const pendingScene = ref<StyleOption | null>(null)
const selectedTemplateIdx = ref<number>(0)

// 每个场景 3 个模板占位（后续替换为实际图片数组）
const TEMPLATE_COUNT = 3

// 要求照片 + 场景均已就绪
const canStart = computed(() => flow.canGenerate && sceneConfirmed.value && !flow.isGenerating)

function openScenePicker() {
  sheetStep.value = 'scene'
  sceneModalOpen.value = true
}

function closeSceneModal() {
  sceneModalOpen.value = false
  // 若用户未完成两步直接关闭，不改动已选状态
  sheetStep.value = 'scene'
  pendingScene.value = null
}

function onSceneCardClick(id: StyleOption) {
  pendingScene.value = id
  sheetStep.value = 'template'
}

function selectTemplate(templateIdx: number) {
  if (!pendingScene.value) return
  flow.setStyle(pendingScene.value)
  selectedTemplateIdx.value = templateIdx

  // 优先使用 .env.local 中配置的高清 AI 底图 URL；
  // 未配置时回退到本地预览缩略图路径（Vite 打包后自动加哈希，ensurePublicTargetUrl 会上传 ImgBB）
  const aiUrl = aiTemplateUrls[pendingScene.value]?.[templateIdx]
  const fallbackPath = sceneTemplates[pendingScene.value]?.[templateIdx] ?? null
  flow.setTemplateTargetUrl(
    aiUrl || (fallbackPath ? window.location.origin + fallbackPath : null)
  )

  sceneConfirmed.value = true
  sceneModalOpen.value = false
  sheetStep.value = 'scene'
  pendingScene.value = null
}
const previewLoadingMode = computed(() => route.query.previewLoading === '1')
const floatingBubbles = Array.from({ length: 22 }, (_, index) => ({
  id: index,
  size: 8 + (index % 5) * 5,
  left: `${(index * 13 + 9) % 100}%`,
  top: `${(index * 17 + 13) % 100}%`,
  delay: `${(index % 7) * 0.7}s`,
  duration: `${16 + (index % 6) * 3.2}s`,
  breatheDuration: `${3.2 + ((index * 7) % 24) / 10}s`,
}))
let previewTimer: number | undefined
let poseGuidePrewarmTimer: number | undefined

onMounted(() => {
  if (poseGuideEnabled) {
    poseGuidePrewarmTimer = window.setTimeout(() => {
      // Idle prewarm: fetch async component and TF runtime chunks, but do not open camera.
      void import('../components/PoseGuideLayer.vue')
      void Promise.allSettled([
        import('@tensorflow/tfjs-core'),
        import('@tensorflow/tfjs-backend-webgl'),
        import('@tensorflow-models/pose-detection'),
      ])
    }, 2800)
  }

  if (previewLoadingMode.value) {
    showTerminalLoader.value = false
    flow.setGenerating(true)
    previewTimer = window.setTimeout(() => {
      flow.setGenerating(false)
    }, 4200)
    return
  }
  flow.resetSourceImage()
  sceneConfirmed.value = false
})

onBeforeUnmount(() => {
  window.clearTimeout(previewTimer)
  window.clearTimeout(poseGuidePrewarmTimer)
})

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function openPicker(mode?: 'user') {
  captureMode.value = mode
  uploadError.value = ''
  if (mode) {
    permissionHint.value = isIOS ? zh.iosHint : zh.cameraHint
  } else {
    permissionHint.value = ''
  }

  if (fileInputRef.value) {
    fileInputRef.value.value = ''
    fileInputRef.value.click()
  }
}

function onFileSelected(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  uploadError.value = ''
  const reader = new FileReader()
  reader.onload = () => {
    const base64 = typeof reader.result === 'string' ? reader.result : ''
    if (!base64) {
      uploadError.value = zh.uploadReadFail
      return
    }
    // Frontend base64 only; no TCB pre-upload dependency.
    flow.setSourceImage({ url: base64, base64 })
    flow.setCloudFileID('')
  }
  reader.readAsDataURL(file)
}

function onPoseAligned(payload: { base64: string }) {
  flow.setSourceImage({ url: payload.base64, base64: payload.base64 })
  flow.setCloudFileID('')
  showPoseGuide.value = false
  poseGuideOpening.value = false
}

function openPoseGuide() {
  poseGuideOpening.value = true
  showPoseGuide.value = true
}

function onPoseGuideReady() {
  poseGuideOpening.value = false
}

function onPoseGuideClose() {
  showPoseGuide.value = false
  poseGuideOpening.value = false
}

async function startGeneration() {
  if (!canStart.value) return
  uploadError.value = ''

  if (!flow.sourceImageBase64) {
    uploadError.value = zh.uploadFirst
    return
  }

  flow.resetResult()
  flow.setGenerating(true)
  // 等 Vue 渲染 loading 界面后再启动网络请求，避免主线程同步操作冻结 UI
  await nextTick()
  try {
    const { resultUrl, meta } = await faceSwapClient.generateFaceSwap({
      imageUrl: flow.sourceImageBase64,
      style: flow.selectedStyle,
      // 使用用户选定的模板底图（未选时回退到 STYLE_TARGET_URLS 默认值）
      targetImageUrl: flow.templateTargetUrl ?? undefined,
    })
    flow.setResultImage(resultUrl)
    flow.certificateMeta = meta
    flow.setGenerating(false)
    await wait(860)
    await router.push('/result-stage')
    if (router.currentRoute.value.path !== '/result-stage') {
      await router.replace('/result-stage')
    }
    if (router.currentRoute.value.path !== '/result-stage') {
      window.location.assign('/result-stage')
    }
  } catch (error) {
    uploadError.value = error instanceof Error ? error.message : zh.processFail
  } finally {
    flow.setGenerating(false)
  }
}
</script>

<template>
  <TerminalLoader :active="showTerminalLoader" @done="showTerminalLoader = false" />
  <FaceSwapProcessLoader :active="flow.isGenerating" />
  <PoseGuideLayer
    v-if="poseGuideEnabled && showPoseGuide"
    :debug-no-camera="poseGuideDebugNoCamera"
    @pose-aligned="onPoseAligned"
    @ready="onPoseGuideReady"
    @close="onPoseGuideClose"
  />

  <section :style="stageBackgroundStyle" class="safe-bottom stage-bg relative isolate min-h-screen w-full overflow-hidden px-4 py-6 md:px-8">
    <div class="pointer-events-none absolute inset-0 z-0">
      <div class="top-light light-a"></div>
      <div class="top-light light-b"></div>
      <div class="top-light light-c"></div>
      <div class="fantasy-silhouette"></div>
      <div class="glow-blob blob-a"></div>
      <div class="glow-blob blob-b"></div>
      <div class="glow-blob blob-c"></div>
      <div class="aurora-decor"></div>
      <div class="purple-aurora"></div>
      <div class="orbit orbit-a"></div>
      <div class="orbit orbit-b"></div>
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

    <div class="stage-shell relative z-10 mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-[420px] flex-col gap-4">
      <header class="flex items-center justify-between">
        <div class="hero-heading">
          <p class="hero-heading__eyebrow">Park-style Magic Makeover Center</p>
          <h1 class="title-halo">{{ zh.tactical }}</h1>
        </div>
        <span class="v2-halo text-[10px] text-[#f8ddb0]/80">{{ teaserMode ? 'PREVIEW' : 'PARK' }}</span>
      </header>

      <p v-if="teaserMode" class="card-shell rounded-[30px] px-3 py-2 text-xs text-[#efe2ff]/85">
        {{ zh.teaserOnly }}
      </p>

      <div class="card-shell relative overflow-hidden rounded-[30px] p-3">
        <div class="mb-2 flex items-center justify-between">
          <div class="section-heading section-heading--portal">
            <div class="section-heading__row">
              <p class="section-heading__title">{{ zh.uploadArea }}</p>
              <p class="section-heading__eyebrow">Wonder Gate</p>
            </div>
            <p class="section-heading__subline">进入你的魔法身份入口</p>
          </div>
          <span class="section-heading__badge">Portal</span>
        </div>
        <button
          type="button"
          class="upload-zone relative flex w-full items-center justify-center overflow-hidden rounded-[30px] border-0 bg-[rgba(255,255,255,0.03)] backdrop-blur-md aspect-[3/4] min-h-[360px] max-h-[60vh]"
          @click="openPicker()"
        >
          <img
            :src="uploadPreview || heroPlaceholder"
            alt="preview"
            class="upload-preview-glow absolute inset-0 h-full w-full object-cover object-[center_15%] opacity-95"
          />

          <div class="magic-veil pointer-events-none absolute inset-0 z-[2] overflow-hidden rounded-[30px]">
            <div class="magic-grain absolute inset-0"></div>
          </div>

          <div v-if="uploadPreview" class="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center">
            <div class="h-20 w-20 rounded-full border border-[#d6c2ff]/55"></div>
            <div class="absolute h-0.5 w-12 bg-[#d6c2ff]/55"></div>
            <div class="absolute h-12 w-0.5 bg-[#d6c2ff]/55"></div>
          </div>

          <div v-else class="placeholder-mask pointer-events-none absolute inset-0 z-[3] flex flex-col items-center justify-center gap-2 text-white/90">
            <p class="typewriter-text font-semibold tracking-[0.06em] text-[#d8cbff]">{{ zh.frontFace }}</p>
            <p class="text-xs text-[#efe2ff]/72">{{ zh.supportCameraAlbum }}</p>
          </div>
        </button>

        <p v-if="permissionHint" class="mt-2 text-xs text-[#efe2ff]/75">{{ permissionHint }}</p>
        <p v-if="uploadError" class="mt-2 text-xs text-red-400">{{ uploadError }}</p>

        <div class="mt-3 flex gap-2">
          <button
            type="button"
            class="glass-button flex flex-1 items-center justify-center gap-2 rounded-[30px] px-3 py-2 text-xs text-white"
            :disabled="teaserMode"
            @click="openPicker('user')"
          >
            <Camera class="h-4 w-4 text-white" />
            {{ zh.authAndOpenCamera }}
          </button>
          <button
            type="button"
            class="glass-button flex flex-1 items-center justify-center gap-2 rounded-[30px] px-3 py-2 text-xs text-white"
            @click="openPicker()"
          >
            <ImagePlus class="h-4 w-4 text-white" />
            {{ zh.fromAlbum }}
          </button>
        </div>
        <div v-if="poseGuideEnabled" class="mt-2 flex">
          <button
            type="button"
            class="glass-button flex flex-1 items-center justify-center gap-2 rounded-[30px] px-3 py-2 text-xs text-white"
            @click="openPoseGuide"
          >
            魔镜引导（试验）
          </button>
        </div>
        <p v-if="poseGuideEnabled && poseGuideOpening" class="mt-2 text-center text-[11px] text-[#efe2ff]/80">
          魔镜加载中，正在汇聚星尘...
        </p>
        <input
          ref="fileInputRef"
          class="hidden"
          type="file"
          accept="image/*"
          :capture="captureMode"
          @change="onFileSelected"
        />
      </div>

      <!-- 传送门场景选择 -->
      <div class="card-shell rounded-[30px] p-3">
        <div class="mb-3 flex items-center justify-between">
          <div class="section-heading section-heading--index">
            <div class="section-heading__row">
              <p class="section-heading__title">{{ zh.styleMatrix }}</p>
              <p class="section-heading__eyebrow">Scene Portal</p>
            </div>
            <p class="section-heading__subline">选择场景与换脸模板</p>
          </div>
          <span class="section-heading__badge">Portal</span>
        </div>

        <!-- 未选择：传送门触发按钮 -->
        <button v-if="!sceneConfirmed" type="button" class="portal-trigger" @click="openScenePicker">
          <!-- 底图：:src 动态绑定绕过 Vite 构建期静态文件检查，运行时从 public/ 加载 -->
          <img :src="'/portal-bg.webp'" alt="" class="portal-bg-img" aria-hidden="true" />
          <!-- 渐变遮罩，保证文字可读 -->
          <div class="portal-bg-mask" aria-hidden="true"></div>
          <!-- 动态光环 -->
          <div class="portal-rings" aria-hidden="true">
            <div class="portal-ring ring-1"></div>
            <div class="portal-ring ring-2"></div>
            <div class="portal-ring ring-3"></div>
          </div>
          <!-- 文字内容 -->
          <div class="portal-core">
            <span class="portal-star">✦</span>
            <p class="portal-label">点击开启传送门</p>
            <p class="portal-hint">选择游戏场景与角色模板</p>
          </div>
        </button>

        <!-- 已选择：场景 + 模板已确认 -->
        <div v-else class="portal-confirmed">
          <img :src="sceneImages[flow.selectedStyle]" alt="scene preview" class="portal-confirmed-thumb" />
          <div class="portal-confirmed-body">
            <span class="portal-confirmed-badge">✦ 场景已选择</span>
            <p class="portal-confirmed-name">{{ selectedScene?.title }}</p>
            <p class="portal-confirmed-sub">模板 {{ ['一','二','三'][selectedTemplateIdx] }}</p>
          </div>
          <button type="button" class="portal-reselect" @click="openScenePicker">重选</button>
        </div>
      </div>

      <!-- 两步选择底部弹层 -->
      <Teleport to="body">
        <Transition name="scene-sheet">
          <div v-if="sceneModalOpen" class="scene-overlay" @click.self="closeSceneModal">
            <div class="scene-panel" role="dialog" :aria-label="sheetStep === 'scene' ? '选择游戏场景' : '选择角色模板'">

              <!-- Step 1：选场景 -->
              <template v-if="sheetStep === 'scene'">
                <div class="scene-panel-header">
                  <p class="scene-panel-title">选择游戏场景</p>
                  <button type="button" class="scene-panel-close" aria-label="关闭" @click="closeSceneModal">×</button>
                </div>
                <div class="scene-list">
                  <button
                    v-for="s in styles"
                    :key="s.id"
                    type="button"
                    class="scene-item"
                    :class="{ 'is-active': sceneConfirmed && flow.selectedStyle === s.id }"
                    @click="onSceneCardClick(s.id)"
                  >
                    <img :src="sceneImages[s.id]" :alt="s.title" class="scene-item-img" />
                    <div class="scene-item-body">
                      <p class="scene-item-title">{{ s.title }}</p>
                      <p class="scene-item-desc">{{ s.description }}</p>
                    </div>
                    <span v-if="sceneConfirmed && flow.selectedStyle === s.id" class="scene-item-check" aria-hidden="true">✓</span>
                  </button>
                </div>
              </template>

              <!-- Step 2：选模板 -->
              <template v-else>
                <div class="scene-panel-header">
                  <button type="button" class="scene-panel-back" aria-label="返回" @click="sheetStep = 'scene'">‹ 返回</button>
                  <p class="scene-panel-title">选择角色模板</p>
                  <button type="button" class="scene-panel-close" aria-label="关闭" @click="closeSceneModal">×</button>
                </div>
                <p class="template-step-hint">{{ styles.find(s => s.id === pendingScene)?.title }} · 选择换脸模板</p>
                <div class="template-grid">
                  <button
                    v-for="idx in TEMPLATE_COUNT"
                    :key="idx"
                    type="button"
                    class="template-item"
                    :class="{ 'is-active': sceneConfirmed && flow.selectedStyle === pendingScene && selectedTemplateIdx === idx - 1 }"
                    @click="selectTemplate(idx - 1)"
                  >
                    <!-- 有图片时显示图片，否则显示白色占位框 -->
                    <img
                      v-if="sceneTemplates[pendingScene ?? 'A']?.[idx - 1]"
                      :src="sceneTemplates[pendingScene ?? 'A']![idx - 1]!"
                      class="template-img"
                      :style="templateImgStyle"
                      :alt="`模板 ${['一','二','三'][idx - 1]}`"
                    />
                    <div v-else class="template-placeholder" aria-hidden="true">
                      <span class="template-placeholder-icon">＋</span>
                    </div>
                    <p class="template-label">模板 {{ ['一','二','三'][idx - 1] }}</p>
                  </button>
                </div>
              </template>

            </div>
          </div>
        </Transition>
      </Teleport>

      <div class="card-shell mt-auto rounded-[30px] p-3">
        <button
          type="button"
          class="glass-button w-full rounded-[30px] px-4 py-5 font-mono text-base tracking-[0.2em] text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!canStart"
          @click="startGeneration"
        >
          <span class="inline-flex items-center gap-2">
            <Play class="h-4 w-4" />
            {{ zh.startSwap }}
          </span>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.stage-bg {
  background-color: #112347;
}

.top-light {
  position: absolute;
  top: -8%;
  width: 34%;
  height: 46%;
  opacity: 0.28;
  filter: blur(6px);
  background: linear-gradient(to bottom, rgba(255, 248, 223, 0.46), rgba(255, 223, 173, 0.16) 35%, transparent 72%);
  clip-path: polygon(46% 0, 54% 0, 100% 100%, 0 100%);
  transform-origin: top center;
  animation: lightSweep 9s ease-in-out infinite alternate;
}

.light-a {
  left: -2%;
  transform: rotate(-10deg);
}

.light-b {
  left: 33%;
  width: 28%;
  opacity: 0.32;
  transform: rotate(-1deg);
}

.light-c {
  right: -2%;
  transform: rotate(10deg);
}

.fantasy-silhouette {
  position: absolute;
  inset: auto 0 6% 0;
  height: 36%;
  opacity: 0.15;
  filter: blur(16px);
  background:
    radial-gradient(circle at 22% 72%, rgba(255, 215, 162, 0.08) 0 10%, transparent 11%),
    radial-gradient(circle at 24% 54%, rgba(255, 215, 162, 0.08) 0 7%, transparent 8%),
    radial-gradient(circle at 26% 36%, rgba(255, 215, 162, 0.08) 0 5%, transparent 6%),
    radial-gradient(circle at 74% 56%, rgba(255, 215, 162, 0.06) 0 5%, transparent 6%),
    linear-gradient(to top, rgba(255, 215, 162, 0.08), rgba(255, 215, 162, 0.01));
  clip-path: polygon(0 100%, 100% 100%, 100% 80%, 87% 78%, 80% 72%, 74% 62%, 66% 68%, 58% 48%, 50% 76%, 42% 64%, 35% 80%, 26% 60%, 20% 72%, 12% 82%, 0 84%);
}

.glow-blob {
  position: absolute;
  border-radius: 9999px;
  filter: blur(56px);
  opacity: 0.26;
  animation: blobFloat 14s ease-in-out infinite alternate;
}

.blob-a {
  left: -8%;
  top: 8%;
  width: 280px;
  height: 280px;
  background: radial-gradient(circle, rgba(67, 136, 255, 0.34) 0%, rgba(67, 136, 255, 0) 72%);
}

.blob-b {
  right: -10%;
  top: 34%;
  width: 320px;
  height: 320px;
  background: radial-gradient(circle, rgba(68, 217, 255, 0.26) 0%, rgba(68, 217, 255, 0) 72%);
  animation-duration: 18s;
}

.blob-c {
  left: 34%;
  bottom: -18%;
  width: 360px;
  height: 360px;
  background: radial-gradient(circle, rgba(182, 122, 255, 0.26) 0%, rgba(182, 122, 255, 0) 74%);
  animation-duration: 20s;
}

.aurora-decor {
  position: absolute;
  inset: -20%;
  opacity: 0.34;
  background:
    linear-gradient(120deg, rgba(68, 217, 255, 0) 0%, rgba(68, 217, 255, 0.3) 35%, rgba(68, 217, 255, 0) 62%),
    linear-gradient(295deg, rgba(255, 138, 214, 0) 5%, rgba(255, 138, 214, 0.16) 42%, rgba(255, 138, 214, 0) 78%);
  filter: blur(34px);
  animation: auroraFlow 20s ease-in-out infinite alternate;
}

.purple-aurora {
  position: absolute;
  inset: 14% -10% 8%;
  border-radius: 40%;
  background:
    radial-gradient(circle at 50% 45%, rgba(182, 122, 255, 0.32), rgba(182, 122, 255, 0.08) 42%, transparent 72%),
    linear-gradient(180deg, rgba(255, 138, 214, 0.08), transparent 46%);
  filter: blur(30px);
  opacity: 0.58;
}

.orbit {
  position: absolute;
  border: 1px solid rgba(225, 209, 255, 0.14);
  border-radius: 999px;
  filter: drop-shadow(0 0 12px rgba(210, 182, 255, 0.1));
}

.orbit::before {
  content: '';
  position: absolute;
  inset: -10px;
  border-radius: inherit;
  border: 1px solid rgba(248, 219, 158, 0.06);
}

.orbit-a {
  top: 8%;
  right: -18%;
  width: 260px;
  height: 260px;
  transform: rotate(-14deg);
}

.orbit-b {
  left: -12%;
  bottom: 14%;
  width: 210px;
  height: 210px;
  transform: rotate(18deg);
}

.bubble-field {
  position: absolute;
  inset: 0;
}

.bubble-dot {
  position: absolute;
  border-radius: 9999px;
  background: radial-gradient(circle, rgba(255, 247, 229, 0.95) 0%, rgba(156, 246, 255, 0.56) 42%, rgba(255, 138, 214, 0.22) 68%, transparent 76%);
  box-shadow:
    0 0 12px rgba(255, 244, 223, 0.5),
    0 0 28px rgba(68, 217, 255, 0.26);
  filter: blur(0.8px);
  animation:
    bubbleDrift ease-in-out infinite alternate,
    bubbleBreathe var(--breathe-duration, 4s) ease-in-out infinite,
    stardustTwinkle calc(var(--breathe-duration, 4s) * 0.9) ease-in-out infinite;
}

.bubble-dot::after {
  content: '';
  position: absolute;
  top: 50%;
  left: -120%;
  width: 180%;
  height: 28%;
  border-radius: 999px;
  transform: translateY(-50%) rotate(-18deg);
  background: linear-gradient(90deg, transparent, rgba(255, 239, 211, 0.18), transparent);
  opacity: 0.6;
  filter: blur(1px);
}

.bubble-dot:nth-child(3n) {
  background: radial-gradient(circle, rgba(201, 114, 255, 0.84) 0%, rgba(154, 107, 197, 0.34) 55%, transparent 74%);
  box-shadow: 0 0 14px rgba(201, 114, 255, 0.34), 0 0 28px rgba(154, 107, 197, 0.18);
  filter: blur(1px);
  animation:
    bubbleDrift ease-in-out infinite alternate,
    bubbleBreathePurple var(--breathe-duration, 4.5s) ease-in-out infinite;
}

.bubble-dot:nth-child(3n + 2) {
  background: rgba(255, 231, 160, 0.62);
  box-shadow: 0 0 12px rgba(255, 224, 178, 0.5);
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


.placeholder-mask {
  background: linear-gradient(to bottom, rgba(19, 46, 84, 0.16), rgba(7, 19, 40, 0.3));
  text-shadow:
    0 0 10px rgba(255, 249, 240, 0.42),
    0 0 22px rgba(68, 217, 255, 0.16);
}

.typewriter-text {
  display: inline-block;
  overflow: hidden;
  white-space: nowrap;
  width: 14em;
  color: rgba(255, 250, 242, 0.98);
  border-right: 2px solid rgba(255, 231, 160, 0.95);
  text-shadow:
    0 0 14px rgba(255, 250, 242, 0.65),
    0 0 26px rgba(68, 217, 255, 0.2);
  animation:
    typewriter 5.2s steps(14, end) infinite,
    cursorBlink 1.4s steps(1, end) infinite;
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

.section-heading::before {
  content: none;
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

.section-heading__badge {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(255, 249, 240, 0.9);
  background: linear-gradient(135deg, rgba(255, 245, 220, 0.18), rgba(190, 151, 255, 0.12));
  border: 1px solid rgba(255, 245, 220, 0.16);
  box-shadow:
    0 0 16px rgba(68, 217, 255, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
}

.section-heading--portal {
  min-width: 190px;
}

.section-heading--index {
  min-width: 220px;
}

@keyframes bubbleDrift {
  0% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  100% {
    transform: translate3d(22px, -28px, 0) scale(1.12);
  }
}

@keyframes auroraFlow {
  0% {
    transform: translate3d(-2%, -1%, 0) scale(1.02);
  }
  100% {
    transform: translate3d(3%, 2%, 0) scale(1.08);
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

@keyframes typewriter {
  0% {
    width: 0;
  }
  38% {
    width: 14em;
  }
  100% {
    width: 14em;
  }
}

@keyframes cursorBlink {
  0%,
  49% {
    border-right-color: rgba(0, 229, 255, 0.95);
  }
  50%,
  100% {
    border-right-color: transparent;
  }
}

.card-shell {
  position: relative;
  background: linear-gradient(180deg, rgba(108, 165, 255, 0.12), rgba(69, 109, 204, 0.08));
  backdrop-filter: blur(12px);
  border: 0.5px solid rgba(205, 225, 255, 0.22);
  border-top: 0.5px solid rgba(255, 245, 220, 0.22);
  box-shadow:
    0 16px 36px rgba(8, 18, 48, 0.48),
    0 0 34px rgba(68, 217, 255, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
  border-radius: 30px;
}

.stage-shell {
  box-shadow: 0 0 66px rgba(68, 217, 255, 0.14);
  border-radius: 30px;
}

.card-shell::before,
.card-shell::after {
  content: '';
  position: absolute;
  inset: 10px;
  border-radius: 999px;
  pointer-events: none;
}

.card-shell::before {
  content: none;
}

.card-shell::after {
  inset: auto 12% -22px 12%;
  height: 44px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(68, 217, 255, 0.18), transparent 72%);
  filter: blur(14px);
}

.glass-button {
  position: relative;
  isolation: isolate;
  border: 2px solid transparent;
  background: linear-gradient(135deg, rgba(255, 245, 220, 0.18), rgba(190, 151, 255, 0.16));
  backdrop-filter: blur(10px);
  box-shadow:
    0 10px 24px rgba(8, 10, 30, 0.28),
    0 0 24px rgba(68, 217, 255, 0.2),
    0 0 28px rgba(201, 114, 255, 0.18),
    inset 0 0 16px rgba(255, 245, 220, 0.16);
  text-shadow: 0 0 8px rgba(190, 227, 248, 0.4);
  transition:
    transform 420ms cubic-bezier(0.22, 1.25, 0.3, 1),
    box-shadow 420ms cubic-bezier(0.22, 1.25, 0.3, 1),
    background 420ms cubic-bezier(0.22, 1.25, 0.3, 1);
  animation: champagneBreathe 3.2s ease-in-out infinite;
  overflow: hidden;
}

.glass-button,
.upload-zone {
  transition:
    transform 420ms cubic-bezier(0.22, 1.25, 0.3, 1),
    box-shadow 420ms cubic-bezier(0.22, 1.25, 0.3, 1),
    background 420ms cubic-bezier(0.22, 1.25, 0.3, 1);
}

.glass-button:hover,
.glass-button:active {
  animation: none;
  transform: scale(1.035) translateY(-1px);
  box-shadow:
    0 14px 28px rgba(8, 10, 30, 0.32),
    0 0 34px rgba(68, 217, 255, 0.32),
    0 0 38px rgba(201, 114, 255, 0.28),
    inset 0 0 22px rgba(255, 245, 220, 0.22);
}

.glass-button:active {
  transform: scale(0.97);
}

.glass-button::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 2px;
  background: linear-gradient(135deg, rgba(255, 231, 160, 0.58), rgba(201, 114, 255, 0.38));
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

@keyframes champagneBreathe {
  0%,
  100% {
    box-shadow:
      0 10px 20px rgba(8, 10, 30, 0.26),
      0 0 24px rgba(68, 217, 255, 0.18),
      0 0 28px rgba(201, 114, 255, 0.16),
      inset 0 0 10px rgba(255, 245, 220, 0.14);
  }
  50% {
    box-shadow:
      0 14px 24px rgba(8, 10, 30, 0.3),
      0 0 32px rgba(68, 217, 255, 0.26),
      0 0 36px rgba(201, 114, 255, 0.22),
      inset 0 0 16px rgba(255, 245, 220, 0.18);
  }
}

@keyframes blobFloat {
  0% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  100% {
    transform: translate3d(24px, -20px, 0) scale(1.08);
  }
}

.upload-preview-glow {
  filter: brightness(1.12) saturate(1.16) contrast(1.08);
  box-shadow:
    0 0 24px rgba(184, 205, 255, 0.24),
    0 0 36px rgba(255, 224, 178, 0.12);
}

.upload-zone {
  position: relative;
  background: linear-gradient(180deg, rgba(177, 215, 255, 0.1), rgba(154, 107, 197, 0.08));
  box-shadow:
    0 0 24px rgba(68, 217, 255, 0.2),
    0 0 44px rgba(201, 114, 255, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

.upload-zone::before {
  content: '';
  position: absolute;
  inset: 8px;
  border-radius: 26px;
  border: 1px solid rgba(255, 244, 223, 0.16);
  pointer-events: none;
}

.magic-veil {
  background:
    radial-gradient(circle at 50% 18%, rgba(255, 226, 167, 0.14), transparent 32%),
    linear-gradient(180deg, rgba(68, 217, 255, 0.04), rgba(201, 114, 255, 0.12) 55%, rgba(255, 226, 167, 0.08));
}

.magic-veil::before {
  content: '';
  position: absolute;
  inset: -8% -20% 52%;
  border-radius: 50%;
  background: linear-gradient(
    180deg,
    rgba(255, 245, 220, 0.2),
    rgba(182, 122, 255, 0.04) 45%,
    transparent 100%
  );
  filter: blur(16px);
  animation: magicSweep 5.8s ease-in-out infinite alternate;
}

.magic-veil::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 50% 50%, rgba(255, 244, 223, 0.08), transparent 52%);
}

.magic-grain {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.75' numOctaves='5' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E");
  background-size: 160px 160px;
  opacity: 0.14;
  mix-blend-mode: soft-light;
}

@keyframes magicSweep {
  0% {
    transform: translate3d(-4%, -6%, 0) scale(0.96);
    opacity: 0.5;
  }
  100% {
    transform: translate3d(4%, 8%, 0) scale(1.04);
    opacity: 0.9;
  }
}

@keyframes lightSweep {
  0% {
    opacity: 0.16;
    transform: translateY(-2%) scaleY(0.94);
  }
  100% {
    opacity: 0.34;
    transform: translateY(2%) scaleY(1.04);
  }
}

@keyframes stardustTwinkle {
  0%,
  100% {
    box-shadow:
      0 0 8px rgba(236, 229, 255, 0.2),
      0 0 18px rgba(82, 138, 255, 0.1);
  }
  50% {
    box-shadow:
      0 0 12px rgba(255, 244, 223, 0.36),
      0 0 26px rgba(154, 107, 197, 0.2);
  }
}

/* ─── 传送门触发按钮 ────────────────────────────────────────────────────────── */
.portal-trigger {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;   /* 与原图比例一致 */
  min-height: 180px;
  border-radius: 20px;
  background: #0a1228;    /* 图片加载前的底色 */
  border: 1px solid rgba(160, 100, 255, 0.35);
  box-shadow:
    0 0 28px rgba(80, 40, 200, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  overflow: hidden;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 280ms cubic-bezier(0.22, 1.25, 0.3, 1), box-shadow 280ms ease;
}
.portal-trigger:active {
  transform: scale(0.97);
}

/* 底图：铺满按钮 */
.portal-bg-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  pointer-events: none;
}

/* 渐变遮罩：顶部透明 → 底部深色，保证文字与光环清晰可读 */
.portal-bg-mask {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 50% 40%, rgba(20, 0, 60, 0.15) 0%, rgba(10, 5, 40, 0.45) 70%),
    linear-gradient(to bottom, rgba(5, 10, 30, 0.1) 0%, rgba(5, 10, 40, 0.55) 100%);
  pointer-events: none;
}

.portal-rings {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.portal-ring {
  position: absolute;
  left: 50%;
  top: 50%;
  border-radius: 999px;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(160, 100, 255, 0.4);
  animation: portalPulse 2.8s ease-in-out infinite;
  will-change: transform, opacity;
}
.ring-1 { width: 70px;  height: 70px;  animation-delay: 0s; }
.ring-2 { width: 110px; height: 110px; animation-delay: 0.55s; border-color: rgba(68, 217, 255, 0.28); }
.ring-3 { width: 150px; height: 150px; animation-delay: 1.1s; border-color: rgba(255, 138, 214, 0.2); }

.portal-core {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.portal-star {
  font-size: 22px;
  color: rgba(220, 180, 255, 0.95);
  text-shadow: 0 0 14px rgba(180, 100, 255, 0.7), 0 0 28px rgba(68, 217, 255, 0.4);
  animation: starSpin 6s linear infinite;
  display: block;
  will-change: transform;
}
.portal-label {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: rgba(240, 225, 255, 0.96);
  text-shadow: 0 0 12px rgba(180, 100, 255, 0.5);
}
.portal-hint {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: rgba(200, 220, 255, 0.65);
}

@keyframes portalPulse {
  0%, 100% { transform: translate(-50%, -50%) scale(1);   opacity: 0.7; }
  50%       { transform: translate(-50%, -50%) scale(1.18); opacity: 0.25; }
}
@keyframes starSpin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* ─── 场景已选择状态 ─────────────────────────────────────────────────────────── */
.portal-confirmed {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: 20px;
  background: linear-gradient(135deg, rgba(40, 20, 90, 0.4), rgba(10, 30, 80, 0.5));
  border: 1px solid rgba(160, 100, 255, 0.3);
}
.portal-confirmed-thumb {
  width: 72px;
  height: 90px;
  border-radius: 12px;
  object-fit: cover;
  object-position: center top;
  flex-shrink: 0;
  border: 1px solid rgba(180, 120, 255, 0.3);
}
.portal-confirmed-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.portal-confirmed-badge {
  font-size: 10px;
  letter-spacing: 0.14em;
  color: rgba(255, 231, 160, 0.9);
  text-shadow: 0 0 8px rgba(255, 200, 80, 0.4);
}
.portal-confirmed-name {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: rgba(240, 225, 255, 0.98);
  text-shadow: 0 0 10px rgba(180, 100, 255, 0.4);
}
.portal-confirmed-desc {
  margin: 0;
  font-size: 11px;
  color: rgba(200, 210, 255, 0.65);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.portal-reselect {
  flex-shrink: 0;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(160, 100, 255, 0.18);
  border: 1px solid rgba(160, 100, 255, 0.3);
  color: rgba(220, 200, 255, 0.9);
  font-size: 12px;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 200ms ease;
}
.portal-reselect:active { background: rgba(160, 100, 255, 0.32); }

/* ─── 场景选择底层蒙版 + 底部面板 ────────────────────────────────────────────── */
.scene-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(4, 10, 28, 0.72);
  display: flex;
  align-items: flex-end;
}
.scene-panel {
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
  border-radius: 28px 28px 0 0;
  background: linear-gradient(180deg, rgba(18, 10, 50, 0.98), rgba(8, 20, 55, 0.98));
  border-top: 1px solid rgba(160, 100, 255, 0.3);
  box-shadow: 0 -8px 40px rgba(80, 30, 180, 0.25);
  padding: 20px 16px 32px;
  -webkit-overflow-scrolling: touch;
}
.scene-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.scene-panel-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: rgba(240, 225, 255, 0.96);
  text-shadow: 0 0 14px rgba(180, 100, 255, 0.4);
}
.scene-panel-close {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(200, 200, 255, 0.15);
  color: rgba(220, 210, 255, 0.8);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.scene-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.scene-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(160, 100, 255, 0.18);
  cursor: pointer;
  text-align: left;
  transition: border-color 200ms ease, background 200ms ease;
  position: relative;
}
.scene-item.is-active {
  border-color: rgba(200, 150, 255, 0.6);
  background: rgba(160, 80, 255, 0.12);
}
.scene-item:active { background: rgba(160, 100, 255, 0.18); }

.scene-item-img {
  width: 72px;
  height: 90px;
  border-radius: 12px;
  object-fit: cover;
  object-position: center top;
  flex-shrink: 0;
}
.scene-item-body { flex: 1; min-width: 0; }
.scene-item-title {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 700;
  color: rgba(240, 225, 255, 0.96);
}
.scene-item-desc {
  margin: 0;
  font-size: 12px;
  color: rgba(200, 210, 255, 0.65);
  line-height: 1.5;
}
.scene-item-check {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: rgba(180, 100, 255, 0.8);
  color: #fff;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 10px rgba(180, 100, 255, 0.5);
}

/* ─── 已选确认：副标题（模板序号）────────────────────────────────────────────── */
.portal-confirmed-sub {
  margin: 0;
  font-size: 12px;
  color: rgba(180, 160, 255, 0.75);
  letter-spacing: 0.06em;
}

/* ─── 弹层 Step2：模板选择 ───────────────────────────────────────────────────── */
.scene-panel-back {
  font-size: 14px;
  color: rgba(180, 160, 255, 0.85);
  letter-spacing: 0.04em;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
}

.template-step-hint {
  margin: 0 0 14px;
  font-size: 12px;
  color: rgba(200, 200, 255, 0.55);
  letter-spacing: 0.06em;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.template-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  border: 1px solid rgba(160, 100, 255, 0.18);
  border-radius: 16px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.03);
  transition: border-color 200ms ease, background 200ms ease;
}
.template-item.is-active {
  border-color: rgba(200, 150, 255, 0.65);
  background: rgba(160, 80, 255, 0.12);
}
.template-item:active { background: rgba(160, 100, 255, 0.2); }

/* 白色遮罩占位图 — 替换时将此 div 换为 <img> 即可 */
/* 实际模板图片（替换占位后生效） */
:deep(.template-img) {
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: 0%;
  object-fit: cover;
  object-position: center 10%;
  display: block;
}
 
.template-placeholder {
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: 0%;
  background: rgba(255, 255, 255, 0.88);
  display: flex;
  align-items: center;
  justify-content: center;
}
.template-placeholder-icon {
  font-size: 24px;
  color: rgba(160, 140, 200, 0.5);
}

.template-label {
  margin: 0;
  font-size: 12px;
  color: rgba(210, 200, 255, 0.75);
  letter-spacing: 0.04em;
}

/* ─── 底部面板入场/离场动画 ──────────────────────────────────────────────────── */
.scene-sheet-enter-active,
.scene-sheet-leave-active {
  transition: opacity 240ms ease;
}
.scene-sheet-enter-active .scene-panel,
.scene-sheet-leave-active .scene-panel {
  transition: transform 280ms cubic-bezier(0.32, 0.72, 0, 1);
}
.scene-sheet-enter-from,
.scene-sheet-leave-to {
  opacity: 0;
}
.scene-sheet-enter-from .scene-panel,
.scene-sheet-leave-to .scene-panel {
  transform: translateY(100%);
}
</style>
