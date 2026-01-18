import { useState, useEffect } from 'react'

// Get the current window
export const getCurrentWindow = () => {
  return window.__TAURI__.window.getCurrentWindow()
}

// Hook to get Tauri window controls
export const useTauriWindow = () => {
  const [appWindow, setAppWindow] = useState(null)

  useEffect(() => {
    setAppWindow(getCurrentWindow())
  }, [])

  const minimize = () => appWindow?.minimize()
  const maximize = async () => {
    if (appWindow) {
      if (await appWindow.isMaximized()) {
        appWindow.unmaximize()
      } else {
        appWindow.maximize()
      }
    }
  }
  const close = () => appWindow?.close()

  const setSize = async (width, height) => {
    if (appWindow) {
      await appWindow.setSize(new window.__TAURI__.dpi.LogicalSize(width, height))
    }
  }

  const getSize = async () => {
    if (appWindow) {
      const size = await appWindow.innerSize()
      return {
        width: size.width / window.devicePixelRatio,
        height: size.height / window.devicePixelRatio
      }
    }
    return { width: 800, height: 500 }
  }

  return {
    appWindow,
    minimize,
    maximize,
    close,
    setSize,
    getSize
  }
}
