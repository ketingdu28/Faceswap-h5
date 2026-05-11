<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PoseDetector } from '@tensorflow-models/pose-detection'

type Keypoint = { x: number; y: number; score?: number; name?: string }
type Point2D = { x: number; y: number }

type PreflightFailure =
  | { kind: 'INSECURE' }
  | { kind: 'NO_API' }
  | { kind: 'PERMISSION_DENIED' }
  | { kind: 'NO_DEVICE' }
  | { kind: 'GENERIC'; message: string }

const props = withDefaults(
  defineProps<{
    similarityThreshold?: number
    holdMs?: number
    mirrored?: boolean
    debugNoCamera?: boolean
  }>(),
  {
    similarityThreshold: 0.8,
    holdMs: 2000,
    mirrored: false,
    debugNoCamera: false,
  },
)

const emit = defineEmits<{
  (e: 'pose-aligned', payload: { base64: string }): void
  (e: 'close'): void
  (e: 'ready'): void
}>()

const videoRef = ref<HTMLVideoElement | null>(null)
const silhouetteCanvasRef = ref<HTMLCanvasElement | null>(null)
const guideCanvasRef = ref<HTMLCanvasElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const modalRef = ref<HTMLDivElement | null>(null)
let lockedScrollY = 0
let previousBodyStyles: Partial<CSSStyleDeclaration> | null = null

function lockPageScroll() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  const body = document.body
  lockedScrollY = window.scrollY || window.pageYOffset || 0
  previousBodyStyles = {
    overflow: body.style.overflow,
    position: body.style.position,
    top: body.style.top,
    width: body.style.width,
    touchAction: body.style.touchAction,
  }
  body.style.overflow = 'hidden'
  body.style.position = 'fixed'
  body.style.top = `-${lockedScrollY}px`
  body.style.width = '100%'
  body.style.touchAction = 'none'
}

function unlockPageScroll() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  const body = document.body
  if (previousBodyStyles) {
    body.style.overflow = previousBodyStyles.overflow ?? ''
    body.style.position = previousBodyStyles.position ?? ''
    body.style.top = previousBodyStyles.top ?? ''
    body.style.width = previousBodyStyles.width ?? ''
    body.style.touchAction = previousBodyStyles.touchAction ?? ''
    previousBodyStyles = null
  } else {
    body.style.overflow = ''
    body.style.position = ''
    body.style.top = ''
    body.style.width = ''
    body.style.touchAction = ''
  }
  window.scrollTo(0, lockedScrollY)
}

const hint = ref('正在校准时空坐标...')
const aligned = ref(false)
const holdProgress = ref(0)
const flashing = ref(false)
const preflightError = ref<PreflightFailure | null>(null)
const countdownLabel = ref('')
const poseScanPhase = ref<'idle' | 'capturing' | 'perfect'>('idle')

const PREVIEW_RECT_SELECTOR = '.upload-zone'
// Pixel-based vertical shift: 0 so ankles (y鈮?.95) are not clipped.
const PREVIEW_Y_OFFSET_RATIO = 0.1
// Width of pose box relative to zone height to prevent horizontal collapse.
const POSE_BOX_WIDTH_RATIO = 0.8
const DEBUG_SHOW_PREVIEW_BOUNDS = false

function getDprClamped() {
  return Math.max(1, Math.min(window.devicePixelRatio || 1, 1.5))
}

function getPreviewMappingDevice():
  | null
  | {
      zoneLeft: number
      zoneTop: number
      zoneWidth: number
      zoneHeight: number
      // object-fit: cover mapping (image -> zone)
      imageOffsetX: number
      imageOffsetY: number
      imageDisplayedW: number
      imageDisplayedH: number
    } {
  if (typeof document === 'undefined') return null
  const zoneEl = document.querySelector<HTMLElement>(PREVIEW_RECT_SELECTOR)
  const el = zoneEl ?? modalRef.value
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (!r || r.width <= 2 || r.height <= 2) return null
  const dpr = getDprClamped()

  const modalRect = modalRef.value?.getBoundingClientRect() ?? null
  const stableLeft = modalRect ? modalRect.left + (modalRect.width - r.width) / 2 : r.left
  const stableTop = modalRect ? modalRect.top + (modalRect.height - r.height) / 2 : r.top

  const img = zoneEl?.querySelector<HTMLImageElement>('img.upload-preview-glow') ?? el.querySelector<HTMLImageElement>('img.upload-preview-glow')

  // If no usable image dimensions, fallback to simple zone mapping.
  if (!img || !img.naturalWidth || !img.naturalHeight) {
    return {
      zoneLeft: stableLeft * dpr,
      zoneTop: stableTop * dpr,
      zoneWidth: r.width * dpr,
      zoneHeight: r.height * dpr,
      imageOffsetX: 0,
      imageOffsetY: 0,
      imageDisplayedW: r.width * dpr,
      imageDisplayedH: r.height * dpr,
    }
  }

  const zoneW = r.width
  const zoneH = r.height
  const imgW = img.naturalWidth
  const imgH = img.naturalHeight

  // PreStageV2 uses object-cover with object-[center_15%]
  const xPos = 0.5
  const yPos = 0.15

  const scale = Math.max(zoneW / imgW, zoneH / imgH)
  const displayedW = imgW * scale
  const displayedH = imgH * scale
  const offsetX = zoneW * xPos - displayedW * xPos
  const offsetY = zoneH * yPos - displayedH * yPos

  return {
    zoneLeft: stableLeft * dpr,
    zoneTop: stableTop * dpr,
    zoneWidth: zoneW * dpr,
    zoneHeight: zoneH * dpr,
    imageOffsetX: offsetX * dpr,
    imageOffsetY: offsetY * dpr,
    imageDisplayedW: displayedW * dpr,
    imageDisplayedH: displayedH * dpr,
  }
}

const MIN_POSE_CONFIDENCE = 0.35
const MIN_KEYPOINT_SCORE = 0.15
const FACE_INDICES = {
  nose: 0,
  leftEye: 1,
  rightEye: 2,
  leftEar: 3,
  rightEar: 4,
  leftShoulder: 5,
  rightShoulder: 6,
} as const

let stream: MediaStream | null = null
let detector: PoseDetector | null = null
let rafId = 0
let guideRafId = 0
let estimateInFlight = false
let countdownStartAt = 0
let captured = false
let closing = false
let emitAlignedTimer: number | null = null
let autoCloseTimer: number | null = null
let heavyTeardownTimer: number | null = null
let latestKeypoints: Keypoint[] = []
let lastGuideFrameAt = 0

let silhouetteCache:
  | null
  | {
      w: number
      h: number
      layoutKey: string
      layout: ReturnType<typeof getGuideLayout>
      points: Array<{ x: number; y: number }>
      headPath: Path2D
      bodyPath: Path2D
      strokePath: Path2D
      jointPath: Path2D
    } = null
const burstParticles: Array<{
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
}> = []

const HERO_POSE_LUOYANG = {
  // 1:7 style body ratio, for "raised fan + hand on waist" stance.
  // coordinates in normalized 0..1 space (x, y)
  // x range stretched to ~0.05..0.95 so the figure fills the poseBox width
  keypoints: [
    [0.50, 0.15], // 0 nose
    [0.47, 0.12], // 1 left eye
    [0.53, 0.12], // 2 right eye
    [0.43, 0.14], // 3 left ear
    [0.57, 0.14], // 4 right ear
    [0.35, 0.22], // 5 left shoulder
    [0.65, 0.25], // 6 right shoulder (slightly lower)
    [0.20, 0.30], // 7 left elbow (fan arm extended outward)
    [0.72, 0.44], // 8 right elbow (bent down)
    [0.08, 0.15], // 9 left wrist (fan raised high & outward)
    [0.60, 0.52], // 10 right wrist (on waist)
    [0.42, 0.55], // 11 left hip
    [0.58, 0.57], // 12 right hip (slight offset)
    [0.40, 0.77], // 13 left knee
    [0.58, 0.80], // 14 right knee
    [0.36, 1.00], // 15 left ankle
    [0.60, 1.02], // 16 right ankle
  ] as ReadonlyArray<readonly [number, number]>,
  edges: [
    // Face mini-rig
    [1, 2], // eye baseline
    [1, 3], // left eye-ear
    [2, 4], // right eye-ear
    [0, 1], // nose-eye
    [0, 2], // nose-eye
    // Upper body
    [5, 6], // shoulder line
    [5, 7], // left upper arm
    [7, 9], // left forearm
    [6, 8], // right upper arm
    [8, 10], // right forearm
    // Torso / spine
    // Legs
    [11, 13], // left thigh
    [13, 15], // left shin
    [12, 14], // right thigh
    [14, 16], // right shin
  ] as ReadonlyArray<readonly [number, number]>,
  handEnergyCenter: [0.60, 0.52] as readonly [number, number], // right wrist (on waist) energy center
}

