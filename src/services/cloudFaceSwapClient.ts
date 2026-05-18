import type { FaceSwapClient, GenerateFaceSwapInput, GenerateFaceSwapOutput } from './faceSwapClient'
import { STYLE_TARGET_URLS } from './faceSwapClient'
import { FaceSwapServiceError } from './errors'
import { uploadToImgBB } from './uploadToImgBB'
import { generateAgentCode, generateTimestamp } from './agentMeta'

// 同一次 session 中换脸和证书生成会并行调用此函数，缓存 Promise 而非结果
// 避免并发竞态：两个调用同时查缓存都 miss 时，只发起一次真正的上传
const _imgbbCache = new Map<string, Promise<string>>()
async function cachedUploadToImgBB(imageUrl: string): Promise<string> {
  const hit = _imgbbCache.get(imageUrl)
  if (hit) return hit
  const promise = uploadToImgBB(imageUrl)
  _imgbbCache.set(imageUrl, promise)
  return promise
}

// ─── 云函数 Bridge（微信 WebView 注入） ────────────────────────────────────────
/**
 * window.__XmetaCloudInvoke 由微信小程序 WebView 注入，
 * 桥接至 wx.cloud.callFunction，合约与云函数 faceSwapAction 保持一致：
 *
 * submit: invoke({ name: 'faceSwapAction', data: { action:'submit', swapImageUrl, targetImageUrl } })
 *         => Promise<{ ok:true, data:{ success:true, taskId:string } } | { ok:false, errorCode, errorMessage }>
 *
 * poll:   invoke({ name: 'faceSwapAction', data: { action:'poll', taskId } })
 *         => Promise<{ ok:true, data:{ success:true, status, imageUrl? } } | { ok:false, ... }>
 */
type CloudInvokePayload = {
  name: string
  data: Record<string, unknown>
}

type CloudInvokeResult = {
  ok: boolean
  success?: boolean
  code?: number
  data?: Record<string, unknown>
  errorCode?: string
  errorMessage?: string
}

type CloudInvoker = (payload: CloudInvokePayload) => Promise<CloudInvokeResult>

declare global {
  interface Window {
    __XmetaCloudInvoke?: CloudInvoker
  }
}

// ─── 辅助工具 ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: number | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error('CLOUD_TIMEOUT')), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timer) window.clearTimeout(timer)
  }
}

function getByPath(data: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, data)
}

function extractResultUrl(data: Record<string, unknown>, customPath?: string): string {
  const candidates: Array<unknown> = [
    customPath ? getByPath(data, customPath) : undefined,
    data.resultUrl,
    data.imageUrl,
    data.url,
    getByPath(data, 'data.resultUrl'),
    getByPath(data, 'data.imageUrl'),
    getByPath(data, 'data.url'),
    getByPath(data, 'result.resultUrl'),
    Array.isArray(data.output) ? data.output[0] : undefined,
    getByPath(data, 'data.output.0'),
    // PiAPI nested paths (used by cloud function)
    getByPath(data, 'output.image_url'),
    getByPath(data, 'output.images.0'),
    getByPath(data, 'output.image'),
  ]
  const hit = candidates.find((entry) => typeof entry === 'string' && entry.length > 0)
  return (hit as string | undefined) ?? ''
}

function buildMeta(style: string, extra?: { codename?: string; code?: string; joinedDate?: string }) {
  return {
    codename: extra?.codename ?? `AGENT_${style}`,
    code: extra?.code ?? generateAgentCode(),       // AGENT-XXXX
    joinedDate: extra?.joinedDate ?? generateTimestamp(), // YYYY-MM-DD HH:mm:ss
  }
}

/** 从 style 或 input.targetImageUrl 取目标模板 URL */
function resolveTargetUrl(input: GenerateFaceSwapInput): string {
  return input.targetImageUrl?.trim() || STYLE_TARGET_URLS[input.style]
}

/**
 * 确保目标图片是即梦 API 可访问的 ImgBB 公网 URL。
 *
 * 即梦 API（火山引擎，国内服务器）无法访问 Vercel / localhost 等域名，
 * 因此必须将模板图上传到 ImgBB 后再传给 API。
 * 已是 ImgBB URL 的直接返回；其余 URL 一律 fetch → 上传 ImgBB（结果缓存）。
 */
