<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import certificateTemplate from '../assets/certificate-template.webp'

const props = defineProps<{
  codename: string
  code: string
  joinedDate: string
  imageUrl: string
}>()

// 将外部图片转为 base64 data URL，解决 html2canvas 跨域截图空白问题
const localImageUrl = ref('')

async function toDataUrl(url: string): Promise<string> {
  if (!url) return ''
  // data: / blob: URL 已在本地，无需再 fetch（fetch data: 加 mode:'cors' 在部分浏览器会抛错）
  if (url.startsWith('data:') || url.startsWith('blob:')) return url
  try {
    const res = await fetch(url, { mode: 'cors' })
    const blob = await res.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return url // 转换失败时降级使用原始 URL
  }
}

onMounted(async () => {
  localImageUrl.value = await toDataUrl(props.imageUrl)
})

watch(() => props.imageUrl, async (url) => {
  localImageUrl.value = await toDataUrl(url)
})
</script>

<template>
  <section
    class="glass-panel relative w-full p-0"
    data-certificate
  >
    <div class="certificate-stage overflow-visible">
      <!-- AI 换脸图：不加 crossorigin，避免 CDN 无 CORS 头时图片完全无法显示；canvas 导出由 ResultStage 独立处理 -->
      <img :src="localImageUrl || imageUrl" alt="ai portrait" class="certificate-bg-image" />
      <!-- 证书模板：叠在图片上方 -->
      <img
        :src="certificateTemplate"
        alt="certificate template"
        class="certificate-template-layer"
      />
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

/* 高度由模板图片原始比例撑开，不再用固定 aspect-ratio */
.certificate-stage {
  position: relative;
  width: 100%;
}

/*
 * 换脸照片定位参数说明（对应下方 canvas 导出坐标，修改时需同步 ResultStage.vue）：
 *
 *  top      → 照片距证书顶部的百分比，值越大照片越靠下
 *  left     → 照片距证书左边的百分比，0 表示紧贴左边
 *  width    → 照片宽度占证书宽度的百分比（对齐拱形宽度）
 *  height   → 照片高度占证书高度的百分比（对齐拱形高度）
 *
 *  object-position → "水平 垂直" 控制照片裁切锚点
 *    "center top"  = 水平居中 + 顶部对齐（适合全身照，脸在上方）
 *    "center 20%"  = 水平居中 + 向下偏移 20%（脸在照片中段时使用）
 *    "50% 10%"     = 等同于 "center 10%"
 */
.certificate-bg-image {
  position: absolute;
  top: 25%;      /* ← 调大：照片整体下移；调小：上移 */
  left: 25%;       /* ← 调大：照片右移（如 "3%"） */
  width: 50%;    /* ← 调大：照片变宽，覆盖更多左侧区域 */
  height: 50%;   /* ← 调大：照片变高，向下延伸 */
  object-fit: cover;
  object-position: center top; /* ← 改 "center 20%" 可让脸部下移 */
  z-index: 1;
}

/* 证书模板：normal flow，height: auto 按原始比例撑开容器 */
.certificate-template-layer {
  display: block;
  position: relative;
  width: 100%;
  height: auto;
  z-index: 2;
}
</style>