const HERO_GUIDE_POINTS = HERO_POSE_LUOYANG.keypoints
const HERO_GUIDE_EDGES: ReadonlyArray<readonly [number, number]> = HERO_POSE_LUOYANG.edges

const TEMPLATE_INDICES: ReadonlyArray<number> = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]

const preflightMessage = computed(() => {
  const err = preflightError.value
  if (!err) return ''
  switch (err.kind) {
    case 'INSECURE':
      return '魔镜需要在 HTTPS 结界内才能开启，请通过安全链接（https:// 或 localhost）进入。'
    case 'NO_API':
      return '当前浏览器不支持相机能力，请使用最新版主流浏览器后重试。'
    case 'PERMISSION_DENIED':
      return '相机权限被拒绝，请在地址栏站点权限中开启「相机」后重试。'
    case 'NO_DEVICE':
      return '未找到可用摄像头，请检查设备摄像头是否被占用或未连接。'
    case 'GENERIC':
    default:
      return '时空波动异常：' + (err.message ?? '未知错误')
  }
})

async function preflightCheck(): Promise<PreflightFailure | null> {
  if (typeof window === 'undefined') {
    return { kind: 'GENERIC', message: 'SSR environment' }
  }
  if (!window.isSecureContext) {
    return { kind: 'INSECURE' }
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { kind: 'NO_API' }
  }
  try {
    const probe = await getCameraStreamWithFallback()
    probe.getTracks().forEach((track) => track.stop())
    return null
  } catch (err) {
    const e = err as DOMException & { name?: string; message?: string }
    if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') {
      return { kind: 'PERMISSION_DENIED' }
    }
    if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') {
      return { kind: 'NO_DEVICE' }
    }
    return { kind: 'GENERIC', message: e?.message ?? String(err) }
  }
}

async function getCameraStreamWithFallback(): Promise<MediaStream> {
  const videoAttempts: MediaTrackConstraints[] = [
    // Strict rear camera first: matches business requirement when supported.
    { facingMode: { exact: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    // Rear-preferred fallback for browsers that reject "exact".
    { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    // Last fallback: any available camera (keeps feature usable instead of hard fail).
    { width: { ideal: 1920 }, height: { ideal: 1080 } },
  ]

  let lastErr: unknown = null
  for (const video of videoAttempts) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video,
        audio: false,
      })
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr ?? new Error('Camera unavailable')
}

async function setupCamera(): Promise<void> {
  if (!videoRef.value) return
  stream = await getCameraStreamWithFallback()
  videoRef.value.srcObject = stream
  await new Promise<void>((resolve) => {
    const v = videoRef.value!
    if (v.readyState >= 2) {
      resolve()
    } else {
      v.onloadedmetadata = () => resolve()
    }
  })
  await videoRef.value.play().catch(() => undefined)
  syncCanvasSize()
}

function syncCanvasSize() {
  if (!videoRef.value || !canvasRef.value) return
  const v = videoRef.value
  const c = canvasRef.value
  if (v.videoWidth && v.videoHeight) {
    c.width = v.videoWidth
    c.height = v.videoHeight
  }
}

function syncGuideCanvasSize() {
  if (!guideCanvasRef.value) return
  const canvas = guideCanvasRef.value
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 1.5))
  const width = Math.floor(window.innerWidth * dpr)
  const height = Math.floor(window.innerHeight * dpr)
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
}

function syncSilhouetteCanvasSize() {
  if (!silhouetteCanvasRef.value) return
  const canvas = silhouetteCanvasRef.value
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 1.5))
  const width = Math.floor(window.innerWidth * dpr)
  const height = Math.floor(window.innerHeight * dpr)
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
}

function getGuideLayout(width: number, height: number) {
  // Local coordinate frame: use the center rounded preview rectangle.
  // Fallback to full canvas when the element is not found.
  const preview = getPreviewMappingDevice()
  const zoneLeft = preview?.zoneLeft ?? 0
  const zoneTop = preview?.zoneTop ?? 0
  const rectW = preview?.zoneWidth ?? width
  const rectH = preview?.zoneHeight ?? height
  const imageOffsetX = preview?.imageOffsetX ?? 0
  const imageOffsetY = preview?.imageOffsetY ?? 0
  const imageDisplayedW = preview?.imageDisplayedW ?? rectW
  const imageDisplayedH = preview?.imageDisplayedH ?? rectH

  const topAnchor = zoneTop
  const footTarget = zoneTop + rectH
  const bodyHeight = rectH
  const unit = rectH / 7.8

  // Pose box inside the rounded preview rectangle.
  // Use height-driven width but limit by the *zone* width, not the object-fit displayed image width.
  // This prevents horizontal collapse when the image is heavily cropped (big head posters).
  const poseBoxW = Math.min(rectW, rectH * POSE_BOX_WIDTH_RATIO)
  const poseBoxH = rectH
  const poseBoxLeft = zoneLeft + (rectW - poseBoxW) / 2
  const poseBoxTop = zoneTop
  const yOffsetPx = rectH * PREVIEW_Y_OFFSET_RATIO

  return {
    rectLeft: zoneLeft,
    rectTop: zoneTop,
    rectWidth: rectW,
    rectHeight: rectH,
    imageOffsetX,
    imageOffsetY,
    imageDisplayedW,
    imageDisplayedH,
    poseBoxLeft,
    poseBoxTop,
    poseBoxW,
    poseBoxH,
    yOffsetPx,
    topAnchor,
    bodyHeight,
    unit,
    footTarget,
  }
}

function mapGuidePoint(point: readonly [number, number], layout: ReturnType<typeof getGuideLayout>, _time: number, _idx: number) {
  // Required mapping:
  // drawX = rect.left + point.x * rect.width
  // drawY = rect.top + point.y * rect.height
  const x = layout.poseBoxLeft + point[0] * layout.poseBoxW
  const y = layout.poseBoxTop + point[1] * layout.poseBoxH + layout.yOffsetPx
  return { x, y }
}

function mapGuidePointStatic(point: readonly [number, number], layout: ReturnType<typeof getGuideLayout>) {
  const x = layout.poseBoxLeft + point[0] * layout.poseBoxW
  const y = layout.poseBoxTop + point[1] * layout.poseBoxH + layout.yOffsetPx
  return { x, y }
}

function clearAllOverlays() {
  const c1 = canvasRef.value
  const c2 = guideCanvasRef.value
  const c3 = silhouetteCanvasRef.value
  if (c1) c1.getContext('2d')?.clearRect(0, 0, c1.width, c1.height)
  if (c2) c2.getContext('2d')?.clearRect(0, 0, c2.width, c2.height)
  if (c3) c3.getContext('2d')?.clearRect(0, 0, c3.width, c3.height)
}

function getLayoutKey(layout: ReturnType<typeof getGuideLayout>) {
  return [
    layout.poseBoxLeft.toFixed(2),
    layout.poseBoxTop.toFixed(2),
    layout.poseBoxW.toFixed(2),
    layout.poseBoxH.toFixed(2),
    layout.yOffsetPx.toFixed(2),
  ].join('|')
}

