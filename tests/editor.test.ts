import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { canvasSizeOf, clipsOnTrack, durationOf, useEditor, type Asset } from '../src/store.ts'
import { createLyricCue, exportSrt, formatLyrics, karaokePresets, lyricLineAt, parseLyrics } from '../src/karaoke.ts'
import { shortcutFor } from '../src/shortcuts.ts'
import { decodeProject, encodeProject, projectSnapshot, sameProject } from '../src/projectFile.ts'

const state = useEditor.getState
const initial = state()
const main = () => state().clips.filter(clip => clip.track === 'main')
const timing = () => main().map(clip => [clip.start, clip.duration, clip.offset])

test('bilingual plain text follows the main SRT cue boundaries and keeps tonal spellings', () => {
  const window = { start: 0, end: 9 }
  const primary = parseLyrics('1\r\n00:00:01,400 --> 00:00:02,100\r\nNùfī zǎ\r\n\r\n2\r\n00:00:03,200 --> 00:00:04,000\r\nMbe’mbè', window)
  const translated = parseLyrics('Welcome here\nGood day', window, primary)
  assert.deepEqual(primary.map(line => line.words.map(word => word.text)), [['Nùfī', 'zǎ'], ['Mbe’mbè']])
  assert.deepEqual(translated.map(({ start, end }) => [start, end]), [[1.4, 2.1], [3.2, 4]])
  assert.equal(lyricLineAt(primary, 1.4), primary[0])
  assert.equal(lyricLineAt(primary, 2.1), undefined)
  assert.deepEqual(parseLyrics(formatLyrics(primary), window), primary)
})

test('Karaoke Studio timing TSV retains exact timings and rejects invalid words', () => {
  const window = { start: 0, end: 10 }
  const tsv = '\uFEFFLine\tStart(s)\tEnd(s)\tWord\n1\t1.28\t1.64\tLíé’zī\n1\t1.69\t2.25\tZáhnam'
  const lines = parseLyrics(tsv, window)
  assert.deepEqual(lines[0].words, [
    { start: 1.28, end: 1.64, text: 'Líé’zī' }, { start: 1.69, end: 2.25, text: 'Záhnam' },
  ])
  assert.throws(() => parseLyrics(tsv.replace('1.69', '1.10'), window), /overlap/)
  assert.throws(() => parseLyrics('Lyrics', { start: 3, end: 2 }), /after/)
})

test('empty SRT cues stay silent and exported bilingual SRT follows clip timing', () => {
  const main = parseLyrics('1\r\n00:00:00,000 --> 00:00:01,000\r\n \r\n\r\n2\r\n00:00:01,000 --> 00:00:05,000\r\nNùfī', { start: 0, end: 6 })
  assert.equal(main.length, 1)
  assert.equal(lyricLineAt(main, .5), undefined)
  const second = [createLyricCue('Bonjour à tous', { start: 2, end: 3 })]
  const clip = { start: 12, duration: 1, offset: 1.5, speed: 2, karaoke: { main, second, style: karaokePresets.normal } }
  assert.equal(exportSrt([clip], 'main'), '1\r\n00:00:12,000 --> 00:00:13,000\r\nNùfī\r\n\r\n')
  assert.equal(exportSrt([clip], 'second'), '1\r\n00:00:12,250 --> 00:00:12,750\r\nBonjour à tous\r\n\r\n')
  assert.equal(exportSrt([{ ...clip, offset: 6 }], 'main'), '')
})

test('splitting assigns later bilingual cues to the right chunk without shifting their timeline timing', () => {
  const id = state().add('karaoke', 3)!
  const lyrics = [createLyricCue('One two', { start: 0, end: 2 }), createLyricCue('Three four', { start: 2, end: 4 })]
  const second = [createLyricCue('Bonjour', { start: 1, end: 4 })]
  state().change(id, { karaoke: { main: lyrics, second, style: karaokePresets.custom } })
  state().seek(5)
  state().split()
  const right = state().clips.find(clip => clip.id === state().selectedClipId)!
  assert.equal(right.offset, 2)
  const left = state().clips.find(clip => clip.id === id)!
  assert.deepEqual(left.karaoke?.main, lyrics.slice(0, 1))
  assert.deepEqual(right.karaoke?.main, lyrics.slice(1))
  assert.equal(left.karaoke?.second[0].end, 2)
  assert.equal(right.karaoke?.second[0].start, 2)
  state().change(right.id, { start: 8 })
  assert.equal(state().clips.find(clip => clip.id === right.id)?.offset, 2)
})

