import { useState, useEffect, useRef } from 'react'
import { THINKING_MESSAGES } from '@hooks/useAITerminal'

const DISCLAIMER = '※ AI는 정확하지 않는 정보를 제공할 수 있습니다. 중요한 정보는 반드시 확인하세요!'
const SEPARATOR = '─────────────────────────────────────────'
const CHAR_DELAY = 15 // ms per character

export default function ThinkingIndicator() {
  const [displayText, setDisplayText] = useState('')
  const fullTextRef = useRef('')

  useEffect(() => {
    const randomMsg = THINKING_MESSAGES[Math.floor(Math.random() * THINKING_MESSAGES.length)]
    const fullText = `${SEPARATOR}\n ${randomMsg}\n ${DISCLAIMER}\n${SEPARATOR}`
    fullTextRef.current = fullText

    let idx = 0
    const timer = setInterval(() => {
      idx++
      if (idx <= fullText.length) {
        setDisplayText(fullText.slice(0, idx))
      } else {
        clearInterval(timer)
      }
    }, CHAR_DELAY)

    return () => clearInterval(timer)
  }, [])

  const isDone = displayText.length >= fullTextRef.current.length

  return (
    <div className="thinking-indicator">
      <pre className="thinking-text">{displayText}</pre>
      {isDone && <span className="streaming-cursor" />}
    </div>
  )
}
