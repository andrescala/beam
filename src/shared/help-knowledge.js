// Hardcoded knowledge base of Beam's features. Single source of truth: the Help
// drawer renders this as a browsable FAQ AND the AI help assistant stuffs it
// into the model's system prompt for grounded answers. Pure data — no Electron
// imports — so both the renderer and the main process can read it.

export const HELP_KB = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    items: [
      { q: 'How do I make my first recording?',
        a: 'Click "New Recording" from the home screen. Grant screen, camera, and microphone permissions when prompted. Choose the screen or window to capture, toggle your webcam on/off, then click "Start Recording". Press Space to pause, Escape to stop.',
        keywords: ['record', 'start', 'capture', 'permissions'] },
      { q: 'Where are my recordings saved?',
        a: 'Recordings are saved automatically as projects under your home folder in Beam/projects. Each project has its own folder with the raw recordings, assets, and exports. You can also export a .beamproject archive for backup.',
        keywords: ['save', 'location', 'folder', 'projects'] },
      { q: 'How do I rename a project?',
        a: 'Double-click the project name on the home screen card to rename it inline. Press Enter to confirm or Escape to cancel.',
        keywords: ['rename', 'name'] }
    ]
  },
  {
    id: 'timeline',
    title: 'Timeline & Trimming',
    items: [
      { q: 'How do I trim the start or end?',
        a: 'In the Timeline tab, drag the trim handles on either side of the Screen track to set your in/out points.',
        keywords: ['trim', 'handles', 'in', 'out'] },
      { q: 'How do I cut a section out?',
        a: 'Click "Cut" in the Timeline toolbar, click once to set the start point, then again to set the end. The red region between is removed from the export. Drag a cut\'s edges to adjust it, or click the X to remove it.',
        keywords: ['cut', 'remove', 'delete section'] },
      { q: 'How does Remove Silence work?',
        a: 'Click "Remove Silence" in the Timeline toolbar. Beam analyzes the audio and adds cuts over silent segments (pauses longer than ~0.5s). Review, adjust, or remove the cuts before exporting.',
        keywords: ['silence', 'pauses', 'auto cut'] }
    ]
  },
  {
    id: 'multiclip',
    title: 'Multi-clip Timeline',
    items: [
      { q: 'How do I add another video to the timeline?',
        a: 'Click "+ Clip" in the editor titlebar and pick a video file. Beam imports it as its own source and appends it to the end of the timeline. When the timeline has more than one clip, a read-only "Clips (N)" strip appears in the Timeline tab showing each clip\'s position.',
        keywords: ['+ clip', 'append', 'multiple videos', 'stitch'] },
      { q: 'What works (and what does not yet) for multi-clip export?',
        a: 'A multi-clip timeline exports by stitching the clips together: each is trimmed, speed-adjusted, letterboxed to a common canvas, and concatenated with its audio (the screen clip keeps your mic/system narration; imported music tracks are mixed in). Export resolution and social presets are honored. Not yet rendered on the multi-clip path: text/image overlays, captions, intro/outro cards, and the webcam bubble.',
        keywords: ['multi-clip export', 'limitations', 'overlays', 'cards'] }
    ]
  },
  {
    id: 'layers',
    title: 'Text, Image & Audio Layers',
    items: [
      { q: 'How do I add text overlays?',
        a: 'Go to the Layers tab and click "+" next to Text. Type your text, adjust font size, color, bold, and background, and use the X/Y sliders to position it. Set start/end times or snap to the current playhead.',
        keywords: ['text', 'overlay', 'title'] },
      { q: 'How do I add image overlays (logos, watermarks)?',
        a: 'In the Assets tab click "+ Image" to import a file (PNG, JPG, SVG, GIF, WebP), then "+ Layer" on the asset card. Adjust size, position, and timing in the Layers tab.',
        keywords: ['image', 'logo', 'watermark'] },
      { q: 'How do I add background music or sound effects?',
        a: 'In the Assets tab click "+ Audio" to import a file, then "+ Layer". Adjust volume and start time in the Layers tab. Audio layers are mixed with the recording audio on export.',
        keywords: ['music', 'audio', 'sound', 'mix'] }
    ]
  },
  {
    id: 'transcript',
    title: 'Transcript & AI Copilot',
    items: [
      { q: 'What is the Transcript tab for?',
        a: 'Click "Transcribe with Whisper" to generate a transcript from the recording audio. The transcript is a text-based editing surface: click a segment to seek the video, select a run of segments and "Remove selection" to cut that part, or remove detected filler words ("um", "uh"). It does not add on-screen text — for subtitles use the Captions tab.',
        keywords: ['transcript', 'whisper', 'text editing', 'filler', 'seek'] },
      { q: 'What can the AI copilot do?',
        a: 'With an API key set, the AI copilot uses your transcript to generate a title + description, chapter markers, highlight suggestions, or to propose cuts from a natural-language instruction (proposed for review, never auto-applied).',
        keywords: ['ai copilot', 'title', 'chapters', 'highlights', 'edit by prompt'] }
    ]
  },
  {
    id: 'captions',
    title: 'Captions & SRT Export',
    items: [
      { q: 'How do I add captions?',
        a: 'In the Captions tab, click "Add at playhead" to create a caption at the current time, or transcribe with Whisper to fill captions from the audio. Edit text and timing per caption. Captions are burned into the video on export.',
        keywords: ['captions', 'subtitles', 'burn-in'] },
      { q: 'Can I export subtitles?',
        a: 'Yes. Click "Export SRT" (or VTT) in the Captions tab to generate a standard subtitle file for any player or platform.',
        keywords: ['srt', 'vtt', 'subtitles export'] }
    ]
  },
  {
    id: 'export',
    title: 'Exporting',
    items: [
      { q: 'What export formats are supported?',
        a: 'Click "Export" in the top-right. Formats: MP4 (H.264), HEVC, WebM, animated GIF, a single PNG frame, and audio-only MP3 or M4A. Choose a quality preset; optionally enable loudness normalization.',
        keywords: ['export', 'format', 'mp4', 'webm', 'gif', 'mp3'] },
      { q: 'Can I export for Instagram / TikTok / a specific resolution?',
        a: 'Yes. The export dialog offers social-media presets (exact width×height with blur-fill or center-crop) and a resolution cap (e.g. 1080p/720p). These reframe/scale the output to the chosen size.',
        keywords: ['social', 'instagram', 'tiktok', 'resolution', 'preset', '1080p', '720p'] },
      { q: 'What is a .beamproject file?',
        a: 'A portable project archive containing your recordings, assets, and edit settings. Use "Export .beamproject" to back up, or "Import" on the home screen to restore — handy for moving projects between machines.',
        keywords: ['beamproject', 'backup', 'archive', 'import'] }
    ]
  },
  {
    id: 'effects',
    title: 'Effects & Webcam',
    items: [
      { q: 'How do I change playback speed?',
        a: 'In the Inspector panel, click a speed preset (0.5x–2x) or enter a custom value up to 4x. Speed affects both video and audio on export.',
        keywords: ['speed', 'fast', 'slow'] },
      { q: 'How do I crop or change aspect ratio?',
        a: 'In the Inspector panel choose an aspect ratio: 16:9, 9:16, 4:3, or 1:1. The crop preview shows as a dashed border; dimmed areas are removed on export.',
        keywords: ['crop', 'aspect ratio', 'vertical', 'square'] },
      { q: 'How do I change the webcam position and size?',
        a: 'In the Inspector under "Webcam", click a position (TL/TR/BL/BR), drag the size slider (10–50%), and choose Circle or Rect. This affects both preview and export.',
        keywords: ['webcam', 'position', 'size', 'bubble'] }
    ]
  },
  {
    id: 'ai-keys',
    title: 'AI Provider Keys',
    items: [
      { q: 'How do I enable the AI features?',
        a: 'AI features (the Help assistant and the transcript copilot) need an API key. Open Settings and add a key for either Anthropic Claude or Google Gemini. Gemini has a free tier, so it is the easiest way to start. If both keys are set, Beam uses Gemini.',
        keywords: ['api key', 'gemini', 'claude', 'enable ai', 'free'] },
      { q: 'Is my data sent anywhere?',
        a: 'Only when you explicitly trigger an AI action. For the Help assistant, your question plus Beam\'s feature documentation are sent to your chosen provider. For the copilot, the transcript text is sent. Nothing is sent without a key configured and an action triggered.',
        keywords: ['privacy', 'data', 'sent', 'provider'] }
    ]
  },
  {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts',
    items: [
      { q: 'Recording shortcuts',
        a: 'Space / P — Pause or resume recording.\nEscape / S — Stop recording.',
        keywords: ['shortcut', 'recording keys'] },
      { q: 'Editor shortcuts',
        a: 'Space — Play / pause the video.\n? — Open this help.',
        keywords: ['shortcut', 'editor keys', 'help'] }
    ]
  }
]

/**
 * Render the KB as a single deterministic text block for the LLM system prompt.
 * Includes every section title and every question/answer.
 */
export function flattenKbForPrompt(kb = HELP_KB) {
  return kb
    .map((section) => {
      const body = section.items
        .map((item) => `Q: ${item.q}\nA: ${item.a}`)
        .join('\n\n')
      return `## ${section.title}\n${body}`
    })
    .join('\n\n')
}