function buildSilhouetteCache(width: number, height: number) {
  const layout = getGuideLayout(width, height)
  const layoutKey = getLayoutKey(layout)
  const points = HERO_GUIDE_POINTS.map((p) => mapGuidePointStatic(p, layout))

  const headPath = new Path2D()
  // Head contour from facial landmarks (ears/eyes/nose) without oversized top circle.
  const leftEar = points[3]
  const leftEye = points[1]
  const nose = points[0]
  const rightEye = points[2]
  const rightEar = points[4]
  const headTop = {
    x: (leftEye.x + rightEye.x) / 2,
    y: Math.min(leftEye.y, rightEye.y, nose.y) - layout.unit * 0.42,
  }
  headPath.moveTo(leftEar.x, leftEar.y)
  headPath.lineTo(leftEye.x, leftEye.y)
  headPath.lineTo(headTop.x, headTop.y)
  headPath.lineTo(rightEye.x, rightEye.y)
  headPath.lineTo(rightEar.x, rightEar.y)
  headPath.lineTo(nose.x, nose.y + layout.unit * 0.1)
  headPath.closePath()

  const bodyPath = new Path2D()
  // Closed contour for a fuller human silhouette cutout (no head-top circle).
  const contourOrder = [9, 7, 5, 6, 8, 10, 12, 14, 16, 15, 13, 11]
  const first = points[contourOrder[0]]
  bodyPath.moveTo(first.x, first.y)
  for (let i = 1; i < contourOrder.length; i += 1) {
    const p = points[contourOrder[i]]
    bodyPath.lineTo(p.x, p.y)
  }
  bodyPath.closePath()

  const strokePath = new Path2D()
  const silhouetteEdges: ReadonlyArray<readonly [number, number]> = [
    [5, 6], // shoulders
    [5, 7], [7, 9], // left arm
    [6, 8], [8, 10], // right arm
    [5, 11], [6, 12], [11, 12], // torso
    [11, 13], [13, 15], // left leg
    [12, 14], [14, 16], // right leg
  ]
  for (const [a, b] of silhouetteEdges) {
    const p1 = points[a]
    const p2 = points[b]
    strokePath.moveTo(p1.x, p1.y)
    strokePath.lineTo(p2.x, p2.y)
  }

  const jointPath = new Path2D()
  // Silhouette joints: skip head circles to remove top-round mask.
  for (let i = 5; i < points.length; i += 1) {
    const p = points[i]
    const r = i >= 11 ? Math.max(8, layout.unit * 0.28) : Math.max(9, layout.unit * 0.34)
    jointPath.moveTo(p.x + 1, p.y)
    jointPath.arc(p.x, p.y, r, 0, Math.PI * 2)
  }

  silhouetteCache = { w: width, h: height, layoutKey, layout, points, headPath, bodyPath, strokePath, jointPath }
}

function projectVideoPointToGuideCanvas(kp: Keypoint, canvasWidth: number, canvasHeight: number) {
  if (!videoRef.value || !videoRef.value.videoWidth || !videoRef.value.videoHeight) return null
  const vw = videoRef.value.videoWidth
  const vh = videoRef.value.videoHeight
  const scale = Math.max(canvasWidth / vw, canvasHeight / vh)
  const drawWidth = vw * scale
  const drawHeight = vh * scale
  const offsetX = (canvasWidth - drawWidth) / 2
  const offsetY = (canvasHeight - drawHeight) / 2
  let x = kp.x * scale + offsetX
  if (props.mirrored) x = canvasWidth - x
  return {
    x,
    y: kp.y * scale + offsetY,
    score: kp.score ?? 0,
  }
}

function jointHighlightRatio(idx: number, guidePoint: { x: number; y: number }) {
  const kp = latestKeypoints[idx]
  if (!kp) return 0
  const pp = projectVideoPointToGuideCanvas(kp, guideCanvasRef.value!.width, guideCanvasRef.value!.height)
  if (!pp || (pp.score ?? 0) < MIN_KEYPOINT_SCORE) return 0
  const d = Math.hypot(pp.x - guidePoint.x, pp.y - guidePoint.y)
  const thresholdPx = 50
  return Math.max(0, Math.min(1, 1 - d / thresholdPx))
}

function virtualJointHighlightRatio(guidePoint: Point2D, liveIndices: readonly [number, number]) {
  if (!guideCanvasRef.value) return 0
  const [a, b] = liveIndices
  const ka = latestKeypoints[a]
  const kb = latestKeypoints[b]
  if (!ka || !kb) return 0
  const pa = projectVideoPointToGuideCanvas(ka, guideCanvasRef.value.width, guideCanvasRef.value.height)
  const pb = projectVideoPointToGuideCanvas(kb, guideCanvasRef.value.width, guideCanvasRef.value.height)
  if (!pa || !pb) return 0
  if ((pa.score ?? 0) < MIN_KEYPOINT_SCORE || (pb.score ?? 0) < MIN_KEYPOINT_SCORE) return 0
  const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
  const d = Math.hypot(mid.x - guidePoint.x, mid.y - guidePoint.y)
  const thresholdPx = 50
  return Math.max(0, Math.min(1, 1 - d / thresholdPx))
}

