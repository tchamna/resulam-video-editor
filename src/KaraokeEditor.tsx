import { useEffect, useState, type RefCallback } from 'react'
import { formatLyrics, karaokeDuration, karaokePresets, parseLyrics, type Karaoke, type KaraokeStyle } from './karaoke'
import { durationOf, MIN_CLIP, type Clip, useEditor } from './store'

const emptyCaptions: Karaoke = { main: [], second: [], style: karaokePresets.normal }

export function KaraokeEditor({ clip, inputRef }: { clip: Clip; inputRef: RefCallback<HTMLTextAreaElement> }) {
  const captions = clip.karaoke ?? emptyCaptions
  const [main, setMain] = useState(() => formatLyrics(captions.main))
  const [second, setSecond] = useState(() => formatLyrics(captions.second))
  const [first, setFirst] = useState('0')
  const [last, setLast] = useState(() => {
    const rest = durationOf(useEditor.getState().clips.filter(item => item.id !== clip.id)) - clip.start
    return String(Math.round(Math.max(0, karaokeDuration(captions) || rest || clip.duration) * 100) / 100)
  })
  const [message, setMessage] = useState('')
  const [invalid, setInvalid] = useState(false)
  const savedMain = formatLyrics(captions.main)
  const savedSecond = formatLyrics(captions.second)
  useEffect(() => { setMain(savedMain); setSecond(savedSecond) }, [savedMain, savedSecond])

  async function fileToText(file: File, update: (value: string) => void) {
    try {
      if (file.size > 2_000_000) throw new Error('Choose a caption file under 2 MB.')
      update(await file.text())
      setMessage('Lyrics loaded. Apply them to preview the captions.')
      setInvalid(false)
    } catch (error) { setMessage((error as Error).message); setInvalid(true) }
  }

  function apply() {
    try {
      const interval = { start: Number(first), end: Number(last) }
      const primary = parseLyrics(main, interval)
      const alternate = parseLyrics(second, interval, primary)
      if (!primary.length && !alternate.length) throw new Error('Enter lyrics or import a caption file.')
      const karaoke = { main: primary, second: alternate, style: captions.style }
      const lastCue = karaokeDuration(karaoke)
      const previousEnd = karaokeDuration(captions)
      const wholeClip = clip.offset === 0 && (!previousEnd || Math.abs(clip.duration - previousEnd) < MIN_CLIP)
      const state = useEditor.getState()
      state.play(false)
      state.change(clip.id, { karaoke, duration: wholeClip ? Math.max(MIN_CLIP, lastCue) : clip.duration })
      const firstCue = Math.min(primary[0]?.start ?? Infinity, alternate[0]?.start ?? Infinity)
      if (wholeClip && (state.currentTime < clip.start + firstCue || state.currentTime >= clip.start + lastCue)) {
        state.seek(clip.start + firstCue + Math.min(.01, (lastCue - firstCue) / 2))
      }
      setMessage('Captions applied.')
      setInvalid(false)
    } catch (error) { setMessage((error as Error).message); setInvalid(true) }
  }

  function styleTo(style: Partial<KaraokeStyle>) {
    useEditor.getState().change(clip.id, { karaoke: { ...captions, style: { ...captions.style, ...style } } })
  }

  return <div className="karaoke-editor">
    <details open className="karaoke-section">
      <summary>Lyrics and timing</summary>
      <p>Use one phrase per line for TXT. SRT keeps its cue times. TSV keeps exact word times. Times are relative to this clip.</p>
      <label htmlFor="main-lyrics">Main lyrics</label>
      <textarea id="main-lyrics" ref={inputRef} rows={5} value={main} onChange={event => setMain(event.target.value)}
        placeholder="Paste lyrics, SRT, or timing TSV" spellCheck={false} />
      <label className="karaoke-file">Import main lyrics <input type="file" accept=".txt,.srt,.tsv" onChange={event => {
        const file = event.target.files?.[0]
        if (file) void fileToText(file, setMain)
        event.target.value = ''
      }} /></label>
      <details className="karaoke-section secondary-lyrics" open={!!second}>
        <summary>Second language</summary>
        <textarea aria-label="Second language lyrics" rows={4} value={second} onChange={event => setSecond(event.target.value)}
          placeholder="Paste translation lyrics, SRT, or timing TSV" spellCheck={false} />
        <label className="karaoke-file">Import second lyrics <input type="file" accept=".txt,.srt,.tsv" onChange={event => {
          const file = event.target.files?.[0]
          if (file) void fileToText(file, setSecond)
          event.target.value = ''
        }} /></label>
      </details>
      <div className="field-grid">
        <label className="field">First lyric (s)<input type="number" min="0" step=".1" value={first} onChange={event => setFirst(event.target.value)} /></label>
        <label className="field">Last lyric (s)<input type="number" min="0" step=".1" value={last} onChange={event => setLast(event.target.value)} /></label>
      </div>
      <button type="button" className="header-action karaoke-apply" onClick={apply}>Apply lyrics</button>
      {message && <p role={invalid ? 'alert' : 'status'}>{message}</p>}
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
