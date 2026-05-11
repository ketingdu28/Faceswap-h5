<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    active?: boolean
  }>(),
  {
    active: false,
  },
)

const emit = defineEmits<{
  unlocked: []
}>()

const statusMap = [
  '初始化换脸引擎...',
  '检测面部关键点...',
  '融合风格与光影...',
  '渲染最终画面...',
]

const logPool = [
  'SYNCHRONIZING FEATURES...',
  'ANALYZING FACE LANDMARKS...',
  'MATCHING STYLE VECTOR...',
  'NORMALIZING LIGHT CHANNEL...',
  'MESH WARP PIPELINE READY...',
  'ENCRYPTING OUTPUT STREAM...',
  'CALIBRATING FINAL FRAME...',
]

const statusText = ref(statusMap[0])
const progress = ref(0)
const displayProgress = computed(() => Math.min(100, progress.value))
const visible = ref(props.active)
const isUnlocking = ref(false)
const logs = ref<Array<{ id: number; text: string }>>([])
const logId = ref(0)

const particleList = Array.from({ length: 8 }).map((_, idx) => {
  const left = 10 + Math.random() * 80
  const top = 10 + Math.random() * 80
  const size = 1.2 + Math.random() * 2.6
  const delay = `${Math.random() * 3.8}s`
  const duration = `${2.6 + Math.random() * 2.8}s`
  const driftX = `${(Math.random() * 22 - 11).toFixed(2)}px`
  const driftY = `${(Math.random() * 16 - 8).toFixed(2)}px`
  const glow = `${(0.35 + Math.random() * 0.5).toFixed(2)}`
  return {
    id: idx,
    style: {
      left: `${left}%`,
      top: `${top}%`,
      '--dot-size': `${size.toFixed(2)}px`,
      '--drift-x': driftX,
      '--drift-y': driftY,
      '--dot-glow': glow,
      '--float-delay': delay,
      '--float-duration': duration,
    },
  }
})

let progressTimer: number | undefined
let logTimer: number | undefined
let unlockTimer: number | undefined

function playUnlockBeep() {
  const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) return
  const ctx = new AudioCtx()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.value = 880
  gain.gain.value = 0.0001
  osc.connect(gain)
  gain.connect(ctx.destination)
  const t = ctx.currentTime
  gain.gain.exponentialRampToValueAtTime(0.03, t + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
  osc.start(t)
  osc.stop(t + 0.24)
  window.setTimeout(() => ctx.close(), 320)
}

function stopTimers() {
  window.clearInterval(progressTimer)
  window.clearInterval(logTimer)
  window.clearTimeout(unlockTimer)
}

function pushLog() {
  const next = logPool[logId.value % logPool.length]
  logs.value.push({ id: logId.value, text: next })
  logId.value += 1
  if (logs.value.length > 6) logs.value.shift()
}

function startProgress() {
  stopTimers()
  progress.value = 4
  statusText.value = statusMap[0]
  isUnlocking.value = false
  logs.value = []
  logId.value = 0

  pushLog()
  logTimer = window.setInterval(() => {
    pushLog()
  }, 600)

  progressTimer = window.setInterval(() => {
    const step = Math.floor(Math.random() * 3) + 1
    progress.value = Math.min(99, progress.value + step)
    const idx = Math.min(statusMap.length - 1, Math.floor(progress.value / 25))
    statusText.value = statusMap[idx]
    if (progress.value >= 99) {
      window.clearInterval(progressTimer)
    }
  }, 240)
}