function drawStaticGuide(time: number) {
  if (closing) {
    clearAllOverlays()
    return
  }
  if (!guideCanvasRef.value) {
    guideRafId = requestAnimationFrame(drawStaticGuide)
    return
  }

  // Cap guide rendering to ~30fps for performance.
  if (time - lastGuideFrameAt < 33) {
    guideRafId = requestAnimationFrame(drawStaticGuide)
    return
  }
  lastGuideFrameAt = time

  syncGuideCanvasSize()
  syncSilhouetteCanvasSize()
  const canvas = guideCanvasRef.value
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    guideRafId = requestAnimationFrame(drawStaticGuide)
    return
  }

  const w = canvas.width
  const h = canvas.height
  const layout = getGuideLayout(w, h)
  const layoutKey = getLayoutKey(layout)
  const mapped = HERO_GUIDE_POINTS.map((point, i) => mapGuidePoint(point, layout, time, i))

  if (silhouetteCanvasRef.value) {
    const sctx = silhouetteCanvasRef.value.getContext('2d')
    if (sctx) {
      const sw = silhouetteCanvasRef.value.width
      const sh = silhouetteCanvasRef.value.height
      const sx = sw / w
      const sy = sh / h
      if (!silhouetteCache || silhouetteCache.w !== w || silhouetteCache.h !== h || silhouetteCache.layoutKey !== layoutKey) {
        buildSilhouetteCache(w, h)
      }
      const cache = silhouetteCache
      if (!cache) {
        guideRafId = requestAnimationFrame(drawStaticGuide)
        return
      }
      sctx.clearRect(0, 0, sw, sh)
      sctx.globalCompositeOperation = 'source-over'
      sctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
      sctx.fillRect(0, 0, sw, sh)
      sctx.save()
      sctx.scale(sx, sy)
      sctx.globalCompositeOperation = 'destination-out'
      sctx.lineCap = 'round'
      sctx.lineJoin = 'round'
      sctx.fillStyle = 'rgba(0,0,0,1)'
      sctx.fill(cache.headPath)
      sctx.fill(cache.bodyPath)
      sctx.strokeStyle = 'rgba(0,0,0,1)'
      sctx.lineWidth = Math.max(11, cache.layout.unit * 0.62)
      sctx.stroke(cache.strokePath)
      sctx.fill(cache.jointPath)
      sctx.restore()
      sctx.globalCompositeOperation = 'source-over'
    }
  }

  ctx.clearRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'source-over'

  const phase = poseScanPhase.value
  const linePalette = {
    line: phase === 'perfect' ? 'rgba(188, 255, 90, 0.95)' : 'rgba(168, 85, 247, 0.9)',
    nodeInner: phase === 'perfect' ? 'rgba(229, 255, 191, 0.95)' : 'rgba(236, 224, 255, 0.95)',
    nodeOuter: phase === 'perfect' ? 'rgba(188, 255, 90, 0.0)' : 'rgba(168, 85, 247, 0.0)',
  }

  // Solid thin guide lines first: clearer stance reference, with organic curvature on arms.
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.lineWidth = Math.max(1, layout.unit * 0.02)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Flow line shimmer: use dash offset instead of per-particle gradients (much faster, no vertical dot trails).
  ctx.setLineDash([])

  const organicArmEdges: ReadonlyArray<readonly [number, number]> = [
    [5, 7],
    [7, 9],
    [6, 8],
    [8, 10],
  ]
  const isArmEdge = (a: number, b: number) =>
    organicArmEdges.some(([ea, eb]) => (ea === a && eb === b) || (ea === b && eb === a))

  for (const [a, b] of HERO_GUIDE_EDGES) {
    const p1 = mapped[a]
    const p2 = mapped[b]
    ctx.strokeStyle = linePalette.line
    ctx.shadowBlur = 0
    ctx.beginPath()
    if (isArmEdge(a, b)) {
      // Organic curve: small Bezier bulge perpendicular to bone direction.
      const mx = (p1.x + p2.x) / 2
      const my = (p1.y + p2.y) / 2
      const dx = p2.x - p1.x
      const dy = p2.y - p1.y
      const len = Math.hypot(dx, dy) || 1
      const nx = -dy / len
      const ny = dx / len
      const bulge = layout.unit * 0.12 * (a < b ? 1 : -1)
      const cx1 = mx + nx * bulge
      const cy1 = my + ny * bulge
      ctx.moveTo(p1.x, p1.y)
      ctx.quadraticCurveTo(cx1, cy1, p2.x, p2.y)
    } else {
      ctx.moveTo(p1.x, p1.y)
      ctx.lineTo(p2.x, p2.y)
    }
    ctx.stroke()
  }
  ctx.restore()

  // Face core landmarks: eyes baseline + inverted triangle (eyes to nose) + eyes to ears.
  // Draw thinner and denser flicker dots for industrial scanning vibe.
  const faceLinePairs: ReadonlyArray<readonly [number, number]> = [
    [FACE_INDICES.leftEye, FACE_INDICES.rightEye],
    [FACE_INDICES.leftEye, FACE_INDICES.nose],
    [FACE_INDICES.rightEye, FACE_INDICES.nose],
    [FACE_INDICES.leftEye, FACE_INDICES.leftEar],
    [FACE_INDICES.rightEye, FACE_INDICES.rightEar],
  ]
  ctx.save()
  ctx.setLineDash([])
  ctx.lineWidth = Math.max(0.8, layout.unit * 0.013)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = linePalette.line
  ctx.shadowBlur = 0
  for (const [a, b] of faceLinePairs) {
    const p1 = mapped[a]
    const p2 = mapped[b]
    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y)
    ctx.lineTo(p2.x, p2.y)
    ctx.stroke()

    const dots = 7
    for (let i = 0; i <= dots; i += 1) {
      const t = i / dots
      const dx = p1.x + (p2.x - p1.x) * t
      const dy = p1.y + (p2.y - p1.y) * t
      ctx.fillStyle = linePalette.nodeInner
      ctx.beginPath()
      ctx.arc(dx, dy, Math.max(1.2, layout.unit * 0.012), 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()

  // Trunk architecture enhancement: shoulder-midpoint to chest to pelvis (spine centerline).
  const neckCenter = { x: (mapped[5].x + mapped[6].x) / 2, y: (mapped[5].y + mapped[6].y) / 2 }
  ctx.save()
  ctx.setLineDash([])
  ctx.lineWidth = Math.max(1, layout.unit * 0.018)
  ctx.strokeStyle = linePalette.line
  ctx.shadowBlur = 0
  ctx.beginPath()
  ctx.moveTo(mapped[5].x, mapped[5].y)
  ctx.lineTo(neckCenter.x, neckCenter.y)
  ctx.lineTo(mapped[6].x, mapped[6].y)
  // Add clavicle links requested: hips -> clavicle, nose -> clavicle.
  ctx.moveTo(mapped[11].x, mapped[11].y)
  ctx.lineTo(neckCenter.x, neckCenter.y)
  ctx.moveTo(mapped[12].x, mapped[12].y)
  ctx.lineTo(neckCenter.x, neckCenter.y)
  ctx.moveTo(mapped[0].x, mapped[0].y)
  ctx.lineTo(neckCenter.x, neckCenter.y)
  ctx.stroke()
  ctx.restore()

  // Explicit clavicle point between shoulders.
  const clavicleLock = virtualJointHighlightRatio(neckCenter, [5, 6])
  const clavicleR = layout.bodyHeight * 0.015 + clavicleLock * layout.bodyHeight * 0.006
  ctx.fillStyle = linePalette.nodeInner
  ctx.beginPath()
  ctx.arc(neckCenter.x, neckCenter.y, clavicleR, 0, Math.PI * 2)
  ctx.fill()

  const keyJointIndices: ReadonlyArray<number> = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
  for (const idx of keyJointIndices) {
    const gp = mapped[idx]
    const lock = jointHighlightRatio(idx, gp)
    const baseR = layout.bodyHeight * 0.014 + lock * layout.bodyHeight * 0.006
    const grad = ctx.createRadialGradient(gp.x, gp.y, 0, gp.x, gp.y, baseR * 3)
    grad.addColorStop(0, linePalette.nodeInner)
    grad.addColorStop(1, linePalette.nodeOuter)
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(gp.x, gp.y, baseR * 3, 0, Math.PI * 2)
    ctx.fill()
  }

  // Head contour from 5 face landmarks: avoids unrealistic perfect circle.
  const guideHeadCenterBase = {
    x: (mapped[0].x + mapped[1].x + mapped[2].x + mapped[3].x + mapped[4].x) / 5,
    y: (mapped[0].y + mapped[1].y + mapped[2].y + mapped[3].y + mapped[4].y) / 5,
  }
  const headCenter = {
    x: guideHeadCenterBase.x,
    y: guideHeadCenterBase.y + layout.unit * -0.25,
  }
  const headLock =
    (jointHighlightRatio(0, headCenter) +
      jointHighlightRatio(1, headCenter) +
      jointHighlightRatio(2, headCenter)) /
    3

  const earDx = mapped[FACE_INDICES.rightEar].x - mapped[FACE_INDICES.leftEar].x
  const earDy = mapped[FACE_INDICES.rightEar].y - mapped[FACE_INDICES.leftEar].y
  const headAngle = Math.atan2(earDy, earDx)
  const earDistance = Math.hypot(earDx, earDy)
  const shoulderWidth = Math.hypot(mapped[6].x - mapped[5].x, mapped[6].y - mapped[5].y)

  const headRx = Math.max(layout.unit * 0.5, earDistance * 0.62)
  const headRy = Math.max(layout.unit * 0.72, shoulderWidth * 0.48)

  ctx.save()
  ctx.translate(headCenter.x, headCenter.y)
  ctx.rotate(headAngle * 0.25)
  const headFillGrad = ctx.createRadialGradient(0, -headRy * 0.18, headRy * 0.12, 0, 0, headRy * 1.15)
  if (headLock > 0.22) {
    headFillGrad.addColorStop(0, 'rgba(225, 255, 170, 0.32)')
    headFillGrad.addColorStop(0.55, 'rgba(188, 255, 90, 0.16)')
    headFillGrad.addColorStop(1, 'rgba(188, 255, 90, 0.04)')
  } else {
    headFillGrad.addColorStop(0, 'rgba(212, 166, 255, 0.28)')
    headFillGrad.addColorStop(0.58, 'rgba(168, 85, 247, 0.14)')
    headFillGrad.addColorStop(1, 'rgba(168, 85, 247, 0.03)')
  }
  ctx.fillStyle = headFillGrad
  ctx.beginPath()
  ctx.ellipse(0, 0, headRx * 0.96, headRy * 0.96, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = headLock > 0.22 ? 'rgba(188, 255, 90, 0.95)' : 'rgba(168, 85, 247, 0.85)'
  ctx.lineWidth = Math.max(1.4, layout.unit * 0.03)
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.ellipse(0, 0, headRx, headRy, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  // Hand anchor point (solid point only).
  const energyPoint = mapGuidePoint(HERO_POSE_LUOYANG.handEnergyCenter, layout, time, 999)
  const energyRadius = layout.unit * 0.065
  const energyGrad = ctx.createRadialGradient(
    energyPoint.x,
    energyPoint.y,
    0,
    energyPoint.x,
    energyPoint.y,
    energyRadius * 3,
  )
  energyGrad.addColorStop(0, linePalette.nodeInner)
  energyGrad.addColorStop(1, linePalette.nodeOuter)
  ctx.fillStyle = energyGrad
  ctx.beginPath()
  ctx.arc(energyPoint.x, energyPoint.y, energyRadius, 0, Math.PI * 2)
  ctx.fill()

  if (DEBUG_SHOW_PREVIEW_BOUNDS) {
    const r = Math.max(4, layout.unit * 0.18)
    // Show active coordinate range = displayed image area inside the rounded preview box.
    const tl = { x: layout.poseBoxLeft, y: layout.poseBoxTop + layout.yOffsetPx }
    const tr = { x: layout.poseBoxLeft + layout.poseBoxW, y: layout.poseBoxTop + layout.yOffsetPx }
    const bl = { x: layout.poseBoxLeft, y: layout.poseBoxTop + layout.poseBoxH + layout.yOffsetPx }
    const br = { x: layout.poseBoxLeft + layout.poseBoxW, y: layout.poseBoxTop + layout.poseBoxH + layout.yOffsetPx }
    const pts: Array<{ p: { x: number; y: number }; label: string }> = [
      { p: tl, label: 'TL' },
      { p: tr, label: 'TR' },
      { p: bl, label: 'BL' },
      { p: br, label: 'BR' },
    ]
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = 'rgba(255, 86, 214, 0.95)'
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.9)'
    ctx.lineWidth = 2
    ctx.setLineDash([])
    for (const item of pts) {
      const { x, y } = item.p
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.font = `bold ${Math.max(10, r * 0.8)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto`
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
      ctx.fillText(item.label, x + r * 0.6, y - r * 0.6)
      ctx.fillStyle = 'rgba(255, 86, 214, 0.95)'
    }
    ctx.restore()
  }

  ctx.globalCompositeOperation = 'source-over'
  guideRafId = requestAnimationFrame(drawStaticGuide)
}

async function loadModel(): Promise<void> {
  const tf = await import('@tensorflow/tfjs-core')
  await import('@tensorflow/tfjs-backend-webgl')
  const poseDetection = await import('@tensorflow-models/pose-detection')
  await tf.setBackend('webgl').catch(() => undefined)
  await tf.ready()
  detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
    modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
  })
}

