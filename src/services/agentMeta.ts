/**
 * 特工证书元数据生成工具
 *
 * generateAgentCode  → 格式 AGENT-XXXX（4 位随机数字）
 * generateTimestamp  → 格式 YYYY-MM-DD HH:mm:ss（当前本地时间）
 */

export function generateAgentCode(): string {
  const n = String(Math.floor(1000 + Math.random() * 9000))
  return `AGENT-${n}`
}

export function generateTimestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}
