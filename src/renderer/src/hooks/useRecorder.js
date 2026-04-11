import { useState, useRef, useEffect } from 'react'

export default function useRecorder() {
  const [state, setState] = useState('idle') // idle, countdown, recording, paused, saving, stopped
  const [elapsed, setElapsed] = useState(0)
  const [selectedSource, setSelectedSource] = useState(null)
  const [webcamEnabled, setWebcamEnabled] = useState(false)
  const [webcamStream, setWebcamStream] = useState(null)

  const screenRecorderRef = useRef(null)
  const webcamRecorderRef = useRef(null)
  const screenChunksRef = useRef([])
  const webcamChunksRef = useRef([])
  const timerRef = useRef(null)
  const startTimeRef = useRef(0)
  const elapsedBeforePauseRef = useRef(0)
  const projectIdRef = useRef(null)
  const screenStreamRef = useRef(null)
  const webcamStreamRef = useRef(null)
  // Track elapsed in a ref so the onstop closure always has the latest value
  const elapsedRef = useRef(0)

  useEffect(() => {
    return () => cleanup()
  }, [])

  function cleanup() {
    clearInterval(timerRef.current)
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop())
    }
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((t) => t.stop())
    }
  }

  function selectSource(source) {
    setSelectedSource(source)
  }

  function startCountdown() {
    if (!selectedSource) return
    setState('countdown')
  }

  async function startRecording() {
    try {
      // Create project first
      const project = await window.electronAPI.createProject(
        `Recording — ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      )
      projectIdRef.current = project.id

      // Tell main process which source we want, then call getDisplayMedia
      // The main process setDisplayMediaRequestHandler will intercept and provide it
      await window.electronAPI.setCaptureSource(selectedSource.id)

      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      })
      screenStreamRef.current = screenStream

      console.log('Screen stream acquired:', screenStream.getVideoTracks().length, 'video tracks')

      // Get microphone separately
      let micStream = null
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        console.warn('Microphone not available')
      }

      // Merge screen video + mic audio into one stream
      const tracks = [...screenStream.getVideoTracks()]
      if (micStream) {
        tracks.push(...micStream.getAudioTracks())
      }
      const combinedStream = new MediaStream(tracks)

      // Pick codec
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm;codecs=vp8'

      // Screen recorder
      screenChunksRef.current = []
      const screenRecorder = new MediaRecorder(combinedStream, { mimeType })
      screenRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) screenChunksRef.current.push(e.data)
      }
      screenRecorderRef.current = screenRecorder
      screenRecorder.start(1000)

      // Webcam recorder
      if (webcamEnabled) {
        try {
          const wcStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 }
          })
          webcamStreamRef.current = wcStream
          setWebcamStream(wcStream)

          webcamChunksRef.current = []
          const wcRecorder = new MediaRecorder(wcStream, { mimeType })
          wcRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) webcamChunksRef.current.push(e.data)
          }
          webcamRecorderRef.current = wcRecorder
          wcRecorder.start(1000)
        } catch (err) {
          console.warn('Webcam recording failed:', err)
        }
      }

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
      setState('idle')
    }
  }

  function pauseRecording() {
    if (screenRecorderRef.current?.state === 'recording') {
      screenRecorderRef.current.pause()
    }
    if (webcamRecorderRef.current?.state === 'recording') {
      webcamRecorderRef.current.pause()
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

    // Stop all media tracks (after calling .stop() on recorders)
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop())
    }
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((t) => t.stop())
    }

    // Wait for blobs, then save them
    try {
      const [screenBlob, webcamBlob] = await Promise.all([screenBlobPromise, webcamBlobPromise])

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
    webcamStream,
    selectSource,
    setWebcamEnabled,
    startCountdown,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording
  }
}