function buildTemplateVector(): number[] {
  const ls = HERO_GUIDE_POINTS[5]
  const rs = HERO_GUIDE_POINTS[6]
  const lh = HERO_GUIDE_POINTS[11]
  const rh = HERO_GUIDE_POINTS[12]
  const cx = (ls[0] + rs[0] + lh[0] + rh[0]) / 4
  const cy = (ls[1] + rs[1] + lh[1] + rh[1]) / 4
  const shoulderSpan = Math.hypot(ls[0] - rs[0], ls[1] - rs[1]) || 1
  const torsoSpan = Math.hypot((ls[0] + rs[0]) / 2 - (lh[0] + rh[0]) / 2, (ls[1] + rs[1]) / 2 - (lh[1] + rh[1]) / 2) || 1
  const scale = Math.max(shoulderSpan, torsoSpan)
  const out: number[] = []
  for (const idx of TEMPLATE_INDICES) {
    const [x, y] = HERO_GUIDE_POINTS[idx]
    out.push((x - cx) / scale + 0.5, (y - cy) / scale + 0.5)
  }
  return out
}

const TEMPLATE_VECTOR = buildTemplateVector()

type StructuralTemplatePoint = {
  id: 'neck' | 'chest' | 'pelvis' | 'handsCenter'
  point: readonly [number, number]
}

const STRUCTURAL_TEMPLATE_POINTS: ReadonlyArray<StructuralTemplatePoint> = (() => {
  const ls = HERO_GUIDE_POINTS[5]
  const rs = HERO_GUIDE_POINTS[6]
  const lh = HERO_GUIDE_POINTS[11]
  const rh = HERO_GUIDE_POINTS[12]
  const lw = HERO_GUIDE_POINTS[9]
  const rw = HERO_GUIDE_POINTS[10]
  const neck: readonly [number, number] = [(ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2]
  const pelvis: readonly [number, number] = [(lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2]
  const chest: readonly [number, number] = [(neck[0] + pelvis[0]) / 2, (neck[1] + pelvis[1]) / 2]
  const handsCenter: readonly [number, number] = [(lw[0] + rw[0]) / 2, (lw[1] + rw[1]) / 2]
  return [
    { id: 'neck', point: neck },
    { id: 'chest', point: chest },
    { id: 'pelvis', point: pelvis },
    { id: 'handsCenter', point: handsCenter },
  ]
})()

function buildStructuralTemplateVector(): number[] {
  const ls = HERO_GUIDE_POINTS[5]
  const rs = HERO_GUIDE_POINTS[6]
  const lh = HERO_GUIDE_POINTS[11]
  const rh = HERO_GUIDE_POINTS[12]
  const cx = (ls[0] + rs[0] + lh[0] + rh[0]) / 4
  const cy = (ls[1] + rs[1] + lh[1] + rh[1]) / 4
  const shoulderSpan = Math.hypot(ls[0] - rs[0], ls[1] - rs[1]) || 1
  const torsoSpan = Math.hypot((ls[0] + rs[0]) / 2 - (lh[0] + rh[0]) / 2, (ls[1] + rs[1]) / 2 - (lh[1] + rh[1]) / 2) || 1
  const scale = Math.max(shoulderSpan, torsoSpan)
  const out: number[] = []
  for (const item of STRUCTURAL_TEMPLATE_POINTS) {
    out.push((item.point[0] - cx) / scale + 0.5, (item.point[1] - cy) / scale + 0.5)
  }
  return out
}

const STRUCTURAL_TEMPLATE_VECTOR = buildStructuralTemplateVector()

function buildLiveVector(keypoints: Keypoint[]): number[] | null {
  if (keypoints.length < 17) return null
  const ls = keypoints[5]
  const rs = keypoints[6]
  const lh = keypoints[11]
  const rh = keypoints[12]
  if (!ls || !rs || !lh || !rh) return null
  if ((ls.score ?? 0) < MIN_KEYPOINT_SCORE || (rs.score ?? 0) < MIN_KEYPOINT_SCORE) return null
  const cx = (ls.x + rs.x + lh.x + rh.x) / 4
  const cy = (ls.y + rs.y + lh.y + rh.y) / 4
  const shoulderSpan = Math.hypot(ls.x - rs.x, ls.y - rs.y) || 1
  const torsoSpan = Math.hypot(((ls.x + rs.x) / 2) - ((lh.x + rh.x) / 2), ((ls.y + rs.y) / 2) - ((lh.y + rh.y) / 2)) || 1
  const scale = Math.max(shoulderSpan, torsoSpan)
  const out: number[] = []
  for (const idx of TEMPLATE_INDICES) {
    const kp = keypoints[idx]
    if (!kp) return null
    const nx = (kp.x - cx) / scale + 0.5
    const ny = (kp.y - cy) / scale + 0.5
    out.push(nx, ny)
  }
  return out
}

function buildStructuralLiveVector(keypoints: Keypoint[]): number[] | null {
  if (keypoints.length < 17) return null
  const ls = keypoints[5]
  const rs = keypoints[6]
  const lw = keypoints[9]
  const rw = keypoints[10]
  const lh = keypoints[11]
  const rh = keypoints[12]
  if (!ls || !rs || !lw || !rw || !lh || !rh) return null
  if ((ls.score ?? 0) < MIN_KEYPOINT_SCORE || (rs.score ?? 0) < MIN_KEYPOINT_SCORE) return null

  const cx = (ls.x + rs.x + lh.x + rh.x) / 4
  const cy = (ls.y + rs.y + lh.y + rh.y) / 4
  const shoulderSpan = Math.hypot(ls.x - rs.x, ls.y - rs.y) || 1
  const torsoSpan = Math.hypot(((ls.x + rs.x) / 2) - ((lh.x + rh.x) / 2), ((ls.y + rs.y) / 2) - ((lh.y + rh.y) / 2)) || 1
  const scale = Math.max(shoulderSpan, torsoSpan)

  const neck = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }
  const pelvis = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 }
  const chest = { x: (neck.x + pelvis.x) / 2, y: (neck.y + pelvis.y) / 2 }
  const handsCenter = { x: (lw.x + rw.x) / 2, y: (lw.y + rw.y) / 2 }
  const derived = [neck, chest, pelvis, handsCenter]

  const out: number[] = []
  for (const p of derived) {
    out.push((p.x - cx) / scale + 0.5, (p.y - cy) / scale + 0.5)
  }
  return out
}

