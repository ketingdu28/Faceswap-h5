import '@mediapipe/pose/pose.js'

type PoseCtor = new (...args: any[]) => any

const PoseFromGlobal = (globalThis as any)?.Pose as PoseCtor | undefined

// pose-detection 的 ESM 构建会从 '@mediapipe/pose' 取命名导出 Pose。
// mediapipe/pose 实际是 IIFE 脚本并把 Pose 挂到全局，因此这里做一次显式导出以便打包器通过静态导出检查。
export const Pose = PoseFromGlobal as unknown as PoseCtor
export default Pose

