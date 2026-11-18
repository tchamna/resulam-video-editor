import { useEffect, useRef, useState, type RefCallback } from 'react'
import { fitLyricEnds, formatLyrics, karaokeDuration, karaokePresets, lyricsInWindow, parseLyrics, type CaptionLanguage, type Karaoke, type KaraokeStyle } from './karaoke'
import { MIN_CLIP, nextCaptionStart, type Clip, useEditor } from './store'
import { CaptionCueEditor } from './CaptionCueEditor'

const emptyCaptions: Karaoke = { main: [], second: [], style: karaokePresets.normal }

export function KaraokeEditor({ clip, inputRef }: { clip: Clip; inputRef: RefCallback<HTMLTextAreaElement> }) {
  const captions = clip.karaoke ?? emptyCaptions
  const fixed = clip.fixedCaptionLength || clip.offset > 0
  const rows = (language: CaptionLanguage) => formatLyrics(lyricsInWindow(captions[language], clip.offset, fixed ? clip.offset + clip.duration * clip.speed : Infinity))
  const savedMain = rows('main')
  const savedSecond = rows('second')
  const [main, setMain] = useState(savedMain)
  const [second, setSecond] = useState(savedSecond)
  const [first, setFirst] = useState('0')
  const [last, setLast] = useState('')
  const defaultEnd = String(Math.round(clip.duration * clip.speed * 1000) / 1000)
  const [message, setMessage] = useState('')
  const ownBulkChange = useRef<Karaoke | null>(null)
  useEffect(() => {
    if (ownBulkChange.current === captions) return
    setMain(savedMain)
    setSecond(savedSecond)
    setMessage('')
  }, [captions, savedMain, savedSecond])

  async function fileToText(file: File, language: CaptionLanguage) {
    try {
      if (file.size > 2_000_000) throw new Error('Choose a caption file under 2 MB.')
      const value = await file.text()
      if (language === 'main') setMain(value)
      else setSecond(value)
      updateLyrics(language === 'main' ? value : main, language === 'second' ? value : second, first, last, true)
    } catch (error) { setMessage((error as Error).message) }
  }

  function updateLyrics(primaryText: string, alternateText: string, from: string, to: string, reveal = false) {
    try {
      const interval = { start: Number(from), end: Number(to || defaultEnd) }
      const primary = parseLyrics(primaryText, interval, [], !to)
      const alternate = parseLyrics(alternateText, interval, primary, !to)
      const limit = (fixed ? clip.duration : nextCaptionStart(useEditor.getState().clips, clip) - clip.start) * clip.speed
      const karaoke = {
        main: lyricsInWindow(primary, -clip.offset, limit),
        second: lyricsInWindow(alternate, -clip.offset, limit),
        style: captions.style,
      }
      updateCaptions(karaoke, true)
      setMessage('')
      const firstCue = Math.min(primary[0]?.start ?? Infinity, alternate[0]?.start ?? Infinity)
      if (reveal || !karaokeDuration(captions)) {
        const time = clip.start + firstCue / clip.speed
        if (time < clip.start + (fixed ? clip.duration : Infinity)) useEditor.getState().seek(time)
      }
    } catch (error) { setMessage((error as Error).message) }
  }

  function updateCaptions(karaoke: Karaoke, bulk = false) {
    const state = useEditor.getState()
    const sourceEnd = clip.offset + clip.duration * clip.speed
    const fitted = fitLyricEnds(karaoke, fixed ? sourceEnd : Math.max(sourceEnd, karaokeDuration(karaoke)))
    const lastCue = karaokeDuration(fitted)
    if (bulk) ownBulkChange.current = fitted
    state.play(false)
    state.change(clip.id, { karaoke: fitted, ...(!fixed && lastCue > 0 ? { duration: Math.max(MIN_CLIP, (lastCue - clip.offset) / clip.speed) } : {}) })
  }

  function styleTo(style: Partial<KaraokeStyle>) {
    useEditor.getState().change(clip.id, { karaoke: { ...captions, style: { ...captions.style, ...style } } })
  }

  return <div className="karaoke-editor">
    <CaptionCueEditor clip={clip} captions={captions} onChange={updateCaptions} inputRef={inputRef} />
    <details className="karaoke-section">
      <summary>Import lyrics and timing</summary>
      <p>Use one phrase per line for TXT. SRT keeps its cue times. TSV keeps exact word times. Times are relative to this clip.</p>
      <label htmlFor="main-lyrics">Main lyrics</label>
      <textarea id="main-lyrics" rows={5} value={main} onChange={event => { setMain(event.target.value); updateLyrics(event.target.value, second, first, last) }}
        placeholder="Paste lyrics, SRT, or timing TSV" spellCheck={false} />
      <label className="karaoke-file">Import main lyrics <input type="file" accept=".txt,.srt,.tsv" onChange={event => {
        const file = event.target.files?.[0]
        if (file) void fileToText(file, 'main')
        event.target.value = ''
      }} /></label>
      <details className="karaoke-section secondary-lyrics" open={!!second}>
        <summary>Second language</summary>
        <textarea aria-label="Second language lyrics" rows={4} value={second} onChange={event => { setSecond(event.target.value); updateLyrics(main, event.target.value, first, last) }}
          placeholder="Paste translation lyrics, SRT, or timing TSV" spellCheck={false} />
        <label className="karaoke-file">Import second lyrics <input type="file" accept=".txt,.srt,.tsv" onChange={event => {
          const file = event.target.files?.[0]
          if (file) void fileToText(file, 'second')
          event.target.value = ''
        }} /></label>
      </details>
      <div className="field-grid">
        <label className="field">First lyric (s)<input type="number" min="0" step=".1" value={first} onChange={event => { setFirst(event.target.value); updateLyrics(main, second, event.target.value, last) }} /></label>
        <label className="field">Last lyric (s)<input type="number" min="0" step=".1" value={last} placeholder={defaultEnd} onChange={event => { setLast(event.target.value); updateLyrics(main, second, first, event.target.value) }} /></label>
      </div>
      {message && <p role="alert">{message}</p>}
    </details>
    <details open className="karaoke-section">
      <summary>Caption style</summary>
      <div className="karaoke-preset">
        <button type="button" className="header-action" onClick={() => styleTo(karaokePresets.normal)}>Normal</button>
        <button type="button" className="header-action" onClick={() => styleTo(karaokePresets.custom)}>Custom</button>
      </div>
      <label className="field">Contrast
        <select value={captions.style.contrast} onChange={event => styleTo({ contrast: event.target.value as KaraokeStyle['contrast'] })}>
          <option value="outline">Outline</option><option value="band">Outline + band</option><option value="none">None</option>
        </select>
      </label>
      <div className="field-grid">
        {([['mainHighlight', 'Main highlight'], ['mainColor', 'Main text'], ['secondHighlight', 'Second highlight'], ['secondColor', 'Second text']] as const).map(([key, label]) =>
          <label className="field" key={key}>{label}<input type="color" value={captions.style[key]} onChange={event => styleTo({ [key]: event.target.value })} /></label>
        )}
      </div>
      {([['size', 'Size', 3, 10, .1], ['mainY', 'Main position', 10, 90, 1], ['secondY', 'Second position', 10, 90, 1]] as const)
        .map(([key, label, min, max, step]) => <label className="inspector-range" key={key}>
          <span>{label}<strong>{captions.style[key]}%</strong></span>
          <input type="range" min={min} max={max} step={step} value={captions.style[key]} onChange={event => styleTo({ [key]: +event.target.value })} />
        </label>)}
    </details>
  </div>
}
