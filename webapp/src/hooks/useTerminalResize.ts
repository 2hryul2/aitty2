import { useEffect, useRef, useCallback } from 'react'

export interface TerminalSize {
  cols: number
  rows: number
  width: number
  height: number
}

const DEFAULT_CHAR_WIDTH = 8
const DEFAULT_CHAR_HEIGHT = 16

export function useTerminalResize(onResize?: (size: TerminalSize) => void) {
  const containerRef = useRef<HTMLDivElement>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const onResizeRef = useRef(onResize)

  // Keep ref in sync with latest callback
  useEffect(() => {
    onResizeRef.current = onResize
  }, [onResize])

  const updateSize = useCallback(() => {
    if (!containerRef.current) return

    const { width, height } = containerRef.current.getBoundingClientRect()

    const cols = Math.floor(width / DEFAULT_CHAR_WIDTH)
    const rows = Math.floor(height / DEFAULT_CHAR_HEIGHT)

    if (cols > 0 && rows > 0) {
      onResizeRef.current?.({
        cols,
        rows,
        width,
        height,
      })
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    resizeObserverRef.current = new ResizeObserver(() => {
      updateSize()
    })

    resizeObserverRef.current.observe(containerRef.current)
    updateSize()

    const handleWindowResize = () => updateSize()
    window.addEventListener('resize', handleWindowResize)

    return () => {
      resizeObserverRef.current?.disconnect()
      window.removeEventListener('resize', handleWindowResize)
    }
  }, [updateSize])

  return containerRef
}
