const PauseOverlay = ({ isActive }) => {
  return (
    <div className={`pause-overlay ${isActive ? 'active' : ''}`} id="pause-overlay">
      <div className="pause-scanlines"></div>
      <span className="pause-indicator">PAUSED</span>
    </div>
  )
}

export default PauseOverlay
