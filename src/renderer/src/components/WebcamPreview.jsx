import { useRef, useEffect } from 'react'
import styles from './WebcamPreview.module.css'

function WebcamPreview({ stream }) {
  const videoRef = useRef(null)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  return (
    <div className={styles.webcam}>
      <video ref={videoRef} autoPlay muted playsInline className={styles.video} />
    </div>
  )
}

export default WebcamPreview
