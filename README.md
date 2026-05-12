# XMeta Agent H5

独立 Vue 3 + Vite + Tailwind 的移动端 H5 AI 换脸工具示例，包含：

- `PreStage`：上传、风格选择、启动换脸
- `ResultStage`：生成态日志滚动、结果展示、证书导出（`html2canvas`）
- Pinia 跨页面状态同步 + `sessionStorage` 持久化
- 可替换云函数调用封装（`mock` / `cloud`）

| 界面一：上传图片 | 界面二：生成结果 |
| :---: | :---: |
| <img width="350" src="https://github.com/user-attachments/assets/65c5a7fb-5fcf-4093-a6c1-93bdc725147a" /> | <img width="350" src="https://github.com/user-attachments/assets/a81e1952-a65f-4096-b28c-a841f6da56a8" /> |
## 启动

```bash
npm install
npm run dev
```

## 环境变量

复制 `.env.example` 为 `.env` 并按需调整：

```bash
VITE_API_MODE=mock   # mock | cloud
VITE_APP_MODE=FULL   # FULL | TEASER
VITE_CLOUD_TIMEOUT_MS=20000
VITE_CLOUD_RETRY_COUNT=2
VITE_CLOUD_PROVIDER=invoker   # invoker | piapi
VITE_PIAPI_BASE_URL=
VITE_PIAPI_API_KEY=
VITE_PIAPI_ENDPOINT=/v1/task
VITE_PIAPI_MODEL=
VITE_PIAPI_RESULT_PATH=
```

- `TEASER` 模式：隐藏证书导出能力，仅保留上传与换脸结果浏览。

## 后端接入位置

- `src/services/cloudFaceSwapClient.ts`

当前支持三种 `VITE_CLOUD_PROVIDER`：

- `invoker`：通过浏览器注入的 `window.__XmetaCloudInvoke` 调用后端
- `backend`：直接调用通用后端任务接口，并支持 task submit/poll 模式
- `piapi`：直接调用第三方 PiAPI 端点（仅在后台允许时使用）

如果你希望 H5 与小程序共享同一个后端接口，请使用 `backend` 模式，并配置：

```bash
VITE_API_MODE=cloud
VITE_CLOUD_PROVIDER=backend
VITE_CLOUD_BASE_URL=https://api.example.com
VITE_CLOUD_ENDPOINT=/faceSwapAction
```

当后端返回 `taskId` 时，H5 会自动进入轮询模式；当后端直接返回 `resultUrl` 时，H5 会跳过轮询。

你也可以继续使用 `invoker`：

```ts
window.__XmetaCloudInvoke = async ({ name, data }) => {
  return {
    ok: true,
    data: {
      resultUrl: 'https://your-temp-authorized-url',
      codename: 'AGENT_X',
      code: 'XM-2026-321',
      joinedDate: '2026-04-20',
    },
  }
}
```

对于 `backend` 模式，额外配置项：

- `VITE_CLOUD_TASK_POLL_INTERVAL_MS=2000`
- `VITE_CLOUD_TASK_POLL_ATTEMPTS=25`
- `VITE_CLOUD_RESULT_PATH=` 可用于从后端响应中提取图片链接（例如 `data.output[0]`）

此外，`generateFaceSwap` 已支持 `onProgress` 回调，可用于驱动日志滚动与进度条。

## Mock 切 Cloud 最小配置清单

1. 在 `.env` 中切换：

```bash
VITE_API_MODE=cloud
VITE_CLOUD_TIMEOUT_MS=20000
VITE_CLOUD_RETRY_COUNT=2
```

2. 在应用启动前注入 `window.__XmetaCloudInvoke`（例如 `main.ts` 里或独立 sdk 引导文件）。
3. 确保云函数返回可导出图片链接（支持 CORS 或临时授权 URL）。
4. 若返回结构不是 `{ ok, data: { resultUrl } }`，也可使用 `success/code/data.url/data.result.resultUrl` 兼容格式。
5. 如出现跨域导出失败，优先改为云端返回临时可访问链接，或前置转 base64。

## 使用 PiAPI（可选）

当你想直接走 PiAPI 而不是 `window.__XmetaCloudInvoke` 时：

1. `.env` 设置：

```bash
VITE_API_MODE=cloud
VITE_CLOUD_PROVIDER=piapi
VITE_PIAPI_BASE_URL=https://your-piapi-host
VITE_PIAPI_API_KEY=your_piapi_key
VITE_PIAPI_ENDPOINT=/v1/task
VITE_PIAPI_MODEL=your_model_optional
VITE_PIAPI_RESULT_PATH=
```

2. 说明：
- 默认会尝试从这些字段提取结果图 URL：`resultUrl`、`url`、`data.resultUrl`、`data.url`、`result.resultUrl`、`output[0]`。
- 如果你的 PiAPI 返回结构不同，可设置 `VITE_PIAPI_RESULT_PATH`（例如 `data.result.image`）。
- 浏览器直连 PiAPI 可能遇到 CORS，生产环境建议通过后端代理。

## 导出质量策略

证书导出在 `ResultStage` 中默认启用：

- `scale >= 2`
- `useCORS: true`
- `await document.fonts.ready`
- 高频失败自动降级到 `scale: 1` 并给出跨域提示

用于提升细字清晰度与减少字体回退问题。

## 移动端兼容说明

- iOS Safari 推荐用户先点击“授权并启动相机”
- 页面底部使用 `env(safe-area-inset-bottom)` 防止按钮被系统栏遮挡