async function ensurePublicTargetUrl(url: string): Promise<string> {
  if (!url) return url

  // 已是 ImgBB URL，即梦可直接访问
  if (url.includes('ibb.co')) return url

  // 用 URL 末段作 cache key，避免 Vercel 哈希路径每次重传
  const cacheKey = `xm_target_${url.replace(/[^a-zA-Z0-9]/g, '_').slice(-60)}`
  try {
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) return cached
  } catch { /* ignore */ }

  // fetch → base64 → 上传 ImgBB（兼容 localhost / Vercel / 任意 URL）
  const res = await fetch(url)
  if (!res.ok) throw new Error(`无法获取模板图片：HTTP ${res.status}`)
  const blob = await res.blob()
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
  const publicUrl = await uploadToImgBB(base64)
  try { sessionStorage.setItem(cacheKey, publicUrl) } catch { /* ignore */ }
  return publicUrl
}

function getEnvNumber(key: string, fallback: number): number {
  return Number((import.meta.env as Record<string, string | undefined>)[key] ?? fallback)
}

function getEnvString(key: string, fallback = ''): string {
  return ((import.meta.env as Record<string, string | undefined>)[key] ?? fallback).trim()
}

// ─── 错误映射 ─────────────────────────────────────────────────────────────────

function mapCloudError(errorCode?: string, fallback?: string) {
  const code = errorCode ?? 'UNKNOWN'
  const mapped: Record<string, string> = {
    AUTH_EXPIRED: '云函数鉴权过期，请重新登录后再试。',
    RATE_LIMITED: '请求过于频繁，请稍后重试。',
    INVALID_IMAGE: '图片格式不支持，请重新上传。',
    CORS_BLOCKED: '云端图片跨域受限，请返回临时授权链接。',
  }
  return mapped[code] ?? fallback ?? `云函数调用失败（${code}）`
}

function mapPiapiError(errorCode?: string, fallback?: string) {
  const code = errorCode ?? 'PIAPI_UNKNOWN'
  const mapped: Record<string, string> = {
    PIAPI_AUTH: 'PiAPI 鉴权失败，请检查 API Key。',
    PIAPI_TIMEOUT: 'PiAPI 请求超时，请稍后重试。',
    PIAPI_CORS: 'PiAPI 跨域受限，请通过后端代理调用。',
    PIAPI_INVALID_RESPONSE: 'PiAPI 返回格式不符合预期。',
  }
  return mapped[code] ?? fallback ?? `PiAPI 调用失败（${code}）`
}

function mapBackendError(errorCode?: string, fallback?: string) {
  const code = errorCode ?? 'BACKEND_UNKNOWN'
  const mapped: Record<string, string> = {
    BACKEND_CONFIG: '后端配置不完整，请设置 VITE_CLOUD_BASE_URL。',
    BACKEND_HTTP: '后端请求失败，请检查接口地址和跨域配置。',
    BACKEND_TASK_FAILED: '后端任务执行失败，请检查任务状态与参数。',
    BACKEND_POLL_TIMEOUT: '后端任务轮询超时，请稍后重试。',
  }
  return mapped[code] ?? fallback ?? `后端调用失败（${code}）`
}

// ─── Backend HTTP Provider ────────────────────────────────────────────────────

function getBackendConfig() {
  const baseUrl = getEnvString('VITE_CLOUD_BASE_URL')
  const endpoint = getEnvString('VITE_CLOUD_ENDPOINT') || '/faceSwapAction'
  const timeoutMs = getEnvNumber('VITE_CLOUD_TIMEOUT_MS', 20000)
  const intervalMs = getEnvNumber('VITE_CLOUD_TASK_POLL_INTERVAL_MS', 2000)
  const maxAttempts = getEnvNumber('VITE_CLOUD_TASK_POLL_ATTEMPTS', 25)
  const resultPath = getEnvString('VITE_CLOUD_RESULT_PATH')

  if (!baseUrl) {
    throw new FaceSwapServiceError(
      'BACKEND_CONFIG',
      '请配置 VITE_CLOUD_BASE_URL 为后端换脸接口地址，例如 https://api.example.com',
    )
  }

  return { baseUrl, endpoint, timeoutMs, intervalMs, maxAttempts, resultPath }
}

async function requestBackendJson(
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const response = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    }),
    timeoutMs,
  )

  if (!response.ok) {
    throw new FaceSwapServiceError(
      'BACKEND_HTTP',
      `后端请求失败：${response.status} ${response.statusText}`,
    )
  }

  return (await response.json()) as Record<string, unknown>
}

