// Pure-Node parity tests for the shared render model + v1→v2 migration.
// Run: node test/render-model.test.mjs
//
// The migration must be lossless: a migrated v1 project must produce a
// RenderModel whose video/overlay/audio timing equals the canonical v1
// cut+speed+mapTimeToOutput math that the legacy export pipeline used.

import assert from 'node:assert/strict'
import {
  computeKeepSegments,
  mapTimeToOutput,
  migrateProjectToV2,
  buildRenderModel
} from '../src/shared/render-model.js'

let passed = 0
const ok = (name) => { passed++; console.log(`  ok  ${name}`) }

function v1Fixture() {
  return {
    id: 'p1',
    name: 'Fixture',
    duration: 20,
    schemaVersion: undefined,
    recordings: {
      screen: 'screen-master.webm', screenProxy: 'screen.webm',
      webcam: 'webcam-master.webm', webcamProxy: 'webcam.webm',
      mic: 'mic.webm', system: 'system.webm'
    },
    edit: {
      trimStart: 2, trimEnd: 18, speed: 2.0,
      cuts: [{ start: 6, end: 9 }, { start: 12, end: 13 }],
      crop: { enabled: true, aspectRatio: '9:16', x: 0.3, y: 0, width: 0.4, height: 1 },
      webcamPosition: 'bottom-left', webcamSize: 0.25, webcamShape: 'circle',
      micVolume: 0.8, micMuted: false, micDenoise: true,
      systemVolume: 0.5, systemMuted: false, audioOffsetMs: 0,
      backgroundBlur: { enabled: true, strength: 12 },
      cursorSpotlight: { enabled: true, intensity: 0.5 },
      zoomKeyframes: [{ time: 5, duration: 2, zoom: 1.5, x: 0.5, y: 0.5 }],
      textLayers: [{ id: 'tx1', text: 'Hello', startTime: 4, endTime: 14, fontSize: 30, color: 'white', x: 0.5, y: 0.2 }],
      imageLayers: [{ id: 'im1', file: 'logo.png', startTime: 0, endTime: 20, x: 0.1, y: 0.1, width: 0.2 }],
      audioLayers: [{ id: 'au1', file: 'music.mp3', volume: 0.4, startTime: 1, fadeIn: 1, fadeOut: 2, duckUnderVoice: true }],
      introCard: { title: 'Intro', duration: 3, bgColor: '#000000' },
      outroCard: { title: 'Bye', duration: 2, bgColor: '#101010' }
    }
  }
}

// ── Test 1: migration preserves edit + adds v2 structures ──
{
  const v1 = v1Fixture()
  const v2 = migrateProjectToV2(v1)
  assert.equal(v2.schemaVersion, 2)
  assert.ok(v2.edit, 'legacy edit retained')
  assert.ok(v2.recordings, 'legacy recordings retained')
  assert.ok(v2.media.screen && v2.media.screen.master === 'screen-master.webm')
  assert.equal(v2.media.screen.proxy, 'screen.webm')
  assert.ok(v2.timeline.videoTrack.length > 0)
  assert.ok(v2.cards.intro && v2.cards.outro)
  ok('migration is non-destructive and adds media/timeline/cards')
}

// ── Test 2: video clips equal canonical keep-segments, sequential placement ──
{
  const v1 = v1Fixture()
  const e = v1.edit
  const keep = computeKeepSegments(e.trimStart, e.trimEnd, e.cuts)
  const model = buildRenderModel(migrateProjectToV2(v1))

  assert.equal(model.videoSegments.length, keep.length, 'one segment per keep-segment')
  let cursor = 0
  keep.forEach((seg, i) => {
    const vs = model.videoSegments[i]
    assert.equal(vs.sourceIn, seg.start, `seg ${i} sourceIn`)
    assert.equal(vs.sourceOut, seg.end, `seg ${i} sourceOut`)
    assert.ok(Math.abs(vs.timelineStart - cursor) < 1e-9, `seg ${i} timelineStart`)
    const outDur = (seg.end - seg.start) / e.speed
    assert.ok(Math.abs(vs.timelineEnd - (cursor + outDur)) < 1e-9, `seg ${i} timelineEnd`)
    assert.equal(vs.speed, e.speed)
    cursor += outDur
  })
  // total duration equals sum of kept output durations
  const expectedDur = keep.reduce((s, seg) => s + (seg.end - seg.start) / e.speed, 0)
  assert.ok(Math.abs(model.duration - expectedDur) < 1e-9, 'model.duration matches')
  ok('video segments match canonical keep-segments + speed')
}