test('resizing a caption chunk updates its automatic end and preserves explicit timings and undo', () => {
  const id = state().add('karaoke', 3)!
  const main = parseLyrics('One two', { start: 0, end: 4 }, [], true)
  const second = [createLyricCue('Bonjour', { start: 0, end: 3 })]
  state().change(id, { karaoke: { main, second, style: karaokePresets.normal } })
  const chunk = () => state().clips.find(clip => clip.id === id)!
  state().change(id, { duration: 6 })
  assert.equal(chunk().karaoke?.main[0].end, 6)
  assert.equal(chunk().karaoke?.main[0].words.at(-1)?.end, 6)
  assert.deepEqual(chunk().karaoke?.second, second)
  state().change(id, { duration: 2 })
  assert.equal(chunk().karaoke?.main[0].end, 2)
  state().undo()
  assert.equal(chunk().karaoke?.main[0].end, 6)
})

test('adding at a caption boundary selects the next chunk and inserting over a range keeps adjacent lyrics in place', () => {
  const id = state().add('karaoke', 1)!
  state().change(id, { karaoke: { main: [createLyricCue('Original lyrics', { start: 0, end: 4 })], second: [], style: karaokePresets.normal } })
  state().seek(3)
  state().split()
  const right = state().selectedClipId
  state().addCaption()
  assert.equal(state().selectedClipId, right)
  let chunks = state().clips.filter(clip => clip.kind === 'karaoke')
  assert.deepEqual(chunks.map(clip => [clip.start, clip.duration, clip.offset]), [[1, 2, 0], [3, 2, 2]])
  state().selectRange({ anchor: 2, focus: 4 })
  state().addCaption()
  chunks = state().clips.filter(clip => clip.kind === 'karaoke').sort((a, b) => a.start - b.start)
  assert.deepEqual(chunks.map(clip => [clip.start, clip.duration, clip.offset]), [[1, 1, 0], [2, 2, 0], [4, 1, 3]])
  assert.equal(state().selectedClipId, chunks[1].id)
  assert.equal(chunks[1].karaoke, undefined)
  assert.equal(new Set(chunks.map(clip => clip.id)).size, 3)
})

beforeEach(() => useEditor.setState(initial, true))

test('project save and reopen retain imported media, captions, tracking edits and markers', async () => {
  const media = new Blob([new Uint8Array([1, 23, 169, 255])], { type: 'video/mp4' })
  const url = URL.createObjectURL(media)
  const asset: Asset = { id: 'local-recording', name: 'Recording.mp4', kind: 'video', duration: 3, url, file: media,
    frameSize: { width: 640, height: 360 } }
  state().addAssets([asset])
  const video = state().add(asset, 3)!
  state().change(video, { offset: .5, duration: 2 })
  const caption = state().add('karaoke', 3)!
  state().change(caption, { duration: 2, karaoke: {
    main: parseLyrics('Salut tout le monde', { start: 0, end: 2 }), second: [], style: karaokePresets.custom,
  } })
  state().seek(4)
  state().addMarker()
  state().toggleTrack('overlay', 'muted')
  state().titleTo('My tutorial')
  const snapshot = projectSnapshot(state())
  const file = await encodeProject(snapshot)
  const restored = await decodeProject(file)
  try {
    assert.equal(restored.title, snapshot.title)
    assert.deepEqual(restored.clips, JSON.parse(JSON.stringify(snapshot.clips)))
    assert.deepEqual(restored.tracks, snapshot.tracks)
    assert.deepEqual(restored.markers, snapshot.markers)
    const local = restored.assets.find(item => item.id === asset.id)!
    assert.notEqual(local.url, url)
    assert.deepEqual(new Uint8Array(await local.file!.arrayBuffer()), new Uint8Array(await media.arrayBuffer()))
    await assert.rejects(decodeProject(file.slice(0, -1)), /invalid or incomplete/)
  } finally {
    URL.revokeObjectURL(url)
    for (const item of restored.assets) if (item.url) URL.revokeObjectURL(item.url)
  }
})