async function generateViaBackend(input: GenerateFaceSwapInput): Promise<GenerateFaceSwapOutput> {
  const { baseUrl, endpoint, timeoutMs, intervalMs, maxAttempts, resultPath } = getBackendConfig()

  // Step 1: 上传用户图片至公网，获取 ImgBB URL（与小程序 uploadToPublic 等价）
  input.onProgress?.({ stage: 'upload', progress: 8, detail: 'Uploading facial image to public CDN...' })
  const swapImageUrl = await cachedUploadToImgBB(input.imageUrl)
  const targetImageUrl = await ensurePublicTargetUrl(resolveTargetUrl(input))

  input.onProgress?.({ stage: 'submit', progress: 20, detail: 'Submitting face-swap task to backend...' })

  // Step 2: 提交任务（合约与云函数 faceSwapAction submit 一致）
  const submitResult = await requestBackendJson(
    `${baseUrl}${endpoint}`,
    { action: 'submit', swapImageUrl, targetImageUrl, style: input.style, mode: 'h5' },
    timeoutMs,
  )

  const submitSuccess = submitResult.success === true || submitResult.ok === true
  const immediateUrl = extractResultUrl(submitResult, resultPath)
  const taskId = typeof submitResult.taskId === 'string' ? submitResult.taskId : undefined

  // 若后端同步返回了结果图（非异步任务模式）
  if (immediateUrl) {
    return { resultUrl: immediateUrl, meta: buildMeta(input.style) }
  }

  if (!submitSuccess && !taskId) {
    throw new FaceSwapServiceError(
      'BACKEND_INVALID_RESPONSE',
      mapBackendError('BACKEND_HTTP', '后端未返回有效的 taskId 或 resultUrl。'),
    )
  }

  if (!taskId) {
    throw new FaceSwapServiceError('BACKEND_INVALID_RESPONSE', '后端 submit 未返回 taskId。')
  }

  // Step 3: 轮询（合约与云函数 faceSwapAction poll 一致）
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    input.onProgress?.({
      stage: 'poll',
      progress: Math.min(90, 30 + Math.floor((attempt / maxAttempts) * 55)),
      detail: `Polling backend task (${attempt}/${maxAttempts})...`,
    })

    const pollResult = await requestBackendJson(
      `${baseUrl}${endpoint}`,
      { action: 'poll', taskId },
      timeoutMs,
    )

    const status = (pollResult.status as string | undefined) ?? (pollResult.state as string | undefined)
    const imageUrl = extractResultUrl(pollResult, resultPath) || (pollResult.imageUrl as string | undefined)
    const pollError = (pollResult.error as string | undefined) ?? (pollResult.message as string | undefined)

    if ((status === 'completed' || status === 'success') && imageUrl) {
      return { resultUrl: imageUrl, meta: buildMeta(input.style) }
    }

    if (status === 'failed' || status === 'error') {
      throw new FaceSwapServiceError('BACKEND_TASK_FAILED', pollError ?? '后端任务执行失败。')
    }

    if (attempt < maxAttempts) await sleep(intervalMs)
  }

  throw new FaceSwapServiceError('BACKEND_POLL_TIMEOUT', mapBackendError('BACKEND_POLL_TIMEOUT'))
}

// ─── Invoker Provider（微信 WebView Bridge） ──────────────────────────────────

/**
 * 通过 window.__XmetaCloudInvoke 调用云函数 faceSwapAction。
 * 合约与小程序端 aiService.js 中 requestFaceSwap + pollFaceSwap 完全一致：
 *   1. submit：返回 taskId
 *   2. poll：轮询直至 status === 'completed'
 *
 * 图片同样先上传至 ImgBB 再传给云函数，确保 PiAPI 可访问。
 */
