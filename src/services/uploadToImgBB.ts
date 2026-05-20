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
 * 上传前将图片压缩到指定最大边长，避免手机大图导致上传超时。
 * 若图片已在限制内，原样返回；非 data: URL（如外部 URL）原样返回。
 */
async function compressDataUrl(
  dataUrl: string,
  maxDimension = 1280,
  quality = 0.85,
): Promise<string> {
  if (!dataUrl.startsWith('data:')) return dataUrl
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      let { naturalWidth: w, naturalHeight: h } = img
      if (w <= maxDimension && h <= maxDimension) {
        resolve(dataUrl)
        return
      }
      if (w > h) {
        h = Math.round((h * maxDimension) / w)
        w = maxDimension
      } else {
        w = Math.round((w * maxDimension) / h)
        h = maxDimension
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => resolve(dataUrl) // 压缩失败时原样上传
    img.src = dataUrl
  })
}

/**
 * @param dataUrl  FileReader.readAsDataURL() 返回的 base64 DataURL
 *                 或纯 base64 字符串（无 "data:..." 前缀）
 * @returns        ImgBB 返回的公网图片 URL
 */
export async function uploadToImgBB(dataUrl: string): Promise<string> {
  if (!dataUrl) throw new Error('[uploadToImgBB] dataUrl 为空')

  // 压缩：手机原图可达 8MB+，压缩到 1280px 后换脸 AI 仍可精准识别人脸
  const compressed = await compressDataUrl(dataUrl)

  // 兼容带前缀 (data:image/jpeg;base64,XXX) 和纯 base64
  const base64 = compressed.includes(',') ? compressed.split(',')[1] : compressed
  if (!base64) throw new Error('[uploadToImgBB] 无效的 DataURL，无法提取 base64 内容')

  const form = new FormData()
  form.append('image', base64)

  // 30s 超时，避免手机弱网环境下请求无限挂起
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)

  let response: Response
  try {
    response = await fetch(`${IMGBB_URL}?key=${IMGBB_KEY}`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`[uploadToImgBB] 上传请求失败（${msg}）`)
  } finally {
    clearTimeout(timer)
  }

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