// ── Test 3: clip transform/effects carried from v1 crop/blur/vignette/zoom ──
{
  const model = buildRenderModel(migrateProjectToV2(v1Fixture()))
  const clip = model.videoSegments[0]
  assert.ok(clip.transform && Math.abs(clip.transform.cropW - 0.4) < 1e-9, 'crop carried')
  const types = clip.effects.map((f) => f.type).sort()
  assert.deepEqual(types, ['blur', 'vignette', 'zoom'], 'all effects carried')
  ok('clip transform + effects derived from v1 edit')
}

// ── Test 4: overlay output-times equal mapTimeToOutput/speed ──
{
  const v1 = v1Fixture()
  const e = v1.edit
  const keep = computeKeepSegments(e.trimStart, e.trimEnd, e.cuts)
  const model = buildRenderModel(migrateProjectToV2(v1))
  const text = model.overlays.find((o) => o.kind === 'text')
  const expStart = mapTimeToOutput(4, keep) / e.speed
  const expEnd = mapTimeToOutput(14, keep) / e.speed
  assert.ok(Math.abs(text.timelineStart - expStart) < 1e-9, 'text start mapped')
  assert.ok(Math.abs(text.timelineEnd - expEnd) < 1e-9, 'text end mapped')
  const img = model.overlays.find((o) => o.kind === 'image')
  assert.equal(img.source, 'logo.png')
  ok('overlay timings mapped through cuts + speed')
}

// ── Test 5: audio model — recording voice + ducked imported layer ──
{
  const model = buildRenderModel(migrateProjectToV2(v1Fixture()))
  const mic = model.audioSegments.find((a) => a.id === 'mic')
  const sys = model.audioSegments.find((a) => a.id === 'system')
  const music = model.audioSegments.find((a) => a.imported)
  assert.ok(mic && mic.isVoice && mic.denoise && Math.abs(mic.volume - 0.8) < 1e-9, 'mic voice carried')
  assert.ok(sys && !sys.isVoice && Math.abs(sys.volume - 0.5) < 1e-9, 'system carried')
  assert.ok(music && music.duckUnderVoice && music.fadeOut === 2, 'imported music carried')
  ok('audio segments carry voice/system/imported settings')
}

// ── Test 6: muted recording audio is dropped from the model ──
{
  const v1 = v1Fixture()
  v1.edit.micMuted = true
  const model = buildRenderModel(migrateProjectToV2(v1))
  assert.ok(!model.audioSegments.find((a) => a.id === 'mic'), 'muted mic dropped')
  ok('muted mic excluded from model')
}

// ── Test 7: preview vs export pick proxy vs master ──
{
  const v2 = migrateProjectToV2(v1Fixture())
  const exp = buildRenderModel(v2, { preview: false })
  const prev = buildRenderModel(v2, { preview: true })
  assert.equal(exp.videoSegments[0].sourceFile, 'screen-master.webm', 'export uses master')
  assert.equal(prev.videoSegments[0].sourceFile, 'screen.webm', 'preview uses proxy')
  ok('export uses master, preview uses proxy')
}

// ── Test 8: idempotent — migrating a v2 project is a no-op ──
{
  const v2 = migrateProjectToV2(v1Fixture())
  const again = migrateProjectToV2(v2)
  assert.equal(again, v2, 'second migrate returns same object')
  ok('migration is idempotent')
}

// ── Test 9: webcam-only / no-cuts project ──
{
  const v1 = {
    id: 'p2', duration: 10, recordings: { screen: 'screen-master.webm', screenProxy: 'screen.webm', mic: 'mic.webm' },
    edit: { trimStart: 0, trimEnd: 10, speed: 1.0, cuts: [], crop: { enabled: false, aspectRatio: 'original' },
      textLayers: [], imageLayers: [], audioLayers: [], micVolume: 1, micMuted: false }
  }
  const model = buildRenderModel(migrateProjectToV2(v1))
  assert.equal(model.videoSegments.length, 1)
  assert.equal(model.videoSegments[0].sourceIn, 0)
  assert.equal(model.videoSegments[0].sourceOut, 10)
  assert.equal(model.videoSegments[0].transform, null, 'no crop → no transform')
  assert.deepEqual(model.videoSegments[0].effects, [])
  ok('simple no-cuts project yields one full clip')
}

console.log(`\n${passed} render-model tests passed`)
