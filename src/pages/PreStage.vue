<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Camera, ImagePlus, Play, Loader } from 'lucide-vue-next'
import StyleCard from '../components/StyleCard.vue'
import { useAgentFlowStore, type StyleOption } from '../stores/agentFlow'

const router = useRouter()
const flow = useAgentFlowStore()
const zh = {
  tactical: '\u6218\u672f\u914d\u7f6e',
  teaserOnly: '\u5f53\u524d\u4e3a\u6f14\u793a\u6a21\u5f0f\uff1a\u4ec5\u4fdd\u7559\u4e0a\u4f20\u3001\u6362\u8138\u4e0e\u7ed3\u679c\u6d4f\u89c8\u80fd\u529b\u3002',
  uploadArea: '\u4e0a\u4f20\u533a\u57df',
  tapUpload: '\u70b9\u51fb\u4e0a\u4f20\u7279\u5de5\u5e95\u7247',
  supportCameraAlbum: '\u652f\u6301\u6444\u50cf\u5934\u6216\u76f8\u518c',
  authAndOpenCamera: '\u6388\u6743\u5e76\u542f\u52a8\u76f8\u673a',
  fromAlbum: '\u4ece\u76f8\u518c\u4e0a\u4f20',
  styleMatrix: '\u98ce\u683c\u77e9\u9635',
  uploadingCloud: '\u6b63\u5728\u4e0a\u4f20\u81f3\u4e91\u7aef\u5b58\u50a8...',
  uploading: '\u4e0a\u4f20\u4e2d...',
  startSwap: '\u542f\u52a8 AI \u6362\u8138\u5408\u6210',
  styleA: '\u8d5b\u535a\u98ce',
  styleB: '\u5e9f\u571f\u98ce',
  styleC: '\u6781\u7b80\u98ce',
  styleADesc: '\u9ad8\u5bf9\u6bd4\u9713\u8679\u8f6e\u5ed3\u4e0e\u4fe1\u606f\u5c42',
  styleBDesc: '\u9897\u7c92\u8d28\u611f\u4e0e\u65e7\u5de5\u4e1a\u8272\u6e29',
  styleCDesc: '\u4f4e\u566a\u70b9\u54d1\u5149\u4e0e\u9ad8\u7ea7\u7070\u5c42\u6b21',
  iosHint: 'iOS Safari \u53ef\u80fd\u4e8c\u6b21\u5f39\u7a97\u6388\u6743\uff0c\u82e5\u5931\u8d25\u8bf7\u6539\u7528\"\u4ece\u76f8\u518c\u4e0a\u4f20\"\u3002',
  cameraHint: '\u8bf7\u6388\u6743\u6444\u50cf\u5934\u540e\u7ee7\u7eed\uff0c\u5931\u8d25\u65f6\u53ef\u6539\u7528\u76f8\u518c\u4e0a\u4f20\u3002',
}
const fileInputRef = ref<HTMLInputElement | null>(null)
const captureMode = ref<'user' | undefined>(undefined)
const permissionHint = ref('')
const isUploading = ref(false)
const uploadError = ref('')

const styles: Array<{ id: StyleOption; title: string; description: string }> = [
  { id: 'A', title: zh.styleA, description: zh.styleADesc },
  { id: 'B', title: zh.styleB, description: zh.styleBDesc },
  { id: 'C', title: zh.styleC, description: zh.styleCDesc },
]

const teaserMode = (import.meta.env.VITE_APP_MODE ?? 'FULL') === 'TEASER'
const isTcbMode = (import.meta.env.VITE_API_MODE as string) === 'tcb'
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)