async function generateViaInvoker(input: GenerateFaceSwapInput): Promise<GenerateFaceSwapOutput> {
  const invoke = window.__XmetaCloudInvoke
  if (!invoke) {
    throw new FaceSwapServiceError(
      'INVOKER_MISSING',
      '未检测到云函数调用器：请注入 window.__XmetaCloudInvoke，或切换 VITE_API_MODE=mock。',
    )
  }

  const timeoutMs = getEnvNumber('VITE_CLOUD_TIMEOUT_MS', 20000)
  const intervalMs = getEnvNumber('VITE_CLOUD_TASK_POLL_INTERVAL_MS', 2000)
  const maxAttempts = getEnvNumber('VITE_CLOUD_TASK_POLL_ATTEMPTS', 25)
  const retryCount = getEnvNumber('VITE_CLOUD_RETRY_COUNT', 2)

  // Step 1: 上传用户图片至公网（小程序在客户端完成，H5 同样在调用云函数前完成）
  input.onProgress?.({ stage: 'upload', progress: 8, detail: 'Uploading facial image to public CDN...' })
  const swapImageUrl = await cachedUploadToImgBB(input.imageUrl)
  const targetImageUrl = await ensurePublicTargetUrl(resolveTargetUrl(input))

  // Step 2: 提交任务，含重试
  input.onProgress?.({ stage: 'submit', progress: 20, detail: 'Submitting task via cloud bridge...' })

  let lastError: unknown
  let taskId: string | undefined

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    if (attempt > 0) {
      input.onProgress?.({
        stage: 'retry',
        progress: 15,
        detail: `Retrying submit (${attempt}/${retryCount})...`,
      })
      await sleep(600 * attempt)
    }

    try {
      const submitResp = await withTimeout(
        invoke({
          name: 'faceSwapAction',
          data: {
            action: 'submit',
            swapImageUrl,
            targetImageUrl,
            style: input.style,
            mode: 'h5',
          },
        }),
        timeoutMs,
      )

      // ok 由 bridge 层设置，data 是云函数的 result
      if (!submitResp.ok && !submitResp.success) {
        throw new FaceSwapServiceError(
          submitResp.errorCode ?? 'CLOUD_SUBMIT_FAILED',
          mapCloudError(submitResp.errorCode, submitResp.errorMessage),
        )
      }

      const resultData = submitResp.data ?? {}

      // 若云函数或 bridge 同步返回了结果图
      const immediateUrl = extractResultUrl(resultData)
      if (immediateUrl) {
        return { resultUrl: immediateUrl, meta: buildMeta(input.style) }
      }

      // 取 taskId（云函数 submit 返回 { success: true, taskId }）
      taskId =
        (resultData.taskId as string | undefined) ??
        (resultData.task_id as string | undefined)

      if (taskId) break
      throw new FaceSwapServiceError('CLOUD_INVALID_RESPONSE', '云函数 submit 未返回 taskId。')
    } catch (err) {
      lastError = err
    }
  }

  if (!taskId) {
    if (lastError instanceof Error && lastError.message === 'CLOUD_TIMEOUT') {
      throw new FaceSwapServiceError('CLOUD_TIMEOUT', '云函数调用超时，请检查网络后重试。')
    }
    if (lastError instanceof FaceSwapServiceError) throw lastError
    throw new FaceSwapServiceError('CLOUD_UNKNOWN', '云函数提交失败，请稍后重试。')
  }

  // Step 3: 轮询结果（与小程序端 pollFaceSwap 逻辑对齐）
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    input.onProgress?.({
      stage: 'poll',
      progress: Math.min(90, 30 + Math.floor((attempt / maxAttempts) * 55)),
      detail: `Polling cloud task (${attempt}/${maxAttempts})...`,
    })

    const pollResp = await withTimeout(
      invoke({ name: 'faceSwapAction', data: { action: 'poll', taskId } }),
      timeoutMs,
    )

    const pollData = pollResp.data ?? {}
    const status = pollData.status as string | undefined
    const imageUrl = extractResultUrl(pollData) || (pollData.imageUrl as string | undefined)
    const pollError = pollData.error

    if (status === 'completed' && imageUrl) {
      return { resultUrl: imageUrl, meta: buildMeta(input.style) }
    }

    if (status === 'failed' || status === 'error') {
      throw new FaceSwapServiceError('CLOUD_TASK_FAILED', `任务失败：${JSON.stringify(pollError)}`)
    }

    if (attempt < maxAttempts) await sleep(intervalMs)
  }

  throw new FaceSwapServiceError('CLOUD_TIMEOUT', '云函数任务轮询超时，请稍后重试。')
}

// ─── PiAPI Direct Provider ────────────────────────────────────────────────────

/**
 * 直接调用 PiAPI（仅适用于后端代理场景，客户端直连会暴露 API Key）。
 * 与云函数 faceSwapAction 内部逻辑完全对应：
 *   1. POST /api/v1/task 提交任务 → 获取 task_id
 *   2. GET  /api/v1/task/{task_id} 轮询直至 completed
 *
 * ⚠️ VITE_PIAPI_API_KEY 会被打包进客户端 JS，生产环境请使用 backend/invoker 模式。
 */