function weightedCosineSimilarity(
  a: number[],
  b: number[],
  weights: number[],
): number {
  if (a.length !== b.length || a.length !== weights.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    const w = weights[i]
    dot += w * a[i] * b[i]
    na += w * a[i] * a[i]
    nb += w * b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

const TEMPLATE_WEIGHTS: number[] = (() => {
  // Weights are per-dimension; live/template vectors are [x0,y0,x1,y1,...]
  // Put more emphasis on shoulders (idx 5,6) and knees (13,14), less on wrists/face.
  // TEMPLATE_INDICES currently: [0,5,6,7,8,9,10,11,12,13,14]
  const w = new Array(TEMPLATE_INDICES.length * 2).fill(0.7)
  const kpToWeight: Record<number, number> = {
    0: 0.8, // nose (raise weight to lock head position)
    1: 0.72, // left eye
    2: 0.72, // right eye
    3: 0.7, // left ear
    4: 0.7, // right ear
    5: 1.35, // left shoulder (high)
    6: 1.35, // right shoulder (high)
    7: 0.8, // left elbow
    8: 0.8, // right elbow
    9: 0.45, // left wrist (low)
    10: 0.45, // right wrist (low)
    11: 1.0, // left hip
    12: 1.0, // right hip
    13: 1.28, // left knee (high)
    14: 1.28, // right knee (high)
    15: 1.05, // left ankle
    16: 1.05, // right ankle
  }
  TEMPLATE_INDICES.forEach((kpIdx, i) => {
    const weight = kpToWeight[kpIdx] ?? 0.7
    w[i * 2] = weight
    w[i * 2 + 1] = weight
  })
  return w
})()

const STRUCTURAL_TEMPLATE_WEIGHTS: number[] = [
  1.38, 1.38, // neck
  1.22, 1.22, // chest
  1.3, 1.3, // pelvis
  0.92, 0.92, // hands center
]

function matchPose(keypoints: Keypoint[]): number {
  const live = buildLiveVector(keypoints)
  const liveStructural = buildStructuralLiveVector(keypoints)
  if (!live || !liveStructural) return -1
  const simMain = weightedCosineSimilarity(live, TEMPLATE_VECTOR, TEMPLATE_WEIGHTS)
  const simStructural = weightedCosineSimilarity(
    liveStructural,
    STRUCTURAL_TEMPLATE_VECTOR,
    STRUCTURAL_TEMPLATE_WEIGHTS,
  )
  return simMain * 0.78 + simStructural * 0.22
}

function passesFaceAndShoulderGate(keypoints: Keypoint[]) {
  if (!guideCanvasRef.value) return { ok: false, reason: 'NO_GUIDE' as const }
  const canvas = guideCanvasRef.value
  const layout = getGuideLayout(canvas.width, canvas.height)

  const required = [
    FACE_INDICES.nose,
    FACE_INDICES.leftEye,
    FACE_INDICES.rightEye,
    FACE_INDICES.leftEar,
    FACE_INDICES.rightEar,
    FACE_INDICES.leftShoulder,
    FACE_INDICES.rightShoulder,
  ]

  const projected = new Map<number, { x: number; y: number; score: number }>()
  for (const idx of required) {
    const kp = keypoints[idx]
    if (!kp) return { ok: false, reason: 'MISSING_FACE' as const }
    const pp = projectVideoPointToGuideCanvas(kp, canvas.width, canvas.height)
    if (!pp || (pp.score ?? 0) < MIN_KEYPOINT_SCORE) return { ok: false, reason: 'LOW_FACE_SCORE' as const }
    projected.set(idx, pp)
  }

  const guideFace = [
    HERO_GUIDE_POINTS[FACE_INDICES.nose],
    HERO_GUIDE_POINTS[FACE_INDICES.leftEye],
    HERO_GUIDE_POINTS[FACE_INDICES.rightEye],
    HERO_GUIDE_POINTS[FACE_INDICES.leftEar],
    HERO_GUIDE_POINTS[FACE_INDICES.rightEar],
  ].map((p) => mapGuidePointStatic(p, layout))

  const guideFaceCenter = {
    x: (guideFace[0].x + guideFace[1].x + guideFace[2].x + guideFace[3].x + guideFace[4].x) / 5,
    y: (guideFace[0].y + guideFace[1].y + guideFace[2].y + guideFace[3].y + guideFace[4].y) / 5,
  }
  const liveFaceCenter = {
    x:
      (projected.get(FACE_INDICES.nose)!.x +
        projected.get(FACE_INDICES.leftEye)!.x +
        projected.get(FACE_INDICES.rightEye)!.x +
        projected.get(FACE_INDICES.leftEar)!.x +
        projected.get(FACE_INDICES.rightEar)!.x) /
      5,
    y:
      (projected.get(FACE_INDICES.nose)!.y +
        projected.get(FACE_INDICES.leftEye)!.y +
        projected.get(FACE_INDICES.rightEye)!.y +
        projected.get(FACE_INDICES.leftEar)!.y +
        projected.get(FACE_INDICES.rightEar)!.y) /
      5,
  }
  const centerDistance = Math.hypot(liveFaceCenter.x - guideFaceCenter.x, liveFaceCenter.y - guideFaceCenter.y)
  const maxFaceCenterDistance = Math.max(24, layout.unit * 0.85)
  if (centerDistance > maxFaceCenterDistance) return { ok: false, reason: 'FACE_OFF_CENTER' as const }

  const ls = projected.get(FACE_INDICES.leftShoulder)!
  const rs = projected.get(FACE_INDICES.rightShoulder)!
  const shoulderSpan = Math.max(1, Math.abs(rs.x - ls.x))
  const shoulderDeltaY = Math.abs(ls.y - rs.y)
  const shoulderLevelRatio = shoulderDeltaY / shoulderSpan
  if (shoulderLevelRatio > 0.12) return { ok: false, reason: 'SHOULDER_NOT_LEVEL' as const }

  return { ok: true, reason: 'OK' as const }
}


function flashCanvasOnce(ctx: CanvasRenderingContext2D) {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = 'rgba(255, 231, 160, 0.55)'
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.restore()
}

function captureFrameBase64(): string | null {
  if (!videoRef.value) return null
  const v = videoRef.value
  if (!v.videoWidth || !v.videoHeight) return null
  const c = document.createElement('canvas')
  c.width = v.videoWidth
  c.height = v.videoHeight
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(v, 0, 0, c.width, c.height)
  try {
    return c.toDataURL('image/jpeg', 0.92)
  } catch {
    return null
  }
}

async function captureAndEmit() {
  if (captured) return
  captured = true
  flashing.value = true
  if (canvasRef.value) {
    const ctx = canvasRef.value.getContext('2d')
    if (ctx) flashCanvasOnce(ctx)
  }
  const base64 = captureFrameBase64()
  emitAlignedTimer = window.setTimeout(() => {
    if (base64) emit('pose-aligned', { base64 })
  }, 240)
  autoCloseTimer = window.setTimeout(() => {
    flashing.value = false
    requestClose()
  }, 520)
}

function teardownHeavy() {
  // Stop camera hardware + detector. This can occasionally stall on iOS, so keep it off the fast close path.
  if (stream) {
    stream.getTracks().forEach((track) => track.stop())
  }
  if (videoRef.value) {
    try {
      videoRef.value.pause()
    } catch {
      /* noop */
    }
    videoRef.value.srcObject = null
  }
  if (detector) {
    try {
      detector.dispose()
    } catch {
      /* noop */
    }
  }
  stream = null
  detector = null
  estimateInFlight = false
  burstParticles.length = 0
  silhouetteCache = null
  latestKeypoints = []
  poseScanPhase.value = 'idle'
}

function requestClose() {
  if (closing) return
  closing = true
  // Fast path: immediately stop loops + release scroll, then close UI.
  if (emitAlignedTimer != null) {
    clearTimeout(emitAlignedTimer)
    emitAlignedTimer = null
  }
  if (autoCloseTimer != null) {
    clearTimeout(autoCloseTimer)
    autoCloseTimer = null
  }
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
  if (guideRafId) {
    cancelAnimationFrame(guideRafId)
    guideRafId = 0
  }
  clearAllOverlays()
  unlockPageScroll()
  emit('close')

  // Heavy path: do actual hardware/model cleanup after UI closes.
  if (heavyTeardownTimer != null) {
    clearTimeout(heavyTeardownTimer)
  }
  heavyTeardownTimer = window.setTimeout(() => {
    heavyTeardownTimer = null
    teardownHeavy()
  }, 0)
}

async function tick(time: number) {
  if (closing) {
    clearAllOverlays()
    return
  }
  rafId = requestAnimationFrame(tick)
  if (!videoRef.value || !canvasRef.value) return
  if (props.debugNoCamera) {
    // In no-camera debug mode we intentionally skip pose inference.
    poseScanPhase.value = 'idle'
    aligned.value = false
    countdownStartAt = 0
    countdownLabel.value = ''
    holdProgress.value = 0
    hint.value = '调试免相机模式：仅展示引导线，不执行实时识别'
    return
  }
  const v = videoRef.value
  if (v.readyState < 2 || v.paused || v.ended) {
    return
  }
  if (canvasRef.value.width !== v.videoWidth || canvasRef.value.height !== v.videoHeight) {
    syncCanvasSize()
  }
  const ctx = canvasRef.value.getContext('2d')
  if (!ctx) return

  // Clear dynamic overlay every frame.
  // This canvas is now reserved for capture flash only (no residual particle effects).
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  let keypoints: Keypoint[] = latestKeypoints
  if (detector && !estimateInFlight) {
    estimateInFlight = true
    detector
      .estimatePoses(v, { maxPoses: 1, flipHorizontal: false })
      .then((poses) => {
        const pose = poses[0] as any
        const poseScore = (pose?.score ?? 1) as number
        const kps = (pose?.keypoints ?? []) as Keypoint[]
        // Lower minPoseConfidence: allow weaker frontal detections to still output keypoints.
        latestKeypoints = poseScore >= MIN_POSE_CONFIDENCE ? kps : kps
      })
      .catch(() => {
        latestKeypoints = []
      })
      .finally(() => {
        estimateInFlight = false
      })
    keypoints = latestKeypoints
  }
  if (keypoints.length > 0) {
    const gate = passesFaceAndShoulderGate(keypoints)
    const sim = gate.ok ? matchPose(keypoints) : -1
    const inAlignmentNow = gate.ok && sim > props.similarityThreshold

    if (!inAlignmentNow) {
      poseScanPhase.value = gate.ok ? 'capturing' : 'idle'
      hint.value = gate.ok
        ? '捕捉中：请保持动作，系统正在高速扫描...'
        : gate.reason === 'SHOULDER_NOT_LEVEL'
          ? '请微调双肩至平齐，保持头部位于引导框中心'
          : '请先将面部三角区域对齐到引导框中心'
      aligned.value = false
      countdownStartAt = 0
      countdownLabel.value = ''
      holdProgress.value = 0
    } else {
      if (countdownStartAt === 0) countdownStartAt = time
      const held = time - countdownStartAt
      const countdown = 3 - Math.floor(held / 1000)
      countdownLabel.value = countdown > 0 ? `${countdown}` : '捕捉中...'
      const pct = Math.min(100, (held / 3000) * 100)
      holdProgress.value = pct
      aligned.value = true
      poseScanPhase.value = 'perfect'
      hint.value = held >= 3000 ? '完美对齐，正在定格...' : '完美对齐，3 秒定格开始'
      if (held >= 3000 && !captured) {
        void captureAndEmit()
      }
    }
  } else {
    latestKeypoints = []
    countdownStartAt = 0
    countdownLabel.value = ''
    hint.value = '若识别较慢，请微调站位或确保光线充足'
    aligned.value = false
    poseScanPhase.value = 'idle'
    holdProgress.value = 0
  }
}

function onVisibilityChange() {
  if (document.hidden) {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    if (guideRafId) {
      cancelAnimationFrame(guideRafId)
      guideRafId = 0
    }
    if (videoRef.value) videoRef.value.pause()
  } else if (!preflightError.value && !captured) {
    if (videoRef.value) videoRef.value.play().catch(() => undefined)
    if (!rafId) rafId = requestAnimationFrame(tick)
    if (!guideRafId) guideRafId = requestAnimationFrame(drawStaticGuide)
  }
}

async function bootstrap() {
  if (!props.debugNoCamera) {
    preflightError.value = await preflightCheck()
    if (preflightError.value) return
  } else {
    preflightError.value = null
    hint.value = '调试模式：已跳过摄像头请求'
    holdProgress.value = 0
  }
  try {
    if (props.debugNoCamera) {
      await loadModel()
    } else {
      await Promise.all([setupCamera(), loadModel()])
    }
  } catch (err) {
    const e = err as DOMException & { name?: string; message?: string }
    if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') {
      preflightError.value = { kind: 'PERMISSION_DENIED' }
    } else if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') {
      preflightError.value = { kind: 'NO_DEVICE' }
    } else {
      preflightError.value = { kind: 'GENERIC', message: e?.message ?? String(err) }
    }
    return
  }
  rafId = requestAnimationFrame(tick)
  emit('ready')
}

