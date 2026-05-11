import { mockFaceSwapClient } from './mockFaceSwapClient'
import { cloudFaceSwapClient } from './cloudFaceSwapClient'
import { tcbFaceSwapClient } from '../api/faceSwap'
import type { StyleOption } from '../stores/agentFlow'

/**
 * style → 换脸模板公网图片 URL
 * 与小程序端的 PORTAL_TARGET_URLS (p1/p2/p3) 对应，
 * 可通过 VITE_TARGET_URL_A/B/C 环境变量覆盖。
 */
export const STYLE_TARGET_URLS: Record<StyleOption, string> = {
  A:
    (import.meta.env.VITE_TARGET_URL_A as string | undefined)?.trim() ||
    'https://i.ibb.co/S7KF4FND/generated-1776064061424.jpg',
  B:
    (import.meta.env.VITE_TARGET_URL_B as string | undefined)?.trim() ||
    'https://i.ibb.co/S7KF4FND/generated-1776064061424.jpg',
  C:
    (import.meta.env.VITE_TARGET_URL_C as string | undefined)?.trim() ||
    'https://i.ibb.co/S7KF4FND/generated-1776064061424.jpg',
}

export interface GenerateFaceSwapInput {
  /** base64 DataURL（由 FileReader.readAsDataURL 产生） */
  imageUrl: string
  style: StyleOption
  /**
   * 换脸目标模板的公网 URL；不传时自动从 STYLE_TARGET_URLS[style] 取。
   * 与小程序端的 targetImageUrl 语义相同。
   */
  targetImageUrl?: string
  /**
   * TCB 云存储 fileID（格式 cloud://envId.xxx/temp_uploads/xxx.jpg）
   * PreStage 上传成功后写入 store，ResultStage 读取后传入，
   * tcbFaceSwapClient 接收到后跳过二次上传。
   */
  cloudFileID?: string | null
  onProgress?: (event: {
    stage: string
    progress: number
    detail?: string
  }) => void
}

export interface GenerateFaceSwapOutput {
  resultUrl: string
  meta: {
    codename: string
    code: string       // 格式 AGENT-XXXX
    joinedDate: string // 格式 YYYY-MM-DD HH:mm:ss
  }
}

export interface FaceSwapClient {
  generateFaceSwap(input: GenerateFaceSwapInput): Promise<GenerateFaceSwapOutput>
}

/**
 * VITE_API_MODE 控制全局客户端选择：
 *   mock  → 本地模拟，无需后端（默认）
 *   tcb   → 腾讯云开发 Web SDK（需配置 VITE_CLOUD_ENV_ID）
 *   cloud → HTTP/Invoker/PiAPI 直连（需配置 VITE_CLOUD_PROVIDER 等）
 */
const mode = (import.meta.env.VITE_API_MODE as string | undefined) ?? 'mock'

export const faceSwapClient: FaceSwapClient =
  mode === 'tcb'   ? tcbFaceSwapClient   :
  mode === 'cloud' ? cloudFaceSwapClient :
  mockFaceSwapClient
