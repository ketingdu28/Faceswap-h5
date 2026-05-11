<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    active?: boolean
  }>(),
  {
    active: true,
  },
)

const emit = defineEmits<{
  done: []
}>()

const logPool = [
  '> INITIALIZING SYSTEM...',
  '> CONNECTING TO ENCRYPTED NODE...',
  '> BIOMETRIC SCANNER READY...',
  '> LOADING TACTICAL SUBROUTINES...',
  '> DECRYPTING FACE MAPPING MATRIX...',
  '> SYNCHRONIZING VISUAL PIPELINE...',
  '> CALIBRATING NEURAL SIGNAL...',
  '> FINAL HANDSHAKE CONFIRMED...',
]

type LayerType = 'far' | 'mid' | 'near'
type LogLine = { id: number; text: string }

function buildLayerParticles(layer: LayerType, count: number, speedMin: number, speedMax: number) {
  return Array.from({ length: count }, (_, index) => {
    const left = Math.random() * 100
    const top = Math.random() * 100
    const duration = speedMin + Math.random() * (speedMax - speedMin)
    const delay = Math.random() * duration
    const width = layer === 'near' ? 1.2 + Math.random() * 0.75 : layer === 'mid' ? 0.85 + Math.random() * 0.55 : 0.55 + Math.random() * 0.4
    const height = layer === 'near' ? 36 + Math.random() * 24 : layer === 'mid' ? 28 + Math.random() * 20 : 22 + Math.random() * 18
    const opacity = layer === 'near' ? 0.72 + Math.random() * 0.24 : layer === 'mid' ? 0.48 + Math.random() * 0.24 : 0.22 + Math.random() * 0.18
    const driftA = (Math.random() * 28 - 14).toFixed(2)
    const driftB = (Math.random() * 36 - 18).toFixed(2)
    const driftC = (Math.random() * 24 - 12).toFixed(2)
    const driftY = (Math.random() * 38 - 19).toFixed(2)

    return {
      id: `${layer}-${index}`,
      style: {
        '--left': `${left.toFixed(2)}%`,
        '--top': `${top.toFixed(2)}%`,
        '--duration': `${duration.toFixed(2)}s`,
        '--delay': `${delay.toFixed(2)}s`,
        '--line-width': `${width.toFixed(2)}px`,
        '--line-height': `${height.toFixed(2)}vh`,
        '--opacity': `${opacity.toFixed(2)}`,
        '--drift-a': `${driftA}px`,
        '--drift-b': `${driftB}px`,
        '--drift-c': `${driftC}px`,
        '--drift-y': `${driftY}px`,
      },
    }
  })
}

const particleLayers = [
  { key: 'far', className: 'loader-stream-layer--far', particles: buildLayerParticles('far', 7, 8, 11) },
  { key: 'mid', className: 'loader-stream-layer--mid', particles: buildLayerParticles('mid', 9, 6, 9) },
  { key: 'near', className: 'loader-stream-layer--near', particles: buildLayerParticles('near', 7, 4.5, 7) },
]

const visible = ref(props.active)
const exploding = ref(false)
const logs = ref<LogLine[]>([])
const progress = ref(0)
const displayProgress = ref(0)
const logId = ref(0)

let logTimer: number | undefined
let progressTimer: number | undefined
let jitterTimer: number | undefined
let finishTimer: number | undefined

const shouldRender = computed(() => visible.value || exploding.value)

function cleanupTimers() {
  window.clearInterval(logTimer)
  window.clearInterval(progressTimer)
  window.clearInterval(jitterTimer)
  window.clearTimeout(finishTimer)
}

function pushLogLine() {
  const next = logPool[logId.value % logPool.length]
  logs.value.push({ id: logId.value, text: next })
  logId.value += 1
  if (logs.value.length > 6) {
    logs.value.shift()
  }
}

function startLoading() {
  cleanupTimers()
  visible.value = true
  exploding.value = false
  logs.value = []
  logId.value = 0
  progress.value = 0
  displayProgress.value = 0

  pushLogLine()
  logTimer = window.setInterval(() => {
    pushLogLine()
  }, 260)

  progressTimer = window.setInterval(() => {
    const step = Math.floor(Math.random() * 6) + 2
    progress.value = Math.min(100, progress.value + step)
    if (progress.value >= 100) {
      window.clearInterval(progressTimer)
      window.clearInterval(logTimer)
      logs.value.push({ id: logId.value, text: '> SYSTEM READY. LAUNCHING INTERFACE...' })
      logId.value += 1
      if (logs.value.length > 6) {
        logs.value.shift()
      }
      triggerExplode()
    }
  }, 180)

  jitterTimer = window.setInterval(() => {
    if (progress.value >= 100) {
      displayProgress.value = 100
      return
    }
    const jitter = Math.floor(Math.random() * 5) - 2
    displayProgress.value = Math.max(0, Math.min(99, progress.value + jitter))
  }, 70)
}