test('playhead and selection preserve the saved revision while an edit marks it dirty', () => {
  const snapshot = projectSnapshot(state())
  state().seek(5)
  state().selectRange({ anchor: 5, focus: 7 })
  assert.equal(sameProject(snapshot, state()), true)
  state().checkpoint()
  state().titleTo('Changed')
  assert.equal(sameProject(snapshot, state()), false)
  state().undo()
  assert.equal(sameProject(snapshot, state()), true)
})

test('range playback starts at the selection, resumes inside it, and stops at its end', () => {
  state().selectRange({ anchor: 6, focus: 9, track: 'main' })
  state().play(true)
  assert.equal(state().currentTime, 6)
  state().advancePlayback(7)
  state().play(false)
  state().play(true)
  assert.equal(state().currentTime, 7)
  state().advancePlayback(10)
  assert.equal(state().currentTime, 9)
  assert.equal(state().playing, false)
  assert.deepEqual(state().range, { anchor: 6, focus: 9, track: 'main' })
  state().play(true)
  assert.equal(state().currentTime, 6)
})

test('reverse drags and empty ranges play from the expected position', () => {
  state().selectRange({ anchor: 6, focus: 2 })
  state().play(true)
  assert.equal(state().currentTime, 2)
  state().advancePlayback(8)
  assert.equal(state().currentTime, 6)
  state().selectRange({ anchor: 8, focus: 8 })
  state().play(true)
  state().advancePlayback(10)
  assert.equal(state().currentTime, 10)
  assert.equal(state().playing, true)
})

test('split all ignores a clip selection and respects locked tracks', () => {
  state().toggleTrack('overlay', 'locked')
  state().seek(5)
  state().split(true)
  assert.deepEqual(main().map(clip => clip.start), [0, 5])
  assert.equal(state().clips.filter(clip => clip.kind === 'text').length, 2)
  assert.equal(state().clips.filter(clip => clip.track === 'overlay').length, 1)
})

test('magnetic tracks pack gaps, insert at a boundary, reorder, trim and close gaps on delete', () => {
  const original = main()[0]
  const asset = { id: 'short', name: 'Short', kind: 'video', duration: 2 } as const
  state().change(original.id, { start: 3, duration: 5 })
  const second = state().add(asset, 12)!
  state().toggleTrack('main', 'magnetic')
  const positions = () => main().sort((a, b) => a.start - b.start).map(clip => [clip.id, clip.start])
  assert.deepEqual(positions(), [[original.id, 0], [second, 5]])
  const third = state().add(asset, 4)!
  assert.deepEqual(positions(), [[original.id, 0], [third, 5], [second, 7]])
  state().change(second, { start: 1 }, false)
  state().settleClip(second, 'main')
  assert.deepEqual(positions(), [[second, 0], [original.id, 2], [third, 7]])
  state().change(original.id, { duration: 3 })
  assert.deepEqual(positions(), [[second, 0], [original.id, 2], [third, 5]])
  state().select(second)
  state().remove()
  assert.deepEqual(positions(), [[original.id, 0], [third, 3]])
  state().undo()
  assert.deepEqual(positions(), [[second, 0], [original.id, 2], [third, 5]])
  state().toggleTrack('main', 'magnetic')
  state().change(third, { start: 20 })
  assert.deepEqual(positions(), [[second, 0], [original.id, 2], [third, 20]])
})

test('pasting onto a magnetic track inserts whole clips without splitting the destination', () => {
  const original = main()[0]
  state().toggleTrack('main', 'magnetic')
  state().selectRange({ anchor: 2, focus: 3, track: 'main' })
  state().copy()
  state().select(null)
  state().seek(8)
  assert.equal(state().paste(), true)
  assert.equal(main().length, 2)
  assert.equal(main().find(clip => clip.id === original.id)?.start, 1)
  assert.equal(state().currentTime, 0)
})

