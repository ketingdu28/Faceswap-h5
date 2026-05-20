<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import textOverlay from '../assets/certificate-template.png'

const props = defineProps<{
  imageUrl: string
}>()

// 将外部 URL 转为 data: URL，规避 Volces CDN 无 CORS 头导致的图片加载失败
// data: URL 不需要 crossorigin 属性，可直接用于展示和 Canvas 导出
const localImageUrl = ref('')

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function resolveUrl(url: string): Promise<string> {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url
  // ① 直连 CORS fetch
  try {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`, {
      mode: 'cors', cache: 'no-store',
    })
    if (res.ok) return blobToDataUrl(await res.blob())
  } catch { /* 继续尝试代理 */ }
  // ② 代理 fetch（服务端加 CORS 头）
  try {
    const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`)
    if (res.ok) return blobToDataUrl(await res.blob())
  } catch { /* 忽略 */ }
  // ③ 兜底直接使用原 URL（无 crossorigin，展示正常但 Canvas 导出可能失败）
  return url
}

async function load(url: string) {
  localImageUrl.value = await resolveUrl(url)
}

onMounted(() => load(props.imageUrl))
watch(() => props.imageUrl, load)
</script>

<template>
  <section class="glass-panel relative w-full p-0 overflow-hidden rounded-[30px]" data-certificate>
    <div class="cert-stage">
      <!-- 底层：AI 皮克斯肖像（已转为 data: URL，无 CORS 问题） -->
      <img :src="localImageUrl || imageUrl" alt="ai portrait" class="cert-layer" />
      <!-- 顶层：纯文字透明遮罩 -->
      <img :src="textOverlay" alt="" class="cert-layer cert-layer--overlay" aria-hidden="true" />
    </div>
  </section>
</template>

<style scoped>
.glass-panel {
  border: 0.5px solid rgba(214, 232, 255, 0.22);
  border-top: 0.5px solid rgba(255, 245, 220, 0.2);
  background: linear-gradient(180deg, rgba(120, 177, 255, 0.12), rgba(88, 131, 228, 0.08));
  box-shadow:
    0 10px 30px rgba(8, 18, 48, 0.4),
    0 0 30px rgba(68, 217, 255, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.28);
  backdrop-filter: blur(12px);
}

/* Grid 叠放：两层占同一个格子 */
.cert-stage {
  display: grid;
  width: 100%;
}

/* 底层和顶层完全相同的缩放规则：width 100% + height auto
   两张原图尺寸相同，按各自比例等比缩放后天然对齐，无需拉伸 */
.cert-layer,
.cert-layer--overlay {
  grid-area: 1 / 1;
  display: block;
  width: 100%;
  height: auto;
}
</style>
