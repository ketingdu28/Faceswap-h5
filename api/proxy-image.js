/**
 * Vercel Serverless Function: /api/proxy-image?url=<encoded-url>
 *
 * 服务端代理外部图片，绕过浏览器 CORS 限制。
 * canvas.toDataURL() 需要图片以 CORS 方式加载，而即梦/PiAPI CDN 通常不携带
 * Access-Control-Allow-Origin 头，导致导出失败。此函数在服务端拉取图片后
 * 加上 CORS 头再返回给浏览器。
 */
export default async function handler(req, res) {
  // 只允许 GET
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { url } = req.query
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Missing url parameter' })
    return
  }

  // 只代理 HTTPS 图片 URL，拒绝内网/文件等协议
  if (!url.startsWith('https://')) {
    res.status(400).json({ error: 'Only HTTPS URLs are supported' })
    return
  }

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 XMeta-Proxy/1.0' },
    })

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `Upstream error: ${upstream.status}` })
      return
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg'
    const buffer = await upstream.arrayBuffer()

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600')
    res.setHeader('Content-Length', buffer.byteLength)
    res.status(200).send(Buffer.from(buffer))
  } catch (err) {
    res.status(500).json({
      error: `Proxy fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}
