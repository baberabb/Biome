import { usePortal } from '../context/PortalContext'

const ShutdownOverlay = () => {
  const { isShuttingDown } = usePortal()

  return (
    <div className={`shutdown-overlay ${isShuttingDown ? 'active' : ''}`}>
      <div className="shutdown-background"></div>
    </div>
  )
}

export default ShutdownOverlay