test('shifted punctuation and modifier shortcuts resolve to distinct actions', () => {
  const press = (key: string, code: string, modifiers = {}) => shortcutFor({
    key, code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...modifiers,
  })
  assert.equal(press(' ', 'Space'), 'play')
  assert.equal(press('S', 'KeyS', { ctrlKey: true, shiftKey: true }), 'splitAll')
  assert.equal(press('S', 'KeyS', { shiftKey: true }), 'silence')
  assert.equal(press('>', 'Period', { shiftKey: true }), 'extendRight')
  assert.equal(press('*', 'Digit8', { ctrlKey: true, shiftKey: true }), 'zoomRange')
  assert.equal(press('}', 'BracketRight', { ctrlKey: true, shiftKey: true }), 'extendMarkerForward')
  assert.equal(press('Delete', 'Delete', { ctrlKey: true }), 'ripple')
  assert.equal(press('M', 'Semicolon', { shiftKey: true }), 'addMarker')
  assert.equal(press('m', 'Semicolon', { ctrlKey: true }), 'markers')
  assert.equal(press('M', 'Semicolon', { ctrlKey: true, shiftKey: true }), undefined)
  assert.equal(press(';', 'Comma'), undefined)
  assert.equal(press('.', 'Comma', { shiftKey: true }), 'frameForward')
  assert.equal(press(',', 'KeyM'), 'frameBack')
  assert.equal(press(':', 'Semicolon', { ctrlKey: true, shiftKey: true }), 'snap')
})

test('cutting a range preserves both fragments and their source offsets', () => {
  const clip = main()[0]
  state().change(clip.id, { speed: 2, fadeIn: 8, endTransform: { x: 82, y: 60, scale: 200 } })
  state().selectRange({ anchor: 9, focus: 4, track: 'main' })
  assert.equal(state().copy(true), true)
  assert.deepEqual(timing(), [[0, 4, 0], [4, 23, 18]])
  const copied = state().clipboard!.clips[0]
  assert.deepEqual([copied.duration, copied.offset, copied.x, copied.fadeWindow?.offset], [5, 8, 54, 4])
  state().paste()
  assert.deepEqual(timing().map(([start, length]) => [start, length]), [[0, 4], [9, 23], [4, 5]])
  state().undo()
  state().undo()
  assert.deepEqual(timing(), [[0, 32, 0]])
  assert.deepEqual(state().range, { anchor: 9, focus: 4, track: 'main' })
})

test('ripple delete closes the gap without shifting locked tracks', () => {
  state().toggleTrack('overlay', 'locked')
  const overlay = state().clips.find(clip => clip.track === 'overlay')
  state().selectRange({ anchor: 4, focus: 11 })
  state().remove(true)
  assert.deepEqual(timing(), [[0, 4, 0], [4, 21, 11]])
  assert.equal(state().clips.find(clip => clip.track === 'overlay'), overlay)
})

test('a selection drawn on one clip leaves overlapping clips intact', () => {
  const chosen = main()[0]
  const demo = state().assets.find(asset => asset.id === chosen.assetId)!
  const overlapping = state().add(demo, 2, 'main')
  state().selectRange({ anchor: 4, focus: 9, track: 'main', clipId: chosen.id })
  assert.equal(state().copy(true), true)
  assert.equal(state().clipboard?.clips.length, 1)
  assert.deepEqual(timing(), [[0, 4, 0], [4, 23, 9], [2, 32, 0]])
  assert.equal(main().at(-1)?.id, overlapping)
})

test('copy keeps a ruler range and cut closes the same interval across unlocked tracks', () => {
  const locked = state().clips.find(clip => clip.track === 'overlay')
  state().toggleTrack('overlay', 'locked')
  state().selectRange({ anchor: 8, focus: 3 })
  const original = state().clips
  assert.equal(state().copy(), true)
  assert.equal(state().clips, original)
  assert.equal(state().clipboard?.duration, 5)
  assert.deepEqual(state().clipboard?.clips.map(clip => [clip.track, clip.start, clip.duration]), [
    ['main', 0, 5], ['annotations', 0, 5],
  ])
  assert.equal(state().copy(true), true)
  assert.deepEqual(timing(), [[0, 3, 0], [3, 24, 8]])
  assert.equal(state().clips.find(clip => clip.track === 'overlay'), locked)
  assert.equal(state().clips.find(clip => clip.kind === 'highlight')?.start, 12)
  assert.equal(state().currentTime, 3)
})

test('the right-hand split piece keeps its source coordinates when moved', () => {
  state().seek(5)
  state().split()
  const rightId = state().selectedClipId!
  assert.deepEqual(timing(), [[0, 5, 0], [5, 27, 5]])
  state().change(rightId, { start: 13 })
  state().seek(13)
  assert.deepEqual(timing(), [[0, 5, 0], [13, 27, 5]])
  state().undo()
  assert.equal(state().currentTime, 5)
  assert.equal(state().selectedClipId, rightId)
  state().redo()
  assert.equal(state().currentTime, 13)
})

