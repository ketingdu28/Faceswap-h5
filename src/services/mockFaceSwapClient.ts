import type { FaceSwapClient, GenerateFaceSwapInput, GenerateFaceSwapOutput } from './faceSwapClient'
import { generateAgentCode, generateTimestamp } from './agentMeta'

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function generateFaceSwap(input: GenerateFaceSwapInput): Promise<GenerateFaceSwapOutput> {
  const steps = [
    { progress: 12, stage: 'decrypt',    detail: 'Decrypting facial grid...' },
    { progress: 28, stage: 'align',      detail: 'Aligning depth landmarks...' },
    { progress: 52, stage: 'synthesize', detail: 'Synthesizing neural layers...' },
    { progress: 76, stage: 'grade',      detail: 'Stabilizing cinematic profile...' },
    { progress: 92, stage: 'finalize',   detail: 'Finalizing mission signature...' },
  ]

  for (const step of steps) {
    await delay(700 + Math.random() * 450)
    input.onProgress?.(step)
  }

  await delay(900)
  input.onProgress?.({ progress: 100, stage: 'done', detail: 'Mission artifact ready.' })

  return {
    resultUrl: input.imageUrl,
    meta: {
      codename: `AGENT_${input.style}`,
      code: generateAgentCode(),       // AGENT-XXXX
      joinedDate: generateTimestamp(), // YYYY-MM-DD HH:mm:ss
    },
  }
}

export const mockFaceSwapClient: FaceSwapClient = {
  generateFaceSwap,
}