async function retry() {
  preflightError.value = null
  closing = false
  captured = false
  countdownStartAt = 0
  countdownLabel.value = ''
  holdProgress.value = 0
  poseScanPhase.value = 'idle'
  await bootstrap()
}

function teardown() {
  if (emitAlignedTimer != null) {
    clearTimeout(emitAlignedTimer)
    emitAlignedTimer = null
  }
  if (autoCloseTimer != null) {
    clearTimeout(autoCloseTimer)
    autoCloseTimer = null
  }
  if (heavyTeardownTimer != null) {
    clearTimeout(heavyTeardownTimer)
    heavyTeardownTimer = null
  }
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
  if (guideRafId) {
    cancelAnimationFrame(guideRafId)
    guideRafId = 0
  }
  teardownHeavy()
}

onMounted(() => {
  closing = false
  lockPageScroll()
  document.addEventListener('visibilitychange', onVisibilityChange)
  guideRafId = requestAnimationFrame(drawStaticGuide)
  void bootstrap()
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  teardown()
  unlockPageScroll()
})
</script>

<template>
  <div ref="modalRef" class="pose-guide-modal" role="dialog" aria-label="魔镜姿态引导">
    <div class="pose-guide-bg" aria-hidden="true"></div>

    <video
      ref="videoRef"
      class="pose-guide-video"
      :class="{ 'is-mirrored': props.mirrored, 'is-debug-no-camera': props.debugNoCamera }"
      playsinline
      muted
      autoplay
    />
    <canvas
      ref="silhouetteCanvasRef"
      class="pose-guide-silhouette-canvas"
      :class="{ 'is-mirrored': props.mirrored }"
    ></canvas>
    <canvas
      ref="guideCanvasRef"
      class="pose-guide-guide-canvas"
      :class="{ 'is-mirrored': props.mirrored }"
    ></canvas>
    <canvas
      ref="canvasRef"
      class="pose-guide-canvas"
      :class="{ 'is-mirrored': props.mirrored }"
    ></canvas>

    <div class="pose-guide-veil" aria-hidden="true"></div>

    <div v-if="!preflightError" class="pose-guide-hint">
      <div class="pose-guide-hint__row">
        <span class="pose-guide-orb" aria-hidden="true"></span>
        <div class="pose-guide-hint__copy">
          <p class="pose-guide-hint__eyebrow">魔镜引导</p>
          <p class="pose-guide-hint__text">{{ hint }}</p>
        </div>
      </div>
      <p v-if="countdownLabel" class="pose-guide-countdown">{{ countdownLabel }}</p>
      <div
        class="pose-guide-progress"
        :style="{ '--p': holdProgress }"
        :class="{ 'is-active': aligned }"
        aria-hidden="true"
      ></div>
    </div>

    <button
      class="pose-guide-close"
      type="button"
      aria-label="关闭魔镜"
      @click="requestClose"
    >
      ×
    </button>

    <div v-if="flashing" class="pose-guide-flash" aria-hidden="true"></div>

    <div v-if="preflightError" class="pose-guide-fallback">
      <p class="pose-guide-fallback__eyebrow">魔镜离线</p>
      <p class="pose-guide-fallback__title">魔镜唤起失败</p>
      <p class="pose-guide-fallback__msg">{{ preflightMessage }}</p>
      <div class="pose-guide-fallback__actions">
        <button
          v-if="preflightError.kind === 'PERMISSION_DENIED' || preflightError.kind === 'GENERIC' || preflightError.kind === 'NO_DEVICE'"
          class="pose-guide-glass-btn"
          type="button"
          @click="retry"
        >
          重新唤起
        </button>
        <button
          class="pose-guide-glass-btn pose-guide-glass-btn--ghost"
          type="button"
          @click="requestClose"
        >
          退出
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pose-guide-modal {
  position: fixed;
  inset: 0;
  z-index: 90;
  overflow: hidden;
  isolation: isolate;
  background: transparent;
  touch-action: none;
  overscroll-behavior: none;
}

