// Shared, pure (no Electron) render model — the single source of truth that
// BOTH the live preview compositor and the FFmpeg exporter consume. Neither
// renderer reads the raw project schema for rendering; they read the model
// produced here. That single consumption point is what keeps preview == export.
//
// It also owns the v1 → v2 project migration, so the schema conversion and the
// model derivation stay consistent and are testable in plain Node.

/**
 * Compute the "keep" segments of the source after applying trim + cuts.
 * (Identical semantics to the legacy ffmpeg.js implementation it replaces.)
 */
export function computeKeepSegments(trimStart, trimEnd, cuts) {
  let segments = [{ start: trimStart, end: trimEnd }]
  if (!cuts || cuts.length === 0) return segments

  const sortedCuts = [...cuts].sort((a, b) => a.start - b.start)
  for (const cut of sortedCuts) {
    const next = []
    for (const seg of segments) {
      if (cut.end <= seg.start || cut.start >= seg.end) {
        next.push(seg)
      } else {
        if (cut.start > seg.start) next.push({ start: seg.start, end: cut.start })
        if (cut.end < seg.end) next.push({ start: cut.end, end: seg.end })
      }
    }
    segments = next
  }
  return segments.filter((s) => s.end - s.start >= 0.1)
}

/**
 * Map a source timestamp to its position in the (cut-collapsed) output, in
 * source-time units (speed is applied by the caller). Identical semantics to
 * the legacy ffmpeg.js implementation.
 */
