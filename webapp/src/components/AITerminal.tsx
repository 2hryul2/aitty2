import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { useTerminalResize } from '@hooks/useTerminalResize'
import { useAITerminal, charDisplayWidth, isWebView2 } from '@hooks/useAITerminal'
import { ai } from '@bridge/ipcBridge'
import { logger } from '@utils/logger'
import { AISettingsPanel } from '@components/AISettingsPanel'

export function AITerminal() {
  const terminalRef = useRef<HTMLDivElement>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  const hook = useAITerminal()
  const {
    termRef,
    inputBufferRef,
    isProcessingRef,
    sendMessageRef,
    handleBuiltinCommandRef,
    writePromptRef,

    isConfigured,
    currentModel,
    isStreaming,
    engineName,
    availableModels,
    isSettingsOpen,
    isSystemPromptOpen,
    systemPrompt,
    endpointUrl,
    isBusy,
    isDirty,
    isApplySuccess,
    activeProvider,
    apiKey,
    providers,
    saveApiLog,

    setIsSettingsOpen,
    setIsSystemPromptOpen,
    setSystemPrompt,
    setApiKey,
    setSaveApiLog,
    setIsDirty,
    setIsApplySuccess,

    handleEndpointChange,
    handleProviderChange,
    handleModelChange,
    handleCheck,
    handleApplySettings,
    handleAnalyzeClick,
    handleCancel,
    handleClear,

    initializeOnMount,
  } = hook

  const resizeRef = useTerminalResize(() => {
    if (fitAddonRef.current && termRef.current) {
      fitAddonRef.current.fit()
    }
  })

  // xterm initialization
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

    fitAddonRef.current = fitAddon

    initializeOnMount(term)

    term.onData((data: string) => {
      if (isProcessingRef.current) {
        if (data === '\x03') {
          ai.cancelStream().catch(() => {})
          isProcessingRef.current = false
          term.writeln('\r\n\x1b[33m^C Cancelled\x1b[0m')
          writePromptRef.current()
        }
        return
      }

      if (data === '\r') {
        const command = inputBufferRef.current.trim()
        inputBufferRef.current = ''
        if (!command) { writePromptRef.current(); return }

        handleBuiltinCommandRef.current(command).then(handled => {
          if (handled) {
            writePromptRef.current()
          } else {
            sendMessageRef.current(command).then(() => writePromptRef.current())
          }
        })
      } else if (data === '\u007f' || data === '\b') {
        const chars = [...inputBufferRef.current]
        if (chars.length > 0) {
          const lastChar = chars.pop()!
          inputBufferRef.current = chars.join('')
          const w = charDisplayWidth(lastChar)
          const curX = term.buffer.active.cursorX
          if (curX >= w) {
            term.write(`\x1b[${w}D\x1b[${w}X`)
          } else {
            const targetCol = term.cols - w
            term.write(`\x1b[A\x1b[${targetCol + 1}G\x1b[${w}X`)
          }
        }
      } else if (data === '\x03') {
        inputBufferRef.current = ''
        term.writeln('^C')
        writePromptRef.current()
      } else if (data === '\x0c') {
        term.clear()
        writePromptRef.current()
      } else if (data.charCodeAt(0) >= 32) {
        inputBufferRef.current += data
        term.write(data)
      }
    })

    // drag selection -> clipboard copy
    term.onSelectionChange(() => {
      const selected = term.getSelection()
      if (selected) {
        navigator.clipboard.writeText(selected).catch(() => {})
      }
    })

    // right-click paste
    const containerEl = terminalRef.current
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      if (isProcessingRef.current) return
      navigator.clipboard.readText()
        .then(text => {
          if (text) {
            term.write(text)
            inputBufferRef.current += text
          }
        })
        .catch(() => {
          term.writeln('\r\n\x1b[33m⚠ 클립보드 권한 없음. Ctrl+V를 사용하세요.\x1b[0m')
          writePromptRef.current()
        })
    }
    containerEl?.addEventListener('contextmenu', handleContextMenu)

    logger.info('Local LLM Terminal initialized')

    return () => {
      containerEl?.removeEventListener('contextmenu', handleContextMenu)
      term.dispose()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const currentProviderInfo = providers.find(p => p.id === activeProvider)
  const requiresApiKey = currentProviderInfo?.requiresApiKey ?? false
  const providerDisplayName = currentProviderInfo?.name ?? activeProvider

  const handleMarkDirty = useCallback(() => {
    setIsDirty(true)
    setIsApplySuccess(false)
  }, [setIsDirty, setIsApplySuccess])

  return (
    <div className="ai-terminal local-llm-terminal">
      <div className="terminal-header">
        <h2>Local LLM Terminal</h2>
        <div className="terminal-status">
          {isConfigured ? (
            <>
              <span className="status-badge connected">Ready</span>
              <span className="status-info">
                {requiresApiKey ? providerDisplayName : engineName} | {currentModel}
              </span>
            </>
          ) : (
            <span className="status-badge disconnected">
              {`${providerDisplayName} Offline`}
            </span>
          )}
          {isStreaming && <span className="status-badge streaming">Generating</span>}
        </div>
        <div className="terminal-controls">
          <button onClick={() => setIsSettingsOpen(prev => !prev)}>
            {isSettingsOpen ? 'Hide Settings' : 'Settings'}
          </button>
          <button onClick={handleClear}>Clear</button>
          <button
            onClick={handleAnalyzeClick}
            disabled={!isConfigured || isBusy}
            style={{ color: '#ffc107', borderColor: '#ffc107' }}
          >
            AI분석
          </button>
          {isStreaming && <button onClick={handleCancel}>Cancel</button>}
        </div>
      </div>

      {isSettingsOpen && (
        <AISettingsPanel
          activeProvider={activeProvider}
          providers={providers}
          endpointUrl={endpointUrl}
          apiKey={apiKey}
          currentModel={currentModel}
          availableModels={availableModels}
          systemPrompt={systemPrompt}
          saveApiLog={saveApiLog}
          isBusy={isBusy}
          isDirty={isDirty}
          isApplySuccess={isApplySuccess}
          isSystemPromptOpen={isSystemPromptOpen}
          requiresApiKey={requiresApiKey}
          providerDisplayName={providerDisplayName}
          onProviderChange={handleProviderChange}
          onEndpointChange={handleEndpointChange}
          onApiKeyChange={setApiKey}
          onModelChange={handleModelChange}
          onSystemPromptChange={setSystemPrompt}
          onSaveApiLogChange={setSaveApiLog}
          onCheck={handleCheck}
          onApply={handleApplySettings}
          onToggleSystemPrompt={() => setIsSystemPromptOpen(prev => !prev)}
          onMarkDirty={handleMarkDirty}
        />
      )}

      <div className="terminal-container" ref={resizeRef} style={{ flex: 1 }}>
        <div ref={terminalRef} className="terminal-content" />
      </div>
    </div>
  )
}
