import { useState, useRef, useEffect } from 'react'

export default function useRecorder() {
  const [state, setState] = useState('idle') // idle, countdown, recording, paused, saving, stopped
  const [elapsed, setElapsed] = useState(0)
  const [selectedSource, setSelectedSource] = useState(null)
  const [webcamEnabled, setWebcamEnabledState] = useState(false)
  const [systemAudioEnabled, setSystemAudioEnabledState] = useState(false)
  const [webcamStream, setWebcamStream] = useState(null)
  const [fps, setFpsState] = useState(30) // capture frame rate (R9): 30 or 60
  // Region capture (R4): mode 'full' records the whole screen; 'region' still
  // records full-screen but stores a crop rect (fractions of the screen) that
  // the export pipeline applies as an edit. null region => full screen.
  const [captureMode, setCaptureMode] = useState('full')
  const [region, setRegion] = useState(null) // { x, y, width, height } as fractions

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
  // Whether crash-safe disk streaming succeeded for each track. If a chunk
  // append fails we fall back to the in-memory save path on stop.
  const streamingOkRef = useRef({ screen: true, webcam: true, mic: true, system: true })

  // Load recording preferences on mount
  useEffect(() => {
    window.electronAPI.getPreferences().then((prefs) => {
      setWebcamEnabledState(prefs.webcamEnabled ?? false)
      setSystemAudioEnabledState(prefs.systemAudioEnabled ?? false)
      setFpsState(prefs.fps ?? 30)
    }).catch(() => {})
    return () => cleanup()
  }, [])

  // Persist frame-rate preference (R9)
  function setFps(value) {
    setFpsState(value)
    window.electronAPI.setPreferences({ fps: value }).catch(() => {})
  }

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

  // Wire a recorder's ondataavailable to BOTH stream each chunk to disk
  // (crash-safe, R8) and keep it in memory as a fallback. If a disk append
  // fails we flag that track so stop() falls back to the in-memory blob.
  function attachChunkHandler(recorder, chunksRef, type) {
    recorder.ondataavailable = async (e) => {
      if (!e.data || e.data.size === 0) return
      chunksRef.current.push(e.data)
      const projectId = projectIdRef.current
      if (!projectId || !streamingOkRef.current[type]) return
      try {
        const buffer = await e.data.arrayBuffer()
        await window.electronAPI.appendRecordingChunk(projectId, type, buffer)
      } catch (err) {
        console.warn(`Chunk streaming failed for ${type}, falling back to in-memory save:`, err)
        streamingOkRef.current[type] = false
      }
    }
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
      streamingOkRef.current = { screen: true, webcam: true, mic: true, system: true }

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
      // R9: request the chosen frame rate (30 or 60). getDisplayMedia treats
      // frameRate as a max/ideal hint — the source may deliver fewer fps.
      const videoConstraints = { frameRate: { ideal: fps, max: fps } }
      let screenStream
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: videoConstraints,
          audio: systemAudioEnabled
        })
      } catch (err) {
        if (!systemAudioEnabled) throw err
        console.warn('Display capture with system audio failed, retrying video-only:', err)
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: videoConstraints,
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
      attachChunkHandler(screenRecorder, screenChunksRef, 'screen')
      screenRecorderRef.current = screenRecorder

      if (micStream) {
        micChunksRef.current = []
        const micRecorder = new MediaRecorder(micStream, { mimeType: audioMime })
        attachChunkHandler(micRecorder, micChunksRef, 'mic')
        micRecorderRef.current = micRecorder
      }

      // System audio (loopback) — recorded as its own track so volume is
      // independently controllable in the editor.
      const systemAudioTracks = screenStream.getAudioTracks()
      if (systemAudioEnabled && systemAudioTracks.length > 0) {
        systemChunksRef.current = []
        const systemStream = new MediaStream(systemAudioTracks)
        const systemRecorder = new MediaRecorder(systemStream, { mimeType: audioMime })
        attachChunkHandler(systemRecorder, systemChunksRef, 'system')
        systemRecorderRef.current = systemRecorder
      } else if (systemAudioEnabled) {
        console.warn('System audio requested but no loopback track available on this platform')
      }

      if (wcStream) {
        webcamChunksRef.current = []
        const wcRecorder = new MediaRecorder(wcStream, { mimeType: videoMime })
        attachChunkHandler(wcRecorder, webcamChunksRef, 'webcam')
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

      // Crash-safe streaming (R8): the real recordings are now saved via the
      // in-memory path above, so close the per-track disk streams and drop the
      // `.part` backups. Doing this AFTER the saves means a crash before here
      // still leaves a recoverable `.part` on disk.
      await Promise.all(
        ['screen', 'webcam', 'mic', 'system'].map((type) =>
          window.electronAPI.finalizeRecording(projectId, type).catch(() => {})
        )
      )

      // Update project with duration, chosen fps (R9), and region crop (R4).
      try {
        const project = await window.electronAPI.loadProject(projectId)
        project.duration = finalElapsed
        project.edit.trimEnd = finalElapsed
        project.fps = fps
        // Region capture stores a crop rect the export pipeline renders. The
        // recording itself is full-screen; aspectRatio:'custom' makes hasCrop
        // true in ffmpeg.js (which only skips aspectRatio:'original').
        if (captureMode === 'region' && region) {
          project.edit.crop = {
            enabled: true,
            aspectRatio: 'custom',
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height
          }
        }
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
  }
}