async function generateViaPiapi(input: GenerateFaceSwapInput): Promise<GenerateFaceSwapOutput> {
  const baseUrl = getEnvString('VITE_PIAPI_BASE_URL')
  const apiKey = getEnvString('VITE_PIAPI_API_KEY')
  const submitEndpoint = getEnvString('VITE_PIAPI_ENDPOINT') || '/api/v1/task'
  const model = getEnvString('VITE_PIAPI_MODEL') || 'Qubico/image-toolkit'
  const timeoutMs = getEnvNumber('VITE_CLOUD_TIMEOUT_MS', 20000)
  const intervalMs = getEnvNumber('VITE_CLOUD_TASK_POLL_INTERVAL_MS', 2000)
  const maxAttempts = getEnvNumber('VITE_CLOUD_TASK_POLL_ATTEMPTS', 25)
  const resultPath = getEnvString('VITE_PIAPI_RESULT_PATH')

  if (!baseUrl || !apiKey) {
    throw new FaceSwapServiceError(
      'PIAPI_AUTH',
      'PiAPI 未配置：请设置 VITE_PIAPI_BASE_URL 与 VITE_PIAPI_API_KEY。',
    )
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'x-api-key': apiKey,
  }

  // Step 1: 上传用户图片至公网
  input.onProgress?.({ stage: 'upload', progress: 8, detail: 'Uploading facial image to public CDN...' })
  const swapImageUrl = await cachedUploadToImgBB(input.imageUrl)
  const targetImageUrl = await ensurePublicTargetUrl(resolveTargetUrl(input))

  // Step 2: 向 PiAPI 提交 face-swap 任务（与云函数 submit() 逻辑相同）
  input.onProgress?.({ stage: 'submit', progress: 20, detail: 'Submitting PiAPI face-swap task...' })

  let submitResp: Response
  try {
    submitResp = await withTimeout(
      fetch(`${baseUrl}${submitEndpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          task_type: 'face-swap',
          input: {
            swap_image: swapImageUrl,
            target_image: targetImageUrl,
          },
        }),
      }),
      timeoutMs,
    )
  } catch (err) {
    if (err instanceof Error && err.message === 'CLOUD_TIMEOUT') {
      throw new FaceSwapServiceError('PIAPI_TIMEOUT', mapPiapiError('PIAPI_TIMEOUT'))
    }
    throw new FaceSwapServiceError('PIAPI_UNKNOWN', mapPiapiError(undefined, (err as Error).message))
  }

  if (!submitResp.ok) {
    if (submitResp.status === 401 || submitResp.status === 403) {
      throw new FaceSwapServiceError('PIAPI_AUTH', mapPiapiError('PIAPI_AUTH'))
    }
    throw new FaceSwapServiceError('PIAPI_HTTP', `PiAPI HTTP 错误：${submitResp.status}`)
  }

  const submitPayload = (await submitResp.json()) as Record<string, unknown>
  const taskId =
    (getByPath(submitPayload, 'data.task_id') as string | undefined) ??
    (submitPayload.task_id as string | undefined)

  if (!taskId) {
    throw new FaceSwapServiceError(
      'PIAPI_INVALID_RESPONSE',
      mapPiapiError('PIAPI_INVALID_RESPONSE', '未获取到 task_id，响应：' + JSON.stringify(submitPayload)),
    )
  }

  // Step 3: 轮询任务状态（与云函数 poll() 逻辑相同）
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    input.onProgress?.({
      stage: 'poll',
      progress: Math.min(90, 30 + Math.floor((attempt / maxAttempts) * 55)),
      detail: `Polling PiAPI task (${attempt}/${maxAttempts})...`,
    })

    let pollResp: Response
    try {
      pollResp = await withTimeout(
        fetch(`${baseUrl}${submitEndpoint}/${taskId}`, { headers }),
        timeoutMs,
      )
    } catch (err) {
      if (err instanceof Error && err.message === 'CLOUD_TIMEOUT') {
        throw new FaceSwapServiceError('PIAPI_TIMEOUT', mapPiapiError('PIAPI_TIMEOUT'))
      }
      throw err
    }

    if (!pollResp.ok) {
      throw new FaceSwapServiceError('PIAPI_HTTP', `PiAPI 轮询请求失败：${pollResp.status}`)
    }

    const pollPayload = (await pollResp.json()) as Record<string, unknown>
    // 与云函数 poll() 中的 payload 提取逻辑对齐
    const inner = (pollPayload.data ?? pollPayload) as Record<string, unknown>
    const status = inner.status as string | undefined
    const imageUrl =
      extractResultUrl(inner, resultPath) ||
      (getByPath(inner, 'output.image_url') as string | undefined) ||
      (getByPath(inner, 'output.images.0') as string | undefined)

    if ((status === 'completed' || status === 'success') && imageUrl) {
      input.onProgress?.({ stage: 'finalize', progress: 96, detail: 'PiAPI artifact ready.' })
      return { resultUrl: imageUrl, meta: buildMeta(input.style) }
    }

    if (status === 'failed' || status === 'error') {
      const errDetail = inner.error ?? inner.message
      throw new FaceSwapServiceError('PIAPI_TASK_FAILED', `PiAPI 任务失败：${JSON.stringify(errDetail)}`)
    }

    if (attempt < maxAttempts) await sleep(intervalMs)
  }

  throw new FaceSwapServiceError('PIAPI_TIMEOUT', mapPiapiError('PIAPI_TIMEOUT', '任务轮询超时。'))
}

// ─── 即梦（Doubao Seedream / Ark）Provider ────────────────────────────────────

/**
 * 调用火山引擎 Ark 图片生成接口（即梦 Seedream）实现换脸。
 * 接口为同步模式，一次 POST 即可获得结果图，无需轮询。
 *
 * 请求格式：
 *   POST /api/v3/images/generations
 *   image: [模板图URL, 用户人脸URL]  两张图：模板 + 用户脸
 *   prompt: 换脸指令（可通过 VITE_JIMENG_PROMPT 覆盖）
 */
async function generateViaJimeng(input: GenerateFaceSwapInput): Promise<GenerateFaceSwapOutput> {
  const baseUrl = getEnvString('VITE_JIMENG_BASE_URL') || 'https://ark.cn-beijing.volces.com'
  const apiKey = getEnvString('VITE_JIMENG_API_KEY')
  const model = getEnvString('VITE_JIMENG_MODEL') || 'doubao-seedream-5-0-260128'
  const prompt =
    getEnvString('VITE_JIMENG_PROMPT') ||
    '极致高清，写实摄影，保持原图的发型、服装及背景环境与光效色彩完全不变，仅将面部特征替换为参考图中的人物，要求肤色融合自然，五官结构精准，表情生动，保持光照和亮度与原始图片一致'
  const size = getEnvString('VITE_JIMENG_SIZE') || '1024x1024'
  const timeoutMs = getEnvNumber('VITE_JIMENG_TIMEOUT_MS', 120000)

  if (!apiKey) {
    throw new FaceSwapServiceError(
      'JIMENG_AUTH',
      '未配置即梦 API Key：请在 .env.local 中设置 VITE_JIMENG_API_KEY。',
    )
  }

  // Step 1: 上传用户人脸至公网 CDN
  input.onProgress?.({ stage: 'upload', progress: 10, detail: 'Uploading facial image to CDN...' })
  const swapImageUrl = await cachedUploadToImgBB(input.imageUrl)
  const targetImageUrl = await ensurePublicTargetUrl(resolveTargetUrl(input))

  // Step 2: 调用即梦接口（双图换脸：[模板图, 人脸图]）
  input.onProgress?.({ stage: 'submit', progress: 35, detail: 'Generating face swap via Jimeng...' })

  let response: Response
  try {
    response = await withTimeout(
      fetch(`${baseUrl}/api/v3/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          prompt,
          image: [targetImageUrl, swapImageUrl],
          size,
          output_format: 'png',
          watermark: false,
        }),
      }),
      timeoutMs,
    )
  } catch (err) {
    if (err instanceof Error && err.message === 'CLOUD_TIMEOUT') {
      throw new FaceSwapServiceError('JIMENG_TIMEOUT', '即梦接口请求超时，请稍后重试。')
    }
    throw new FaceSwapServiceError('JIMENG_UNKNOWN', `即梦请求失败：${(err as Error).message}`)
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new FaceSwapServiceError('JIMENG_AUTH', '即梦 API 鉴权失败，请检查 VITE_JIMENG_API_KEY。')
    }
    let errBody = ''
    try { errBody = await response.text() } catch { /* ignore */ }
    throw new FaceSwapServiceError('JIMENG_HTTP', `即梦 API 错误 ${response.status}：${errBody.slice(0, 120)}`)
  }

  const payload = (await response.json()) as { data?: Array<{ url?: string; b64_json?: string }> }
  const resultUrl = payload.data?.[0]?.url ?? ''

  if (!resultUrl) {
    throw new FaceSwapServiceError(
      'JIMENG_INVALID_RESPONSE',
      `即梦未返回图片地址，响应：${JSON.stringify(payload).slice(0, 200)}`,
    )
  }

  input.onProgress?.({ stage: 'done', progress: 100, detail: 'Mission artifact ready.' })
  return { resultUrl, swapImageUrl, meta: buildMeta(input.style) }
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

