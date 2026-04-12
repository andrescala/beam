import { useState } from 'react'
import styles from './HelpDrawer.module.css'

const SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    items: [
      {
        q: 'How do I make my first recording?',
        a: 'Click "New Recording" from the home screen. Grant screen, camera, and microphone permissions when prompted. Choose the screen or window you want to capture, toggle your webcam on/off, then click "Start Recording". Press Space to pause, Escape to stop.'
      },
      {
        q: 'Where are my recordings saved?',
        a: 'Recordings are saved automatically as projects in ~/BeamProjects. Each project has its own folder with the raw recordings, assets, and export files. You can also export a .beamproject archive from the Inspector panel for backup.'
      },
      {
        q: 'How do I rename a project?',
        a: 'Double-click the project name on the home screen card to rename it inline. Press Enter to confirm or Escape to cancel.'
      }
    ]
  },
  {
    id: 'timeline',
    title: 'Timeline & Trimming',
    items: [
      {
        q: 'How do I trim the start or end?',
        a: 'In the Timeline tab, drag the blue trim handles on either side of the track to set your in/out points. You can also type exact values in the Inspector panel under "Trim".'
      },
      {
        q: 'How do I cut a section out?',
        a: 'Click the "Cut" button in the Timeline toolbar. Click once on the timeline to set the start point, then click again to set the end. The red region between is removed from the export. You can drag the edges of a cut to adjust it, or click the X to remove it.'
      },
      {
        q: 'How does Remove Silence work?',
        a: 'Click "Remove Silence" in the Timeline toolbar. Beam analyzes the audio track and automatically adds cuts over any silent segments (pauses longer than 0.5 seconds). The cuts appear as red regions you can review, adjust, or remove before exporting.'
      }
    ]
  },
  {
    id: 'layers',
    title: 'Text, Image & Audio Layers',
    items: [
      {
        q: 'How do I add text overlays?',
        a: 'Go to the Layers tab and click "+" next to Text. Type your text, adjust font size, color, bold, and background. Use the X/Y sliders to position it. Set start/end times or click the "|" button to snap to the current playhead.'
      },
      {
        q: 'How do I add image overlays (logos, watermarks)?',
        a: 'Go to the Assets tab and click "+ Image" to import a file. Then click "+ Layer" on the asset card to add it as an overlay. Switch to the Layers tab to adjust size, position, and timing. Images support PNG, JPG, SVG, GIF, and WebP.'
      },
      {
        q: 'How do I add background music or sound effects?',
        a: 'Go to the Assets tab and click "+ Audio" to import a file. Click "+ Layer" to add it. Switch to the Layers tab to adjust volume (0-100%) and start time. Audio layers are mixed with the original recording audio on export.'
      },
      {
        q: 'What is the Assets tab?',
        a: 'The Assets tab is your media library for the project. It shows all imported files (images and audio) with previews. You can import new files, add them as layers at the current playhead position, and delete unused assets. An "In use" badge shows which files are currently referenced by layers.'
      }
    ]
  },
  {
    id: 'captions',
    title: 'Captions & SRT Export',
    items: [
      {
        q: 'How do I add captions?',
        a: 'Go to the Captions tab and click "Add at playhead" to create a caption at the current time. Or click "Auto-generate" to create evenly spaced placeholder captions across the entire recording. Edit the text and adjust timing for each caption.'
      },
      {
        q: 'Can I export subtitles?',
        a: 'Yes! Click "Export SRT" in the Captions tab. This generates a standard .srt subtitle file that works with any video player or hosting platform. Captions are also burned into the video during MP4 export.'
      }
    ]
  },
  {
    id: 'effects',
    title: 'Effects & Pro Features',
    items: [
      {
        q: 'How do I change playback speed?',
        a: 'In the Inspector panel (right sidebar), click a speed preset (0.5x to 2x) or enter a custom value up to 4x. Speed changes affect both video and audio in the export.'
      },
      {
        q: 'How do I crop the video?',
        a: 'In the Inspector panel, choose an aspect ratio: 16:9, 9:16 (vertical), 4:3, or 1:1 (square). The crop preview shows as a dashed border on the video. The dimmed areas will be removed on export.'
      },
      {
        q: 'What does Vignette do?',
        a: 'Vignette darkens the edges of the video, drawing attention to the center of the screen. Adjust the intensity slider (10-80%) in the Inspector panel. Great for focusing the viewer on your main content.'
      },
      {
        q: 'How do Zoom & Pan keyframes work?',
        a: 'In the Inspector panel, click "+ Add Keyframe". Set the time (when the zoom starts), duration (how long it lasts), zoom level (1.1-4x), and focal point (X/Y, where 0.5, 0.5 is center). The zoom smoothly animates in and out. Add multiple keyframes for different moments.'
      },
      {
        q: 'What are Intro and Outro cards?',
        a: 'Title cards are branded slides that play before (intro) or after (outro) your recording. Toggle them on in the Inspector, then customize the title text, subtitle, duration (1-10s), and background color. They appear in the final MP4 export.'
      },
      {
        q: 'What does Video Blur do?',
        a: 'Video Blur applies a blur effect across the entire video frame. Adjust the strength slider. This is useful for creating background slides or obscuring sensitive content. Note: blur is applied before the webcam overlay, so your webcam stays sharp.'
      }
    ]
  },
  {
    id: 'webcam',
    title: 'Webcam',
    items: [
      {
        q: 'How do I change the webcam position and size?',
        a: 'In the Inspector panel under "Webcam", click a position (TL, TR, BL, BR) and drag the size slider (10-50% of video width). Choose Circle or Rect shape. These settings affect both the preview and the final export.'
      },
      {
        q: 'Can I record without a webcam?',
        a: 'Yes. Toggle the webcam off before recording by clicking the camera icon on the recording screen. Your preference is remembered for next time.'
      }
    ]
  },
  {
    id: 'export',
    title: 'Exporting',
    items: [
      {
        q: 'How do I export my video?',
        a: 'Click the "Export" button in the top-right corner of the editor. Choose MP4 (H.264 video) or GIF (animated image). MP4 includes all effects, overlays, and title cards. GIF includes trim, cuts, speed, and crop only.'
      },
      {
        q: 'What is a .beamproject file?',
        a: 'A portable project archive. It contains all your recordings, assets, and edit settings in a single file. Use "Export .beamproject" in the Inspector to back up, or "Import" on the home screen to restore. Great for moving projects between machines.'
      }
    ]
  },
  {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts',
    items: [
      {
        q: 'Recording',
        a: 'Space / P - Pause / Resume recording\nEscape / S - Stop recording'
      },
      {
        q: 'Editor',
        a: 'Space - Play / Pause video'
      }
    ]
  }
]

