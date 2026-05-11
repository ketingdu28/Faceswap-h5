/**
 * src/api/faceSwap.ts
 *
 * 腾讯云开发（TCB）Web SDK 封装
 * ─────────────────────────────────────────────────────────────────────────────
 * 安装：npm install @cloudbase/js-sdk（已完成）
 * 配置：在 .env.local 中设置 VITE_CLOUD_ENV_ID（云开发环境 ID）
 *
 * 对外暴露：
 *   initTcb()         — 在 main.ts 中调用，预热匿名登录
 *   tcbFaceSwapClient — FaceSwapClient 实现，供 faceSwapClient.ts 选用
 */

import cloudbase from '@cloudbase/js-sdk'
import type { FaceSwapClient, GenerateFaceSwapInput, GenerateFaceSwapOutput } from '../services/faceSwapClient'
import { FaceSwapServiceError } from '../services/errors'
import { generateAgentCode, generateTimestamp } from '../services/agentMeta'

// ─── Mock 逻辑（注释保留，联调时可快速取消注释验证）──────────────────────────
/*
export async function uploadToCloudStorage(_dataUrl: string, _style: string): Promise<string> {
  await new Promise(r => setTimeout(r, 600))
  return 'mock-file-id://temp_uploads/mock.jpg'
}

export const tcbFaceSwapClient: FaceSwapClient = {
  async generateFaceSwap(input) {
    for (let i = 1; i <= 5; i++) {
      await new Promise(r => setTimeout(r, 500))
      input.onProgress?.({ stage: 'mock', progress: i * 18, detail: `Mock step ${i}...` })
    }
    return {
      resultUrl: input.imageUrl,
      meta: { codename: `AGENT_${input.style}`, code: 'AGENT-0000', joinedDate: new Date().toLocaleString() },
    }
  },
}

export function initTcb() { console.log('[TCB] Mock 模式，不初始化云端') }
*/
// ─────────────────────────────────────────────────────────────────────────────

const ENV_ID: string = (import.meta.env.VITE_CLOUD_ENV_ID as string | undefined)?.trim() ?? ''
const REGION: string | undefined = (import.meta.env.VITE_CLOUD_REGION as string | undefined)?.trim() || undefined
const ACCESS_KEY: string | undefined = (import.meta.env.VITE_CLOUD_ACCESS_KEY as string | undefined)?.trim() || undefined

// 单例 App 实例
let _app: ReturnType<typeof cloudbase.init> | null = null
// 登录 Promise 全局共享，避免并发多次登录
let _loginPromise: Promise<void> | null = null

function getApp() {
  if (!_app) {
    if (!ENV_ID) {
      throw new FaceSwapServiceError(
        'TCB_CONFIG',
        '请在 .env.local 中配置 VITE_CLOUD_ENV_ID（云开发环境 ID）',
      )
    }
    _app = cloudbase.init({
      env: ENV_ID,
      ...(REGION ? { region: REGION } : {}),
      ...(ACCESS_KEY ? { accessKey: ACCESS_KEY } : {}),
    })
  }
  return _app
}

/**
 * 确保已完成匿名登录（幂等，重复调用安全）
 * @cloudbase/js-sdk 2.x：auth 为属性，getLoginState 返回 null 表示未登录
 */
async function ensureLogin(): Promise<void> {
  if (_loginPromise) return _loginPromise
  _loginPromise = (async () => {
    const app = getApp()
    const auth = app.auth
    const state = await auth.getLoginState()
    if (!state || !state.isAnonymousAuth) {
      const { error } = await auth.signInAnonymously()
      if (error) throw error
      console.log('[TCB] 匿名登录成功')
    } else {
      console.log('[TCB] 已有匿名登录态，跳过')
    }
  })().catch((err: unknown) => {
    _loginPromise = null   // 失败时重置，允许下次重试
    throw err
  })
  return _loginPromise
}

/**
 * 调用云函数 faceSwapAction（submit + poll 轮询）
 * H5 端改为传 imageDataUrl，由云函数代传存储并生成可访问 URL。
 */
