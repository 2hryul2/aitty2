import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { useTerminalResize } from '@hooks/useTerminalResize'
import { ai, type AiProvider } from '@bridge/ipcBridge'
import { logger } from '@utils/logger'

const DEFAULT_MODEL = 'qwen2.5-coder:7b'
const DEFAULT_SYSTEM_PROMPT = 'You are a local Linux SSH assistant. Analyze terminal output, explain issues, and suggest safe next commands. Prefer minimal-risk commands first.'
const DEFAULT_ENDPOINT = 'http://172.16.1.103:11434'

function isWebView2(): boolean {
  return !!window.chrome?.webview
}

export function AITerminal() {
  const terminalRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const inputBufferRef = useRef('')
  const isProcessingRef = useRef(false)

  // endpointUrl을 ref로도 관리 → loadEngineState deps에서 제거
  const endpointUrlRef = useRef(DEFAULT_ENDPOINT)

  const [isConfigured, setIsConfigured] = useState(false)
  const [currentModel, setCurrentModel] = useState(DEFAULT_MODEL)
  const [isStreaming, setIsStreaming] = useState(false)
  const [engineName, setEngineName] = useState('ollama')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [isSettingsOpen, setIsSettingsOpen] = useState(true)
  const [isSystemPromptOpen, setIsSystemPromptOpen] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT)
  const [endpointUrl, setEndpointUrl] = useState(DEFAULT_ENDPOINT)
  const [statusMessage, setStatusMessage] = useState('Not checked')
  const [isBusy, setIsBusy] = useState(false)
  const [isDirty, setIsDirty] = useState(false)       // 설정 변경 후 미적용
  const [isApplySuccess, setIsApplySuccess] = useState(false) // Apply 성공

  // ── 제공자 관련 상태 ────────────────────────────────────────
  const [activeProvider, setActiveProvider] = useState<string>('ollama')
  const [apiKey, setApiKey] = useState('')
  const [providers, setProviders] = useState<AiProvider[]>([])

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

  // endpointUrl을 deps에서 제거 (ref로 접근). 연결 성공 여부(boolean) 반환.
  const loadEngineState = useCallback(async (announce = false): Promise<boolean> => {
    try {
      const [state, models, provResult] = await Promise.all([
        ai.state(),
        ai.models(),
        ai.providers(),
      ])
      const modelList = models.models
      const serverEp = state.baseUrl || endpointUrlRef.current
      const currentProvider = state.provider || 'ollama'

      setIsConfigured(state.isConfigured)
      setEngineName(state.engine || 'ollama')
      setActiveProvider(currentProvider)
      setProviders(provResult.providers)
      setAvailableModels(modelList)

      const statusMsg = currentProvider === 'gemini'
        ? (state.isConfigured ? 'Gemini Ready' : 'Gemini: API Key 없음')
        : (state.isConfigured ? `Ready on ${serverEp}` : `Offline at ${serverEp}`)
      setStatusMessage(statusMsg)

      const serverModel = state.model || DEFAULT_MODEL
      const resolvedModel = modelList.length > 0
        ? (modelList.includes(serverModel) ? serverModel : modelList[0])
        : serverModel
      setCurrentModel(resolvedModel)

      if (announce) {
        const providerLabel = currentProvider === 'gemini' ? 'Gemini' : `Ollama (${serverEp})`
        writeLine(`\x1b[32mEngine: ${providerLabel} | Model: ${resolvedModel}\x1b[0m`)
      }

      return state.isConfigured
    } catch (error) {
      setIsConfigured(false)
      setAvailableModels([])
      setStatusMessage(`Offline at ${endpointUrlRef.current}`)
      if (announce) {
        const message = error instanceof Error ? error.message : 'Connection failed'
        writeLine(`\x1b[31m${message}\x1b[0m`)
      }
      return false
    }
  }, [writeLine])

  // ── Endpoint 입력 핸들러 ────────────────────────────────────
  const handleEndpointChange = useCallback((value: string) => {
    endpointUrlRef.current = value
    setEndpointUrl(value)
    setIsDirty(true)
    setIsApplySuccess(false)
  }, [])

  // ── 제공자 전환 ─────────────────────────────────────────────
  const handleProviderChange = useCallback(async (provider: string) => {
    setActiveProvider(provider)
    if (!isWebView2()) return
    try {
      await ai.setProvider(provider)
      await loadEngineState(false)
      writeLine(`\x1b[32mProvider: ${provider}\x1b[0m`)
    } catch (error) {
      writeLine(`\x1b[31mProvider 전환 실패: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m`)
    } finally {
      writePrompt()
    }
  }, [loadEngineState, writeLine, writePrompt])

  // ── 모델 선택 즉시 백엔드 적용 ─────────────────────────────
  const handleModelChange = useCallback(async (newModel: string) => {
    setCurrentModel(newModel)
    if (!isWebView2()) return
    try {
      await ai.setModel(newModel)
      writeLine(`\x1b[32mModel: ${newModel}\x1b[0m`)
    } catch (error) {
      writeLine(`\x1b[31mModel 변경 실패: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m`)
    } finally {
      writePrompt()
    }
  }, [writeLine, writePrompt])

  // ── 버튼 핸들러 ────────────────────────────────────────────

  const handleCheck = useCallback(async () => {
    setIsBusy(true)
    try {
      if (activeProvider === 'gemini') {
        if (apiKey.trim()) await ai.setApiKey('gemini', apiKey.trim())
      } else {
        await ai.setEndpoint(endpointUrlRef.current)
      }
      const connected = await loadEngineState(true)
      if (connected) {
        writeLine('\x1b[32m✓ 연결되었습니다\x1b[0m')
      }
      writeLine('\x1b[33mAI는 정확하지 않는 정보를 제공할 수 있습니다. 중요한 정보는 확인하세요\x1b[0m')
    } catch (error) {
      writeLine(`\x1b[31mCheck 실패: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m`)
    } finally {
      setIsBusy(false)
      writePrompt()
    }
  }, [activeProvider, apiKey, loadEngineState, writeLine, writePrompt])

  const handleApplySettings = useCallback(async () => {
    setIsBusy(true)
    try {
      if (activeProvider === 'gemini') {
        if (apiKey.trim()) await ai.setApiKey('gemini', apiKey.trim())
      } else {
        await ai.setEndpoint(endpointUrlRef.current)
      }
      await ai.setModel(currentModel)
      await ai.setSystem(systemPrompt)
      const connected = await loadEngineState(false)
      const appliedTo = activeProvider === 'gemini' ? 'Google Gemini' : endpointUrlRef.current
      writeLine(`\x1b[32mApplied: ${appliedTo} | ${currentModel}\x1b[0m`)
      if (connected) {
        writeLine('\x1b[32m✓ 연결되었습니다\x1b[0m')
        setIsDirty(false)
        setIsApplySuccess(true)
      } else {
        writeLine('\x1b[31m✗ 연결 실패 - 설정을 확인하세요\x1b[0m')
        setIsApplySuccess(false)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply settings'
      writeLine(`\x1b[31m${message}\x1b[0m`)
      setIsApplySuccess(false)
    } finally {
      setIsBusy(false)
      writePrompt()
    }
  }, [activeProvider, apiKey, currentModel, systemPrompt, loadEngineState, writeLine, writePrompt])

  // AI분석: 마지막 SSH 명령어 출력만 스트리밍 분석
  const handleAnalyzeClick = useCallback(async () => {
    const term = termRef.current
    if (!term) return

    setIsBusy(true)
    isProcessingRef.current = true
    term.writeln('')

    // ── 진행 중 인디케이터 (타이프라이터 효과, 15ms/글자) ──────────
    const thinkingMessages = [
      'AI가 지식의 바다를 헤엄치는 중! 잠시 후 최선의 답변을 가져다 드릴게요...',
      'AI 뉴런들이 전속력으로 달리는 중! 최고의 답변을 향해 질주하고 있습니다...',
      'AI가 수천만 개의 파라미터를 총동원 중! 최적의 답을 조합하고 있어요...',
      'AI가 도서관 백만 권을 동시에 검색하는 중! 핵심만 쏙 뽑아 드릴게요...',
      'AI 요리사가 답변을 정성껏 요리하는 중! 잠시만 기다리시면 곧 나옵니다...',
      'AI가 생각의 미로 속을 탐험하는 중! 최선의 경로를 찾고 있습니다...',
      'AI 회의실에서 수천 개의 의견이 충돌 중! 잠시 후 최종 결론이 나옵니다...',
      'AI가 은하수만큼 광활한 데이터를 스캔하는 중! 잠시 후 결과를 알려드립니다...',
      'AI 탐정이 최선의 답을 추적하는 중! 모든 단서를 수집하고 있어요...',
      'AI가 천재들의 집단 지성을 결집하는 중! 잠시 후 최고의 답변으로 돌아올게요...',
    ]
    const randomMsg = thinkingMessages[Math.floor(Math.random() * thinkingMessages.length)]
    const indicatorLines: { text: string; color: string }[] = [
      { text: ' ----------------------------------------------------------------------------', color: '\x1b[2;36m' },
      { text: `  ${randomMsg}`, color: '\x1b[36m' },
      { text: '  ※ AI는 정확하지 않는 정보를 제공할 수 있습니다. 중요한 정보는 반드시 확인하세요!', color: '\x1b[33m' },
      { text: ' ----------------------------------------------------------------------------', color: '\x1b[2;36m' },
    ]
    for (const { text, color } of indicatorLines) {
      term.write(color)
      for (const char of text) {
        if (!isProcessingRef.current) break
        term.write(char)
        await new Promise(r => setTimeout(r, 15))
      }
      term.write('\x1b[0m')
      if (isProcessingRef.current) term.write('\r\n')
    }
    term.write('\r\n')

    try {
      const result = await ai.analyzeLast((chunk) => {
        term.write(chunk)
      })
      term.writeln('')
      if (!result.content.trim()) {
        writeLine('\x1b[33mSSH 터미널에서 명령어를 실행한 후 다시 시도하세요.\x1b[0m')
      }
    } catch (error) {
      writeLine(`\x1b[31mError: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m`)
    } finally {
      isProcessingRef.current = false
      setIsBusy(false)
      writePrompt()
    }
  }, [writeLine, writePrompt])

  // ── 빌트인 커맨드 ──────────────────────────────────────────
  const printHelp = useCallback(() => {
    const term = termRef.current
    if (!term) return
    term.writeln('')
    term.writeln('\x1b[1;36m--- Local LLM Terminal Commands ---\x1b[0m')
    term.writeln('')
    term.writeln('  \x1b[33mengine status\x1b[0m              Check AI engine availability')
    term.writeln('  \x1b[33mmodel list\x1b[0m                List available models')
    term.writeln('  \x1b[33mmodel use <MODEL>\x1b[0m         Switch active model')
    term.writeln('  \x1b[33msystem set <PROMPT>\x1b[0m      Update system prompt')
    term.writeln('  \x1b[33manalyze last\x1b[0m             SSH 마지막 명령어 출력 AI 분석')
    term.writeln('  \x1b[33mstatus\x1b[0m                   Show AI engine state')
    term.writeln('  \x1b[33mclear\x1b[0m                    Clear terminal')
    term.writeln('  \x1b[33mreset\x1b[0m                    Clear conversation history')
    term.writeln('  \x1b[33mhelp\x1b[0m                     Show this help')
    term.writeln('')
    term.writeln('  Any other input is sent to the AI model.')
  }, [])

  const handleBuiltinCommand = useCallback(async (command: string): Promise<boolean> => {
    const normalized = command.trim()
    const lower = normalized.toLowerCase()
    const parts = normalized.split(/\s+/)

    if (lower === 'help') { printHelp(); return true }

    if (lower === 'clear') { termRef.current?.clear(); return true }

    if (lower === 'reset') {
      await ai.clear().catch(() => undefined)
      writeLine('\x1b[32mConversation history cleared.\x1b[0m')
      return true
    }

    if (lower === 'status' || lower === 'engine status') {
      await handleCheck()
      return true
    }

    if (lower === 'model list') {
      try {
        const result = await ai.models()
        setAvailableModels(result.models)
        writeLine('\x1b[1mAvailable Models:\x1b[0m')
        result.models.forEach((model) => {
          const marker = model === currentModel ? ' \x1b[32m<current>\x1b[0m' : ''
          writeLine(`  \x1b[33m${model}\x1b[0m${marker}`)
        })
      } catch (error) {
        writeLine(`\x1b[31m${error instanceof Error ? error.message : 'Failed to list models'}\x1b[0m`)
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
      await handleAnalyzeClick()
      return true
    }

    return false
  }, [currentModel, handleCheck, handleAnalyzeClick, printHelp, writeLine])

  // ── 메시지 전송 (스트리밍) ─────────────────────────────────
  const sendMessage = useCallback(async (message: string) => {
    const term = termRef.current
    if (!term || isProcessingRef.current) return

    isProcessingRef.current = true
    setIsStreaming(true)
    term.writeln('')

    if (!isWebView2()) {
      term.writeln('\x1b[31mWebView2 not available. Running in browser mode.\x1b[0m')
      term.writeln('\x1b[33mAI calls require the native WPF host.\x1b[0m')
      isProcessingRef.current = false
      setIsStreaming(false)
      return
    }

    // ── 진행 중 인디케이터 (타이프라이터 효과, 15ms/글자) ──────────
    const thinkingMessages = [
      'AI가 지식의 바다를 헤엄치는 중! 잠시 후 최선의 답변을 가져다 드릴게요...',
      'AI 뉴런들이 전속력으로 달리는 중! 최고의 답변을 향해 질주하고 있습니다...',
      'AI가 수천만 개의 파라미터를 총동원 중! 최적의 답을 조합하고 있어요...',
      'AI가 도서관 백만 권을 동시에 검색하는 중! 핵심만 쏙 뽑아 드릴게요...',
      'AI 요리사가 답변을 정성껏 요리하는 중! 잠시만 기다리시면 곧 나옵니다...',
      'AI가 생각의 미로 속을 탐험하는 중! 최선의 경로를 찾고 있습니다...',
      'AI 회의실에서 수천 개의 의견이 충돌 중! 잠시 후 최종 결론이 나옵니다...',
      'AI가 은하수만큼 광활한 데이터를 스캔하는 중! 잠시 후 결과를 알려드립니다...',
      'AI 탐정이 최선의 답을 추적하는 중! 모든 단서를 수집하고 있어요...',
      'AI가 천재들의 집단 지성을 결집하는 중! 잠시 후 최고의 답변으로 돌아올게요...',
    ]
    const randomMsg = thinkingMessages[Math.floor(Math.random() * thinkingMessages.length)]
    const indicatorLines: { text: string; color: string }[] = [
      { text: ' ----------------------------------------------------------------------------', color: '\x1b[2;36m' },
      { text: `  ${randomMsg}`, color: '\x1b[36m' },
      { text: '  ※ AI는 정확하지 않는 정보를 제공할 수 있습니다. 중요한 정보는 반드시 확인하세요!', color: '\x1b[33m' },
      { text: ' ----------------------------------------------------------------------------', color: '\x1b[2;36m' },
    ]
    for (const { text, color } of indicatorLines) {
      term.write(color)
      for (const char of text) {
        if (!isProcessingRef.current) break
        term.write(char)
        await new Promise(r => setTimeout(r, 15))
      }
      term.write('\x1b[0m')
      if (isProcessingRef.current) term.write('\r\n')
    }
    term.write('\r\n')

    try {
      const response = await ai.stream(message, (chunk) => {
        term.write(chunk)
      })
      term.writeln('')
      if (!response.content.trim()) {
        term.writeln('\x1b[33mNo content returned.\x1b[0m')
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      term.writeln(`\r\n\x1b[31mError: ${errorMsg}\x1b[0m`)
    } finally {
      isProcessingRef.current = false
      setIsStreaming(false)
    }
  }, [])

  // ── xterm 초기화 ───────────────────────────────────────────
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
    term.writeln('Type \x1b[33mhelp\x1b[0m for available commands.')

    if (isWebView2()) {
      // ── 초기 설정 점검 ───────────────────────────────────────
      ;(async () => {
        term.writeln('')
        term.writeln('\x1b[2;36m■ 초기 설정 점검 중...\x1b[0m')
        try {
          const connected = await loadEngineState(false)
          const state = await ai.state().catch(() => null)
          const provider = state?.provider || 'ollama'
          const model = state?.model || DEFAULT_MODEL
          const endpoint = provider === 'gemini'
            ? 'Google Gemini API'
            : (state?.baseUrl || endpointUrlRef.current)
          term.writeln(`\x1b[36m├─ Provider : ${provider === 'gemini' ? 'Google Gemini' : 'Ollama'}\x1b[0m`)
          term.writeln(`\x1b[36m├─ Endpoint : ${endpoint}\x1b[0m`)
          term.writeln(`\x1b[36m├─ Model    : ${model}\x1b[0m`)
          if (connected) {
            term.writeln('\x1b[32m└─ ✓ 연결 성공 | 바로 AI에게 질문하세요!\x1b[0m')
            setIsApplySuccess(true)
          } else {
            term.writeln('\x1b[31m└─ ✗ 연결 실패 | [Check] 버튼으로 재시도하세요\x1b[0m')
          }
        } catch {
          term.writeln('\x1b[31m└─ ✗ 초기화 실패 | 설정을 확인하세요\x1b[0m')
        }
        writePrompt()
      })()
    } else {
      writePrompt()
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
        if (!command) { writePrompt(); return }

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

    // 드래그 선택 → 클립보드 자동 복사
    term.onSelectionChange(() => {
      const selected = term.getSelection()
      if (selected) {
        navigator.clipboard.writeText(selected).catch(() => {})
      }
    })

    // 우클릭 → 클립보드에서 붙여넣기 (입력 버퍼에도 추가)
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
        .catch(() => {})
    }
    containerEl?.addEventListener('contextmenu', handleContextMenu)

    logger.info('Local LLM Terminal initialized')

    return () => {
      containerEl?.removeEventListener('contextmenu', handleContextMenu)
      term.dispose()
    }
  }, [handleBuiltinCommand, loadEngineState, sendMessage, writePrompt])

  // ── AI 30초 헬스체크 ──────────────────────────────────────
  useEffect(() => {
    if (!isWebView2()) return
    const timer = setInterval(async () => {
      try {
        const state = await ai.state()
        const serverEp = state.baseUrl || endpointUrlRef.current
        const provider = state.provider || 'ollama'
        setIsConfigured(state.isConfigured)
        const statusMsg = provider === 'gemini'
          ? (state.isConfigured ? 'Gemini Ready' : 'Gemini: API Key 없음')
          : (state.isConfigured ? `Ready on ${serverEp}` : `Offline at ${serverEp}`)
        setStatusMessage(statusMsg)
      } catch {
        setIsConfigured(false)
        setStatusMessage(`Offline at ${endpointUrlRef.current}`)
      }
    }, 30_000)
    return () => clearInterval(timer)
  }, [])

  // ── Cancel / Clear ─────────────────────────────────────────
  const handleCancel = async () => {
    try { await ai.cancelStream() } catch {}
    isProcessingRef.current = false
    setIsStreaming(false)
    termRef.current?.writeln('\r\n\x1b[33mCancelled\x1b[0m')
    writePrompt()
  }

  const handleClear = () => {
    termRef.current?.clear()
    writePrompt()
    inputBufferRef.current = ''
  }

  const isGemini = activeProvider === 'gemini'

  // ── 렌더 ───────────────────────────────────────────────────
  return (
    <div className="ai-terminal local-llm-terminal">
      <div className="terminal-header">
        <h2>Local LLM Terminal</h2>
        <div className="terminal-status">
          {isConfigured ? (
            <>
              <span className="status-badge connected">Ready</span>
              <span className="status-info">
                {isGemini ? 'Gemini' : engineName} | {currentModel}
              </span>
            </>
          ) : (
            <span className="status-badge disconnected">
              {isGemini ? 'Gemini Offline' : 'Ollama Offline'}
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
        <div className="llm-settings-panel">
          <div className="settings-grid">

            {/* ── Provider 선택 ─────────────────────────────── */}
            <div className="form-group">
              <label>AI Provider</label>
              <select
                value={activeProvider}
                onChange={(e) => handleProviderChange(e.target.value)}
                disabled={isBusy}
              >
                {providers.length > 0
                  ? providers.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))
                  : (
                    <>
                      <option value="ollama">Ollama (Local)</option>
                      <option value="gemini">Google Gemini</option>
                    </>
                  )
                }
              </select>
            </div>

            {/* ── Ollama: Endpoint / Gemini: API Key ─────────── */}
            {isGemini ? (
              <div className="form-group">
                <label>Gemini API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setIsDirty(true); setIsApplySuccess(false) }}
                  placeholder="AIza..."
                  autoComplete="off"
                />
              </div>
            ) : (
              <div className="form-group">
                <label>Engine Endpoint</label>
                <input
                  type="text"
                  value={endpointUrl}
                  onChange={(e) => handleEndpointChange(e.target.value)}
                  placeholder="http://172.16.1.103:11434"
                />
              </div>
            )}

            {/* ── Engine Status ───────────────────────────────── */}
            <div className="form-group">
              <label>Engine Status</label>
              <input type="text" value={statusMessage} readOnly />
            </div>

            {/* ── Model ──────────────────────────────────────── */}
            <div className="form-group">
              <label>Model</label>
              <select
                value={currentModel}
                onChange={(e) => handleModelChange(e.target.value)}
              >
                {!availableModels.includes(currentModel) && (
                  <option value={currentModel}>{currentModel}</option>
                )}
                {availableModels.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </div>

          </div>

          {/* ── 버튼 행 ──────────────────────────────────────── */}
          <div className="settings-button-row">
            <button type="button" onClick={handleCheck} disabled={isBusy}>
              Check
            </button>
            <button
              type="button"
              onClick={handleApplySettings}
              disabled={isBusy}
              style={isDirty
                ? { color: '#ffc107', borderColor: '#ffc107' }
                : isApplySuccess
                  ? { color: '#4caf50', borderColor: '#4caf50' }
                  : {}
              }
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setIsSystemPromptOpen(prev => !prev)}
            >
              시스템 프롬프트
            </button>
          </div>

          {isSystemPromptOpen && (
            <div className="form-group prompt-group">
              <label>System Prompt</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => { setSystemPrompt(e.target.value); setIsDirty(true); setIsApplySuccess(false) }}
                rows={3}
              />
            </div>
          )}
        </div>
      )}

      <div className="terminal-container" ref={resizeRef} style={{ flex: 1 }}>
        <div ref={terminalRef} className="terminal-content" />
      </div>
    </div>
  )
}