test('select all on a track and cut closes the track while leaving other tracks in place', () => {
  const otherTracks = state().clips.filter(clip => clip.track !== 'main')
  state().selectAll('main')
  assert.deepEqual(state().selectedClipIds, [main()[0].id])
  assert.equal(state().copy(true), true)
  assert.deepEqual(state().clips, otherTracks)
})

test('silencing a range preserves timeline timing and source positions through a split', () => {
  const clip = main()[0]
  state().change(clip.id, { speed: 2, offset: 3 })
  state().selectRange({ anchor: 3, focus: 5, track: 'main', clipId: clip.id })
  assert.equal(state().silence(), true)
  assert.equal(state().silence(), false)
  assert.deepEqual(timing(), [[0, 32, 3]])
  assert.deepEqual(main()[0].silentRanges, [{ start: 9, end: 13 }])
  state().seek(4)
  state().split()
  assert.deepEqual(main().map(clip => clip.offset), [3, 11])
  assert.deepEqual(main()[1].silentRanges, [{ start: 9, end: 13 }])
  state().undo()
  state().undo()
  assert.equal(main()[0].silentRanges, undefined)
})

test('split can use a range boundary and exits selection mode for dragging', () => {
  state().toggleRangeMode()
  state().selectRange({ anchor: 1, focus: 3, track: 'main' })
  state().split()
  assert.deepEqual(timing(), [[0, 3, 0], [3, 29, 3]])
  assert.equal(state().rangeMode, false)
  assert.equal(state().range, null)
  assert.equal(state().clips.filter(clip => clip.track === 'annotations').length, 2)
})

test('double-click edit navigation makes an offscreen annotation active', () => {
  const annotation = state().clips.find(clip => clip.kind === 'text')!
  state().seek(durationOf(state().clips))
  state().editAnnotation(annotation.id)
  assert.equal(state().selectedClipId, annotation.id)
  assert.equal(state().currentTime, annotation.start + annotation.duration / 2)
  state().toggleTrack('annotations', 'locked')
  const version = state().annotationEditVersion
  state().editAnnotation(annotation.id)
  assert.equal(state().annotationEditVersion, version)
})

test('the earliest main video controls canvas dimensions regardless of insertion order', () => {
  const portrait: Asset = { id: 'portrait', name: 'Portrait', kind: 'video', duration: 2, frameSize: { width: 360, height: 640 } }
  const landscape: Asset = { id: 'landscape', name: 'Landscape', kind: 'video', duration: 2, frameSize: { width: 640, height: 360 } }
  state().addAssets([portrait, landscape])
  state().add(landscape, 0, 'overlay')
  assert.deepEqual(canvasSizeOf(state()), { width: 1280, height: 720 })
  const later = state().add(landscape, 2, 'main')
  const earlier = state().add(portrait, 0, 'main')
  assert.deepEqual(canvasSizeOf(state()), portrait.frameSize)
  assert.deepEqual(clipsOnTrack(state().clips, 'main').slice(-2).map(clip => clip.id), [earlier, later])
  state().undo()
  state().undo()
  assert.deepEqual(canvasSizeOf(state()), { width: 1280, height: 720 })
})

test('new standalone audio goes to Audio and older projects gain the track when reopened', async () => {
  const music: Asset = { id: 'music', name: 'Music', kind: 'audio', duration: 4 }
  state().addAssets([music])
  const id = state().add(music, 1)
  assert.equal(state().clips.find(clip => clip.id === id)?.track, 'audio')
  const saved = projectSnapshot(state())
  assert.deepEqual((await decodeProject(await encodeProject(saved))).tracks, saved.tracks)
  const legacy = { ...saved, tracks: saved.tracks.filter(track => track.id !== 'audio'),
    clips: saved.clips.map(clip => clip.id === id ? { ...clip, track: 'main' as const } : clip) }
  const reopened = await decodeProject(await encodeProject(legacy))
  assert.equal(reopened.tracks.at(-1)?.id, 'audio')
  assert.equal(reopened.clips.find(clip => clip.id === id)?.track, 'main')
})