watch(
  () => props.active,
  (active) => {
    if (active) {
      visible.value = true
      startProgress()
    } else {
      stopTimers()
      if (!visible.value) return
      progress.value = 99
      isUnlocking.value = true
      playUnlockBeep()
      unlockTimer = window.setTimeout(() => {
        progress.value = 100
        visible.value = false
        isUnlocking.value = false
        emit('unlocked')
      }, 800)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  stopTimers()
})
</script>

<template>
  <Transition name="swap-loader-fade">
    <section
      v-if="visible"
      class="swap-loader"
      :class="{ 'is-unlocking': isUnlocking }"
    >
      <img class="loader-bg-image" src="/magic-bg.png" alt="" loading="lazy" decoding="async" />
      <div class="loader-bg-mask" />
      <div class="swap-loader-nebula" />
      <div class="swap-loader-grid" />
      <div class="swap-loader-panel">
        <div class="panel-head">
          <p class="title rgb-split">AI 换脸处理中</p>
          <p class="subtitle">FACE-SWAP ENGINE</p>
        </div>

        <div class="particle-core">
          <span v-for="item in particleList" :key="item.id" class="core-dot" :style="item.style" />
          <div class="core-ring ring-outer" />
          <div class="core-ring ring-scale" />
          <div class="core-ring ring-inner" />
          <div class="core-glow" />
          <div class="nebula-pulse" />
          <p class="percent rgb-split">{{ displayProgress }}%</p>
        </div>

        <div class="status-wrap">
          <p class="status">{{ statusText }}</p>
        </div>
        <div class="track">
          <div class="fill" :style="{ width: `${displayProgress}%` }">
            <span class="flow-light" />
          </div>
          <span class="energy-dot" :style="{ left: `calc(${displayProgress}% - 6px)` }" />
        </div>
        <div class="log-stream">
          <p v-for="line in logs" :key="line.id" class="log-line">&gt; {{ line.text }}</p>
        </div>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.swap-loader {
  position: fixed;
  inset: 0;
  z-index: 140;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background-color: #0d1f3a;
}

.loader-bg-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.loader-bg-mask {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at top, rgba(255, 218, 170, 0.06) 0%, rgba(255, 218, 170, 0) 30%),
    linear-gradient(135deg, rgba(9, 24, 48, 0.3) 0%, rgba(15, 52, 94, 0.24) 100%);
}

.swap-loader-nebula {
  position: absolute;
  inset: -20%;
  background: radial-gradient(circle at 50% 45%, rgba(68, 217, 255, 0.22) 0%, rgba(201, 114, 255, 0.08) 40%, transparent 65%);
  /* filter:blur 已移除，改用 opacity 动画，不触发 GPU 层重建 */
  animation: nebulaDrift 12s ease-in-out infinite alternate;
}

/* Firefly dot background — no vertical lines */
.swap-loader-grid {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle 3px at 12% 22%, rgba(68, 217, 255, 0.46), transparent 100%),
    radial-gradient(circle 2px at 35% 60%, rgba(201, 114, 255, 0.18), transparent 100%),
    radial-gradient(circle 4px at 58% 18%, rgba(68, 217, 255, 0.34), transparent 100%),
    radial-gradient(circle 3px at 78% 45%, rgba(255, 138, 214, 0.14), transparent 100%),
    radial-gradient(circle 2px at 90% 78%, rgba(255, 231, 160, 0.28), transparent 100%);
  /* filter:blur 移除，静态 CSS 点不需要模糊层 */
  opacity: 0.82;
}

.swap-loader-panel {
  position: relative;
  z-index: 2;
  width: min(90vw, 420px);
  border: none;
  background: linear-gradient(180deg, rgba(120, 177, 255, 0.16), rgba(88, 131, 228, 0.1));
  backdrop-filter: blur(8px) saturate(105%);
  box-shadow:
    0 8px 26px rgba(8, 18, 48, 0.34),
    0 0 18px rgba(68, 217, 255, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.14);
  padding: 18px 16px 14px;
  text-shadow: 0 0 12px rgba(255, 249, 240, 0.42);
  border-radius: 30px;
}

.swap-loader-panel::after {
  content: none;
}

.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.title {
  margin: 0;
  color: #fffaf2;
  font-size: 18px;
  text-shadow: 0 0 16px rgba(255, 249, 240, 0.78), 0 0 28px rgba(68, 217, 255, 0.28);
}

