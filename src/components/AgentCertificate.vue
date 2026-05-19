<script setup lang="ts">
import textOverlay from '../assets/certificate-template.png'

defineProps<{
  imageUrl: string
}>()
</script>

<template>
  <section class="glass-panel relative w-full p-0" data-certificate>
    <div class="cert-stage">
      <!-- Layer 1 (底层): AI 生成的皮克斯肖像 + 背景 -->
      <img :src="imageUrl" alt="ai portrait" class="cert-layer" />
      <!-- Layer 2 (顶层): 纯文字透明遮罩，与底图严格等尺寸叠加 -->
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

.cert-stage {
  position: relative;
  width: 100%;
}

/* 底层：normal flow 撑开容器高度 */
.cert-layer {
  display: block;
  width: 100%;
  height: auto;
}

/* 顶层：绝对定位覆盖底层，宽高 100% 严格对齐 */
.cert-layer--overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
}
</style>
