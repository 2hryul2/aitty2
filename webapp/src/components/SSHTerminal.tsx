import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { useSSHConnection } from '@hooks/useSSHConnection'
import { useTerminalResize } from '@hooks/useTerminalResize'
import { SSHConnection } from '@types/ssh'
import { logger } from '@utils/logger'
import { ssh as sshBridge } from '@bridge/ipcBridge'
import '../styles/terminal.css'

export interface SSHTerminalProps {
  connection?: SSHConnection
  onRequestConnect?: (conn: SSHConnection) => void
  onConnect?: () => void
  onDisconnect?: () => void
  autoConnect?: boolean
}

const POLL_INTERVAL = 100 // ms

export function SSHTerminal({ connection, onRequestConnect, onConnect, onDisconnect, autoConnect = false }: SSHTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const healthCheckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isPollingRef = useRef(false)

  const { state: sshState, connect, disconnect, shellWrite, shellRead } = useSSHConnection()
  const shellWriteRef = useRef(shellWrite)
  const [showConnectForm, setShowConnectForm] = useState(true)
  const [formData, setFormData] = useState({
    host: '172.16.1.103',
    port: '22',
    username: 'ds',
    password: '',
    privateKey: '',
  })

  // Keep ref in sync with latest shellWrite (avoids stale closure in onData)
  useEffect(() => {
    shellWriteRef.current = shellWrite
  }, [shellWrite])

  const resizeRef = useTerminalResize(() => {
    if (fitAddonRef.current && termRef.current) {
      fitAddonRef.current.fit()
    }
  })

  // Shell output polling
  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return

    pollTimerRef.current = setInterval(async () => {
      if (isPollingRef.current) return
      isPollingRef.current = true

      try {
        const data = await shellRead()
        if (data && termRef.current) {
          termRef.current.write(data)
        }
      } catch {
        // Connection lost or read error — stop polling
        stopPolling()
      } finally {
        isPollingRef.current = false
      }
    }, POLL_INTERVAL)
  }, [shellRead])

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
    isPollingRef.current = false
  }, [])

  // ── 30초 SSH 헬스체크 ────────────────────────────────────────
  const stopHealthCheck = useCallback(() => {
    if (healthCheckTimerRef.current) {
      clearInterval(healthCheckTimerRef.current)
      healthCheckTimerRef.current = null
    }
  }, [])

  const startHealthCheck = useCallback((showBannerFn: (t: Terminal) => void) => {
    if (healthCheckTimerRef.current) return
    healthCheckTimerRef.current = setInterval(async () => {
      try {
        const { isConnected } = await sshBridge.state()
        if (!isConnected) {
          stopHealthCheck()
          stopPolling()
          const term = termRef.current
          if (term) {
            term.writeln('\r\n\x1b[31m⚠ SSH 연결이 끊어졌습니다.\x1b[0m')
            setTimeout(() => { term.clear(); showBannerFn(term) }, 2000)
          }
          setShowConnectForm(true)
          onDisconnect?.()
        }
      } catch { /* IPC error - skip */ }
    }, 30_000)
  }, [stopHealthCheck, stopPolling, onDisconnect])

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopPolling(); stopHealthCheck() }
  }, [stopPolling, stopHealthCheck])

  const showBanner = (term: Terminal) => {
    const C = '\x1b[36m'   // cyan
    const D = '\x1b[2;36m' // dim cyan
    const G = '\x1b[32m'   // green
    const R = '\x1b[0m'    // reset
    term.writeln('')
    term.writeln(`${C} ____  _   _ ___ _   _ _   _    _    _   _     ____  ____${R}`)
    term.writeln(`${C}/ ___|| | | |_ _| \\ | | | | |  / \\  | \\ | |   |  _ \\/ ___|${R}`)
    term.writeln(`${C}\\___ \\| |_| || ||  \\| | |_| | / _ \\ |  \\| |   | | | \\___ \\${R}`)
    term.writeln(`${C} ___) ||  _  || || |\\  |  _  |/ ___ \\| |\\  |   | |_| |___) |${R}`)
    term.writeln(`${C}|____/ |_| |_|___|_| \\_|_| |_/_/   \\_\\_| \\_|   |____/|____/${R}`)
    term.writeln('')
    term.writeln(`${D}──────────────────────────────────────────────────────────────${R}`)
    term.writeln(`${G}  SSH AI Terminal  │  Powered by Arti ${R}`)
    term.writeln(`${D}──────────────────────────────────────────────────────────────${R}`)
    term.writeln('')
    term.writeln(`${D}  Enter connection details above and press Connect.${R}`)
    term.writeln('')
  }

  // Initialize xterm.js
  useEffect(() => {
    if (!terminalRef.current) return

    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'Consolas, "Courier New", monospace',
      lineHeight: 1.2,
      theme: {
        background: '#000000',
        foreground: '#cccccc',
        cursor: '#cccccc',
        black: '#000000',
        red: '#cc0000',
        green: '#4e9a06',
        yellow: '#c4a000',
        blue: '#3465a4',
        magenta: '#75507b',
        cyan: '#06989a',
        white: '#d3d7cf',
        brightBlack: '#555753',
        brightRed: '#ef2929',
        brightGreen: '#8ae234',
        brightYellow: '#fce94f',
        brightBlue: '#729fcf',
        brightMagenta: '#ad7fa8',
        brightCyan: '#34e2e2',
        brightWhite: '#eeeeec',
      },
      cols: 120,
      rows: 40,
      cursorBlink: true,
      scrollback: 5000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)
    fitAddon.fit()

    termRef.current = term
    fitAddonRef.current = fitAddon

    showBanner(term)

    // Forward all keystrokes to shell stream via ref (avoids stale closure)
    term.onData((data: string) => {
      shellWriteRef.current(data).catch(err => {
        logger.error('Shell write error', { error: err })
      })
    })

    // 드래그 선택 → 클립보드 자동 복사
    term.onSelectionChange(() => {
      const selected = term.getSelection()
      if (selected) {
        navigator.clipboard.writeText(selected).catch(() => {})
      }
    })

    // 우클릭 → 클립보드에서 붙여넣기
    const containerEl = terminalRef.current
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      navigator.clipboard.readText()
        .then(text => { if (text) shellWriteRef.current(text).catch(() => {}) })
        .catch(() => {})
    }
    containerEl?.addEventListener('contextmenu', handleContextMenu)

    logger.info('Terminal initialized')

    return () => {
      containerEl?.removeEventListener('contextmenu', handleContextMenu)
      term.dispose()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-connect when connection prop changes
  useEffect(() => {
    if (connection && !sshState.isConnected && !sshState.isConnecting) {
      handleConnect(connection)
    }
  }, [connection]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = async (conn?: SSHConnection) => {
    const target = conn || {
      host: formData.host,
      port: parseInt(formData.port) || 22,
      username: formData.username,
      password: formData.password || undefined,
      privateKey: formData.privateKey || undefined,
    }

    if (!target.host || !target.username) {
      termRef.current?.writeln('\x1b[31mError: Host and username are required\x1b[0m')
      return
    }

    try {
      termRef.current?.writeln(`\x1b[33mConnecting to ${target.host}:${target.port}...\x1b[0m`)

      await connect(target)

      // 배너 지우고 접속 정보 출력
      termRef.current?.clear()
      termRef.current?.writeln(`\x1b[32m✓ Connected to ${target.host}:${target.port} as ${target.username}\x1b[0m`)
      termRef.current?.writeln('')

      setShowConnectForm(false)
      onRequestConnect?.(target)
      onConnect?.()

      // Start polling for shell output (MOTD, prompt, etc.)
      startPolling()
      startHealthCheck(showBanner)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Connection failed'
      termRef.current?.writeln(`\x1b[31mFailed: ${msg}\x1b[0m`)
    }
  }

  const handleDisconnect = async () => {
    try {
      stopHealthCheck()
      stopPolling()
      await disconnect()
      // 배너 재표시
      if (termRef.current) {
        termRef.current.clear()
        showBanner(termRef.current)
      }
      setShowConnectForm(true)
      onDisconnect?.()
    } catch (error) {
      logger.error('Disconnect error', { error })
    }
  }

  const handleClear = () => {
    termRef.current?.clear()
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleConnect()
  }

  return (
    <div className="ssh-terminal">
      <div className="terminal-header">
        <h2>SSH Terminal</h2>
        <div className="terminal-status">
          {sshState.isConnected ? (
            <>
              <span className="status-badge connected">● Connected</span>
              <span className="status-info">
                {sshState.connection?.host}:{sshState.connection?.port}
              </span>
            </>
          ) : sshState.isConnecting ? (
            <span className="status-badge connecting">◌ Connecting...</span>
          ) : (
            <span className="status-badge disconnected">○ Disconnected</span>
          )}
        </div>
        <div className="terminal-controls">
          {sshState.isConnected ? (
            <>
              <button onClick={handleClear}>Clear</button>
              <button onClick={handleDisconnect}>Disconnect</button>
            </>
          ) : (
            <button
              onClick={() => setShowConnectForm(!showConnectForm)}
              className={showConnectForm ? 'active' : ''}
            >
              {showConnectForm ? 'Hide Form' : 'Connect'}
            </button>
          )}
        </div>
      </div>

      {showConnectForm && !sshState.isConnected && (
        <form className="ssh-connect-form" onSubmit={handleFormSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Host</label>
              <input
                type="text"
                value={formData.host}
                onChange={e => setFormData(p => ({ ...p, host: e.target.value }))}
                placeholder="127.0.0.1"
              />
            </div>
            <div className="form-group form-group-small">
              <label>Port</label>
              <input
                type="text"
                value={formData.port}
                onChange={e => setFormData(p => ({ ...p, port: e.target.value }))}
                placeholder="22"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                value={formData.username}
                onChange={e => setFormData(p => ({ ...p, username: e.target.value }))}
                placeholder="username"
                autoComplete="username"
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={formData.password}
                onChange={e => setFormData(p => ({ ...p, password: e.target.value }))}
                placeholder="password"
                autoComplete="current-password"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>Private Key (optional)</label>
              <input
                type="text"
                value={formData.privateKey}
                onChange={e => setFormData(p => ({ ...p, privateKey: e.target.value }))}
                placeholder="~/.ssh/id_rsa"
              />
            </div>
          </div>
          <div className="form-row">
            <button
              type="submit"
              className="connect-btn"
              disabled={sshState.isConnecting || !formData.host || !formData.username}
            >
              {sshState.isConnecting ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        </form>
      )}

      <div className="terminal-container" ref={resizeRef} style={{ flex: 1 }}>
        <div ref={terminalRef} className="terminal-content" />
      </div>
    </div>
  )
}