.rgb-split {
  text-shadow:
    0.8px 0 rgba(201, 114, 255, 0.22),
    -0.8px 0 rgba(68, 217, 255, 0.32),
    0 0 10px rgba(255, 249, 240, 0.6);
}

.subtitle {
  margin: 0;
  color: rgba(255, 245, 220, 0.72);
  font-size: 11px;
  letter-spacing: 0.08em;
}

.particle-core {
  position: relative;
  margin: 16px auto 0;
  width: min(76vw, 300px);
  height: 180px;
  overflow: hidden;
}

.core-ring {
  position: absolute;
  left: 50%;
  top: 50%;
  border-radius: 999px;
  transform: translate(-50%, -50%);
  will-change: transform;
}

/* Outer ring: aurora cyan */
.ring-outer {
  width: 146px;
  height: 146px;
  border: 0.5px solid rgba(104, 231, 255, 0.88);
  box-shadow: 0 0 18px rgba(68, 217, 255, 0.52), inset 0 0 12px rgba(210, 242, 255, 0.12);
  animation: spinSlow 4.2s linear infinite;
}

/* Scale ring: dimmer cyan */
.ring-scale {
  width: 168px;
  height: 168px;
  border: 0.5px dashed rgba(68, 217, 255, 0.44);
  opacity: 0.8;
  animation: spinScale 7.2s linear infinite reverse;
}

/* Inner ring: phantom purple */
.ring-inner {
  width: 100px;
  height: 100px;
  border: 0.5px dashed rgba(160, 120, 255, 0.44);
  box-shadow: 0 0 10px rgba(160, 120, 255, 0.2);
  animation: spinFast 2.5s linear infinite reverse;
}

/* Core glow: cyan + purple nebula */
.core-glow {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 70px;
  height: 70px;
  border-radius: 999px;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, rgba(220, 247, 255, 0.72) 0%, rgba(68, 217, 255, 0.54) 42%, rgba(160, 120, 255, 0.24) 70%, transparent 84%);
  animation: pulseGlow 1.8s ease-in-out infinite;
}

/* Purple nebula diffusion behind percent number */
.nebula-pulse {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, rgba(160, 120, 255, 0.18) 0%, rgba(104, 231, 255, 0.08) 55%, transparent 70%);
  animation: nebulaExpand 3s ease-in-out infinite;
  pointer-events: none;
}

.percent {
  position: absolute;
  left: 50%;
  top: 50%;
  margin: 0;
  z-index: 2;
  transform: translate(-50%, -50%);
  color: #effbff;
  font-size: 26px;
  font-weight: 700;
  text-shadow:
    0 0 12px rgba(210, 242, 255, 0.82),
    0 0 24px rgba(68, 217, 255, 0.3);
}

.core-dot {
  position: absolute;
  width: var(--dot-size);
  height: var(--dot-size);
  border-radius: 999px;
  background: radial-gradient(circle, rgba(255, 247, 229, 0.95) 0%, rgba(68, 217, 255, 0.52) 42%, rgba(201, 114, 255, 0.22) 70%, transparent 100%);
  box-shadow: 0 0 10px rgba(68, 217, 255, calc(var(--dot-glow) * 0.8));
  will-change: transform, opacity;
  /* coreDotTwinkle 含 filter:blur，已移除；只保留位移动画 */
  animation: coreDotFloat ease-in-out infinite alternate;
  animation-duration: var(--float-duration, 3s);
  animation-delay: var(--float-delay, 0s);
}

.status-wrap {
  position: relative;
  margin: 8px 0 0;
}

.status {
  margin: 0;
  color: #dff7ff;
  font-size: 14px;
  text-align: center;
  text-shadow: 0 0 10px rgba(210, 242, 255, 0.48);
}

