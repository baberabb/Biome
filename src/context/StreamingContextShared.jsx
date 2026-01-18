import { createContext, useContext } from 'react'

// Shared streaming context
export const StreamingContext = createContext(null)

export const useStreaming = () => {
  const context = useContext(StreamingContext)
  if (!context) {
    throw new Error('useStreaming must be used within a StreamingProvider')
  }
  return context
}