function triggerExplode() {
  displayProgress.value = 100
  exploding.value = false
  finishTimer = window.setTimeout(() => {
    visible.value = false
    emit('done')
  }, 420)
}

watch(
  () => props.active,
  (active) => {
    if (active) {
      startLoading()
    } else {
      cleanupTimers()
      visible.value = false
      exploding.value = false
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  cleanupTimers()
})
</script>

<template>
  <Transition name="loader-fade">
    <section
      v-if="shouldRender"
      class="terminal-loader"
      :class="{ 'is-exploding': exploding }"
    >
      <img class="loader-bg-image" src="/magic-bg.png" alt="" loading="lazy" decoding="async" />
      <div class="loader-bg-mask" />
      <div
        v-for="layer in particleLayers"
        :key="layer.key"
        class="loader-stream-layer"
        :class="layer.className"
        aria-hidden="true"
      >
        <span v-for="particle in layer.particles" :key="particle.id" class="loader-stream-particle" :style="particle.style">
          <i class="loader-stream-trail" />
        </span>
      </div>
      <div class="loader-scanline" aria-hidden="true" />
      <div class="loader-grid" aria-hidden="true" />

      <div class="terminal-panel">
        <div class="terminal-lines">
          <p v-for="line in logs" :key="line.id" class="terminal-line">{{ line.text }}</p>
        </div>
        <div class="terminal-progress">
          <span>LOADING</span>
          <span class="progress-value">{{ displayProgress }}%</span>
        </div>
      </div>
      <template v-if="exploding">
        <div class="beam-split beam-top" />
        <div class="beam-split beam-bottom" />
        <div class="beam-core" />
      </template>
    </section>
  </Transition>
</template>

<style scoped>
.terminal-loader {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #0d1f3a;
  overflow: hidden;
}

.loader-bg-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  animation: loaderBgFadeIn 4s ease-out forwards;
}

.loader-bg-mask {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at top, rgba(255, 218, 170, 0.06) 0%, rgba(255, 218, 170, 0) 30%),
    linear-gradient(135deg, rgba(9, 24, 48, 0.3) 0%, rgba(15, 52, 94, 0.24) 100%);
}

.loader-stream-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.loader-stream-layer--far {
  z-index: 1;
}

.loader-stream-layer--mid {
  z-index: 2;
}

.loader-stream-layer--near {
  z-index: 3;
}

.loader-stream-particle {
  position: absolute;
  left: var(--left);
  top: var(--top);
  animation: loaderFloat var(--duration) ease-in-out infinite alternate;
  animation-delay: calc(var(--delay) * -1);
  will-change: transform, opacity;
}

.loader-stream-trail {
  display: block;
  width: calc(var(--line-width) * 9);
  height: calc(var(--line-width) * 9);
  opacity: var(--opacity);
  border-radius: 999px;
  background: radial-gradient(circle at center, rgba(255, 252, 242, 1) 0%, rgba(68, 217, 255, 0.68) 40%, rgba(201, 114, 255, 0.24) 70%, transparent 84%);
  animation: loaderSway calc(var(--duration) * 0.82) ease-in-out infinite;
}

.loader-stream-layer--far .loader-stream-trail {
  filter: blur(2px);
  box-shadow:
    0 0 16px rgba(255, 244, 223, 0.52),
    0 0 24px rgba(68, 217, 255, 0.16);
}

.loader-stream-layer--mid .loader-stream-trail {
  filter: blur(2px);
  box-shadow:
    0 0 20px rgba(68, 217, 255, 0.62),
    0 0 28px rgba(201, 114, 255, 0.18);
}

.loader-stream-layer--near .loader-stream-trail {
  box-shadow:
    0 0 22px rgba(68, 217, 255, 0.8),
    0 0 36px rgba(201, 114, 255, 0.3);
}

.loader-scanline {
  display: none;
}

.loader-grid {
  display: none;
}