async function generateFaceSwap(input: GenerateFaceSwapInput): Promise<GenerateFaceSwapOutput> {
  const provider = getEnvString('VITE_CLOUD_PROVIDER').toLowerCase() || 'invoker'
  if (provider === 'jimeng') return generateViaJimeng(input)
  if (provider === 'piapi') return generateViaPiapi(input)
  if (provider === 'backend') return generateViaBackend(input)
  return generateViaInvoker(input)
}

export const cloudFaceSwapClient: FaceSwapClient = {
  generateFaceSwap,
}

// ─── 皮克斯卡通头像生成（用于证书，与换脸结果独立）────────────────────────────

/**
 * 使用即梦 API 将用户照片转换为皮克斯风格 3D 卡通头像。
 * 仅传入用户照片（单图），不依赖换脸模板。
 * 可通过 VITE_JIMENG_CARTOON_PROMPT 环境变量覆盖提示词。
 */
export async function generateCartoonAvatar(imageUrl: string): Promise<string> {
  const baseUrl = getEnvString('VITE_JIMENG_BASE_URL') || 'https://ark.cn-beijing.volces.com'
  const apiKey = getEnvString('VITE_JIMENG_API_KEY')
  const model = getEnvString('VITE_JIMENG_MODEL') || 'doubao-seedream-5-0-260128'
  const prompt =
    getEnvString('VITE_JIMENG_CARTOON_PROMPT') ||
    '学习皮克斯3D画风的动漫风格，将照片中的人，生成为此风格的动漫头像。模仿形体，脸型，肤色、五官表情。生成图片为人物的正面半身照，图片比例1：1，背景白底，只要完整人物'
  // 与换脸保持一致的 size 配置，避免 API 拒绝不支持的分辨率
  const size = getEnvString('VITE_JIMENG_SIZE') || '1024x1024'
  const timeoutMs = getEnvNumber('VITE_JIMENG_TIMEOUT_MS', 120000)

  if (!apiKey) throw new Error('未配置 VITE_JIMENG_API_KEY')

  // 已是公网 HTTP URL（换脸步骤已上传至 ImgBB）时直接使用，无需再次上传
  const userPhotoUrl = imageUrl.startsWith('http')
    ? imageUrl
    : await cachedUploadToImgBB(imageUrl)

  // Seedream 模型要求传入 2 张参考图；此处以同一张用户照片填充两个槽位，
  // 让模型在保留面部特征的同时按 prompt 进行风格变换
  const response = await withTimeout(
    fetch(`${baseUrl}/api/v3/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        image: [userPhotoUrl, userPhotoUrl],
        size,
        output_format: 'png',
        watermark: false,
      }),
    }),
    timeoutMs,
  )

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new Error(`即梦卡通头像生成失败 HTTP ${response.status}：${errBody.slice(0, 200)}`)
  }

  const payload = (await response.json()) as { data?: Array<{ url?: string }> }
  const url = payload.data?.[0]?.url ?? ''
  if (!url) throw new Error(`即梦未返回卡通头像 URL，响应：${JSON.stringify(payload).slice(0, 200)}`)
  return url
}

// ─── AI 游戏证书生成 ──────────────────────────────────────────────────────────

/**
 * 将卡通头像融合进游戏证书模板，生成完整的 AI 证书图。
 *
 * 参数说明：
 *   cartoonAvatarUrl       - 卡通头像公网 URL（即梦卡通生成结果）
 *   certificateTemplateUrl - 证书模板公网 URL（配置在 VITE_CERTIFICATE_TEMPLATE_URL）
 *
 * 调色提示词通过 VITE_JIMENG_CERT_PROMPT 覆盖。
 */
export async function generateCertificateWithAvatar(
  cartoonAvatarUrl: string,
  certificateTemplateUrl: string,
): Promise<string> {
  const baseUrl = getEnvString('VITE_JIMENG_BASE_URL') || 'https://ark.cn-beijing.volces.com'
  const apiKey = getEnvString('VITE_JIMENG_API_KEY')
  const model = getEnvString('VITE_JIMENG_MODEL') || 'doubao-seedream-5-0-260128'
  const prompt =
    getEnvString('VITE_JIMENG_CERT_PROMPT') ||
    '将第二张图中的卡通人物头像自然融合到第一张游戏证书模板的头像预留区域中，保持证书整体构图、背景、文字、装饰和色彩完全不变，仅替换头像区域，融合边缘自然无痕'
  // 证书独立 size，默认 1024x1024（小于换脸 2K），可单独通过 VITE_JIMENG_CERT_SIZE 调整
  const size = getEnvString('VITE_JIMENG_CERT_SIZE') || '1024x1024'
  const timeoutMs = getEnvNumber('VITE_JIMENG_TIMEOUT_MS', 120000)

  if (!apiKey) throw new Error('未配置 VITE_JIMENG_API_KEY')
  if (!certificateTemplateUrl) throw new Error('未配置证书模板 URL（VITE_CERTIFICATE_TEMPLATE_URL）')

  // 确保两张图都是即梦服务器可访问的公网 HTTP URL
  const templateUrl = certificateTemplateUrl.startsWith('http')
    ? certificateTemplateUrl
    : await cachedUploadToImgBB(certificateTemplateUrl)

  const avatarUrl = cartoonAvatarUrl.startsWith('http')
    ? cartoonAvatarUrl
    : await cachedUploadToImgBB(cartoonAvatarUrl)

  const response = await withTimeout(
    fetch(`${baseUrl}/api/v3/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        image: [templateUrl, avatarUrl],
        size,
        output_format: 'png',
        watermark: false,
      }),
    }),
    timeoutMs,
  )

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new Error(`即梦证书生成失败 HTTP ${response.status}：${errBody.slice(0, 200)}`)
  }

  const payload = (await response.json()) as { data?: Array<{ url?: string }> }
  const url = payload.data?.[0]?.url ?? ''
  if (!url) throw new Error(`即梦未返回证书图片 URL，响应：${JSON.stringify(payload).slice(0, 200)}`)
  return url
}

