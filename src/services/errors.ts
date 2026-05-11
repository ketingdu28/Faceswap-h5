export class FaceSwapServiceError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'FaceSwapServiceError'
    this.code = code
  }
}