async function generateFaceSwap(input: GenerateFaceSwapInput): Promise<GenerateFaceSwapOutput> {
  const intervalMs = Number(import.meta.env.VITE_CLOUD_TASK_POLL_INTERVAL_MS ?? 2000)
  const maxAttempts = Number(import.meta.env.VITE_CLOUD_TASK_POLL_ATTEMPTS ?? 25)

  // Step 1: 登录
  input.onProgress?.({ stage: 'login', progress: 5, detail: 'Connecting to cloud...' })
  await ensureLogin()

  const app = getApp()

  input.onProgress?.({ stage: 'upload', progress: 15, detail: 'Handing image to cloud function...' })

  // Step 3: 提交换脸任务
  input.onProgress?.({ stage: 'submit', progress: 28, detail: 'Submitting face-swap task...' })
  const submitRes = await app.callFunction({
    name: 'faceSwapAction',
    data: {
      action: 'submit',
      imageDataUrl: input.imageUrl,         // 云函数侧代传存储（避免浏览器 CORS）
      cloudFileID: input.cloudFileID ?? '', // 若调用方已上传，可直接复用
      targetImageUrl: input.targetImageUrl, // 模板图公网 URL（可选，云函数有默认值）
      style: input.style,
      mode: 'h5',
    },
  })

  const submitResult = submitRes.result as Record<string, unknown>
  if (!submitResult?.success) {
    throw new FaceSwapServiceError(
      'TCB_SUBMIT_FAILED',
      `云函数提交失败：${String(submitResult?.error ?? '未知错误')}`,
    )
  }

  // 若云函数同步返回了结果图（同步模式）
  if (typeof submitResult.imageUrl === 'string' && submitResult.imageUrl) {
    return {
      resultUrl: submitResult.imageUrl,
      meta: { codename: `AGENT_${input.style}`, code: generateAgentCode(), joinedDate: generateTimestamp() },
    }
  }

  const taskId = submitResult.taskId as string | undefined
  if (!taskId) {
    throw new FaceSwapServiceError('TCB_NO_TASK_ID', '云函数未返回 taskId，请检查云函数日志')
  }

  // Step 4: 轮询结果（与小程序端 pollFaceSwap 逻辑对齐）
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    input.onProgress?.({
      stage: 'poll',
      progress: Math.min(90, 35 + Math.floor((attempt / maxAttempts) * 50)),
      detail: `Polling task (${attempt}/${maxAttempts})...`,
    })

    const pollRes = await app.callFunction({
      name: 'faceSwapAction',
      data: { action: 'poll', taskId },
    })

    const pollResult = pollRes.result as Record<string, unknown>
    const { status, imageUrl, error } = pollResult ?? {}

    if (status === 'completed' && typeof imageUrl === 'string' && imageUrl) {
      input.onProgress?.({ stage: 'done', progress: 100, detail: 'Mission artifact ready.' })
      return {
        resultUrl: imageUrl,
        meta: { codename: `AGENT_${input.style}`, code: generateAgentCode(), joinedDate: generateTimestamp() },
      }
    }

    if (status === 'failed' || status === 'error') {
      throw new FaceSwapServiceError('TCB_TASK_FAILED', `换脸任务失败：${JSON.stringify(error)}`)
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }

  throw new FaceSwapServiceError('TCB_TIMEOUT', `轮询 ${maxAttempts} 次后任务仍未完成，请重试`)
}

export const tcbFaceSwapClient: FaceSwapClient = { generateFaceSwap }

/**
 * 在 main.ts 调用，预热 TCB 连接（init + 匿名登录）
 * VITE_API_MODE !== 'tcb' 时为空操作
 */
export function initTcb(): void {
  if ((import.meta.env.VITE_API_MODE as string) !== 'tcb') return
  if (!ENV_ID) {
    console.warn('[TCB] VITE_CLOUD_ENV_ID 未配置，请在 .env.local 中设置后重启开发服务器')
    return
  }
  // 预热登录，不阻塞 UI
  ensureLogin().catch((err) => console.error('[TCB] 预热匿名登录失败:', err))
}