const uploadPreview = computed(() => flow.sourceImageUrl)
const canStart = computed(() => flow.canGenerate && !flow.isGenerating && !isUploading.value)
const decorImageUrl = `${import.meta.env.BASE_URL}assets/prestage-tech-lines-wide.png`
const particles = Array.from({ length: 58 }, (_, groupIndex) => {
  const left = 4 + Math.random() * 92
  const delay = Math.random() * 8
  const duration = 6 + Math.random() * 6
  const length = 66 + Math.random() * 140
  const opacity = 0.2 + Math.random() * 0.17
  const width = 0.9 + Math.random() * 2.4
  const twinkle = 0.7 + Math.random() * 1.3
  const hasPair = Math.random() > 0.22

  const primary = {
    id: `${groupIndex}-a`,
    style: {
      '--left': `${left}%`,
      '--delay': `${delay}s`,
      '--duration': `${duration}s`,
      '--length': `${length}px`,
      '--opacity': `${opacity.toFixed(3)}`,
      '--width': `${width.toFixed(2)}px`,
      '--twinkle': `${twinkle.toFixed(2)}s`,
    },
  }

  const companion = hasPair
    ? {
        id: `${groupIndex}-b`,
        style: {
          '--left': `${(left + (Math.random() * 3.2 - 1.6)).toFixed(2)}%`,
          '--delay': `${(delay + Math.random() * 0.9).toFixed(2)}s`,
          '--duration': `${(duration + (Math.random() * 1.2 - 0.6)).toFixed(2)}s`,
          '--length': `${(length * (0.72 + Math.random() * 0.4)).toFixed(2)}px`,
          '--opacity': `${(opacity * (0.75 + Math.random() * 0.35)).toFixed(3)}`,
          '--width': `${(width * (0.55 + Math.random() * 0.85)).toFixed(2)}px`,
          '--twinkle': `${(twinkle + Math.random() * 0.6).toFixed(2)}s`,
        },
      }
    : null

  return companion ? [primary, companion] : [primary]
}).flat()

function openPicker(mode?: 'user') {
  captureMode.value = mode
  uploadError.value = ''
  if (mode) {
    permissionHint.value = isIOS ? zh.iosHint : zh.cameraHint
  } else {
    permissionHint.value = ''
  }
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
    fileInputRef.value.click()
  }
}

function onFileSelected(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  uploadError.value = ''
  const reader = new FileReader()
  reader.onload = () => {
    const base64 = typeof reader.result === 'string' ? reader.result : ''
    if (!base64) return
    flow.setSourceImage({ url: base64, base64 })
  }
  reader.readAsDataURL(file)
}

async function startGeneration() {
  if (!canStart.value) return
  uploadError.value = ''

  // H5 ???????????????? COS?
  if (isTcbMode) flow.setCloudFileID('')

  flow.resetResult()
  await router.push('/result-stage')
}
</script>

