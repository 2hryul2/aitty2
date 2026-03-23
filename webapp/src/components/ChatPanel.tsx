import { useEffect, useRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '@app-types/chat'
import CodeBlock from './CodeBlock'
import ThinkingIndicator from './ThinkingIndicator'
import '@styles/chat.css'

interface ChatPanelProps {
  messages: ChatMessage[]
  isStreaming: boolean
  sshConnected?: boolean
  onRunCommand?: (command: string) => void
}

export default function ChatPanel({ messages, isStreaming, sshConnected, onRunCommand }: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const markdownComponents = useMemo(() => ({
    code({ className, children, ...props }: { className?: string; children?: React.ReactNode; [key: string]: unknown }) {
      const match = /language-(\w+)/.exec(className || '')
      const codeStr = String(children).replace(/\n$/, '')

      if (match) {
        return (
          <CodeBlock
            language={match[1]}
            code={codeStr}
            sshConnected={sshConnected}
            onRunCommand={onRunCommand}
          />
        )
      }

      return (
        <code className="inline-code" {...props}>
          {children}
        </code>
      )
    },
  }), [sshConnected, onRunCommand])

  if (messages.length === 0) {
    return (
      <div className="chat-panel chat-panel-empty">
        <div className="chat-empty-message">
          <span className="chat-empty-icon">💬</span>
          <p>메시지를 입력하거나 <strong>AI분석</strong> 버튼을 눌러보세요.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-panel" ref={scrollRef}>
      {messages.map((msg) => (
        <div key={msg.id} className={`chat-bubble ${msg.role}`}>
          {msg.role === 'user' ? (
            <div className="chat-bubble-content">{msg.content}</div>
          ) : (
            <div className="chat-bubble-content">
              {msg.isStreaming && !msg.content ? (
                <ThinkingIndicator />
              ) : (
                <>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {msg.content || ' '}
                  </ReactMarkdown>
                  {msg.isStreaming && <span className="streaming-cursor" />}
                </>
              )}
            </div>
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
