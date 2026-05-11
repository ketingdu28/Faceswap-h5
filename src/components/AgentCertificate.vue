<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import certificateTemplate from '../assets/certificate-template.png'

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
      <!-- AI 换脸图：crossOrigin 确保首次加载即携带 CORS 头，避免后续 canvas 导出时缓存冲突 -->
      <img :src="localImageUrl || imageUrl" crossorigin="anonymous" alt="ai portrait" class="certificate-bg-image" />
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
  backdrop-filter: blur(45px) saturate(140%);
}

/* 高度由模板图片原始比例撑开，不再用固定 aspect-ratio */
.certificate-stage {
  position: relative;
  width: 100%;
}

/*
 * 换脸照片：绝对定位铺满背景。
 * 证书模板透明的拱形区域会透出下方的照片。
 *
 * 调整照片在拱形区域内的显示效果：
 *   object-position  ← "left top" / "center top" / "20% 10%" 等，
 *                       控制照片对准哪个部位（人脸居中建议用 "center top"）
 *   object-fit       ← cover 填满整个背景区域
 */
.certificate-bg-image {
  position: absolute;
  top: 29%;      /* ← 向下移动：数值越大越往下 */
  left: 0;
  width: 55%;
  height: 55%;
  object-fit: cover;         /* ← 填满背景，可改为 contain */
  object-position: center top; /* ← 调整照片对准位置 */
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
