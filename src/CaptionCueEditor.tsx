import { useLayoutEffect, useState, type RefCallback } from 'react'
import { createLyricCue, type CaptionLanguage, type Karaoke, type LyricLine } from './karaoke'
import { MIN_CLIP, nextCaptionStart, type Clip, useEditor } from './store'

const displayTime = (time: number) => String(Math.round(time * 1000) / 1000)

export function CaptionCueEditor({ clip, captions, onChange, inputRef }: {
  clip: Clip
  captions: Karaoke
  onChange: (captions: Karaoke) => void
  inputRef: RefCallback<HTMLTextAreaElement>
}) {
  const [language, setLanguage] = useState<CaptionLanguage>('main')
  const [selected, setSelected] = useState<LyricLine | null>(null)
  const [text, setText] = useState('')
  const [start, setStart] = useState(displayTime(clip.start))
  const [end, setEnd] = useState('')
  const [autoEnd, setAutoEnd] = useState(true)
  const [message, setMessage] = useState('')
  const editVersion = useEditor(state => state.annotationEditVersion)
  const toSource = (time: number) => clip.offset + (time - clip.start) * clip.speed
  const toTimeline = (time: number) => clip.start + (time - clip.offset) / clip.speed
  const clipEnd = clip.start + clip.duration
  const fixed = clip.fixedCaptionLength || clip.offset > 0
  const lines = captions[language]
  const visible = lines.map((line, index) => ({ line, index })).filter(({ line }) =>
    line.end > clip.offset && line.start < toSource(clipEnd))
  const editing = selected ? (visible.find(({ line }) => line === selected) ??
    visible.find(({ line }) => line.start === selected.start))?.index ?? null : null
  const activeLine = editing === null ? undefined : lines[editing]
  const shownStart = activeLine && !message ? displayTime(Math.max(clip.start, toTimeline(activeLine.start))) : start
  const shownEnd = activeLine && !message ? displayTime(Math.min(clipEnd, toTimeline(activeLine.end))) : autoEnd ? displayTime(clipEnd) : end

  function reset(time: number) {
    setSelected(null)
    setText('')
    setStart(displayTime(time))
    setEnd('')
    setAutoEnd(true)
    setMessage('')
  }

  function choose(value: string, preview = true, activeLines = lines) {
    if (!value) { reset(Math.max(clip.start, useEditor.getState().currentTime)); return }
    const index = Number(value)
    const line = activeLines[index]
    const first = Math.max(clip.start, toTimeline(line.start))
    setSelected(line)
    setStart(displayTime(first))
    setEnd(displayTime(Math.min(clipEnd, toTimeline(line.end))))
    setAutoEnd(!!line.autoEnd)
    const visibleEnd = toSource(clipEnd)
    setText(line.words.filter(word => word.end > clip.offset && word.start < visibleEnd).map(word => word.text).join(' '))
    setMessage('')
    const state = useEditor.getState()
    state.play(false)
    if (preview) state.seek(first)
  }

  useLayoutEffect(() => {
    const state = useEditor.getState()
    const activeLanguage = state.annotationEditLanguage ?? language
    const activeLines = captions[activeLanguage]
    const now = toSource(state.currentTime)
    const candidates = activeLines.filter(line => line.end > clip.offset && line.start < toSource(clipEnd))
    const hit = candidates.find(line => line.start <= now && line.end > now) ??
      candidates.find(line => line.start > now) ?? candidates.at(-1)
    setLanguage(activeLanguage)
    if (hit) choose(String(activeLines.indexOf(hit)), false, activeLines)
    else reset(Math.max(clip.start, state.currentTime))
  }, [editVersion])

  function save(value: string, from: string, to: string, automatic = autoEnd) {
    setText(value)
    setStart(from)
    setEnd(to)
    setAutoEnd(automatic)
    if (!value.trim()) {
      if (editing !== null) {
        onChange({ ...captions, [language]: lines.filter((_, index) => index !== editing) })
        setSelected(null)
      }
      setMessage('')
      return
    }
    try {
      const remaining = lines.filter((_, index) => index !== editing)
      if (!from || Number(from) < clip.start - .0005) throw new Error('Set the cue at or after the start of this clip.')
      const limit = fixed ? clipEnd : nextCaptionStart(useEditor.getState().clips, clip)
      const fromTime = activeLine && from === displayTime(Math.max(clip.start, toTimeline(activeLine.start)))
        ? Math.max(clip.start, toTimeline(activeLine.start)) : Math.max(Number(from), clip.start)
      const nextCue = remaining.find(line => toTimeline(line.start) > fromTime)
      const toTime = automatic ? Math.min(limit, nextCue ? toTimeline(nextCue.start) : Infinity,
        fromTime < clipEnd - MIN_CLIP ? clipEnd : fromTime + 2) : Number(to)
      if ((!automatic && !to) || toTime > limit + .0005) throw new Error('Set the end within this caption chunk.')
      const interval = { start: toSource(fromTime), end: toSource(Math.min(toTime, limit)) }
      const updated = { ...createLyricCue(value, interval, activeLine), autoEnd: automatic }
      const next = [...remaining, updated].sort((a, b) => a.start - b.start)
      onChange({ ...captions, [language]: next })
      setSelected(updated)
      setMessage('')
      const state = useEditor.getState()
      if (state.currentTime < fromTime || state.currentTime >= toTime) state.seek(fromTime)
    } catch (error) { setMessage((error as Error).message) }
  }

  return <details open className="karaoke-section">
    <summary>Write captions</summary>
    <label className="field">Caption language
      <select value={language} onChange={event => {
        setLanguage(event.target.value as CaptionLanguage)
        reset(Math.max(clip.start, useEditor.getState().currentTime))
      }}><option value="main">Main</option><option value="second">Second language</option></select>
    </label>
    <label className="field">Caption cue
      <select value={editing ?? ''} onChange={event => choose(event.target.value)}>
        <option value="">New caption</option>
        {visible.map(({ line, index }) => <option key={index} value={index}>
          {displayTime(Math.max(clip.start, toTimeline(line.start)))}s · {line.words.map(word => word.text).join(' ').slice(0, 72)}
        </option>)}
      </select>
    </label>
    <label className="field">Caption text
      <textarea ref={inputRef} rows={2} value={text} onChange={event => save(event.target.value, shownStart, shownEnd)} />
    </label>
    <div className="field-grid">
      <div><label className="field">Start (seconds)
        <input type="number" step=".001" value={shownStart} onChange={event => save(text, event.target.value, shownEnd)} />
      </label><button type="button" className="header-action cue-playhead" onClick={() => save(text, displayTime(useEditor.getState().currentTime), shownEnd)}>Start at playhead</button></div>
      <div><label className="field">End (seconds)
        <input type="number" step=".001" value={shownEnd} onChange={event => save(text, shownStart, event.target.value, false)} />
      </label><button type="button" className="header-action cue-playhead" onClick={() => save(text, shownStart, displayTime(useEditor.getState().currentTime), false)}>End at playhead</button></div>
    </div>
    <div className="karaoke-preset">
      <button type="button" className="header-action" onClick={() => {
        const time = useEditor.getState().currentTime
        reset(Math.max(clip.start, !activeLine || time > toTimeline(activeLine.start) ? time : Number(shownEnd)))
      }}>New caption</button>
      {!autoEnd && <button type="button" className="header-action" onClick={() => save(text, shownStart, '', true)}>Use automatic end</button>}
      {editing !== null && <button type="button" className="header-action" onClick={() => {
        onChange({ ...captions, [language]: lines.filter((_, index) => index !== editing) })
        reset(Math.max(clip.start, useEditor.getState().currentTime))
      }}>Delete caption</button>}
    </div>
    {message && <p role="status">{message}</p>}
  </details>
}
