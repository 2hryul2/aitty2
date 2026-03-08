import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { useTerminalResize } from '@hooks/useTerminalResize'
import { ai } from '@bridge/ipcBridge'
import { logger } from '@utils/logger'

export interface AITerminalProps {
  onCommand?: (command: string) => void
  onOutput?: (output: string) => void
}

const AVAILABLE_MODELS = [
  { id: 'claude-sonnet-4-6-20250514', name: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
  { id: 'claude-opus-4-6-20250514', name: 'Claude Opus 4.6' },
]

function isWebView2(): boolean {
  return !!window.chrome?.webview
}

export function AITerminal({ onCommand, onOutput }: AITerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const inputBufferRef = useRef('')
  const isProcessingRef = useRef(false)
  const [isConfigured, setIsConfigured] = useState(false)
  const [currentModel, setCurrentModel] = useState('claude-sonnet-4-6-20250514')
  const [isStreaming, setIsStreaming] = useState(false)

  const resizeRef = useTerminalResize(() => {
    if (fitAddonRef.current && termRef.current) {
      fitAddonRef.current.fit()
    }
  })

  const writePrompt = useCallback(() => {
    termRef.current?.write('\r\n\x1b[36mai\x1b[0m@\x1b[33maitty\x1b[0m:\x1b[32m~\x1b[0m$ ')
  }, [])

  const printHelp = useCallback(() => {
    const term = termRef.current
    if (!term) return
    term.writeln('')
    term.writeln('\x1b[1;36m--- Aitty AI Terminal Commands ---\x1b[0m')
    term.writeln('')
    term.writeln('  \x1b[33mconfig set api-key <KEY>\x1b[0m   Set Claude API key')
    term.writeln('  \x1b[33mconfig set model <MODEL>\x1b[0m   Set AI model')
    term.writeln('  \x1b[33mconfig set system <PROMPT>\x1b[0m Set system prompt')
    term.writeln('  \x1b[33mmodel list\x1b[0m                 List available models')
    term.writeln('  \x1b[33mmodel use <MODEL>\x1b[0m          Switch model')
    term.writeln('  \x1b[33mstatus\x1b[0m                     Show API status')
    term.writeln('  \x1b[33mclear\x1b[0m                      Clear terminal')
    term.writeln('  \x1b[33mreset\x1b[0m                      Clear conversation history')
    term.writeln('  \x1b[33mhelp\x1b[0m                       Show this help')
    term.writeln('')
    term.writeln('  Any other input is sent to Claude as a message.')
  }, [])

  const handleBuiltinCommand = useCallback(async (command: string): Promise<boolean> => {
    const term = termRef.current
    if (!term) return false

    const parts = command.trim().split(/\s+/)
    const cmd = parts[0]?.toLowerCase()

    if (cmd === 'help') {
      printHelp()
      return true
    }

    if (cmd === 'clear') {
      term.clear()
      return true
    }

    if (cmd === 'reset') {
      try {
        await ai.clear()
        term.writeln('\r\n\x1b[32mConversation history cleared.\x1b[0m')
      } catch {
        term.writeln('\r\n\x1b[32mConversation history cleared (local).\x1b[0m')
      }
      return true
    }

    if (cmd === 'status') {
      try {
        const state = await ai.state()
        term.writeln('')
        term.writeln(`\x1b[1mAPI Status:\x1b[0m`)
        term.writeln(`  Configured: ${state.isConfigured ? '\x1b[32mYes\x1b[0m' : '\x1b[31mNo\x1b[0m'}`)
        term.writeln(`  Model: \x1b[33m${state.model}\x1b[0m`)
        term.writeln(`  History: ${state.historyCount} messages`)
      } catch {
        term.writeln('')
        term.writeln(`  API: \x1b[33mWebView2 not available (browser mode)\x1b[0m`)
        term.writeln(`  Model: \x1b[33m${currentModel}\x1b[0m`)
      }
      return true
    }

    if (cmd === 'model') {
      if (parts[1]?.toLowerCase() === 'list') {
        term.writeln('')
        term.writeln('\x1b[1mAvailable Models:\x1b[0m')
        for (const m of AVAILABLE_MODELS) {
          const marker = m.id === currentModel ? ' \x1b[32m← current\x1b[0m' : ''
          term.writeln(`  \x1b[33m${m.id}\x1b[0m (${m.name})${marker}`)
        }
        return true
      }

      if (parts[1]?.toLowerCase() === 'use' && parts[2]) {
        const model = parts[2]
        try {
          const result = await ai.setModel(model)
          setCurrentModel(result.model)
          term.writeln(`\r\n\x1b[32mSwitched to: ${result.model}\x1b[0m`)
        } catch {
          setCurrentModel(model)
          term.writeln(`\r\n\x1b[32mModel set to: ${model}\x1b[0m`)
        }
        return true
      }
    }

    if (cmd === 'config' && parts[1]?.toLowerCase() === 'set') {
      const key = parts[2]?.toLowerCase()
      const value = parts.slice(3).join(' ')

      if (!key || !value) {
        term.writeln('\r\n\x1b[31mUsage: config set <api-key|model|system> <value>\x1b[0m')
        return true
      }

      if (key === 'api-key') {
        try {
          await ai.setKey(value)
          setIsConfigured(true)
          term.writeln('\r\n\x1b[32mAPI key configured successfully.\x1b[0m')
        } catch {
          term.writeln('\r\n\x1b[33mAPI key saved (will apply when WebView2 is available).\x1b[0m')
        }
        return true
      }

      if (key === 'model') {
        try {
          await ai.setModel(value)
          setCurrentModel(value)
          term.writeln(`\r\n\x1b[32mModel set to: ${value}\x1b[0m`)
        } catch {
          setCurrentModel(value)
          term.writeln(`\r\n\x1b[32mModel set to: ${value}\x1b[0m`)
        }
        return true
      }

      if (key === 'system') {
        try {
          await ai.setSystem(value)
          term.writeln('\r\n\x1b[32mSystem prompt updated.\x1b[0m')
        } catch {
          term.writeln('\r\n\x1b[33mSystem prompt saved (will apply when WebView2 is available).\x1b[0m')
        }
        return true
      }

      term.writeln(`\r\n\x1b[31mUnknown config key: ${key}\x1b[0m`)
      return true
    }

    return false
  }, [currentModel, printHelp])

  const sendMessage = useCallback(async (message: string) => {
    const term = termRef.current
    if (!term || isProcessingRef.current) return

    isProcessingRef.current = true
    setIsStreaming(true)
    onCommand?.(message)

    term.writeln('')

    if (!isWebView2()) {
      term.writeln('\x1b[31mWebView2 not available. Running in browser mode.\x1b[0m')
      term.writeln('\x1b[33mClaude API requires the native WPF app.\x1b[0m')
      isProcessingRef.current = false
      setIsStreaming(false)
      return
    }

    try {
      // Show streaming indicator
      term.write('\x1b[2m...\x1b[0m')

      const response = await ai.stream(
        message,
        (chunk) => {
          // On first chunk, clear the "..." indicator
          if (term) {
            term.write(chunk)
          }
        }
      )

      // Final newline + token info
      term.writeln('')
      onOutput?.(response.content)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'

      if (errorMsg.includes('not configured')) {
        term.writeln(`\x1b[31m${errorMsg}\x1b[0m`)
        term.writeln('\x1b[33mRun: config set api-key <YOUR_KEY>\x1b[0m')
      } else {
        term.writeln(`\r\n\x1b[31mError: ${errorMsg}\x1b[0m`)
      }
    } finally {
      isProcessingRef.current = false
      setIsStreaming(false)
    }
  }, [onCommand, onOutput])

  // Initialize xterm.js
  useEffect(() => {
    if (!terminalRef.current) return

    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'Consolas, "Courier New", monospace',
      lineHeight: 1.2,
      theme: {
        background: '#1a1a1a',
        foreground: '#e0e0e0',
        cursor: '#00ff00',
        cyan: '#00bcd4',
        yellow: '#ffc107',
        green: '#4caf50',
        red: '#f44336',
      },
      cols: 100,
      rows: 30,
      convertEol: true,
      cursorBlink: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)
    fitAddon.fit()

    termRef.current = term
    fitAddonRef.current = fitAddon

    // Warning banner
    term.writeln('\x1b[1;33m╔════════════════════════════════════════════════════╗\x1b[0m')
    term.writeln('\x1b[1;33m║  ⚠ AI는 부정확한 정보를 제공할 수 있습니다.       ║\x1b[0m')
    term.writeln('\x1b[33m║  실행 전 반드시 내용을 검토하세요                  ║\x1b[0m')
    term.writeln('\x1b[1;33m╚════════════════════════════════════════════════════╝\x1b[0m')
    term.writeln('')
    term.writeln('Type \x1b[33mhelp\x1b[0m for available commands.')
    term.writeln('Type \x1b[33mconfig set api-key <KEY>\x1b[0m to get started.')
    term.write('\r\n\x1b[36mai\x1b[0m@\x1b[33maitty\x1b[0m:\x1b[32m~\x1b[0m$ ')

    // Check initial state
    if (isWebView2()) {
      ai.state().then(state => {
        setIsConfigured(state.isConfigured)
        setCurrentModel(state.model)
      }).catch(() => {})
    }

    // Handle input
    term.onData((data: string) => {
      if (isProcessingRef.current) {
        // Allow Ctrl+C to cancel during streaming
        if (data === '\x03') {
          ai.cancelStream().catch(() => {})
          isProcessingRef.current = false
          setIsStreaming(false)
          term.writeln('\r\n\x1b[33m^C Cancelled\x1b[0m')
          writePrompt()
        }
        return
      }

      if (data === '\r') {
        const command = inputBufferRef.current.trim()
        inputBufferRef.current = ''

        if (!command) {
          writePrompt()
          return
        }

        // Try builtin commands first
        handleBuiltinCommand(command).then(handled => {
          if (handled) {
            writePrompt()
          } else {
            // Send to Claude API
            sendMessage(command).then(() => writePrompt())
          }
        })
      } else if (data === '\u007f' || data === '\b') {
        if (inputBufferRef.current.length > 0) {
          inputBufferRef.current = inputBufferRef.current.slice(0, -1)
          term.write('\b \b')
        }
      } else if (data === '\x03') {
        // Ctrl+C
        inputBufferRef.current = ''
        term.writeln('^C')
        writePrompt()
      } else if (data === '\x0c') {
        // Ctrl+L
        term.clear()
        writePrompt()
      } else if (data.charCodeAt(0) >= 32) {
        inputBufferRef.current += data
        term.write(data)
      }
    })

    logger.info('AI Terminal initialized')

    return () => {
      term.dispose()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClear = () => {
    termRef.current?.clear()
    writePrompt()
    inputBufferRef.current = ''
  }

  const handleCancel = async () => {
    try {
      await ai.cancelStream()
    } catch { /* ignore */ }
    isProcessingRef.current = false
    setIsStreaming(false)
    termRef.current?.writeln('\r\n\x1b[33mCancelled\x1b[0m')
    writePrompt()
  }

  return (
    <div className="ai-terminal">
      <div className="terminal-header">
        <h2>AI CLI Terminal</h2>
        <div className="terminal-status">
          {isConfigured ? (
            <>
              <span className="status-badge connected">● Connected</span>
              <span className="status-info">{currentModel.split('-').slice(0, -1).join('-')}</span>
            </>
          ) : (
            <span className="status-badge disconnected">○ No API Key</span>
          )}
          {isStreaming && <span className="status-badge streaming">⟳ Streaming</span>}
        </div>
        <div className="terminal-controls">
          <button onClick={handleClear}>Clear</button>
          {isStreaming && <button onClick={handleCancel}>Cancel</button>}
        </div>
      </div>
      <div className="terminal-container" ref={resizeRef} style={{ flex: 1 }}>
        <div ref={terminalRef} className="terminal-content" />
      </div>
    </div>
  )
}
