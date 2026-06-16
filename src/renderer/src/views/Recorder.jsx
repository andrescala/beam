import { useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import SourcePicker from '../components/SourcePicker'
import Countdown from '../components/Countdown'
import RecordingControls from '../components/RecordingControls'
import WebcamPreview from '../components/WebcamPreview'
import { useToast } from '../components/Toast'
import useRecorder from '../hooks/useRecorder'
import styles from './Recorder.module.css'

function Recorder() {
  const navigate = useNavigate()
  const showToast = useToast()
  const {
    state,
    elapsed,
    selectedSource,
    webcamEnabled,
    systemAudioEnabled,
    webcamStream,
    fps,
    captureMode,
    region,
    selectSource,
    setWebcamEnabled,
    setSystemAudioEnabled,
    setFps,
    setCaptureMode,
    setRegion,
    startCountdown,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording
  } = useRecorder()

  const handleStop = useCallback(async () => {
    try {
      const projectId = await stopRecording()
      if (projectId) {
        showToast('success', 'Recording saved')
        navigate(`/editor/${projectId}`)
      } else {
        showToast('error', 'Recording failed — no project created')
        navigate('/')
      }
    } catch (err) {
      console.error('Stop recording failed:', err)
      showToast('error', 'Failed to save recording')
      navigate('/')
    }
  }, [stopRecording, navigate, showToast])

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e) {
      // Only handle shortcuts during recording/paused states
      if (state === 'recording') {
        if (e.code === 'Space' || e.key === 'p') {
          e.preventDefault()
          pauseRecording()
        } else if (e.key === 'Escape' || e.key === 's') {
          e.preventDefault()
          handleStop()
        }
      } else if (state === 'paused') {
        if (e.code === 'Space' || e.key === 'p') {
          e.preventDefault()
          resumeRecording()
        } else if (e.key === 'Escape' || e.key === 's') {
          e.preventDefault()
          handleStop()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state, pauseRecording, resumeRecording, handleStop])

  // Global record hotkey (Cmd/Ctrl+Shift+R): stop if recording. App.jsx
  // routes the event here when this view is already mounted.
  useEffect(() => {
    function handleRecordToggle() {
      if (state === 'recording' || state === 'paused') {
        handleStop()
      }
    }
    window.addEventListener('beam:record-toggle', handleRecordToggle)
    return () => window.removeEventListener('beam:record-toggle', handleRecordToggle)
  }, [state, handleStop])

  if (state === 'idle') {
    return (
      <SourcePicker
        onSelect={selectSource}
        onCancel={() => navigate('/')}
        webcamEnabled={webcamEnabled}
        onWebcamToggle={setWebcamEnabled}
        systemAudioEnabled={systemAudioEnabled}
        onSystemAudioToggle={setSystemAudioEnabled}
        onStart={startCountdown}
        selectedSource={selectedSource}
        fps={fps}
        onFpsChange={setFps}
        captureMode={captureMode}
        onCaptureModeChange={setCaptureMode}
        region={region}
        onRegionChange={setRegion}
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