.track {
  position: relative;
  margin-top: 12px;
  width: 100%;
  height: 8px;
  border: 1px solid rgba(132, 222, 255, 0.26);
  background: linear-gradient(135deg, rgba(20, 45, 88, 0.78), rgba(47, 76, 143, 0.72));
  border-radius: 999px;
}

.fill {
  position: relative;
  overflow: hidden;
  height: 100%;
  background: linear-gradient(90deg, #44d9ff, #8b7dff);
  box-shadow: 0 0 14px rgba(68, 217, 255, 0.58);
  transition: width 0.2s linear;
}

.flow-light {
  position: absolute;
  inset: 0;
  background: linear-gradient(110deg, transparent 0%, rgba(255, 255, 255, 0.42) 48%, transparent 100%);
  animation: barFlow 1.25s linear infinite;
}

.energy-dot {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  transform: translateY(-50%);
  background: #dff7ff;
  box-shadow:
    0 0 10px rgba(104, 231, 255, 0.9),
    0 0 20px rgba(139, 125, 255, 0.36);
  transition: left 0.2s linear;
}

.log-stream {
  margin-top: 10px;
  height: 86px;
  border: none;
  background: transparent;
  padding: 8px;
  overflow: hidden;
}

.log-line {
  margin: 0;
  color: rgba(244, 248, 255, 0.9);
  font-family: 'Courier New', Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  letter-spacing: 0.04em;
  animation: logPop 180ms ease-out;
}

.is-unlocking {
  animation: glitchShake 0.18s linear 4;
}

@keyframes coreDotFloat {
  0% {
    transform: translate3d(0, 0, 0) scale(0.9);
    opacity: 0.55;
  }
  100% {
    transform: translate3d(var(--drift-x), var(--drift-y), 0) scale(1.15);
    opacity: 0.95;
  }
}

@keyframes coreDotTwinkle {
  0%,
  100% {
    opacity: 0.45;
    filter: blur(0.2px);
  }
  50% {
    opacity: 1;
    filter: blur(0);
  }
}

@keyframes spinSlow {
  from {
    transform: translate(-50%, -50%) rotate(0deg);
  }
  to {
    transform: translate(-50%, -50%) rotate(360deg);
  }
}

@keyframes spinFast {
  from {
    transform: translate(-50%, -50%) rotate(0deg);
  }
  to {
    transform: translate(-50%, -50%) rotate(-360deg);
  }
}

@keyframes spinScale {
  from {
    transform: translate(-50%, -50%) rotate(0deg);
  }
  to {
    transform: translate(-50%, -50%) rotate(-360deg);
  }
}

@keyframes barFlow {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(120%);
  }
}

@keyframes logPop {
  from {
    transform: translateY(6px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes pulseGlow {
  0%,
  100% {
    opacity: 0.76;
    transform: translate(-50%, -50%) scale(0.92);
  }
  50% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.1);
  }
}

@keyframes glitchShake {
  0% {
    transform: translate(0, 0);
  }
  25% {
    transform: translate(-1px, 1px);
  }
  50% {
    transform: translate(1px, -1px);
  }
  75% {
    transform: translate(-1px, 0);
  }
  100% {
    transform: translate(0, 0);
  }
}

@keyframes nebulaExpand {
  0%,
  100% {
    transform: translate(-50%, -50%) scale(0.8);
    opacity: 0.4;
  }
  50% {
    transform: translate(-50%, -50%) scale(1.45);
    opacity: 1;
  }
}

@keyframes nebulaDrift {
  0% {
    transform: translate3d(-2%, 0, 0) scale(0.98);
  }
  100% {
    transform: translate3d(2%, -2%, 0) scale(1.08);
  }
}

.swap-loader-fade-enter-active,
.swap-loader-fade-leave-active {
  transition: opacity 180ms ease;
}

.swap-loader-fade-enter-from,
.swap-loader-fade-leave-to {
  opacity: 0;
}

</style>
