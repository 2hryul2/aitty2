import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { useTerminalResize } from '@hooks/useTerminalResize'
import { ai } from '@bridge/ipcBridge'
import { logger } from '@utils/logger'

const DEFAULT_MODEL = 'qwen2.5-coder:7b'
const DEFAULT_SYSTEM_PROMPT = 'You are a local Linux SSH assistant. Analyze terminal output, explain issues, and suggest safe next commands. Prefer minimal-risk commands first.'
const OLLAMA_ENDPOINT = 'http://localhost:11434'

function isWebView2(): boolean {
  return !!window.chrome?.webview
}

export function AITerminal() {
  const terminalRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const inputBufferRef = useRef('')
  const isProcessingRef = useRef(false)

  const [isConfigured, setIsConfigured] = useState(false)
  const [currentModel, setCurrentModel] = useState(DEFAULT_MODEL)
  const [isStreaming, setIsStreaming] = useState(false)
  const [engineName, setEngineName] = useState('ollama')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [isSettingsOpen, setIsSettingsOpen] = useState(true)
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT)
  const [statusMessage, setStatusMessage] = useState('Not checked')
  const [isBusy, setIsBusy] = useState(false)

  const resizeRef = useTerminalResize(() => {
    if (fitAddonRef.current && termRef.current) {
      fitAddonRef.current.fit()
    }
  })

  const writePrompt = useCallback(() => {
    termRef.current?.write('\r\n\x1b[36mlocal\x1b[0m@\x1b[33maitty\x1b[0m:\x1b[32m~\x1b[0m$ ')
  }, [])

  const writeLine = useCallback((text: string) => {
    termRef.current?.writeln(text)
  }, [])

  const loadEngineState = useCallback(async (announce = false) => {
    try {
      const [state, models] = await Promise.all([ai.state(), ai.models()])
      setIsConfigured(state.isConfigured)
      setCurrentModel(state.model || DEFAULT_MODEL)
      setEngineName(state.engine || 'ollama')
      setAvailableModels(models.models)
      setStatusMessage(state.isConfigured ? `Ready on ${OLLAMA_ENDPOINT}` : `Offline at ${OLLAMA_ENDPOINT}`)

      if (announce) {
        writeLine(`\x1b[32mEngine: ${state.engine} | Model: ${state.model}\x1b[0m`)
      }
    } catch (error) {
      setIsConfigured(false)
      setAvailableModels([])
      setStatusMessage(`Offline at ${OLLAMA_ENDPOINT}`)
      if (announce) {
        const message = error instanceof Error ? error.message : 'Ollama is not reachable'
        writeLine(`\x1b[31m${message}\x1b[0m`)
      }
    }
  }, [writeLine])

  const printHelp = useCallback(() => {
    const term = termRef.current
    if (!term) return
    term.writeln('')
    term.writeln('\x1b[1;36m--- Local LLM Terminal Commands ---\x1b[0m')
    term.writeln('')
    term.writeln('  \x1b[33mengine status\x1b[0m              Check Ollama availability')
    term.writeln('  \x1b[33mmodel list\x1b[0m                List installed local models')
    term.writeln('  \x1b[33mmodel use <MODEL>\x1b[0m         Switch active model')
    term.writeln('  \x1b[33msystem set <PROMPT>\x1b[0m      Update system prompt')
    term.writeln('  \x1b[33manalyze last\x1b[0m             Analyze recent SSH output')
    term.writeln('  \x1b[33msuggest command\x1b[0m          Suggest one safe next SSH command')
    term.writeln('  \x1b[33mstatus\x1b[0m                     Show local LLM state')
    term.writeln('  \x1b[33mclear\x1b[0m                      Clear terminal')
    term.writeln('  \x1b[33mreset\x1b[0m                      Clear conversation history')
    term.writeln('  \x1b[33mhelp\x1b[0m                       Show this help')
    term.writeln('')
    term.writeln('  Any other input is sent to the local model.')
  }, [])

  const handleBuiltinCommand = useCallback(async (command: string): Promise<boolean> => {
    const normalized = command.trim()
    const lower = normalized.toLowerCase()
    const parts = normalized.split(/\s+/)

    if (lower === 'help') {
      printHelp()
      return true
    }

    if (lower === 'clear') {
      termRef.current?.clear()
      return true
    }

    if (lower === 'reset') {
      await ai.clear().catch(() => undefined)
      writeLine('\x1b[32mConversation history cleared.\x1b[0m')
      return true
    }

    if (lower === 'status' || lower === 'engine status') {
      await loadEngineState(true)
      return true
    }

    if (lower === 'model list') {
      try {
        const result = await ai.models()
        setAvailableModels(result.models)
        writeLine('\x1b[1mInstalled Models:\x1b[0m')
        result.models.forEach((model) => {
          const marker = model === currentModel ? ' \x1b[32m<current>\x1b[0m' : ''
          writeLine(`  \x1b[33m${model}\x1b[0m${marker}`)
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to list models'
        writeLine(`\x1b[31m${message}\x1b[0m`)
      }
      return true
    }

    if (parts[0]?.toLowerCase() === 'model' && parts[1]?.toLowerCase() === 'use' && parts[2]) {
      const model = parts.slice(2).join(' ')
      await ai.setModel(model)
      setCurrentModel(model)
      writeLine(`\x1b[32mActive model: ${model}\x1b[0m`)
      return true
    }

    if (parts[0]?.toLowerCase() === 'system' && parts[1]?.toLowerCase() === 'set' && parts[2]) {
      const prompt = parts.slice(2).join(' ')
      await ai.setSystem(prompt)
      setSystemPrompt(prompt)
      writeLine('\x1b[32mSystem prompt updated.\x1b[0m')
      return true
    }

    if (lower === 'analyze last') {
      const result = await ai.analyzeLast()
      writeLine(result.content)
      return true
    }

    if (lower === 'suggest command') {
      const result = await ai.suggestCommand()
      writeLine(result.content)
      return true
    }

    return false
  }, [currentModel, loadEngineState, printHelp, writeLine])

  const sendMessage = useCallback(async (message: string) => {
    const term = termRef.current
    if (!term || isProcessingRef.current) return

    isProcessingRef.current = true
    setIsStreaming(true)
    term.writeln('')

    if (!isWebView2()) {
      term.writeln('\x1b[31mWebView2 not available. Running in browser mode.\x1b[0m')
      term.writeln('\x1b[33mLocal LLM calls require the native WPF host.\x1b[0m')
      isProcessingRef.current = false
      setIsStreaming(false)
      return
    }

    try {
      const response = await ai.stream(message, (chunk) => {
        term.write(chunk)
      })
      term.writeln('')
      if (!response.content.trim()) {
        term.writeln('\x1b[33mNo content returned by local model.\x1b[0m')
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      term.writeln(`\r\n\x1b[31mError: ${errorMsg}\x1b[0m`)
    } finally {
      isProcessingRef.current = false
      setIsStreaming(false)
    }
  }, [])

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

    term.writeln('\x1b[1;36mLocal LLM Terminal\x1b[0m')
    term.writeln('\x1b[33mEngine: Ollama (localhost:11434)\x1b[0m')
    term.writeln('Use the settings panel above to select a model and prompt.')
    term.writeln('Type \x1b[33mhelp\x1b[0m for available commands.')
    writePrompt()

    if (isWebView2()) {
      loadEngineState(false).catch(() => undefined)
    }

    term.onData((data: string) => {
      if (isProcessingRef.current) {
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

        handleBuiltinCommand(command).then(handled => {
          if (handled) {
            writePrompt()
          } else {
            sendMessage(command).then(() => writePrompt())
          }
        })
      } else if (data === '\u007f' || data === '\b') {
        if (inputBufferRef.current.length > 0) {
          inputBufferRef.current = inputBufferRef.current.slice(0, -1)
          term.write('\b \b')
        }
      } else if (data === '\x03') {
        inputBufferRef.current = ''
        term.writeln('^C')
        writePrompt()
      } else if (data === '\x0c') {
        term.clear()
        writePrompt()
      } else if (data.charCodeAt(0) >= 32) {
        inputBufferRef.current += data
        term.write(data)
      }
    })

    logger.info('Local LLM Terminal initialized')

    return () => {
      term.dispose()
    }
  }, [handleBuiltinCommand, loadEngineState, sendMessage, writePrompt])

  const handleApplySettings = async () => {
    setIsBusy(true)
    try {
      await ai.configure({ model: currentModel, systemPrompt })
      await ai.setModel(currentModel)
      await ai.setSystem(systemPrompt)
      await loadEngineState(false)
      writeLine(`\x1b[32mApplied settings: ${currentModel}\x1b[0m`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply settings'
      writeLine(`\x1b[31m${message}\x1b[0m`)
    } finally {
      setIsBusy(false)
    }
  }

  const handleAnalyzeClick = async () => {
    writeLine('\x1b[36mRunning analyze last...\x1b[0m')
    const result = await ai.analyzeLast()
    writeLine(result.content)
    writePrompt()
  }

  const handleSuggestClick = async () => {
    writeLine('\x1b[36mRunning suggest command...\x1b[0m')
    const result = await ai.suggestCommand()
    writeLine(result.content)
    writePrompt()
  }

  const handleClear = () => {
    termRef.current?.clear()
    writePrompt()
    inputBufferRef.current = ''
  }

  const handleCancel = async () => {
    try {
      await ai.cancelStream()
    } catch {}
    isProcessingRef.current = false
    setIsStreaming(false)
    termRef.current?.writeln('\r\n\x1b[33mCancelled\x1b[0m')
    writePrompt()
  }

  return (
    <div className="ai-terminal local-llm-terminal">
      <div className="terminal-header">
        <h2>Local LLM Terminal</h2>
        <div className="terminal-status">
          {isConfigured ? (
            <>
              <span className="status-badge connected">Ready</span>
              <span className="status-info">{engineName} | {currentModel}</span>
            </>
          ) : (
            <span className="status-badge disconnected">Ollama Offline</span>
          )}
          {isStreaming && <span className="status-badge streaming">Generating</span>}
        </div>
        <div className="terminal-controls">
          <button onClick={() => setIsSettingsOpen((prev) => !prev)}>{isSettingsOpen ? 'Hide Settings' : 'Settings'}</button>
          <button onClick={handleClear}>Clear</button>
          {isStreaming && <button onClick={handleCancel}>Cancel</button>}
        </div>
      </div>

      {isSettingsOpen && (
        <div className="llm-settings-panel">
          <div className="settings-grid">
            <div className="form-group">
              <label>Engine Endpoint</label>
              <input type="text" value={OLLAMA_ENDPOINT} readOnly />
            </div>
            <div className="form-group">
              <label>Engine Status</label>
              <input type="text" value={statusMessage} readOnly />
            </div>
            <div className="form-group">
              <label>Model</label>
              <select value={currentModel} onChange={(e) => setCurrentModel(e.target.value)}>
                {availableModels.length === 0 ? <option value={currentModel}>{currentModel}</option> : null}
                {availableModels.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </div>
            <div className="form-group settings-actions">
              <label>Controls</label>
              <div className="button-row">
                <button type="button" onClick={() => loadEngineState(true)} disabled={isBusy}>Check</button>
                <button type="button" onClick={handleApplySettings} disabled={isBusy}>Apply</button>
                <button type="button" onClick={handleAnalyzeClick} disabled={!isConfigured}>Analyze Last</button>
                <button type="button" onClick={handleSuggestClick} disabled={!isConfigured}>Suggest Command</button>
              </div>
            </div>
          </div>
          <div className="form-group prompt-group">
            <label>System Prompt</label>
            <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={3} />
          </div>
        </div>
      )}

      <div className="terminal-container" ref={resizeRef} style={{ flex: 1 }}>
        <div ref={terminalRef} className="terminal-content" />
      </div>
    </div>
  )
}
