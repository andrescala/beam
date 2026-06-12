import { useState, useRef, useEffect } from 'react'

export default function useRecorder() {
  const [state, setState] = useState('idle') // idle, countdown, recording, paused, saving, stopped
  const [elapsed, setElapsed] = useState(0)
  const [selectedSource, setSelectedSource] = useState(null)
  const [webcamEnabled, setWebcamEnabledState] = useState(false)
  const [systemAudioEnabled, setSystemAudioEnabledState] = useState(false)
  const [webcamStream, setWebcamStream] = useState(null)

  const screenRecorderRef = useRef(null)
  const webcamRecorderRef = useRef(null)
  const micRecorderRef = useRef(null)
  const systemRecorderRef = useRef(null)
  const screenChunksRef = useRef([])
  const webcamChunksRef = useRef([])
  const micChunksRef = useRef([])
  const systemChunksRef = useRef([])
  const timerRef = useRef(null)
  const startTimeRef = useRef(0)
  const elapsedBeforePauseRef = useRef(0)
  const projectIdRef = useRef(null)
  const screenStreamRef = useRef(null)
  const webcamStreamRef = useRef(null)
  const micStreamRef = useRef(null)
  // Track elapsed in a ref so the onstop closure always has the latest value
  const elapsedRef = useRef(0)

  // Load recording preferences on mount
  useEffect(() => {
    window.electronAPI.getPreferences().then((prefs) => {
      setWebcamEnabledState(prefs.webcamEnabled ?? false)
      setSystemAudioEnabledState(prefs.systemAudioEnabled ?? false)
    }).catch(() => {})
    return () => cleanup()
  }, [])

  // Persist webcam toggle to preferences
  function setWebcamEnabled(enabled) {
    setWebcamEnabledState(enabled)
    window.electronAPI.setPreferences({ webcamEnabled: enabled }).catch(() => {})
  }

  // Persist system-audio toggle to preferences
  function setSystemAudioEnabled(enabled) {
    setSystemAudioEnabledState(enabled)
    window.electronAPI.setPreferences({ systemAudioEnabled: enabled }).catch(() => {})
  }

  function cleanup() {
    clearInterval(timerRef.current)
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop())
    }
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((t) => t.stop())
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop())
    }
  }

  function selectSource(source) {
    setSelectedSource(source)
  }

  // Pre-warm everything before the countdown so the moment it ends we can
  // call MediaRecorder.start() instantly with no async setup gap. This
  // prevents the recorder from missing the first 300–500ms after countdown
  // (and stops Chrome from dumping buffered "warmup" audio into the file).
  async function startCountdown() {
    if (!selectedSource) return
    try {
      // Create project + acquire all streams + build recorders, BUT do not
      // call .start() yet. The Countdown component's onComplete will call
      // startRecording() which just fires the .start()s synchronously.
      const project = await window.electronAPI.createProject(
        `Recording — ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      )
      projectIdRef.current = project.id

      await window.electronAPI.setCaptureSource(selectedSource.id)

      // Preferred input devices (set in the source picker)
      let prefs = {}
      try {
        prefs = await window.electronAPI.getPreferences()
      } catch {
        // fall back to defaults
      }

      // System audio comes back as an audio track on the display-media
      // stream (Electron loopback). It is recorded as its own file, never
      // mixed into the screen recorder. Platforms without loopback support
      // simply return no audio track — recording proceeds without it.
      let screenStream
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: systemAudioEnabled
        })
      } catch (err) {
        if (!systemAudioEnabled) throw err
        console.warn('Display capture with system audio failed, retrying video-only:', err)
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false
        })
      }
      screenStreamRef.current = screenStream

      // CRITICAL for sync: disable Chrome's default audio processing
      // (echoCancellation / noiseSuppression / autoGainControl) which adds
      // 100–500ms of latency to the captured audio stream.
      let micStream = null
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(prefs.micDeviceId ? { deviceId: { ideal: prefs.micDeviceId } } : {}),
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
            sampleRate: 48000
          }
        })
        micStreamRef.current = micStream
      } catch {
        console.warn('Microphone not available')
      }

      // Optional webcam stream (warmed up here too)
      let wcStream = null
      if (webcamEnabled) {
        try {
          wcStream = await navigator.mediaDevices.getUserMedia({
            video: {
              ...(prefs.cameraDeviceId ? { deviceId: { ideal: prefs.cameraDeviceId } } : {}),
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            }
          })
          webcamStreamRef.current = wcStream
          setWebcamStream(wcStream)
        } catch (err) {
          console.warn('Webcam stream failed:', err)
        }
      }

      // Codecs
      const videoMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm;codecs=vp8'
      const audioMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'

      // Build recorders (but DO NOT start them yet)
      const tracks = [...screenStream.getVideoTracks()]
      if (micStream) tracks.push(...micStream.getAudioTracks())
      const combinedStream = new MediaStream(tracks)

      screenChunksRef.current = []
      const screenRecorder = new MediaRecorder(combinedStream, { mimeType: videoMime })
      screenRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) screenChunksRef.current.push(e.data)
      }
      screenRecorderRef.current = screenRecorder

      if (micStream) {
        micChunksRef.current = []
        const micRecorder = new MediaRecorder(micStream, { mimeType: audioMime })
        micRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) micChunksRef.current.push(e.data)
        }
        micRecorderRef.current = micRecorder
      }

      // System audio (loopback) — recorded as its own track so volume is
      // independently controllable in the editor.
      const systemAudioTracks = screenStream.getAudioTracks()
      if (systemAudioEnabled && systemAudioTracks.length > 0) {
        systemChunksRef.current = []
        const systemStream = new MediaStream(systemAudioTracks)
        const systemRecorder = new MediaRecorder(systemStream, { mimeType: audioMime })
        systemRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) systemChunksRef.current.push(e.data)
        }
        systemRecorderRef.current = systemRecorder
      } else if (systemAudioEnabled) {
        console.warn('System audio requested but no loopback track available on this platform')
      }

      if (wcStream) {
        webcamChunksRef.current = []
        const wcRecorder = new MediaRecorder(wcStream, { mimeType: videoMime })
        wcRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) webcamChunksRef.current.push(e.data)
        }
        webcamRecorderRef.current = wcRecorder
      }

      // Now enter countdown — streams are live and warm, recorders ready
      // to fire instantly when onComplete calls startRecording().
      setState('countdown')
    } catch (err) {
      console.error('Failed to prepare recording:', err)
      cleanup()
      setState('idle')
      throw err
    }
  }

  // Called when the countdown reaches 0. Fires all recorders in immediate
  // succession (synchronous JS — sub-millisecond delta) so the captured
  // audio/video are aligned at the moment "1!" disappears.
  function startRecording() {
    try {
      if (screenRecorderRef.current) screenRecorderRef.current.start(1000)
      if (micRecorderRef.current) micRecorderRef.current.start(1000)
      if (systemRecorderRef.current) systemRecorderRef.current.start(1000)
      if (webcamRecorderRef.current) webcamRecorderRef.current.start(1000)

      // Timer
      startTimeRef.current = Date.now()
      elapsedBeforePauseRef.current = 0
      elapsedRef.current = 0
      timerRef.current = setInterval(() => {
        const t = elapsedBeforePauseRef.current + (Date.now() - startTimeRef.current) / 1000
        elapsedRef.current = t
        setElapsed(t)
      }, 100)

      setState('recording')
    } catch (err) {
      console.error('Failed to start recording:', err)
      cleanup()
      setState('idle')
      throw err
    }
  }

  function pauseRecording() {
    if (screenRecorderRef.current?.state === 'recording') {
      screenRecorderRef.current.pause()
    }
    if (webcamRecorderRef.current?.state === 'recording') {
      webcamRecorderRef.current.pause()
    }
    if (micRecorderRef.current?.state === 'recording') {
      micRecorderRef.current.pause()
    }
    if (systemRecorderRef.current?.state === 'recording') {
      systemRecorderRef.current.pause()
    }
    elapsedBeforePauseRef.current += (Date.now() - startTimeRef.current) / 1000
    clearInterval(timerRef.current)
    setState('paused')
  }

  function resumeRecording() {
    if (screenRecorderRef.current?.state === 'paused') {
      screenRecorderRef.current.resume()
    }
    if (webcamRecorderRef.current?.state === 'paused') {
      webcamRecorderRef.current.resume()
    }
    if (micRecorderRef.current?.state === 'paused') {
      micRecorderRef.current.resume()
    }
    if (systemRecorderRef.current?.state === 'paused') {
      systemRecorderRef.current.resume()
    }
    startTimeRef.current = Date.now()
    timerRef.current = setInterval(() => {
      const t = elapsedBeforePauseRef.current + (Date.now() - startTimeRef.current) / 1000
      elapsedRef.current = t
      setElapsed(t)
    }, 100)
    setState('recording')
  }

  async function stopRecording() {
    clearInterval(timerRef.current)
    setState('saving')

    // Collect screen chunks via a promise that resolves on the recorder's `stop` event
    const screenBlobPromise = new Promise((resolve) => {
      const recorder = screenRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        resolve(new Blob(screenChunksRef.current, { type: 'video/webm' }))
        return
      }
      recorder.onstop = () => {
        resolve(new Blob(screenChunksRef.current, { type: 'video/webm' }))
      }
      recorder.stop()
    })

    // Collect webcam chunks the same way
    const webcamBlobPromise = new Promise((resolve) => {
      const recorder = webcamRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        resolve(null)
        return
      }
      recorder.onstop = () => {
        resolve(new Blob(webcamChunksRef.current, { type: 'video/webm' }))
      }
      recorder.stop()
    })

    // Collect mic chunks the same way
    const micBlobPromise = new Promise((resolve) => {
      const recorder = micRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        resolve(null)
        return
      }
      recorder.onstop = () => {
        resolve(new Blob(micChunksRef.current, { type: 'audio/webm' }))
      }
      recorder.stop()
    })

    // Collect system-audio chunks the same way
    const systemBlobPromise = new Promise((resolve) => {
      const recorder = systemRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        resolve(null)
        return
      }
      recorder.onstop = () => {
        resolve(new Blob(systemChunksRef.current, { type: 'audio/webm' }))
      }
      recorder.stop()
    })

    // Stop all media tracks (after calling .stop() on recorders)
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop())
    }
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((t) => t.stop())
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop())
    }

    // Wait for blobs, then save them
    try {
      const [screenBlob, webcamBlob, micBlob, systemBlob] = await Promise.all([
        screenBlobPromise,
        webcamBlobPromise,
        micBlobPromise,
        systemBlobPromise
      ])

      const projectId = projectIdRef.current
      const finalElapsed = elapsedRef.current

      // Save screen recording
      if (screenBlob && screenBlob.size > 0) {
        const buffer = await screenBlob.arrayBuffer()
        await window.electronAPI.saveRawRecording(projectId, 'screen', buffer)
        console.log(`Screen recording saved: ${(screenBlob.size / 1024 / 1024).toFixed(1)} MB`)
      } else {
        console.warn('Screen recording blob is empty')
      }

      // Save webcam recording
      if (webcamBlob && webcamBlob.size > 0) {
        const buffer = await webcamBlob.arrayBuffer()
        await window.electronAPI.saveRawRecording(projectId, 'webcam', buffer)
        console.log(`Webcam recording saved: ${(webcamBlob.size / 1024 / 1024).toFixed(1)} MB`)
      }

      // Save mic recording (separate audio file — volume is controllable in editor)
      if (micBlob && micBlob.size > 0) {
        const buffer = await micBlob.arrayBuffer()
        await window.electronAPI.saveRawRecording(projectId, 'mic', buffer)
        console.log(`Mic recording saved: ${(micBlob.size / 1024 / 1024).toFixed(1)} MB`)
      }

      // Save system-audio recording (separate track, like mic)
      if (systemBlob && systemBlob.size > 0) {
        const buffer = await systemBlob.arrayBuffer()
        await window.electronAPI.saveRawRecording(projectId, 'system', buffer)
        console.log(`System audio saved: ${(systemBlob.size / 1024 / 1024).toFixed(1)} MB`)
      }

      // Update project with duration
      try {
        const project = await window.electronAPI.loadProject(projectId)
        project.duration = finalElapsed
        project.edit.trimEnd = finalElapsed
        await window.electronAPI.saveProject(projectId, project)
      } catch (err) {
        console.error('Failed to update project duration:', err)
      }

      // Generate thumbnail (non-blocking — don't let this prevent navigation)
      window.electronAPI.generateThumbnail(projectId).catch((err) => {
        console.warn('Thumbnail generation failed:', err)
      })

      setState('stopped')
      return projectId
    } catch (err) {
      console.error('Failed to save recording:', err)
      setState('stopped')
      // Still return the project ID so the user can navigate to the editor
      return projectIdRef.current
    }
  }

  return {
    state,
    elapsed,
    selectedSource,
    webcamEnabled,
    systemAudioEnabled,
    webcamStream,
    selectSource,
    setWebcamEnabled,
    setSystemAudioEnabled,
    startCountdown,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording
  }
}
