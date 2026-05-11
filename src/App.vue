<script setup lang="ts">
type LayerType = 'far' | 'mid' | 'near'

const enableGlobalBackdrop = (import.meta.env.VITE_APP_GLOBAL_BACKDROP ?? '0') === '1'

function buildLayerParticles(layer: LayerType, count: number, speedMin: number, speedMax: number) {
  return Array.from({ length: count }, (_, index) => {
    const left = Math.random() * 100
    const duration = speedMin + Math.random() * (speedMax - speedMin)
    const delay = Math.random() * duration
    const width = layer === 'near' ? 1.7 + Math.random() * 1.2 : layer === 'mid' ? 1.1 + Math.random() * 0.9 : 0.8 + Math.random() * 0.7
    const height = layer === 'near' ? 30 + Math.random() * 24 : layer === 'mid' ? 24 + Math.random() * 20 : 20 + Math.random() * 18
    const opacity = layer === 'near' ? 0.6 + Math.random() * 0.32 : layer === 'mid' ? 0.35 + Math.random() * 0.24 : 0.16 + Math.random() * 0.16
    const driftA = (Math.random() * 30 - 15).toFixed(2)
    const driftB = (Math.random() * 36 - 18).toFixed(2)
    const driftC = (Math.random() * 24 - 12).toFixed(2)

    return {
      id: `${layer}-${index}`,
      style: {
        '--left': `${left.toFixed(2)}%`,
        '--duration': `${duration.toFixed(2)}s`,
        '--delay': `${delay.toFixed(2)}s`,
        '--line-width': `${width.toFixed(2)}px`,
        '--line-height': `${height.toFixed(2)}vh`,
        '--opacity': `${opacity.toFixed(2)}`,
        '--drift-a': `${driftA}px`,
        '--drift-b': `${driftB}px`,
        '--drift-c': `${driftC}px`,
      },
    }
  })
}

const particleLayers = [
  { key: 'far', className: 'data-stream-layer--far', particles: buildLayerParticles('far', 22, 24, 42) },
  { key: 'mid', className: 'data-stream-layer--mid', particles: buildLayerParticles('mid', 28, 16, 28) },
  { key: 'near', className: 'data-stream-layer--near', particles: buildLayerParticles('near', 16, 10, 18) },
]
</script>

<template>
  <div class="app-shell min-h-screen">
    <template v-if="enableGlobalBackdrop">
      <div
        v-for="layer in particleLayers"
        :key="layer.key"
        class="data-stream-layer"
        :class="layer.className"
        aria-hidden="true"
      >
        <span v-for="particle in layer.particles" :key="particle.id" class="data-stream-particle" :style="particle.style">
          <i class="data-stream-trail" />
        </span>
      </div>
      <div class="crt-scanlines" aria-hidden="true" />
      <div class="crt-noise" aria-hidden="true" />
      <div class="agent-noise" aria-hidden="true" />
    </template>
    <main class="relative z-10 min-h-screen pb-[env(safe-area-inset-bottom)]">
      <RouterView />
    </main>
  </div>
</template>