.terminal-panel {
  position: relative;
  z-index: 20;
  width: min(88vw, 540px);
  border: none;
  background: linear-gradient(180deg, rgba(120, 177, 255, 0.16), rgba(88, 131, 228, 0.1));
  backdrop-filter: blur(12px);
  border: 0.5px solid rgba(214, 232, 255, 0.22);
  border-top: 0.5px solid rgba(255, 245, 220, 0.2);
  box-shadow:
    0 10px 30px rgba(8, 18, 48, 0.4),
    0 0 28px rgba(68, 217, 255, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.26);
  padding: 20px 18px;
  text-shadow: 0 0 12px rgba(255, 249, 240, 0.52);
  border-radius: 30px;
}

.terminal-panel::after {
  content: none;
}

.terminal-lines {
  min-height: 160px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 6px;
  overflow: hidden;
  font-family: 'Courier New', Consolas, monospace;
}

.terminal-line {
  margin: 0;
  color: rgba(244, 248, 255, 0.98);
  font-size: 13px;
  letter-spacing: 0.06em;
  animation: linePop 180ms ease-out;
}

.terminal-progress {
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid rgba(255, 245, 220, 0.24);
  padding-top: 12px;
  font-family: 'Courier New', Consolas, monospace;
  color: rgba(244, 248, 255, 0.98);
  font-size: 13px;
}

.progress-value {
  min-width: 54px;
  text-align: right;
  text-shadow:
    0 0 10px rgba(255, 245, 220, 0.6),
    0 0 18px rgba(68, 217, 255, 0.2);
}

.beam-split,
.beam-core {
  position: absolute;
  left: 0;
  width: 100%;
  pointer-events: none;
}

.beam-split {
  height: 50%;
  background: rgba(17, 35, 71, 0.94);
}

.beam-top {
  top: 0;
}

.beam-bottom {
  bottom: 0;
}

.beam-core {
  top: 50%;
  height: 2px;
  transform: translateY(-50%);
  background: linear-gradient(90deg, transparent, rgba(255, 231, 160, 0.95), rgba(201, 114, 255, 0.85), transparent);
  opacity: 0;
}

.is-exploding .beam-core {
  opacity: 1;
  animation: coreFlash 900ms ease-out forwards;
}

.is-exploding .beam-top {
  animation: splitTop 900ms cubic-bezier(0.22, 0.61, 0.35, 1) forwards;
}

.is-exploding .beam-bottom {
  animation: splitBottom 900ms cubic-bezier(0.22, 0.61, 0.35, 1) forwards;
}

@keyframes linePop {
  from {
    transform: translateY(7px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes loaderFloat {
  0% {
    transform: translate3d(-28px, -26px, 0) scale(0.9);
    opacity: 0.45;
  }
  50% {
    transform: translate3d(28px, var(--drift-y), 0) scale(1.12);
    opacity: 1;
  }
  100% {
    transform: translate3d(-24px, 30px, 0) scale(1);
    opacity: 0.62;
  }
}

@keyframes loaderSway {
  0% {
    transform: translateX(0);
  }
  25% {
    transform: translateX(var(--drift-a));
  }
  50% {
    transform: translateX(var(--drift-b));
  }
  75% {
    transform: translateX(var(--drift-c));
  }
  100% {
    transform: translateX(0);
  }
}

@keyframes loaderScanlineSweep {
  0% {
    background-position: 0 -40vh;
  }
  100% {
    background-position: 0 100vh;
  }
}

@keyframes loaderGridDrift {
  0% {
    transform: translateX(0);
  }
  50% {
    transform: translateX(2px);
  }
  100% {
    transform: translateX(0);
  }
}

@keyframes coreFlash {
  0% {
    opacity: 0;
    box-shadow: 0 0 0 rgba(0, 242, 255, 0);
  }
  24% {
    opacity: 1;
    box-shadow: 0 0 18px rgba(0, 242, 255, 0.85);
  }
  100% {
    opacity: 0;
    box-shadow: 0 0 40px rgba(0, 242, 255, 0);
  }
}

@keyframes splitTop {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(-100%);
  }
}

@keyframes splitBottom {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(100%);
  }
}

@keyframes loaderBgFadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.loader-fade-enter-active {
  transition: opacity 320ms ease;
}

.loader-fade-leave-active {
  transition:
    opacity 720ms cubic-bezier(0.22, 0.61, 0.36, 1),
    transform 720ms cubic-bezier(0.22, 0.61, 0.36, 1),
    filter 720ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.loader-fade-enter-from {
  opacity: 0;
}

.loader-fade-leave-from {
  opacity: 1;
  transform: scale(1);
  filter: blur(0);
}

.loader-fade-leave-to {
  opacity: 0;
  transform: scale(1.018);
  filter: blur(7px);
}

</style>