function HelpDrawer({ open, onClose }) {
  const [expandedId, setExpandedId] = useState('getting-started')
  const [expandedItem, setExpandedItem] = useState(null)

  if (!open) return null

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>How to use Beam</h2>
          <button className={styles.closeBtn} onClick={onClose}>{'\u00D7'}</button>
        </div>

        <div className={styles.body}>
          {SECTIONS.map((section) => (
            <div key={section.id} className={styles.section}>
              <button
                className={`${styles.sectionTitle} ${expandedId === section.id ? styles.sectionTitleActive : ''}`}
                onClick={() => setExpandedId(expandedId === section.id ? null : section.id)}
              >
                <span>{section.title}</span>
                <span className={styles.chevron}>{expandedId === section.id ? '\u25BC' : '\u25B6'}</span>
              </button>

              {expandedId === section.id && (
                <div className={styles.sectionBody}>
                  {section.items.map((item, i) => {
                    const itemKey = `${section.id}-${i}`
                    const isOpen = expandedItem === itemKey
                    return (
                      <div key={i} className={styles.faqItem}>
                        <button
                          className={`${styles.question} ${isOpen ? styles.questionOpen : ''}`}
                          onClick={() => setExpandedItem(isOpen ? null : itemKey)}
                        >
                          {item.q}
                        </button>
                        {isOpen && (
                          <div className={styles.answer}>
                            {item.a.split('\n').map((line, j) => (
                              <p key={j}>{line}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default HelpDrawer
