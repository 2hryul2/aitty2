export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

// [M-4] 민감 필드 키 목록 (소문자 정규화 후 비교)
const SENSITIVE_KEYS = new Set([
  'apikey', 'api_key', 'password', 'passwd',
  'passphrase', 'token', 'secret', 'authorization',
  'auth', 'credential', 'privatekey', 'private_key',
])

// [M-4] 1-depth 민감 필드 마스킹 (중첩 객체는 재귀 없이 처리)
function maskSensitive(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    result[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '***' : v
  }
  return result
}

// [M-4] 로그 레벨 순서
const LEVEL_ORDER: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]:  1,
  [LogLevel.WARN]:  2,
  [LogLevel.ERROR]: 3,
}

class Logger {
  // [M-4] Production: WARN 이상만 출력. Development: 전체 출력.
  // import.meta.env.PROD는 Vite 빌드 타임에 결정 (런타임 변경 불가)
  private readonly minLevel: LogLevel = import.meta.env.PROD
    ? LogLevel.WARN
    : LogLevel.DEBUG

  private write(level: LogLevel, message: string, data?: unknown): void {
    // 레벨 필터
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return

    const timestamp = new Date().toISOString()
    const consoleMethod =
      level === LogLevel.ERROR ? console.error :
      level === LogLevel.WARN  ? console.warn  :
      console.log

    consoleMethod(`[${timestamp}] [${level}] ${message}`, maskSensitive(data) ?? '')
  }

  debug(message: string, data?: unknown): void {
    this.write(LogLevel.DEBUG, message, data)
  }

  info(message: string, data?: unknown): void {
    this.write(LogLevel.INFO, message, data)
  }

  warn(message: string, data?: unknown): void {
    this.write(LogLevel.WARN, message, data)
  }

  error(message: string, data?: unknown): void {
    this.write(LogLevel.ERROR, message, data)
  }
}

export const logger = new Logger()
