import { useNavigate } from 'react-router-dom'
import SourcePicker from '../components/SourcePicker'
import Countdown from '../components/Countdown'
import RecordingControls from '../components/RecordingControls'
import WebcamPreview from '../components/WebcamPreview'
import useRecorder from '../hooks/useRecorder'
import styles from './Recorder.module.css'

function Recorder() {
  const navigate = useNavigate()
  const {
    state,
    elapsed,
    selectedSource,
    webcamEnabled,
    webcamStream,
    selectSource,
    setWebcamEnabled,
    startCountdown,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording
  } = useRecorder()

  async function handleStop() {
    try {
      const projectId = await stopRecording()
      if (projectId) {
        navigate(`/editor/${projectId}`)
      } else {
        // Something went wrong but we have no project — go home
        navigate('/')
      }
    } catch (err) {
      console.error('Stop recording failed:', err)
      navigate('/')
    }
  }

  if (state === 'idle') {
    return (
      <SourcePicker
        onSelect={selectSource}
        onCancel={() => navigate('/')}
        webcamEnabled={webcamEnabled}
        onWebcamToggle={setWebcamEnabled}
        onStart={startCountdown}
        selectedSource={selectedSource}
      />
    )
  }

  if (state === 'countdown') {
    return <Countdown onComplete={startRecording} />
  }

  if (state === 'saving') {
    return (
      <div className={styles.savingOverlay}>
        <div className={styles.savingContent}>
          <div className={styles.spinner} />
          <div className={styles.savingText}>Saving recording...</div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.recordingOverlay}>
      <RecordingControls
        state={state}
        elapsed={elapsed}
        onPause={pauseRecording}
        onResume={resumeRecording}
        onStop={handleStop}
      />
      {webcamEnabled && webcamStream && (
        <WebcamPreview stream={webcamStream} />
      )}
    </div>
  )
}

export default Recorder
