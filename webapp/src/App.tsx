import { useEffect, useState, useCallback, useRef } from 'react'
import { config as configBridge } from '@bridge/ipcBridge'
import { logger } from '@utils/logger'
import { SSHTerminal } from '@components/SSHTerminal'
import { AITerminal } from '@components/AITerminal'
import type { SSHConnection } from '@types/ssh'
import './App.css'

const DEFAULT_CONFIG = {
  theme: 'dark',
  fontSize: 12,
  fontFamily: 'Consolas, "Courier New"',
  sshConnections: [] as any[],
}

const SPLIT_MIN = 20  // 최소 패널 너비 %
const SPLIT_MAX = 80  // 최대 패널 너비 %

function App() {
  const [config, setConfig] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [sshConnection, setSshConnection] = useState<SSHConnection | undefined>()
  const [sshConnected, setSshConnected] = useState(false)
  const [splitRatio, setSplitRatio] = useState(50)  // SSH 패널 너비 %

  const layoutRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const loaded = await configBridge.load().catch(() => null)
        setConfig(loaded ?? DEFAULT_CONFIG)
        logger.info('App initialized', { source: loaded ? 'ipc' : 'default' })
      } catch (error) {
        logger.error('Failed to initialize app', { error })
        setConfig(DEFAULT_CONFIG)
      } finally {
        setIsLoading(false)
      }
    }
    initializeApp()
  }, [])

  // Drag resize handlers
  const handleResizerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !layoutRef.current) return

      const rect = layoutRef.current.getBoundingClientRect()
      const offsetX = e.clientX - rect.left
      const ratio = (offsetX / rect.width) * 100

      setSplitRatio(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ratio)))
    }

    const onMouseUp = () => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const handleSshConnect = useCallback((conn: SSHConnection) => {
    setSshConnection(conn)
  }, [])

  const handleConnected = useCallback(() => setSshConnected(true), [])
  const handleDisconnected = useCallback(() => setSshConnected(false), [])

  if (isLoading) {
    return (
      <div className="app loading">
        <h1>SSH AI Terminal</h1>
        <p>Initializing...</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1><span className="shinhan">신한DS</span> Aitty <span className="subtitle">(SSH + AI Terminal for Windows, v0.1.0)</span></h1>
      </header>

      <div className="app-layout" ref={layoutRef}>
        <div className="terminal-panel ssh-panel" style={{ width: `${splitRatio}%` }}>
          <SSHTerminal
            connection={sshConnection}
            onRequestConnect={handleSshConnect}
            onConnect={handleConnected}
            onDisconnect={handleDisconnected}
          />
        </div>

        <div
          className="panel-resizer"
          onMouseDown={handleResizerMouseDown}
          title="Drag to resize"
        />

        <div className="terminal-panel ai-panel" style={{ flex: 1 }}>
          <AITerminal />
        </div>
      </div>

      <footer className="app-footer">
        <p>© 2026 Aitty | 신한DS AX본부</p>
      </footer>
    </div>
  )
}

export default App
