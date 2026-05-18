# XMeta Agent H5

Vue 3 + Vite + Tailwind CSS 移动端 H5，集成即梦（火山引擎 Doubao Seedream）AI 图片生成，实现：

- **AI 换脸**：用户上传照片 → 与选定的 XR 场景海报融合
- **皮克斯证书一体化生成**：单次 API 调用将用户照片转换为皮克斯 3D 风格头像，并自然融合进游戏荣誉证书
- 姿势引导 + 风格选择（A / B / C 三套场景）
- Pinia 跨页面状态同步 + `sessionStorage` 持久化

| 界面一：上传图片 | 界面二：生成结果 |
| :---: | :---: |
|<img width="430" height="920" alt="db52e60af09b66f072fcab67e62d7582" src="https://github.com/user-attachments/assets/d8d8d27e-fafd-40e5-9dc1-7c40d3f85c76" />| <img width="430" height="924" alt="e5bf89e63f0d7b533d3cd4f538844646" src="https://github.com/user-attachments/assets/fdcfa8aa-1e56-4e0e-b16f-e1d1d66cd11f" /> |

## 启动

```bash
npm install
npm run dev
```

## 环境变量

复制并创建 `.env.local`（不提交 Git），修改后重启 dev server 生效：

### 基础配置

```bash
VITE_API_MODE=cloud
VITE_CLOUD_PROVIDER=jimeng        # 主要 provider，可切换为 piapi / backend / invoker
VITE_APP_MODE=FULL                # FULL | TEASER（TEASER 模式隐藏证书导出）
VITE_POSE_GUIDE=1                 # 1=开启姿势引导，0=关闭
```

### 即梦（火山引擎 Ark / Doubao Seedream）换脸

```bash
VITE_JIMENG_BASE_URL=/jimeng-proxy           # 本地走 Vite 代理；生产走 vercel.json rewrite
VITE_JIMENG_API_KEY=your_api_key_here        # 火山引擎 ARK API Key（⚠️ 前端可见，建议限制额度）
VITE_JIMENG_MODEL=doubao-seedream-5-0-260128 # 模型 ID
VITE_JIMENG_SIZE=2K                          # 换脸图片尺寸（最小 3686400 像素，推荐 2K）
VITE_JIMENG_TIMEOUT_MS=120000                # 超时（毫秒），建议 ≥ 90000

# 换脸提示词（留空使用代码内默认值）
VITE_JIMENG_PROMPT=海报中已经用白色区域遮盖了需要替换的人物面部位置...
```

### 换脸模板图（各风格，必须是可公网访问的 URL）

```bash
# 风格兜底图（未选具体模板时使用）
VITE_TARGET_URL_A=https://your-cdn.com/style-a.png
VITE_TARGET_URL_B=https://your-cdn.com/style-b.png
VITE_TARGET_URL_C=https://your-cdn.com/style-c.png

# AI 换脸专用高清底图（A1-A3 / B1-B3 / C1-C3，留空自动降级到缩略图）
VITE_AI_TEMPLATE_A1=https://your-cdn.com/template-a1.png
# ... 其余同理
```

### 皮克斯证书一体化生成

```bash
# 证书模板图（⚠️ 必须托管在即梦服务器可稳定访问的 CDN，推荐阿里云 OSS / 腾讯 COS）
# 留空则降级为 Canvas 合成模式（不使用 AI 生成证书）
VITE_CERTIFICATE_TEMPLATE_URL=https://your-cdn.com/certificate-template.png

# 证书图片尺寸（独立于换脸尺寸，2K = 约 2048×2048，满足最低像素要求）
VITE_JIMENG_CERT_SIZE=2K

# 一体化提示词：单次 API 调用完成「皮克斯头像生成 + 融合证书」
# image[0]=证书模板  image[1]=用户照片（留空使用代码内默认值）
VITE_JIMENG_CERT_ONE_SHOT_PROMPT=参考第二张图中人物的面部特征，将其转换为皮克斯（Pixar）3D动画风格的卡通头像，并自然融合到第一张游戏证书模板的头像预留区域中。要求：1. 保留人物真实面部特征（脸型、五官、肤色），不改变性别和年龄感。2. 采用皮克斯电影级3D渲染质感，皮肤细腻，眼睛明亮有神。3. 头像完整显示在预留区域内，融合边缘自然无痕。4. 严格保持证书其余所有内容（背景、文字、徽章、装饰图案、整体配色）完全不变。
```

## 证书生成流程

```
用户照片 + 证书模板（VITE_CERTIFICATE_TEMPLATE_URL）
        │
        ▼  单次 API 调用（generateCertificateFromPhoto）
即梦 Doubao Seedream
        │
        ▼
含皮克斯 3D 头像的完整证书图片
```

**降级逻辑**：`VITE_CERTIFICATE_TEMPLATE_URL` 为空时，自动使用 HTML5 Canvas 将换脸结果合成到本地证书模板。

## Vercel 部署

`vercel.json` 已配置 `/jimeng-proxy` rewrite，无需额外代理服务。

**必须在 Vercel Dashboard → Settings → Environment Variables 中设置以下变量**（`.env.local` 不会上传）：

| 变量名 | 说明 |
|--------|------|
| `VITE_JIMENG_API_KEY` | 火山引擎 ARK API Key |
| `VITE_JIMENG_SIZE` | `2K`（不可使用 `1024x1024`，低于即梦最小像素限制） |
| `VITE_JIMENG_CERT_SIZE` | `2K` |
| `VITE_CERTIFICATE_TEMPLATE_URL` | 证书模板公网 URL（**不可使用 ImgBB**，即梦国内服务器无法稳定访问） |
| `VITE_JIMENG_CERT_ONE_SHOT_PROMPT` | 一体化证书生成提示词 |
| `VITE_TARGET_URL_A/B/C` | 三套风格兜底图 |
| `VITE_AI_TEMPLATE_*` | 换脸高清底图（可选） |

设置后在 Vercel 触发 **Redeploy** 即可生效，无需重新推送代码。

## 其他 Provider（可选）

### PiAPI

```bash
VITE_CLOUD_PROVIDER=piapi
VITE_PIAPI_BASE_URL=https://api.piapi.ai
VITE_PIAPI_API_KEY=your_key
```

### 后端代理模式

```bash
VITE_CLOUD_PROVIDER=backend
VITE_CLOUD_BASE_URL=https://api.example.com
VITE_CLOUD_ENDPOINT=/faceSwapAction
```

后端返回 `taskId` 时自动进入轮询；直接返回 `resultUrl` 时跳过轮询。

### 小程序 WebView 注入模式

```ts
window.__XmetaCloudInvoke = async ({ name, data }) => ({
  ok: true,
  data: { resultUrl: 'https://your-authorized-url' },
})
```

## 后端接入位置

- 换脸 + 证书生成：`src/services/cloudFaceSwapClient.ts`
- 状态管理：`src/stores/agentFlow.ts`
- 结果页流程：`src/pages/ResultStage.vue`

## 移动端兼容说明

- iOS Safari 推荐用户先点击"授权并启动相机"
- 页面底部使用 `env(safe-area-inset-bottom)` 防止按钮被系统栏遮挡
