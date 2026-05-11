/**
 * 将 base64 DataURL 上传至 ImgBB，返回公网 HTTPS URL
 *
 * 浏览器端通过 FormData + fetch 实现 multipart 上传，
 * 与小程序端的 uni.uploadFile 逻辑等价。
 *
 * API Key 统一从 VITE_IMGBB_KEY 环境变量读取；
 * 若未配置，回退至共享开发 Key（仅限联调，生产请替换）。
 */

const IMGBB_KEY: string =
  (import.meta.env.VITE_IMGBB_KEY as string | undefined)?.trim() ||
  'dbd70f652007b3a0daeebb0b93b36819'

const IMGBB_URL = 'https://api.imgbb.com/1/upload'

interface ImgBBResponse {
  success: boolean
  data?: { url: string; display_url: string }
  error?: { message: string; code: number }
}

/**
 * @param dataUrl  FileReader.readAsDataURL() 返回的 base64 DataURL
 *                 或纯 base64 字符串（无 "data:..." 前缀）
 * @returns        ImgBB 返回的公网图片 URL
 */
export async function uploadToImgBB(dataUrl: string): Promise<string> {
  if (!dataUrl) throw new Error('[uploadToImgBB] dataUrl 为空')

  // 兼容带前缀 (data:image/jpeg;base64,XXX) 和纯 base64
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
  if (!base64) throw new Error('[uploadToImgBB] 无效的 DataURL，无法提取 base64 内容')

  const form = new FormData()
  form.append('image', base64)

  const response = await fetch(`${IMGBB_URL}?key=${IMGBB_KEY}`, {
    method: 'POST',
    body: form,
  })

  if (!response.ok) {
    throw new Error(`[uploadToImgBB] HTTP ${response.status} ${response.statusText}`)
  }

  const payload = (await response.json()) as ImgBBResponse

  if (!payload.success || !payload.data?.url) {
    const msg = payload.error?.message ?? JSON.stringify(payload)
    throw new Error(`[uploadToImgBB] 上传失败：${msg}`)
  }

  return payload.data.url
}
