/**
 * tcb-js-sdk 最小类型声明
 * 覆盖本项目实际使用的 API 面：init / auth / uploadFile / callFunction
 */
declare module '@cloudbase/js-sdk' {
  export interface LoginState {
    isAnonymousAuth: boolean
    uid: string
  }

  export interface Auth {
    getLoginState(): Promise<LoginState | null>
    signInAnonymously(): Promise<{ error?: unknown } & Partial<LoginState>>
  }

  export interface UploadFileResult {
    fileID: string
    requestId?: string
  }

  export interface CallFunctionResult {
    result: unknown
    requestId?: string
  }

  export interface App {
    /** cloudbase 2.x：auth 为属性 */
    auth: Auth
    uploadFile(params: {
      cloudPath: string
      fileContent: Blob | File
    }): Promise<UploadFileResult>
    callFunction(params: {
      name: string
      data?: Record<string, unknown>
    }): Promise<CallFunctionResult>
  }

  const tcb: {
    init(config: { env: string; [key: string]: unknown }): App
  }
  export default tcb
}