// ─── 一体化证书生成（单步：从原始照片直接生成含皮克斯头像的证书）──────────────

/**
 * 从用户原始照片一步生成含皮克斯风格头像的游戏证书。
 * 替代原来的两步流程（先生成卡通头像 → 再融合证书），减少 API 调用次数。
 *
 * image[0] = 证书模板，image[1] = 用户照片
 * 可通过 VITE_JIMENG_CERT_ONE_SHOT_PROMPT 覆盖提示词。
 */
export async function generateCertificateFromPhoto(
  photoUrl: string,
  certificateTemplateUrl: string,
): Promise<string> {
  const baseUrl = getEnvString('VITE_JIMENG_BASE_URL') || 'https://ark.cn-beijing.volces.com'
  const apiKey = getEnvString('VITE_JIMENG_API_KEY')
  const model = getEnvString('VITE_JIMENG_MODEL') || 'doubao-seedream-5-0-260128'
  const prompt =
    getEnvString('VITE_JIMENG_CERT_ONE_SHOT_PROMPT') ||
    '参考第二张图中人物的面部特征，将其转换为皮克斯（Pixar）3D动画风格的卡通头像，并自然融合到第一张游戏证书模板的头像预留区域中。要求：1. 保留人物真实面部特征（脸型、五官、肤色），不改变性别和年龄感。2. 采用皮克斯电影级3D渲染质感，皮肤细腻，眼睛明亮有神。3. 头像完整显示在预留区域内，融合边缘自然无痕。4. 严格保持证书其余所有内容（背景、文字、徽章、装饰图案、整体配色）完全不变。'
  const size = getEnvString('VITE_JIMENG_CERT_SIZE') || '2K'
  const timeoutMs = getEnvNumber('VITE_JIMENG_TIMEOUT_MS', 120000)

  if (!apiKey) throw new Error('未配置 VITE_JIMENG_API_KEY')
  if (!certificateTemplateUrl) throw new Error('未配置证书模板 URL（VITE_CERTIFICATE_TEMPLATE_URL）')

  const templateUrl = certificateTemplateUrl.startsWith('http')
    ? certificateTemplateUrl
    : await cachedUploadToImgBB(certificateTemplateUrl)

  const userPhotoUrl = photoUrl.startsWith('http')
    ? photoUrl
    : await cachedUploadToImgBB(photoUrl)

  const response = await withTimeout(
    fetch(`${baseUrl}/api/v3/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        image: [templateUrl, userPhotoUrl],
        size,
        output_format: 'png',
        watermark: false,
      }),
    }),
    timeoutMs,
  )

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new Error(`即梦证书生成失败 HTTP ${response.status}：${errBody.slice(0, 200)}`)
  }

  const payload2 = (await response.json()) as { data?: Array<{ url?: string }> }
  const certUrl = payload2.data?.[0]?.url ?? ''
  if (!certUrl) throw new Error(`即梦未返回证书图片 URL，响应：${JSON.stringify(payload2).slice(0, 200)}`)
  return certUrl
}