export function mapTimeToOutput(sourceTime, keepSegments) {
  let outputTime = 0
  for (const seg of keepSegments) {
    if (sourceTime <= seg.start) return outputTime
    if (sourceTime <= seg.end) return outputTime + (sourceTime - seg.start)
    outputTime += (seg.end - seg.start)
  }
  return outputTime
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Convert a v1 project (flat `edit` + `recordings`) into the v2 shape:
 * a `media` library and a `timeline` of clips/tracks. NON-DESTRUCTIVE: the
 * legacy `edit` and `recordings` are preserved so anything still reading them
 * keeps working until it's migrated to the model. Pure function — returns a
 * new object; the caller persists it.
 */
export function migrateProjectToV2(project) {
  if (!project || project.schemaVersion === 2) return project

  const edit = project.edit || {}
  const rec = project.recordings || {}
  const speed = edit.speed || 1.0
  const duration = project.duration || 0
  const trimStart = edit.trimStart || 0
  const trimEnd = edit.trimEnd || duration

  // ── media library ──
  const media = {}
  const addMedia = (id, kind, master, proxy) => {
    if (!master) return
    media[id] = { id, kind, master, proxy: proxy || master }
  }
  addMedia('screen', 'screen', rec.screen, rec.screenProxy)
  addMedia('webcam', 'webcam', rec.webcam, rec.webcamProxy)
  if (rec.mic) media.mic = { id: 'mic', kind: 'mic', master: rec.mic, proxy: rec.mic }
  if (rec.system) media.system = { id: 'system', kind: 'system', master: rec.system, proxy: rec.system }

  // ── video track: one clip per keep-segment, placed sequentially ──
  const keepSegments = rec.screen ? computeKeepSegments(trimStart, trimEnd, edit.cuts || []) : []
  const effects = []
  if (edit.backgroundBlur && edit.backgroundBlur.enabled) {
    effects.push({ type: 'blur', strength: edit.backgroundBlur.strength || 10 })
  }
  if (edit.cursorSpotlight && edit.cursorSpotlight.enabled) {
    effects.push({ type: 'vignette', intensity: edit.cursorSpotlight.intensity || 0.4 })
  }
  if ((edit.zoomKeyframes || []).length > 0) {
    effects.push({ type: 'zoom', keyframes: edit.zoomKeyframes })
  }
  const crop = edit.crop || {}
  const transform = (crop.enabled && crop.aspectRatio !== 'original')
    ? { cropX: crop.x, cropY: crop.y, cropW: crop.width, cropH: crop.height }
    : null

  const videoTrack = []
  let cursor = 0
  for (const seg of keepSegments) {
    const outDur = (seg.end - seg.start) / speed
    videoTrack.push({
      id: uid('clip'),
      mediaId: 'screen',
      sourceIn: seg.start,
      sourceOut: seg.end,
      timelineStart: cursor,
      speed,
      transform,
      effects: effects.length ? effects : null,
      transitionIn: null
    })
    cursor += outDur
  }

  // ── overlay items (output-time coords baked in) ──
  const toOut = (t) => mapTimeToOutput(t, keepSegments) / speed
  const overlays = []
  for (const t of edit.textLayers || []) {
    overlays.push({
      id: t.id || uid('ov'),
      kind: 'text',
      timelineStart: toOut(t.startTime || 0),
      timelineEnd: t.endTime != null ? toOut(t.endTime) : cursor,
      geometry: { x: t.x ?? 0.5, y: t.y ?? 0.5, opacity: 1 },
      style: { text: t.text, fontSize: t.fontSize, color: t.color, fontWeight: t.fontWeight, background: t.background },
      source: null
    })
  }
  for (const img of edit.imageLayers || []) {
    overlays.push({
      id: img.id || uid('ov'),
      kind: 'image',
      timelineStart: toOut(img.startTime || 0),
      timelineEnd: img.endTime != null ? toOut(img.endTime) : cursor,
      geometry: { x: img.x ?? 0, y: img.y ?? 0, w: img.width ?? 0.15, opacity: 1 },
      style: null,
      source: img.file
    })
  }

  // ── audio clips (imported layers) ──
  const audioTracks = []
  const importedAudio = (edit.audioLayers || []).map((a) => ({
    id: a.id || uid('aud'),
    file: a.file,
    timelineStart: a.startTime || 0,
    volume: a.volume != null ? a.volume : 0.3,
    fadeIn: a.fadeIn || 0,
    fadeOut: a.fadeOut || 0,
    duckUnderVoice: !!a.duckUnderVoice
  }))
  if (importedAudio.length) audioTracks.push(importedAudio)

  return {
    ...project,
    schemaVersion: 2,
    media,
    timeline: {
      videoTrack,
      overlayTracks: overlays.length ? [overlays] : [],
      audioTracks,
      webcam: rec.webcam
        ? {
            mediaId: 'webcam',
            position: edit.webcamPosition || 'bottom-right',
            size: edit.webcamSize || 0.2,
            shape: edit.webcamShape || 'circle'
          }
        : null
    },
    cards: {
      intro: edit.introCard || null,
      outro: edit.outroCard || null
    }
    // NOTE: legacy `edit` and `recordings` are intentionally retained.
  }
}

/**
 * Build the normalized RenderModel from a project. Accepts v1 or v2 (v1 is
 * migrated on the fly). The output uses OUTPUT-TIME coordinates throughout, so
 * neither renderer re-derives cut/speed mapping.
 *
 * @param {object} project
 * @param {object} opts { preview?: boolean }  preview→use proxy media, else master
 */
export function buildRenderModel(project, opts = {}) {
  const v2 = project.schemaVersion === 2 ? project : migrateProjectToV2(project)
  const useProxy = !!opts.preview
  const tl = v2.timeline || { videoTrack: [], overlayTracks: [], audioTracks: [], webcam: null }
  const media = v2.media || {}
  const fileFor = (mediaId) => {
    const m = media[mediaId]
    if (!m) return null
    return useProxy ? m.proxy : m.master
  }

  const videoSegments = []
  let duration = 0
  for (const clip of tl.videoTrack || []) {
    const outDur = (clip.sourceOut - clip.sourceIn) / (clip.speed || 1)
    const timelineEnd = clip.timelineStart + outDur
    videoSegments.push({
      id: clip.id,
      sourceFile: fileFor(clip.mediaId),
      mediaId: clip.mediaId,
      sourceIn: clip.sourceIn,
      sourceOut: clip.sourceOut,
      timelineStart: clip.timelineStart,
      timelineEnd,
      speed: clip.speed || 1,
      transform: clip.transform || null,
      effects: clip.effects || [],
      transitionIn: clip.transitionIn || null
    })
    duration = Math.max(duration, timelineEnd)
  }

  const overlays = []
  for (const track of tl.overlayTracks || []) {
    for (const item of track) {
      overlays.push({
        ...item,
        source: item.source ? fileFor(item.kind === 'webcam' ? 'webcam' : item.mediaId) || item.source : item.source
      })
    }
  }

  const audioSegments = []
  // Recording audio (mic / system) follows the video keep-segments: model it
  // as full-timeline voice sources flagged isVoice for ducking sidechains.
  const edit = v2.edit || {}
  if (media.mic && !edit.micMuted) {
    audioSegments.push({
      id: 'mic', sourceFile: fileFor('mic'), mediaId: 'mic',
      timelineStart: 0, volume: edit.micVolume != null ? edit.micVolume : 1,
      offsetMs: edit.audioOffsetMs || 0, denoise: !!edit.micDenoise,
      isVoice: true, followsVideoCuts: true
    })
  }
  if (media.system && !edit.systemMuted) {
    audioSegments.push({
      id: 'system', sourceFile: fileFor('system'), mediaId: 'system',
      timelineStart: 0, volume: edit.systemVolume != null ? edit.systemVolume : 1,
      isVoice: false, followsVideoCuts: true
    })
  }
  for (const track of tl.audioTracks || []) {
    for (const a of track) {
      audioSegments.push({
        id: a.id, sourceFile: a.file, mediaId: null,
        timelineStart: a.timelineStart, volume: a.volume,
        fadeIn: a.fadeIn, fadeOut: a.fadeOut, duckUnderVoice: a.duckUnderVoice,
        isVoice: false, followsVideoCuts: false, imported: true
      })
    }
  }

  return {
    width: v2.width || null,
    height: v2.height || null,
    duration,
    videoSegments,
    overlays,
    audioSegments,
    webcam: tl.webcam || null,
    cards: v2.cards || { intro: null, outro: null }
  }
}
