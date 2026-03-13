declare global {
  interface Window {
    chrome?: {
      webview?: {
        postMessage(message: any): void
        addEventListener(type: string, listener: (e: MessageEvent) => void): void
        removeEventListener(type: string, listener: (e: MessageEvent) => void): void
      }
    }
  }
}

interface PendingRequest {
  resolve: (value: any) => void
  reject: (reason: any) => void
  timer: ReturnType<typeof setTimeout>
}

type StreamChunkHandler = (chunk: string) => void

const pending = new Map<string, PendingRequest>()
const streamListeners = new Map<string, StreamChunkHandler>()
const REQUEST_TIMEOUT = 30_000
const STREAM_TIMEOUT = 120_000

function isWebView2(): boolean {
  return !!window.chrome?.webview
}

function init() {
  if (!isWebView2()) return

  window.chrome!.webview!.addEventListener('message', (e: MessageEvent) => {
    try {
      const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data

      // ai:stream:chunk / ai:ssh:analyze:chunk / ai:ssh:suggest:chunk 통합 처리
      if (msg.type.endsWith(':chunk')) {
        const listener = streamListeners.get(msg.id)
        if (listener && msg.payload?.chunk) {
          listener(msg.payload.chunk)
        }
        return
      }

      const req = pending.get(msg.id)
      if (!req) return

      clearTimeout(req.timer)
      pending.delete(msg.id)
      streamListeners.delete(msg.id)

      if (msg.error) {
        req.reject(new Error(msg.error))
      } else {
        req.resolve(msg.payload)
      }
    } catch (err) {
      console.error('[ipcBridge] Failed to parse message', err)
    }
  })
}

export function invoke<T = any>(type: string, payload: any = {}): Promise<T> {
  if (!isWebView2()) {
    return Promise.reject(new Error('WebView2 not available, running in browser mode'))
  }

  return new Promise<T>((resolve, reject) => {
    const id = crypto.randomUUID()
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`IPC timeout: ${type}`))
    }, REQUEST_TIMEOUT)

    pending.set(id, { resolve, reject, timer })
    window.chrome!.webview!.postMessage({ id, type, payload })
  })
}

export const ssh = {
  connect: (conn: { host: string; port: number; username: string; password?: string; privateKey?: string; passphrase?: string }) =>
    invoke<{ success: boolean }>('ssh:connect', conn),
  disconnect: () => invoke<{ success: boolean }>('ssh:disconnect'),
  exec: (command: string) => invoke<{ output: string }>('ssh:exec', { command }),
  test: () => invoke<{ success: boolean }>('ssh:test'),
  state: () => invoke<{ isConnected: boolean; isConnecting: boolean; error?: string; host?: string }>('ssh:state'),
  shellWrite: (data: string) => invoke<{ success: boolean }>('ssh:shell:write', { data }),
  shellRead: () => invoke<{ data: string | null }>('ssh:shell:read'),
}

export const config = {
  load: () => invoke<{ theme: string; fontSize: number; fontFamily: string; sshConnections: any[]; lastConnection?: string }>('config:load'),
  save: (cfg: any) => invoke<{ success: boolean }>('config:save', cfg),
  addConnection: (conn: any) => invoke<{ success: boolean }>('config:connections:add', conn),
  removeConnection: (host: string) => invoke<{ success: boolean }>('config:connections:remove', { host }),
}

export const keys = {
  list: () => invoke<{ keys: string[]; directory: string }>('keys:list'),
  validate: (path: string) => invoke<{ valid: boolean }>('keys:validate', { path }),
  sshConfig: () => invoke<Record<string, Record<string, string>>>('keys:ssh-config'),
}

export interface AiSendResponse {
  content: string
  model: string
  inputTokens: number
  outputTokens: number
}

export interface AiStreamResponse {
  content: string
  done: boolean
}

export interface AiState {
  isConfigured: boolean
  model: string
  historyCount: number
  engine: string
  provider: string
  baseUrl?: string
}

export interface AiProvider {
  id: string
  name: string
  status: string
  requiresApiKey: boolean
}

export interface AiProvidersResponse {
  providers: AiProvider[]
  active: string
}

