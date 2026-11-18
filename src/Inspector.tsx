import { AlignCenter, AlignLeft, AlignRight, AudioLines, Bold, ChevronDown, Crop, Move, SlidersHorizontal, Sparkles, Type } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { canCrop, clamp, type Clip, EMPTY_CROP, MIN_CLIP, timed, useEditor } from './store'
import { icons, ToolButton } from './ui'
import { KaraokeEditor } from './KaraokeEditor'

function Section({ label, icon, children, optional = false }: { label: string; icon: ReactNode; children: ReactNode; optional?: boolean }) {
  return <details className="inspector-section" open={!optional}>
    <summary>{icon}<span>{label}</span><ChevronDown className="section-chevron" size={14} /></summary>
    <div className="inspector-fields">{children}</div>
  </details>
}

function Field({ label, value, unit, min, max, step = 1, change }: {
  label: string; value: number; unit: string; min: number; max: number; step?: number; change: (value: number) => void
}) {
  return <label className="field"><span>{label}</span><div className="number-wrap">
    <input aria-label={label} type="number" value={Number(value.toFixed(2))} step={step} min={min} max={max}
      onChange={e => { if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) change(clamp(e.target.valueAsNumber, min, max)) }} />
    <span>{unit}</span>
  </div></label>
}

export function Inspector({ exporting }: { exporting: boolean }) {
  const clip = useEditor(s => s.clips.find(c => c.id === s.selectedClipId))
  const track = useEditor(s => s.tracks.find(t => t.id === clip?.track))
  const asset = useEditor(s => s.assets.find(a => a.id === clip?.assetId))
  const editVersion = useEditor(s => s.annotationEditVersion)
  const inspectedEdit = useRef(editVersion)
  const annotationInput = useRef<HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement | null>(null)
  useEffect(() => {
    if (inspectedEdit.current === editVersion) return
    inspectedEdit.current = editVersion
    const input = annotationInput.current
    const panel = input?.closest('details')
    if (panel) panel.open = true
    input?.focus()
    if (input instanceof HTMLTextAreaElement) {
      if (clip?.kind === 'karaoke') input.setSelectionRange(input.value.length, input.value.length)
      else input.select()
    }
  }, [editVersion, clip?.kind])
  const edit = (patch: Partial<Clip>) => { if (clip) useEditor.getState().change(clip.id, patch) }
  const number = (key: 'x' | 'y' | 'scale' | 'rotation' | 'speed' | 'fontSize' | 'fadeIn' | 'fadeOut', label: string, unit: string, min: number, max: number, step = 1) => (
    <Field label={label} value={clip![key]} unit={unit} min={min} max={max} step={step} change={value => {
      const duration = key === 'speed' && asset ? Math.min(clip!.duration, (asset.duration - clip!.offset) / value) : clip!.duration
      edit(key === 'speed' ? { speed: value, duration: Math.max(MIN_CLIP, duration) } : { [key]: value })
    }} />
  )
  const range = (key: 'opacity' | 'volume' | 'blur', label: string, max = 100, unit = '%', min = 0) => (
    <label className="inspector-range"><span>{label}<strong>{Math.round(clip![key])}{unit}</strong></span>
      <input aria-label={label} type="range" min={min} max={max} value={clip![key]}
        onPointerDown={() => useEditor.getState().checkpoint()}
        onKeyDown={event => { if (event.key.startsWith('Arrow') || ['Home', 'End'].includes(event.key)) useEditor.getState().checkpoint() }}
        onChange={e => useEditor.getState().change(clip!.id, { [key]: +e.target.value }, false)} />
    </label>
  )
  const Icon = clip ? icons[clip.kind] : SlidersHorizontal
  const crop = clip?.crop ?? EMPTY_CROP
  return <aside className="inspector" aria-label="Properties">
    <div className="panel-heading"><SlidersHorizontal size={16} /><h2>Properties</h2></div>
    {clip ? <div className="inspector-scroll" key={clip.id}>
      <div className="inspector-clip"><div className={`track-glyph ${clip.track}`}><Icon size={17} /></div><div>
        <strong>{clip.name}</strong><span>{track?.name}{track?.locked ? ' · Locked' : ''}</span>
      </div></div>
      <fieldset disabled={exporting || track?.locked}>
        {clip.kind === 'karaoke' ? <KaraokeEditor clip={clip} inputRef={input => { annotationInput.current = input }} /> : <>
        {clip.kind !== 'audio' && <Section label="Transform" icon={<Move size={15} />}>
          <div className="field-grid">{number('x', 'Position X', '%', -1000, 1000)}{number('y', 'Position Y', '%', -1000, 1000)}</div>
          <div className="field-grid">{number('scale', 'Scale', '%', 1, 800)}{number('rotation', 'Rotation', '°', -360, 360)}</div>
          {range('opacity', 'Opacity')}
        </Section>}
        {timed(clip.kind) && <Section label="Playback" icon={<AudioLines size={15} />}>
          {range('volume', 'Volume')}
          {number('speed', 'Playback speed', '×', .25, 4, .25)}
        </Section>}
        {canCrop(clip.kind) && <Section label="Crop edges" icon={<Crop size={15} />} optional={!clip.crop}>
          <div className="field-grid">{([['left', 'right'], ['right', 'left'], ['top', 'bottom'], ['bottom', 'top']] as const).map(([edge, opposite]) =>
            <Field key={edge} label={`Crop ${edge}`} unit="%" min={0} max={98 - crop[opposite]} step={.1} value={crop[edge]} change={value => edit({ crop: { ...crop, [edge]: value } })} />
          )}</div>
          <button className="subtle-button" type="button" disabled={!clip.crop} onClick={() => edit({ crop: undefined })}>Reset crop</button>
        </Section>}
        {!!clip.silentRanges?.length && <Section label="Silenced audio" icon={<AudioLines size={15} />}>
          <button className="subtle-button" type="button" onClick={() => edit({ silentRanges: undefined })}>Clear silenced ranges</button>
        </Section>}
        {clip.kind === 'text' && <Section label="Text style" icon={<Type size={15} />}>
          <textarea ref={input => { annotationInput.current = input }} aria-label="Annotation text" value={clip.text} onChange={e => edit({ text: e.target.value, name: e.target.value.trim().split('\n')[0] || 'Text Box' })} />
          {number('fontSize', 'Font size', 'px', 8, 230)}
          <div className="text-tools">
            <ToolButton label="Bold text" aria-pressed={clip.bold} className={clip.bold ? 'active' : ''} onClick={() => edit({ bold: !clip.bold })}><Bold size={15} /></ToolButton>
            {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([align, Alignment]) =>
              <ToolButton key={align} label={`Align ${align}`} aria-pressed={clip.align === align} className={clip.align === align ? 'active' : ''} onClick={() => edit({ align })}><Alignment size={15} /></ToolButton>)}
            <input type="color" aria-label="Text color" value={clip.color} onChange={e => edit({ color: e.target.value })} />
          </div>
        </Section>}
        {(clip.kind === 'arrow' || clip.kind === 'highlight') && <Section label="Callout style" icon={<Icon size={15} />}>
          <label className="color-field">Color <input ref={input => { annotationInput.current = input }} type="color" aria-label="Callout color" value={clip.color} onChange={e => edit({ color: e.target.value })} /></label>
        </Section>}
        {clip.kind === 'blur' && <Section label="Blur / Redact" icon={<Icon size={15} />}>
          <label className="field"><span>Mode</span><select ref={input => { annotationInput.current = input }} aria-label="Redaction mode" value={clip.redact ? 'solid' : 'blur'} onChange={e => edit({ redact: e.target.value === 'solid' })}><option value="blur">Blur</option><option value="solid">Solid redact</option></select></label>
          {!clip.redact && range('blur', 'Intensity', 60, ' px', 1)}
        </Section>}
        <Section label="Effects" icon={<Sparkles size={15} />} optional={!clip.endTransform && !clip.fadeIn && !clip.fadeOut && clip.track !== 'overlay'}>
          <div className="field-grid">{number('fadeIn', 'Fade in', 's', 0, clip.duration, .1)}{number('fadeOut', 'Fade out', 's', 0, clip.duration, .1)}</div>
          {clip.kind !== 'audio' && <label className="field"><span>Picture-in-picture</span><select aria-label="Picture-in-picture shape" value={clip.shape} onChange={e => edit({ shape: e.target.value as Clip['shape'] })}><option value="none">None</option><option value="circle">Circle</option><option value="rounded">Rounded rectangle</option></select></label>}
          {clip.endTransform && <><span className="field-caption">End keyframe</span><div className="field-grid">
            {(['x', 'y', 'scale'] as const).map(key => <Field key={key} label={key === 'scale' ? 'End scale' : `End ${key.toUpperCase()}`} unit="%" min={key === 'scale' ? 1 : -1000} max={1000} value={clip.endTransform![key]} change={value => edit({ endTransform: { ...clip.endTransform!, [key]: value } })} />)}
          </div>
          <button className="subtle-button" type="button" onClick={() => edit({ endTransform: undefined })}>Remove pan &amp; zoom</button></>}
        </Section>
        </>}
      </fieldset>
    </div> : <div className="inspector-empty"><SlidersHorizontal size={24} /><p>Select a clip to edit its properties.</p></div>}
  </aside>
}