<template>
  <section class="pre-stage-bg safe-bottom relative isolate mx-auto min-h-screen w-full max-w-[420px] overflow-hidden px-3 py-4">
    <div class="pointer-events-none absolute inset-0 z-0">
      <div class="spectral-ghost-layer">
        <span class="spectral-ghost ghost-a"></span>
        <span class="spectral-ghost ghost-b"></span>
        <span class="spectral-ghost ghost-c"></span>
      </div>
      <div class="particle-stream-layer">
        <span v-for="particle in particles" :key="particle.id" class="particle-stream-item" :style="particle.style"></span>
      </div>
      <div class="prestage-bottom-decor">
        <img class="prestage-bottom-decor-image" :src="decorImageUrl" alt="" />
      </div>
    </div>

    <div class="relative z-10 flex min-h-[calc(100vh-2rem)] flex-col gap-4">
      <header class="flex items-center justify-between">
      <h1 class="font-mono text-sm uppercase tracking-[0.28em] text-accentGreen">PreStage // {{ zh.tactical }}</h1>
      <span class="text-[10px] text-slate-400">{{ teaserMode ? 'TEASER' : isTcbMode ? 'TCB' : 'MOCK' }}</span>
      </header>
      <p v-if="teaserMode" class="glass-panel rounded-xl px-3 py-2 text-xs text-slate-300">
        {{ zh.teaserOnly }}
      </p>

      <!-- upload area -->
      <div class="glass-panel relative overflow-hidden rounded-3xl p-3">
      <div class="mb-2 flex items-center justify-between">
        <p class="font-mono text-xs text-slate-300">{{ zh.uploadArea }}</p>
        <span class="text-[10px] text-slate-500">45% viewport</span>
      </div>
      <button
        type="button"
        class="relative flex h-[45vh] w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed border-accentGreen/35 bg-black/50"
        @click="openPicker()"
      >
        <img v-if="uploadPreview" :src="uploadPreview" alt="preview" class="h-full w-full object-cover opacity-95" />

        <!-- ????????? + ???? -->
        <div v-if="uploadPreview" class="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div class="h-20 w-20 rounded-full border border-accentGreen/55"></div>
          <div class="absolute h-0.5 w-12 bg-accentGreen/45"></div>
          <div class="absolute h-12 w-0.5 bg-accentGreen/45"></div>
        </div>

        <!-- ?????? -->
        <div v-else class="flex flex-col items-center gap-2 text-slate-200">
          <ImagePlus class="h-8 w-8 text-accentGreen" />
          <p class="font-semibold">{{ zh.tapUpload }}</p>
          <p class="text-xs text-slate-400">{{ zh.supportCameraAlbum }}</p>
        </div>
      </button>

      <p v-if="permissionHint" class="mt-2 text-xs text-accentGreen/80">{{ permissionHint }}</p>

      <div class="mt-3 flex gap-2">
        <button
          type="button"
          class="glass-panel flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs"
          :disabled="teaserMode"
          @click="openPicker('user')"
        >
          <Camera class="h-4 w-4 text-accentGreen" />
          {{ zh.authAndOpenCamera }}
        </button>
        <button
          type="button"
          class="glass-panel flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs"
          @click="openPicker()"
        >
          <ImagePlus class="h-4 w-4 text-accentGreen" />
          {{ zh.fromAlbum }}
        </button>
      </div>
      <input
        ref="fileInputRef"
        class="hidden"
        type="file"
        accept="image/*"
        :capture="captureMode"
        @change="onFileSelected"
      />
      </div>

      <!-- ???? -->
      <div class="glass-panel rounded-3xl p-3">
      <p class="mb-2 font-mono text-xs text-slate-300">{{ zh.styleMatrix }}</p>
      <div class="grid grid-cols-3 gap-2">
        <StyleCard
          v-for="style in styles"
          :key="style.id"
          :style-id="style.id"
          :title="style.title"
          :description="style.description"
          :active="flow.selectedStyle === style.id"
          @click="flow.setStyle(style.id)"
        />
      </div>
      </div>

      <!-- ???? -->
      <div class="glass-panel mt-auto rounded-3xl p-3">
      <!-- ???????? -->
      <p v-if="isUploading" class="mb-2 flex items-center gap-2 font-mono text-xs text-accentGreen/80">
        <Loader class="h-3 w-3 animate-spin" />
        {{ zh.uploadingCloud }}
      </p>
      <p v-if="uploadError" class="mb-2 text-xs text-red-400">{{ uploadError }}</p>

      <button
        type="button"
        class="glass-panel w-full rounded-2xl border border-accentGreen/45 bg-white/[0.03] px-4 py-5 font-mono text-base tracking-[0.2em] text-accentGreen shadow-[0_0_22px_rgba(89,255,182,0.22)] transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!canStart"
        @click="startGeneration"
      >
        <span class="inline-flex items-center gap-2">
          <Loader v-if="isUploading" class="h-4 w-4 animate-spin" />
          <Play v-else class="h-4 w-4" />
          {{ isUploading ? zh.uploading : zh.startSwap }}
        </span>
      </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pre-stage-bg {
  background:
    linear-gradient(135deg, rgba(5, 12, 29, 0.45) 0%, rgba(10, 30, 60, 0.42) 100%),
    url('../assets/starfield-bg.png') center top / auto no-repeat;
}

