import { useState, useCallback, useRef } from 'react'
import { SSHConnection, SSHConnectionState } from '@types/ssh'
import { ssh } from '@bridge/ipcBridge'
import { logger } from '@utils/logger'

export function useSSHConnection() {
  const [state, setState] = useState<SSHConnectionState>({
    isConnected: false,
    isConnecting: false,
  })
  const [lastCommand, setLastCommand] = useState<string>('')
  const commandHistoryRef = useRef<string[]>([])

  const connect = useCallback(async (connection: SSHConnection) => {
    try {
      setState(prev => ({ ...prev, isConnecting: true, error: undefined }))

      const result = await ssh.connect({
        host: connection.host,
        port: connection.port,
        username: connection.username,
        password: connection.password,
        privateKey: connection.privateKey,
        passphrase: connection.passphrase,
      })

      if (!result.success) {
        throw new Error(result.error || 'Connection failed')
      }

      setState(prev => ({
        ...prev,
        isConnected: true,
        isConnecting: false,
        connection,
        connectionTime: new Date(),
      }))

      logger.info('SSH connection established', { host: connection.host })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed'

      setState(prev => ({
        ...prev,
        isConnected: false,
        isConnecting: false,
        error: errorMessage,
      }))

      logger.error('SSH connection failed', { error: errorMessage })
      throw error
    }
  }, [])

  const disconnect = useCallback(async () => {
    try {
      await ssh.disconnect()
      setState({ isConnected: false, isConnecting: false })
      logger.info('SSH disconnected')
    } catch (error) {
      logger.error('SSH disconnect error', { error })
    }
  }, [])

  const execCommand = useCallback(
    async (command: string): Promise<string> => {
      if (!state.isConnected) {
        throw new Error('SSH not connected')
      }

      try {
        setLastCommand(command)
        commandHistoryRef.current.push(command)

        const result = await ssh.exec(command)
        return result.output
      } catch (error) {
        logger.error('Command execution failed', {
          command: command.substring(0, 100),
          error,
        })
        throw error
      }
    },
    [state.isConnected]
  )

  const getCommandHistory = useCallback(() => {
    return [...commandHistoryRef.current]
  }, [])

  const clearHistory = useCallback(() => {
    commandHistoryRef.current = []
  }, [])

  const shellWrite = useCallback(async (data: string): Promise<void> => {
    await ssh.shellWrite(data)
  }, [])

  const shellRead = useCallback(async (): Promise<string | null> => {
    const result = await ssh.shellRead()
    return result.data
  }, [])

  return {
    state,
    connect,
    disconnect,
    execCommand,
    shellWrite,
    shellRead,
    lastCommand,
    getCommandHistory,
    clearHistory,
  }
}