export interface OpenWebUiDiagnosis {
  success: boolean
  baseUrl: string
  isOpenWebUi: boolean
  modelsCount: number
  logs: string[]
}

export interface ApiLogSaveResult {
  success: boolean
  path: string
}

export const ai = {
  send: (message: string) => invoke<AiSendResponse>('ai:send', { message }),
  stream: (message: string, onChunk: StreamChunkHandler) => {
    if (!isWebView2()) {
      return Promise.reject(new Error('WebView2 not available, running in browser mode'))
    }

    return new Promise<AiStreamResponse>((resolve, reject) => {
      const id = crypto.randomUUID()
      const timer = setTimeout(() => {
        pending.delete(id)
        streamListeners.delete(id)
        reject(new Error('AI stream timeout'))
      }, STREAM_TIMEOUT)

      pending.set(id, { resolve, reject, timer })
      streamListeners.set(id, onChunk)
      window.chrome!.webview!.postMessage({ id, type: 'ai:stream', payload: { message } })
    })
  },
  cancelStream: () => invoke<{ success: boolean }>('ai:stream:cancel'),
  configure: (config: { model?: string; systemPrompt?: string; maxTokens?: number }) => invoke<{ success: boolean }>('ai:configure', config),
  setModel: (model: string) => invoke<{ success: boolean; model: string }>('ai:set-model', { model }),
  setSystem: (systemPrompt: string | null) => invoke<{ success: boolean }>('ai:set-system', { systemPrompt }),
  setEndpoint: (url: string) => invoke<{ success: boolean; url: string }>('ai:set-endpoint', { url }),
  openWebUiDiagnose: (url?: string) => invoke<OpenWebUiDiagnosis>('ai:openwebui:diagnose', { url: url ?? '' }),
  saveApiLog: (content: string) => invoke<ApiLogSaveResult>('ai:api-log:save', { content }),
  state: () => invoke<AiState>('ai:state'),
  history: () => invoke<{ messages: Array<{ role: string; content: string }> }>('ai:history'),
  clear: () => invoke<{ success: boolean }>('ai:clear'),
  models: () => invoke<{ models: string[] }>('ai:models'),
  // ── 제공자 관리 ─────────────────────────────── //
  providers: () => invoke<AiProvidersResponse>('ai:providers'),
  setProvider: (provider: string) => invoke<{ success: boolean; provider: string }>('ai:set-provider', { provider }),
  setApiKey: (provider: string, apiKey: string) => invoke<{ success: boolean; provider: string; hasKey: boolean }>('ai:set-apikey', { provider, apiKey }),
  // 스트리밍으로 전환: 30초 타임아웃 → 120초 + 청크 실시간 출력
  analyzeLast: (onChunk?: StreamChunkHandler) => {
    if (!isWebView2()) return Promise.reject(new Error('WebView2 not available'))
    return new Promise<{ content: string }>((resolve, reject) => {
      const id = crypto.randomUUID()
      const timer = setTimeout(() => {
        pending.delete(id)
        streamListeners.delete(id)
        reject(new Error('IPC timeout: ai:ssh:analyze'))
      }, STREAM_TIMEOUT)
      pending.set(id, { resolve, reject, timer })
      if (onChunk) streamListeners.set(id, onChunk)
      window.chrome!.webview!.postMessage({ id, type: 'ai:ssh:analyze', payload: {} })
    })
  },
  suggestCommand: (onChunk?: StreamChunkHandler) => {
    if (!isWebView2()) return Promise.reject(new Error('WebView2 not available'))
    return new Promise<{ content: string }>((resolve, reject) => {
      const id = crypto.randomUUID()
      const timer = setTimeout(() => {
        pending.delete(id)
        streamListeners.delete(id)
        reject(new Error('IPC timeout: ai:ssh:suggest-command'))
      }, STREAM_TIMEOUT)
      pending.set(id, { resolve, reject, timer })
      if (onChunk) streamListeners.set(id, onChunk)
      window.chrome!.webview!.postMessage({ id, type: 'ai:ssh:suggest-command', payload: {} })
    })
  },
}

export const app = {
  version: () => invoke<{ version: string }>('app:version'),
}

init()
