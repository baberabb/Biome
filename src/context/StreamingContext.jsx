import { useState, useEffect, useRef, useCallback } from 'react'
import { StreamingContext, useStreaming } from './StreamingContextShared'
import { usePortal } from './PortalContext'
import useWebSocket from '../hooks/useWebSocket'
import useGameInput from '../hooks/useGameInput'
import useConfig from '../hooks/useConfig'
import useEngine from '../hooks/useEngine'
import { createLogger } from '../utils/logger'

const log = createLogger('Streaming')

// Re-export useStreaming for backwards compatibility
export { useStreaming }

export const StreamingProvider = ({ children }) => {
  const { state, states, transitionTo, shutdown, isConnected: portalConnected } = usePortal()
  const containerRef = useRef(null)
  const canvasRef = useRef(null)

  // Config hook for GPU server settings and API keys
  const { config, isLoaded: configLoaded, reloadConfig, saveConfig, hasOpenAiKey, hasFalKey } = useConfig()

  // Engine hook for standalone server management
  const {
    startServer,
    stopServer,
    isServerRunning,
    isReady: engineReady,
    checkStatus: checkEngineStatus,
    serverLogPath
  } = useEngine()

  const {
    connectionState,
    statusCode,
    error,
    frame,
    frameId,
    genTime,
    connect,
    disconnect,
    sendControl,
    sendPause,
    sendPrompt,
    sendPromptWithSeed,
    reset,
    isConnected,
    isReady,
    isLoading
  } = useWebSocket()

  const [isPaused, setIsPaused] = useState(false)
  const [pausedAt, setPausedAt] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [mouseSensitivity, setMouseSensitivity] = useState(1.0)

  // Bottom panel visibility (persisted in config)
  const bottomPanelHidden = config?.ui?.bottom_panel_hidden ?? false
  const setBottomPanelHidden = useCallback(
    async (hidden) => {
      await saveConfig({
        ...config,
        ui: {
          ...config.ui,
          bottom_panel_hidden: hidden
        }
      })
    },
    [config, saveConfig]
  )
  const [fps, setFps] = useState(0)
  const [connectionLost, setConnectionLost] = useState(false)
  const [engineError, setEngineError] = useState(null)

  // Local endpoint URL (user provides this instead of VIP key)
  const [endpointUrl, setEndpointUrl] = useState(null)

  // Track when canvas element is registered
  const [canvasReady, setCanvasReady] = useState(false)

  // Track when first frame is received (for isVideoReady)
  const hasReceivedFrame = frame !== null

  // Track if we were attempting/had a connection (to detect connection loss)
  const wasConnectingOrConnectedRef = useRef(false)

  const isStreaming = state === states.STREAMING
  const inputEnabled = isStreaming && isReady && !isPaused && !settingsOpen

  // FPS counter
  const frameCountRef = useRef(0)
  const lastFpsUpdateRef = useRef(performance.now())

  // Check engine status on mount (for standalone mode)
  useEffect(() => {
    if (config.features?.use_standalone_engine) {
      checkEngineStatus()
    }
  }, [config.features?.use_standalone_engine, checkEngineStatus])

  // Pointer lock controls
  const requestPointerLock = useCallback(() => {
    if (containerRef?.current) {
      containerRef.current.requestPointerLock()
    }
  }, [])

  const exitPointerLock = useCallback(() => {
    if (document.pointerLockElement) {
      document.exitPointerLock()
    }
  }, [])

  const togglePointerLock = useCallback(() => {
    if (!isStreaming || !isReady) return
    if (document.pointerLockElement) {
      document.exitPointerLock()
    } else {
      containerRef.current?.requestPointerLock()
    }
  }, [isStreaming, isReady])

  // Reset and resume feed (used by U key handler)
  const handleReset = useCallback(() => {
    reset()
    requestPointerLock()
  }, [reset, requestPointerLock])

  const { pressedKeys, getInputState, isPointerLocked } = useGameInput(
    inputEnabled,
    containerRef,
    handleReset,
    togglePointerLock
  )

  const inputLoopRef = useRef(null)

  // Sync settings/pause state with pointer lock
  useEffect(() => {
    if (!isStreaming || !isReady) return

    if (isPointerLocked) {
      if (settingsOpen || isPaused) {
        setSettingsOpen(false)
        setIsPaused(false)
        setPausedAt(null)
        sendPause(false)
        log.info('Pointer locked - settings closed, resumed')
      }
    } else {
      if (!settingsOpen && !isPaused) {
        setSettingsOpen(true)
        setIsPaused(true)
        setPausedAt(Date.now())
        sendPause(true)
        log.info('Pointer unlocked - settings opened, paused')
      }
    }
  }, [isPointerLocked, isStreaming, isReady, settingsOpen, isPaused, sendPause])

  // Connect when entering WARM state with endpoint URL
  // If standalone engine is enabled, start the server first
  useEffect(() => {
    if (state !== states.WARM) return

    const connectToServer = async () => {
      const useStandalone = config.features?.use_standalone_engine
      const { host, port } = config.gpu_server

      // Clear any previous engine error
      setEngineError(null)

      // If standalone engine is enabled and server isn't running, start it
      if (useStandalone && !isServerRunning) {
        log.info('Standalone engine enabled - starting server on port', port)

        // Check if engine is ready (dependencies installed)
        await checkEngineStatus()
        if (!engineReady) {
          const errorMsg = 'Engine not ready - please run setup in Settings first'
          log.error(errorMsg)
          setEngineError(errorMsg)
          transitionTo(states.COLD)
          return
        }

        try {
          await startServer(port)
          log.info('Server started, waiting for it to be ready...')
          // Give the server a moment to start up before connecting
          await new Promise((resolve) => setTimeout(resolve, 2000))
        } catch (err) {
          const errorMsg = err?.message || String(err)
          log.error('Failed to start server:', errorMsg)
          setEngineError(errorMsg)
          transitionTo(states.COLD)
          return
        }
      }

      // Build WebSocket URL
      let wsUrl
      if (endpointUrl) {
        // User-provided URL from terminal input - connect directly
        wsUrl = endpointUrl
      } else {
        // Build from config: host:port (useWebSocket adds ws:// and /ws)
        wsUrl = `${host}:${port}`
      }

      log.info('WARM state - connecting to local WebSocket endpoint:', wsUrl)
      wasConnectingOrConnectedRef.current = true
      connect(wsUrl)
    }

    connectToServer()
  }, [state, states.WARM, states.COLD, endpointUrl, config.gpu_server, config.features?.use_standalone_engine, connect, isServerRunning, engineReady, startServer, checkEngineStatus, transitionTo])

  // Transition to HOT when we've received frames
  useEffect(() => {
    if (state === states.WARM && hasReceivedFrame && canvasReady) {
      log.info('First frame received - transitioning to HOT')
      transitionTo(states.HOT)
    }
  }, [state, states.WARM, states.HOT, hasReceivedFrame, canvasReady, transitionTo])

  // Transition to STREAMING when HOT and fully ready
  useEffect(() => {
    if (state === states.HOT && portalConnected && isReady) {
      log.info('Fully ready - transitioning to STREAMING')
      transitionTo(states.STREAMING)
    }
  }, [state, states.HOT, states.STREAMING, portalConnected, isReady, transitionTo])

  // Auto-grab cursor when entering STREAMING state
  useEffect(() => {
    if (state === states.STREAMING && isReady && containerRef.current) {
      log.info('Auto-requesting pointer lock on stream start')
      containerRef.current.requestPointerLock()
    }
  }, [state, states.STREAMING, isReady])

  // Disconnect when leaving streaming states
  useEffect(() => {
    if (state !== states.WARM && state !== states.HOT && state !== states.STREAMING) {
      disconnect()
      exitPointerLock()
      setSettingsOpen(false)
      setIsPaused(false)
      setPausedAt(null)
    }
  }, [state, states.WARM, states.HOT, states.STREAMING, disconnect, exitPointerLock])

  // Handle connection errors during WARM state - go back to COLD with error
  useEffect(() => {
    if (state === states.WARM && (connectionState === 'error' || connectionState === 'disconnected')) {
      // Connection failed during warm-up - show error and go back to COLD
      if (wasConnectingOrConnectedRef.current) {
        log.error('Connection failed during WARM state')
        const errorMsg = error || 'Connection failed - server may have crashed'
        setEngineError(errorMsg)
        wasConnectingOrConnectedRef.current = false
        transitionTo(states.COLD)
      }
    }
  }, [state, states.WARM, states.COLD, connectionState, error, transitionTo])

  // Timeout for WARM state - if we don't receive frames within 60 seconds, give up
  useEffect(() => {
    if (state !== states.WARM) return

    const timeoutId = setTimeout(() => {
      if (state === states.WARM && !hasReceivedFrame) {
        log.error('Connection timeout - no frames received within 60 seconds')
        setEngineError('Connection timeout - server failed to respond')
        disconnect()
        transitionTo(states.COLD)
      }
    }, 60000) // 60 second timeout

    return () => clearTimeout(timeoutId)
  }, [state, states.WARM, states.COLD, hasReceivedFrame, disconnect, transitionTo])

  // Detect connection loss - show overlay when connection drops during HOT/STREAMING
  useEffect(() => {
    const isInConnectionState = state === states.HOT || state === states.STREAMING

    // Track when we enter a connection state
    if (isInConnectionState && (connectionState === 'connecting' || connectionState === 'connected')) {
      wasConnectingOrConnectedRef.current = true
    }

    // Detect connection loss: we were connecting/connected but now disconnected or errored
    if (
      wasConnectingOrConnectedRef.current &&
      isInConnectionState &&
      (connectionState === 'disconnected' || connectionState === 'error')
    ) {
      log.info('Connection lost detected')
      setConnectionLost(true)
    }

    // Reset tracking when we leave connection states (back to COLD)
    if (state === states.COLD) {
      wasConnectingOrConnectedRef.current = false
      setConnectionLost(false)
    }
  }, [connectionState, state, states.HOT, states.STREAMING, states.COLD])

  // Render frames to canvas
  useEffect(() => {
    if (!frame || !canvasRef.current || !canvasReady) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Count frames for FPS
    frameCountRef.current++
    const now = performance.now()
    if (now - lastFpsUpdateRef.current >= 1000) {
      setFps(frameCountRef.current)
      frameCountRef.current = 0
      lastFpsUpdateRef.current = now
    }

    // Decode base64 frame and draw to canvas
    const img = new Image()
    img.onload = () => {
      // Resize canvas if needed
      if (canvas.width !== img.width || canvas.height !== img.height) {
        canvas.width = img.width
        canvas.height = img.height
      }
      ctx.drawImage(img, 0, 0)
    }
    img.src = `data:image/jpeg;base64,${frame}`
  }, [frame, canvasReady])

  // Input loop at 60hz
  useEffect(() => {
    if (!inputEnabled) {
      if (inputLoopRef.current) {
        clearInterval(inputLoopRef.current)
        inputLoopRef.current = null
      }
      return
    }

    inputLoopRef.current = setInterval(() => {
      const { buttons, mouseDx, mouseDy } = getInputState()
      // Apply mouse sensitivity multiplier
      const adjustedDx = Math.round(mouseDx * mouseSensitivity)
      const adjustedDy = Math.round(mouseDy * mouseSensitivity)
      sendControl(buttons, adjustedDx, adjustedDy)
    }, 16)

    return () => {
      if (inputLoopRef.current) {
        clearInterval(inputLoopRef.current)
        inputLoopRef.current = null
      }
    }
  }, [inputEnabled, getInputState, sendControl, mouseSensitivity])

  const registerContainerRef = useCallback((element) => {
    containerRef.current = element
  }, [])

  const registerCanvasRef = useCallback((element) => {
    canvasRef.current = element
    setCanvasReady(!!element)
  }, [])

  const handleContainerClick = useCallback(() => {
    if (isStreaming && isReady) {
      requestPointerLock()
    }
  }, [isStreaming, isReady, requestPointerLock])

  const logout = useCallback(async () => {
    log.info('Logout initiated')
    exitPointerLock()
    disconnect()
    setSettingsOpen(false)
    setIsPaused(false)
    setPausedAt(null)

    // Stop standalone server if it was started
    if (config.features?.use_standalone_engine && isServerRunning) {
      log.info('Stopping standalone server...')
      try {
        await stopServer()
        log.info('Server stopped')
      } catch (err) {
        log.error('Failed to stop server:', err)
      }
    }

    await shutdown()
    log.info('Logout complete')
  }, [disconnect, exitPointerLock, shutdown, config.features?.use_standalone_engine, isServerRunning, stopServer])

  // Dismiss connection lost overlay and return to COLD state
  const dismissConnectionLost = useCallback(async () => {
    log.info('Dismissing connection lost overlay')
    setConnectionLost(false)
    wasConnectingOrConnectedRef.current = false
    exitPointerLock()
    disconnect()
    setSettingsOpen(false)
    setIsPaused(false)
    setPausedAt(null)

    // Stop standalone server if it was started
    if (config.features?.use_standalone_engine && isServerRunning) {
      log.info('Stopping standalone server...')
      try {
        await stopServer()
      } catch (err) {
        log.error('Failed to stop server:', err)
      }
    }

    await shutdown()
  }, [disconnect, exitPointerLock, shutdown, config.features?.use_standalone_engine, isServerRunning, stopServer])

  const value = {
    // Connection state
    connectionState,
    connectionLost,
    error,
    isConnected,
    isVideoReady: hasReceivedFrame && canvasReady, // Ready when we have frames and canvas
    isReady,
    isLoading,
    isStreaming,
    isPaused,
    pausedAt,
    settingsOpen,
    statusCode,

    // Stats
    genTime,
    frameId,
    fps,
    showStats,
    setShowStats,

    // Local mode - no session management
    sessionRemaining: null,
    sessionExpired: false,
    sessionTimeDisplay: null,
    gpuAssignment: null,
    setGpuAssignment: () => {},
    endpointUrl,
    setEndpointUrl,

    // Config for standalone mode
    config,
    configLoaded,
    reloadConfig,
    hasOpenAiKey,
    hasFalKey,

    // Standalone engine state
    isServerRunning,
    engineReady,
    engineError,
    clearEngineError: () => setEngineError(null),
    serverLogPath,

    // Settings
    mouseSensitivity,
    setMouseSensitivity,
    bottomPanelHidden,
    setBottomPanelHidden,

    // Input state
    pressedKeys,
    isPointerLocked,

    // Actions
    connect,
    disconnect,
    logout,
    dismissConnectionLost,
    reset,
    sendPrompt,
    sendPromptWithSeed,
    requestPointerLock,
    exitPointerLock,
    registerContainerRef,
    registerCanvasRef,
    registerVideoRef: () => {}, // No-op, WebSocket mode uses canvas
    handleContainerClick
  }

  return <StreamingContext.Provider value={value}>{children}</StreamingContext.Provider>
}

export default StreamingContext
