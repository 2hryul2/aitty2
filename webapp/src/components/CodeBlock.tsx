import { useState, useCallback, useMemo } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { checkCommandSafety, formatSafetyAlert, type SafetyLevel } from '@utils/commandSafety'

interface CodeBlockProps {
  language: string
  code: string
  sshConnected?: boolean
  onRunCommand?: (command: string) => void
}

const SAFETY_BUTTON_CONFIG: Record<Exclude<SafetyLevel, 'safe'>, { label: string; className: string; badge: string }> = {
  danger:  { label: '🚫 Blocked', className: 'code-action-danger',  badge: '🔴 위험' },
  caution: { label: '⚠️ Blocked', className: 'code-action-caution', badge: '🟠 주의' },
  warning: { label: '⚠ Blocked',  className: 'code-action-warning', badge: '🟡 경고' },
}

export default function CodeBlock({ language, code, sshConnected, onRunCommand }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const isShellLang = !language || ['bash', 'sh', 'zsh', 'shell', 'console', 'text'].includes(language.toLowerCase())
  const safety = useMemo(() => isShellLang ? checkCommandSafety(code) : { level: 'safe' as SafetyLevel }, [code, isShellLang])
  const isBlocked = safety.level !== 'safe'

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard not available */ }
  }, [code])

  const handleRun = useCallback(() => {
    if (isBlocked) {
      alert(formatSafetyAlert(safety))
      return
    }
    onRunCommand?.(code)
  }, [code, onRunCommand, isBlocked, safety])

  const btnConfig = isBlocked ? SAFETY_BUTTON_CONFIG[safety.level as Exclude<SafetyLevel, 'safe'>] : null

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">
          {language || 'text'}
          {isBlocked && btnConfig && (
            <span className={`code-safety-badge ${safety.level}`}>{btnConfig.badge}</span>
          )}
        </span>
        <div className="code-block-actions">
          <button className="code-action-btn" onClick={handleCopy} title="Copy to clipboard">
            {copied ? '✓ Copied' : '📋 Copy'}
          </button>
          {sshConnected && onRunCommand && (
            <button
              className={`code-action-btn ${isBlocked && btnConfig ? btnConfig.className : 'code-action-run'}`}
              onClick={handleRun}
              disabled={isBlocked}
              title={isBlocked ? formatSafetyAlert(safety) : 'Run in SSH Terminal'}
            >
              {isBlocked && btnConfig ? btnConfig.label : '▶ Run'}
            </button>
          )}
        </div>
      </div>
      {isBlocked && safety.alternative && (
        <div className="code-safety-hint">
          💡 안전한 대안: <code>{safety.alternative}</code>
        </div>
      )}
      <SyntaxHighlighter
        language={language || 'text'}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          borderRadius: '0 0 6px 6px',
          fontSize: '12px',
          lineHeight: '1.4',
        }}
        wrapLongLines
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}
