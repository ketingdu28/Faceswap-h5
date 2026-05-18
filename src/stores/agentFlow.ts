import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { generateAgentCode, generateTimestamp } from '../services/agentMeta'

const STORAGE_KEY = 'xmeta-agent-flow'
const STORAGE_VERSION = 5   // 升至 v5：新增 aiCertificateUrl 持久化

export type StyleOption = 'A' | 'B' | 'C'

interface CertificateMeta {
  codename: string
  code: string       // 格式 AGENT-XXXX
  joinedDate: string // 格式 YYYY-MM-DD HH:mm:ss
}

interface PersistedState {
  sourceImageUrl: string | null
  sourceImageBase64: string | null
  selectedStyle: StyleOption
  resultImageUrl: string | null
  certificateMeta: CertificateMeta
  cloudFileID: string | null
  cartoonAvatarUrl: string | null
  aiCertificateUrl: string | null
}

interface VersionedPayload {
  version: number
  data: PersistedState
}

function getDefaultMeta(): CertificateMeta {
  return {
    codename: 'AGENT_X',
    code: generateAgentCode(),        // AGENT-XXXX 随机
    joinedDate: generateTimestamp(),  // YYYY-MM-DD HH:mm:ss
  }
}

function loadPersistedState(): PersistedState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedState | VersionedPayload

    // v3+ payload
    if ('version' in parsed && 'data' in parsed) {
      const d = parsed.data
      if (d.sourceImageUrl?.startsWith('blob:') && d.sourceImageBase64) {
        d.sourceImageUrl = d.sourceImageBase64
      }
      return d
    }

    // v1/v2 legacy
    if ('sourceImageUrl' in parsed) {
      const legacy = parsed as PersistedState
      if (legacy.sourceImageUrl?.startsWith('blob:') && legacy.sourceImageBase64) {
        legacy.sourceImageUrl = legacy.sourceImageBase64
      }
      return legacy
    }
    return null
  } catch {
    return null
  }
}

export const useAgentFlowStore = defineStore('agentFlow', () => {
  const persisted = loadPersistedState()

  const sourceImageUrl = ref<string | null>(persisted?.sourceImageUrl ?? null)
  const sourceImageBase64 = ref<string | null>(persisted?.sourceImageBase64 ?? null)
  const selectedStyle = ref<StyleOption>(persisted?.selectedStyle ?? 'A')
  const resultImageUrl = ref<string | null>(persisted?.resultImageUrl ?? null)
  const isGenerating = ref(false)
  const certificateMeta = ref<CertificateMeta>(persisted?.certificateMeta ?? getDefaultMeta())
  /** 云存储 fileID，TCB 模式上传后写入，供 ResultStage 传给云函数 */
  const cloudFileID = ref<string | null>(persisted?.cloudFileID ?? null)
  /** 用户选定的模板底图公网 URL（覆盖 STYLE_TARGET_URLS 默认值） */
  const templateTargetUrl = ref<string | null>(null)
  /** 皮克斯卡通头像 URL（独立于换脸结果，用于证书展示，持久化到 sessionStorage） */
  const cartoonAvatarUrl = ref<string | null>(persisted?.cartoonAvatarUrl ?? null)
  /** 即梦 AI 生成的完整游戏证书图片 URL（持久化到 sessionStorage） */
  const aiCertificateUrl = ref<string | null>(persisted?.aiCertificateUrl ?? null)

  const canGenerate = computed(() => Boolean(sourceImageUrl.value && selectedStyle.value))

  function setSourceImage(payload: { url: string; base64: string }) {
    sourceImageUrl.value = payload.url
    sourceImageBase64.value = payload.base64
    resultImageUrl.value = null
    cloudFileID.value = null   // 新图片时清除旧 fileID
  }

  function setStyle(style: StyleOption) {
    selectedStyle.value = style
  }

  function setResultImage(url: string) {
    resultImageUrl.value = url
  }

  function setGenerating(status: boolean) {
    isGenerating.value = status
  }

  function setCloudFileID(id: string) {
    cloudFileID.value = id
  }

  function setTemplateTargetUrl(url: string | null) {
    templateTargetUrl.value = url
  }

  function setCartoonAvatar(url: string | null) {
    cartoonAvatarUrl.value = url
  }

  function setAiCertificate(url: string | null) {
    aiCertificateUrl.value = url
  }

  function resetSourceImage() {
    sourceImageUrl.value = null
    sourceImageBase64.value = null
    cloudFileID.value = null
    resultImageUrl.value = null
    templateTargetUrl.value = null
    cartoonAvatarUrl.value = null
    aiCertificateUrl.value = null
    isGenerating.value = false
  }

  function resetResult() {
    resultImageUrl.value = null
    cartoonAvatarUrl.value = null
    aiCertificateUrl.value = null
    isGenerating.value = false
  }

  watch(
    [sourceImageUrl, sourceImageBase64, selectedStyle, resultImageUrl, certificateMeta, cloudFileID, cartoonAvatarUrl, aiCertificateUrl],
    () => {
      if (typeof window === 'undefined') return
      const payload: PersistedState = {
        sourceImageUrl: sourceImageUrl.value,
        sourceImageBase64: sourceImageBase64.value,
        selectedStyle: selectedStyle.value,
        resultImageUrl: resultImageUrl.value,
        certificateMeta: certificateMeta.value,
        cloudFileID: cloudFileID.value,
        cartoonAvatarUrl: cartoonAvatarUrl.value,
        aiCertificateUrl: aiCertificateUrl.value,
      }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, data: payload }))
    },
    { deep: true },
  )

  return {
    sourceImageUrl,
    sourceImageBase64,
    selectedStyle,
    resultImageUrl,
    isGenerating,
    certificateMeta,
    cloudFileID,
    canGenerate,
    setSourceImage,
    setStyle,
    setResultImage,
    setGenerating,
    setCloudFileID,
    templateTargetUrl,
    setTemplateTargetUrl,
    cartoonAvatarUrl,
    setCartoonAvatar,
    aiCertificateUrl,
    setAiCertificate,
    resetSourceImage,
    resetResult,
  }
})