.prestage-bottom-decor {
  position: absolute;
  left: 0;
  right: 0;
  bottom: clamp(15vh, 20vh, 22vh);
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: flex-end;
  opacity: 0.56;
  z-index: 1;
  transform-origin: 50% 100%;
  filter: drop-shadow(0 0 24px rgba(122, 255, 210, 0.24));
  -webkit-mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0) 0, rgba(0, 0, 0, 0.9) 16%, rgba(0, 0, 0, 0.9) 84%, rgba(0, 0, 0, 0) 100%);
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0) 0, rgba(0, 0, 0, 0.9) 16%, rgba(0, 0, 0, 0.9) 84%, rgba(0, 0, 0, 0) 100%);
  animation: driftBottomDecor 60s ease-in-out infinite alternate;
}

.prestage-bottom-decor-image {
  width: 100%;
  height: auto;
  max-height: 40vh;
  object-fit: contain;
  object-position: center bottom;
}

.prestage-bottom-decor::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, rgba(8, 15, 20, 0.34), rgba(8, 15, 20, 0) 18%, rgba(8, 15, 20, 0) 82%, rgba(8, 15, 20, 0.34));
  filter: blur(7px);
  pointer-events: none;
}


.particle-stream-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  z-index: 2;
}

.particle-stream-item {
  position: absolute;
  top: -190px;
  left: var(--left);
  width: var(--width);
  height: var(--length);
  background: repeating-linear-gradient(
    to bottom,
    rgba(178, 255, 226, calc(var(--opacity) * 0.2)) 0 2px,
    rgba(178, 255, 226, var(--opacity)) 2px 18px,
    rgba(178, 255, 226, calc(var(--opacity) * 0.24)) 18px 22px
  );
  border-radius: 1px;
  box-shadow: 0 0 14px rgba(162, 255, 224, 0.48);
  filter: none;
  animation: particleFall var(--duration) linear infinite, particleTwinkle var(--twinkle) ease-in-out infinite;
  animation-delay: var(--delay), calc(var(--delay) * -0.6);
}

.spectral-ghost-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  z-index: 1;
}

.spectral-ghost {
  position: absolute;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(126, 255, 218, 0.16), rgba(126, 255, 218, 0));
  filter: blur(18px);
  mix-blend-mode: screen;
  animation: ghostPulse 18s ease-in-out infinite;
}

.ghost-a {
  left: -8%;
  top: 18%;
  width: 46vw;
  height: 26vh;
}

.ghost-b {
  right: -12%;
  top: 44%;
  width: 52vw;
  height: 30vh;
  animation-delay: -6s;
}

.ghost-c {
  left: 14%;
  bottom: 8%;
  width: 42vw;
  height: 20vh;
  animation-delay: -12s;
}

@keyframes driftBottomDecor {
  0% {
    transform: translate3d(-1.2%, 0, 0) scale(1.02) rotate(-0.35deg);
  }
  100% {
    transform: translate3d(1.2%, -0.8%, 0) scale(1.05) rotate(0.35deg);
  }
}

@keyframes particleFall {
  0% {
    transform: translate3d(0, -8vh, 0);
    opacity: 0;
  }
  12% {
    opacity: 1;
  }
  88% {
    opacity: 1;
  }
  100% {
    transform: translate3d(0, 112vh, 0);
    opacity: 0;
  }
}

@keyframes ghostPulse {
  0%,
  100% {
    opacity: 0.24;
    transform: translate3d(0, 0, 0) scale(0.94);
  }
  50% {
    opacity: 0.42;
    transform: translate3d(0, -10px, 0) scale(1.08);
  }
}

@keyframes particleTwinkle {
  0%,
  100% {
    opacity: calc(var(--opacity) * 0.5);
  }
  50% {
    opacity: calc(var(--opacity) * 1.75);
  }
}

</style>
