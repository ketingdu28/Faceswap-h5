<script setup lang="ts">
import { Monitor, Sparkles, Shield } from 'lucide-vue-next'
import type { StyleOption } from '../stores/agentFlow'
import styleAImage from '../assets/style-a.png'
import styleBImage from '../assets/style-b.png'
import styleCImage from '../assets/style-c.png'

const props = defineProps<{
  styleId: StyleOption
  title: string
  description: string
  active: boolean
}>()

const iconMap = {
  A: Monitor,
  B: Shield,
  C: Sparkles,
}

const previewImageMap = {
  A: styleAImage,
  B: styleBImage,
  C: styleCImage,
}
</script>

<template>
  <button
    type="button"
    class="style-card relative flex w-full flex-col gap-2 rounded-[30px] p-3 text-left transition"
    :class="active ? 'style-card--active' : 'style-card--idle'"
  >
    <div v-if="active" class="portal-selection-ring" aria-hidden="true"></div>
    <div class="h-14 w-full overflow-hidden rounded-[15px] border-0 bg-[rgba(255,255,255,0.04)]">
      <img
        :src="previewImageMap[props.styleId]"
        :alt="title"
        class="h-full w-full object-cover object-center"
      />
    </div>
    <div class="flex items-center gap-2">
      <component :is="iconMap[props.styleId]" class="h-4 w-4 text-[#d9c6ff]" />
      <span class="font-mono text-xs font-semibold text-[#efe2ff]">时空门 {{ styleId }}</span>
    </div>
    <p class="font-mono text-xs font-semibold text-white">{{ title }}</p>
    <p class="text-[10px] text-[#f3e7ff]/78">{{ description }}</p>
  </button>
</template>

<style scoped>
.style-card {
  isolation: isolate;
  border: none;
  background: linear-gradient(180deg, rgba(120, 177, 255, 0.18), rgba(88, 131, 228, 0.12));
  box-shadow:
    0 24px 40px -28px rgba(0, 0, 50, 0.42),
    0 0 24px rgba(68, 217, 255, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.24);
  backdrop-filter: blur(45px) saturate(140%);
  border: 0.5px solid rgba(214, 232, 255, 0.22);
  border-top: 0.5px solid rgba(255, 245, 220, 0.2);
  border-radius: 30px;
  transition:
    transform 420ms cubic-bezier(0.22, 1.25, 0.3, 1),
    box-shadow 420ms cubic-bezier(0.22, 1.25, 0.3, 1),
    border-color 420ms cubic-bezier(0.22, 1.25, 0.3, 1);
}

.style-card::before,
.style-card::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.style-card::before {
  content: none;
}

.style-card::after {
  left: 14%;
  right: 14%;
  bottom: -18px;
  height: 34px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(154, 107, 197, 0.18), transparent 70%);
  filter: blur(12px);
}

.style-card--idle:hover {
  transform: translateY(-2px) scale(1.025);
  box-shadow:
    0 26px 42px -28px rgba(0, 0, 50, 0.48),
    0 0 32px rgba(68, 217, 255, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

.style-card--active {
  border: 1px solid rgba(182, 122, 255, 0.46);
  box-shadow:
    0 0 26px rgba(182, 122, 255, 0.24),
    0 24px 44px -26px rgba(255, 214, 150, 0.2);
}

.style-card--active::after {
  content: '';
  position: absolute;
  inset: -10px;
  border-radius: inherit;
  background: radial-gradient(circle at 50% 60%, rgba(154, 107, 197, 0.5), rgba(255, 214, 150, 0.18), transparent 72%);
  filter: blur(12px);
  z-index: -1;
  pointer-events: none;
  animation: cyanRipple 2.4s ease-out infinite;
}

.style-card img {
  filter: brightness(1.16) saturate(1.22) contrast(1.1) drop-shadow(0 0 10px rgba(255, 238, 195, 0.12));
}

.style-card:active {
  transform: scale(0.97);
}

.portal-selection-ring {
  position: absolute;
  inset: -7px;
  border-radius: 36px;
  border: 1px solid rgba(168, 85, 247, 0.9);
  box-shadow:
    0 0 10px rgba(168, 85, 247, 0.72),
    0 0 24px rgba(168, 85, 247, 0.48),
    inset 0 0 10px rgba(182, 122, 255, 0.45);
  background: radial-gradient(circle at 50% 50%, rgba(168, 85, 247, 0.1), rgba(168, 85, 247, 0.02) 58%, transparent 82%);
  animation: portalRingPulse 1.6s ease-in-out infinite;
  pointer-events: none;
  z-index: 0;
}

.style-card > *:not(.portal-selection-ring) {
  position: relative;
  z-index: 1;
}

@keyframes cyanRipple {
  0%,
  100% {
    opacity: 0.3;
    transform: scale(0.98);
  }
  60% {
    opacity: 1;
    transform: scale(1.08);
  }
}

@keyframes portalRingPulse {
  0%,
  100% {
    opacity: 0.64;
    transform: scale(0.985);
  }
  50% {
    opacity: 1;
    transform: scale(1.02);
  }
}
</style>