.pose-guide-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: transparent;
  z-index: 1;
}

.pose-guide-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 2;
}

.pose-guide-video.is-mirrored {
  transform: scaleX(-1);
}

.pose-guide-video.is-debug-no-camera {
  opacity: 0;
}

.pose-guide-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 3;
  mix-blend-mode: screen;
}

.pose-guide-canvas.is-mirrored {
  transform: scaleX(-1);
}

.pose-guide-silhouette-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 5;
}

.pose-guide-silhouette-canvas.is-mirrored {
  transform: scaleX(-1);
}

.pose-guide-guide-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 6;
  opacity: 0.94;
  mix-blend-mode: screen;
}

.pose-guide-guide-canvas.is-mirrored {
  transform: scaleX(-1);
}

.pose-guide-canvas {
  z-index: 7;
}

.pose-guide-veil {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.pose-guide-hint {
  position: absolute;
  top: 4.5%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 7;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 10px 14px;
  border-radius: 30px;
  min-width: 0;
  width: min(92vw, 360px);
  max-width: calc(100vw - 20px);
  background: linear-gradient(180deg, rgba(108, 165, 255, 0.16), rgba(69, 109, 204, 0.12));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 0.5px solid rgba(205, 225, 255, 0.22);
  border-top: 0.5px solid rgba(255, 245, 220, 0.22);
  box-shadow:
    0 16px 36px rgba(8, 18, 48, 0.48),
    0 0 34px rgba(68, 217, 255, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.pose-guide-hint__row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
}

.pose-guide-hint__copy {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.pose-guide-orb {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(216, 172, 255, 0.95) 0%, rgba(168, 85, 247, 0.55) 48%, rgba(168, 85, 247, 0) 76%);
  box-shadow:
    0 0 10px rgba(168, 85, 247, 0.52),
    0 0 18px rgba(216, 172, 255, 0.28);
  animation: poseGuideOrbBreathe 1.9s ease-in-out infinite;
}

.pose-guide-hint__eyebrow {
  margin: 0;
  font-size: 8px;
  font-weight: 500;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgba(255, 231, 160, 0.72);
  text-shadow: 0 0 10px rgba(255, 231, 160, 0.22);
}

.pose-guide-hint__text {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.08em;
  line-height: 1.3;
  color: rgba(255, 249, 240, 0.98);
  text-shadow:
    0 0 14px rgba(255, 249, 240, 0.46),
    0 0 28px rgba(68, 217, 255, 0.18);
  white-space: normal;
  text-align: center;
  word-break: break-word;
  overflow-wrap: anywhere;
  max-width: 100%;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.pose-guide-countdown {
  margin: 0;
  font-size: 22px;
  line-height: 1;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(251, 191, 36, 0.96);
  text-shadow:
    0 0 12px rgba(251, 191, 36, 0.7),
    0 0 24px rgba(251, 191, 36, 0.36);
}

@keyframes poseGuideOrbBreathe {
  0%,
  100% {
    transform: scale(0.9);
    opacity: 0.65;
    filter: blur(0.2px);
  }
  50% {
    transform: scale(1.18);
    opacity: 1;
    filter: blur(0);
  }
}

.pose-guide-progress {
  --p: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: conic-gradient(rgba(251, 191, 36, 0.92) calc(var(--p) * 1%), rgba(168, 85, 247, 0.28) 0);
  position: relative;
  margin-top: 2px;
  transition: filter 200ms ease;
  filter: drop-shadow(0 0 6px rgba(168, 85, 247, 0.4));
}

.pose-guide-progress.is-active {
  filter: drop-shadow(0 0 10px rgba(251, 191, 36, 0.7));
}

.pose-guide-progress::after {
  content: '';
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: rgba(17, 35, 71, 0.78);
  backdrop-filter: blur(4px);
}

.pose-guide-close {
  position: absolute;
  top: 5%;
  right: 5%;
  z-index: 8;
  width: 44px;
  height: 44px;
  border-radius: 999px;
  border: 0.5px solid rgba(205, 225, 255, 0.22);
  background: linear-gradient(135deg, rgba(255, 245, 220, 0.18), rgba(190, 151, 255, 0.16));
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: rgba(255, 249, 240, 0.96);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  box-shadow:
    0 10px 24px rgba(8, 10, 30, 0.28),
    0 0 22px rgba(68, 217, 255, 0.18),
    inset 0 0 12px rgba(255, 245, 220, 0.16);
  transition:
    transform 320ms cubic-bezier(0.22, 1.25, 0.3, 1),
    box-shadow 320ms cubic-bezier(0.22, 1.25, 0.3, 1);
}

.pose-guide-close:hover,
.pose-guide-close:active {
  transform: scale(1.06);
  box-shadow:
    0 14px 28px rgba(8, 10, 30, 0.32),
    0 0 30px rgba(68, 217, 255, 0.28),
    inset 0 0 16px rgba(255, 245, 220, 0.22);
}

.pose-guide-flash {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  background: radial-gradient(circle at 50% 50%, rgba(255, 231, 160, 0.96), rgba(251, 191, 36, 0.55) 38%, transparent 78%);
  animation: poseGuideFlash 520ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
  box-shadow: inset 0 0 120px rgba(255, 231, 160, 0.4);
}

@keyframes poseGuideFlash {
  0% {
    opacity: 0;
    transform: scale(1);
  }
  18% {
    opacity: 1;
    transform: scale(1.04);
  }
  34% {
    opacity: 0.92;
    transform: scale(1.02);
  }
  100% {
    opacity: 0;
    transform: scale(1);
  }
}

.pose-guide-fallback {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 9;
  width: min(86vw, 360px);
  padding: 22px 22px 20px 22px;
  border-radius: 30px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
  background: linear-gradient(180deg, rgba(108, 165, 255, 0.14), rgba(69, 109, 204, 0.10));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 0.5px solid rgba(205, 225, 255, 0.22);
  border-top: 0.5px solid rgba(255, 245, 220, 0.22);
  box-shadow:
    0 16px 36px rgba(8, 18, 48, 0.48),
    0 0 34px rgba(68, 217, 255, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.pose-guide-fallback__eyebrow {
  margin: 0;
  font-size: 9px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgba(255, 231, 160, 0.78);
  text-shadow: 0 0 10px rgba(255, 231, 160, 0.26);
}

.pose-guide-fallback__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(255, 249, 240, 0.98);
  text-shadow:
    0 0 14px rgba(255, 249, 240, 0.46),
    0 0 28px rgba(201, 114, 255, 0.18);
}

.pose-guide-fallback__msg {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(229, 239, 255, 0.86);
}

.pose-guide-fallback__actions {
  margin-top: 6px;
  display: flex;
  gap: 10px;
  width: 100%;
}

.pose-guide-glass-btn {
  flex: 1;
  position: relative;
  isolation: isolate;
  border: 0.5px solid rgba(205, 225, 255, 0.22);
  background: linear-gradient(135deg, rgba(255, 245, 220, 0.18), rgba(190, 151, 255, 0.16));
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: rgba(255, 249, 240, 0.96);
  font-size: 13px;
  letter-spacing: 0.12em;
  padding: 10px 14px;
  border-radius: 30px;
  cursor: pointer;
  text-shadow: 0 0 8px rgba(190, 227, 248, 0.4);
  box-shadow:
    0 10px 24px rgba(8, 10, 30, 0.28),
    0 0 24px rgba(68, 217, 255, 0.2),
    inset 0 0 16px rgba(255, 245, 220, 0.16);
  animation: poseGuideChampagneBreathe 3.2s ease-in-out infinite;
  transition:
    transform 320ms cubic-bezier(0.22, 1.25, 0.3, 1),
    box-shadow 320ms cubic-bezier(0.22, 1.25, 0.3, 1);
}

.pose-guide-glass-btn:hover,
.pose-guide-glass-btn:active {
  animation: none;
  transform: scale(1.03);
  box-shadow:
    0 14px 28px rgba(8, 10, 30, 0.32),
    0 0 34px rgba(68, 217, 255, 0.32),
    inset 0 0 22px rgba(255, 245, 220, 0.22);
}

.pose-guide-glass-btn--ghost {
  background: linear-gradient(135deg, rgba(255, 245, 220, 0.08), rgba(190, 151, 255, 0.06));
  animation: none;
}

@keyframes poseGuideChampagneBreathe {
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
</style>






