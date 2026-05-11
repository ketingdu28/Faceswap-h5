export interface FaceSwapServiceInput {
  imageBase64: string
  styleId: 'A' | 'B' | 'C'
}

export interface FaceSwapServiceOutput {
  resultImageUrl: string
  taskId: string
}

import { uploadToImgBB } from '../services/uploadToImgBB'

interface PiApiCreateTaskResponse {
  task_id?: string
  data?: {
    task_id?: string
  }
  message?: string
}

interface PiApiTaskStatusResponse {
  data?: {
    status?: string
    output?: {
      image_url?: string
      images?: string[]
      image?: string
      url?: string
    }
    error?: unknown
  }
  status?: string
  output?: {
    image_url?: string
    images?: string[]
    image?: string
    url?: string
  }
  error?: unknown
}

const PIAPI_BASE_URL = (import.meta.env.VITE_AI_BASE_URL as string | undefined)?.trim() || 'https://api.piapi.ai'
const PIAPI_MODEL = (import.meta.env.VITE_AI_MODEL as string | undefined)?.trim() || 'Qubico/image-toolkit'
const PIAPI_TASK_ENDPOINT = `${PIAPI_BASE_URL}/api/v1/task`
const PIAPI_API_KEY = (import.meta.env.VITE_AI_API_KEY as string | undefined)?.trim() || ''
const POLL_INTERVAL_MS = Number(import.meta.env.VITE_AI_POLL_INTERVAL_MS ?? 2000)
const POLL_ATTEMPTS = Number(import.meta.env.VITE_AI_POLL_ATTEMPTS ?? 24)

function ensureApiKey(): string {
  if (!PIAPI_API_KEY) {
    throw new Error('未配置 VITE_AI_API_KEY，请在 .env.local 中设置')
  }
  return PIAPI_API_KEY
}

function resolveTargetImage(styleId: 'A' | 'B' | 'C'): string {
  const styleMap = {
    A: (import.meta.env.VITE_TARGET_URL_A as string | undefined)?.trim() || '',
    B: (import.meta.env.VITE_TARGET_URL_B as string | undefined)?.trim() || '',
    C: (import.meta.env.VITE_TARGET_URL_C as string | undefined)?.trim() || '',
  }

  const target = styleMap[styleId]
  if (!target) {
    throw new Error(`未配置风格 ${styleId} 的目标图，请在 .env.local 设置 VITE_TARGET_URL_${styleId}`)
  }
  return target
}

function parseResultImageUrl(payload: PiApiTaskStatusResponse): string {
  const output = payload.data?.output ?? payload.output
  const url =
    output?.image_url ??
    output?.images?.[0] ??
    output?.image ??
    output?.url ??
    ''

  if (!url) throw new Error('PIAPI 返回成功，但未提供结果图片地址')
  return url
}

async function parseJsonSafely<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T
  } catch {
    throw new Error(`服务响应解析失败（HTTP ${response.status}）`)
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('无法读取图片数据'))
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.readAsDataURL(blob)
  })
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value)
}

async function ensurePublicImageUrl(image: string, cacheKey?: string): Promise<string> {
  const trimmed = image.trim()
  if (!trimmed) throw new Error('图片地址为空')

  if (cacheKey) {
    const hit = sessionStorage.getItem(cacheKey)
    if (hit) return hit
  }

  // 1) already public url
  if (isHttpUrl(trimmed)) {
    if (cacheKey) sessionStorage.setItem(cacheKey, trimmed)
    return trimmed
  }

  // 2) data url or base64 → upload directly
  if (trimmed.startsWith('data:') || /^[A-Za-z0-9+/=]+$/.test(trimmed.slice(0, 48))) {
    const url = await uploadToImgBB(trimmed)
    if (cacheKey) sessionStorage.setItem(cacheKey, url)
    return url
  }

  // 3) relative path (/xxx.png) → fetch from current origin then upload
  if (trimmed.startsWith('/')) {
    const res = await fetch(trimmed, { method: 'GET' })
    if (!res.ok) throw new Error(`无法读取本地目标图：HTTP ${res.status}`)
    const blob = await res.blob()
    const dataUrl = await blobToDataUrl(blob)
    const url = await uploadToImgBB(dataUrl)
    if (cacheKey) sessionStorage.setItem(cacheKey, url)
    return url
  }

  throw new Error(`不支持的图片格式：${trimmed.slice(0, 32)}`)
}

export async function requestFaceSwap({ imageBase64, styleId }: FaceSwapServiceInput): Promise<FaceSwapServiceOutput> {
  if (!imageBase64) throw new Error('imageBase64 不能为空')
  const apiKey = ensureApiKey()
  const targetImage = resolveTargetImage(styleId)

  // PiAPI expects public URLs. Convert swap/target to public CDN URLs first.
  const swapImageUrl = await ensurePublicImageUrl(imageBase64)
  const targetImageUrl = await ensurePublicImageUrl(targetImage, `piapi_target_${styleId}`)

  const createResponse = await fetch(PIAPI_TASK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model: PIAPI_MODEL,
      task_type: 'face-swap',
      input: {
        swap_image: swapImageUrl,
        target_image: targetImageUrl,
      },
    }),
  })

  const createPayload = await parseJsonSafely<PiApiCreateTaskResponse>(createResponse)
  const taskId = createPayload.data?.task_id ?? createPayload.task_id ?? ''
  if (!createResponse.ok || !taskId) {
    throw new Error(`提交 PIAPI 任务失败：${createPayload.message || `HTTP ${createResponse.status}`}`)
  }

  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    const pollResponse = await fetch(`${PIAPI_TASK_ENDPOINT}/${taskId}`, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    })
    const pollPayload = await parseJsonSafely<PiApiTaskStatusResponse>(pollResponse)
    const status = pollPayload.data?.status ?? pollPayload.status ?? 'unknown'

    if (status === 'completed' || status === 'success') {
      return {
        resultImageUrl: parseResultImageUrl(pollPayload),
        taskId,
      }
    }
    if (status === 'failed' || status === 'error') {
      throw new Error(`PIAPI 任务失败：${JSON.stringify(pollPayload.data?.error ?? pollPayload.error ?? 'unknown')}`)
    }

    if (attempt < POLL_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }

  throw new Error(`PIAPI 轮询超时：${POLL_ATTEMPTS} 次后任务仍未完成`)
}
