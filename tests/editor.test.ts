import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { canvasSizeOf, durationOf, useEditor, type Asset } from '../src/store.ts'

const state = useEditor.getState
const initial = state()
const main = () => state().clips.filter(clip => clip.track === 'main')
const timing = () => main().map(clip => [clip.start, clip.duration, clip.offset])

beforeEach(() => useEditor.setState(initial, true))

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

test('the first main video controls canvas dimensions, including after undo', () => {
  const portrait: Asset = { id: 'portrait', name: 'Portrait', kind: 'video', duration: 2, frameSize: { width: 360, height: 640 } }
  const landscape: Asset = { id: 'landscape', name: 'Landscape', kind: 'video', duration: 2, frameSize: { width: 640, height: 360 } }
  state().addAssets([portrait, landscape])
  state().add(landscape, 0, 'overlay')
  assert.deepEqual(canvasSizeOf(state()), { width: 1280, height: 720 })
  state().add(portrait, 0, 'main')
  state().add(landscape, 2, 'main')
  assert.deepEqual(canvasSizeOf(state()), portrait.frameSize)
  state().undo()
  state().undo()
  assert.deepEqual(canvasSizeOf(state()), { width: 1280, height: 720 })
})
