export type LyricWord = { start: number; end: number; text: string }
export type LyricLine = { start: number; end: number; words: LyricWord[]; autoEnd?: boolean }
export type KaraokeStyle = {
  mainY: number; secondY: number; size: number; contrast: 'outline' | 'band' | 'none'
  mainColor: string; mainHighlight: string; secondColor: string; secondHighlight: string
}
export type Karaoke = { main: LyricLine[]; second: LyricLine[]; style: KaraokeStyle }

export const karaokePresets = {
  normal: {
    mainY: 86, secondY: 14, size: 7.6, contrast: 'band',
    mainColor: '#ffffff', mainHighlight: '#ffd400', secondColor: '#ffffff', secondHighlight: '#ffd400',
  },
  custom: {
    mainY: 90, secondY: 80, size: 5.4, contrast: 'outline',
    mainColor: '#ffffff', mainHighlight: '#ff3999', secondColor: '#ffffff', secondHighlight: '#ffae00',
  },
} satisfies Record<string, KaraokeStyle>

type Interval = { start: number; end: number }
const timestamp = '(\\d{2,}:\\d{2}:\\d{2}[,.]\\d{1,3})'
const srtTiming = new RegExp(`^${timestamp}\\s*-->\\s*${timestamp}(?:\\s.*)?$`)
const timingHeader = /^Line\tStart\(s\)\tEnd\(s\)\tWord$/i
const weight = (word: string) =>
  Math.max(1, word.normalize('NFD').replace(/\p{M}/gu, '').match(/[aeiouyɑəɛɨɔʉɯ]+/giu)?.length ?? 0)

function toSeconds(value: string) {
  const [hours, minutes, seconds] = value.replace(',', '.').split(':').map(Number)
  return hours * 3600 + minutes * 60 + seconds
}

function divide({ start, end }: Interval, weights: number[]) {
  const total = weights.reduce((sum, value) => sum + value, 0)
  const minimum = Math.min(.1, (end - start) / (2 * weights.length))
  const span = end - start - minimum * weights.length
  let used = 0
  return weights.map((value, index) => {
    const left = start + index * minimum + span * used / total
    used += value
    return { start: left, end: index === weights.length - 1 ? end : start + (index + 1) * minimum + span * used / total }
  })
}

function lyricLine(words: string[], interval: Interval): LyricLine {
  return { ...interval, words: divide(interval, words.map(weight)).map((time, index) => ({ ...time, text: words[index] })) }
}

export function createLyricCue(text: string, interval: Interval, previous?: LyricLine): LyricLine {
  const words = text.trim().split(/\s+/u)
  if (!words[0]) throw new Error('Enter caption text.')
  if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end) || interval.start < 0 || interval.end <= interval.start) {
    throw new Error('Choose an end time after the start time.')
  }
  if (previous && words.join(' ') === previous.words.map(word => word.text).join(' ')) {
    const scale = (interval.end - interval.start) / (previous.end - previous.start)
    const move = (time: number) => interval.start + (time - previous.start) * scale
    return { ...interval, words: previous.words.map(word => ({ ...word, start: move(word.start), end: move(word.end) })) }
  }
  return lyricLine(words, interval)
}

export function fitLyricEnds(captions: Karaoke, end: number): Karaoke {
  const fit = (lines: LyricLine[]) => lines.map((line, index) => {
    const next = lines[index + 1]
    const limit = Math.min(end, next?.start ?? Infinity)
    if (!line.autoEnd || limit <= line.start || Math.abs(line.end - limit) < .000001) return line
    return { ...createLyricCue(line.words.map(word => word.text).join(' '), { start: line.start, end: limit }, line), autoEnd: true }
  })
  return { ...captions, main: fit(captions.main), second: fit(captions.second) }
}

export function splitLyrics(captions: Karaoke, at: number): [Karaoke, Karaoke] {
  const before = (lines: LyricLine[]) => lyricsInWindow(lines, 0, at)
  const after = (lines: LyricLine[]) => lyricsInWindow(lines, at, Infinity, 0)
  return [
    { ...captions, main: before(captions.main), second: before(captions.second) },
    { ...captions, main: after(captions.main), second: after(captions.second) },
  ]
}

function parseSrt(text: string) {
  const lines = text.split(/\n\s*\n/).flatMap((block, index) => {
    const parts = block.split('\n').map(line => line.trim())
    if (/^\d+$/.test(parts[0])) parts.shift()
    const match = srtTiming.exec(parts.shift() ?? '')
    if (!match) throw new Error(`SRT cue ${index + 1} needs a valid start and end timestamp.`)
    const interval = { start: toSeconds(match[1]), end: toSeconds(match[2]) }
    const lyrics = parts.join(' ').replace(/<\/?(?:b|i|u)>/gi, '').trim()
    if (!(interval.end > interval.start)) throw new Error(`SRT cue ${index + 1} needs a positive duration.`)
    return lyrics ? [lyricLine(lyrics.split(/\s+/u), interval)] : []
  })
  return lines.sort((a, b) => a.start - b.start)
}

export type CaptionLanguage = 'main' | 'second'
type CaptionPlacement = { start: number; duration: number; offset: number; speed: number; karaoke?: Karaoke }

function srtTime(milliseconds: number) {
  const pad = (value: number, digits = 2) => String(value).padStart(digits, '0')
  return `${pad(Math.floor(milliseconds / 3600000))}:${pad(Math.floor(milliseconds / 60000) % 60)}:${pad(Math.floor(milliseconds / 1000) % 60)},${pad(milliseconds % 1000, 3)}`
}

export function exportSrt(clips: readonly CaptionPlacement[], language: CaptionLanguage) {
  const cues = clips.flatMap(clip => (clip.karaoke?.[language] ?? []).flatMap(line => {
    const start = Math.max(0, (line.start - clip.offset) / clip.speed)
    const end = Math.min(clip.duration, (line.end - clip.offset) / clip.speed)
    if (end <= start) return []
    return [{
      start: Math.round((clip.start + start) * 1000),
      end: Math.round((clip.start + end) * 1000),
      text: line.words.map(word => word.text).join(' '),
    }]
  })).filter(cue => cue.end > cue.start).sort((a, b) => a.start - b.start || a.end - b.end)
  return cues.map((cue, index) => `${index + 1}\r\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\r\n${cue.text}\r\n\r\n`).join('')
}

function parseTsv(text: string) {
  const groups = new Map<number, LyricWord[]>()
  const rows = text.split('\n')
  if (timingHeader.test(rows[0].trim())) rows.shift()
  rows.forEach((row, index) => {
    if (!row.trim()) return
    const [groupText, a, b, ...words] = row.split('\t')
    const group = Number(groupText)
    const start = Number(a)
    const end = Number(b)
    const lyrics = words.join('\t').trim()
    if (!Number.isSafeInteger(group) || group < 1 || !a?.trim() || !b?.trim() ||
        !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || !lyrics) {
      throw new Error(`Timing row ${index + 1} needs a line number, start, end, and word.`)
    }
    const existing = groups.get(group) ?? []
    existing.push({ start, end, text: lyrics })
    groups.set(group, existing)
  })
  return [...groups.values()].map(words => {
    words.sort((a, b) => a.start - b.start)
    if (words.some((word, index) => index > 0 && word.start < words[index - 1].end - .000001)) {
      throw new Error('Word timings overlap within a lyric line.')
    }
    return { words, start: words[0].start, end: words.at(-1)!.end }
  }).sort((a, b) => a.start - b.start)
}

export function parseLyrics(source: string, interval: Interval, reference: LyricLine[] = [], autoEnd = false) {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  if (!text) return []
  if (/^\s*\d{2,}:[^\n]*-->/m.test(text)) return parseSrt(text)
  if (timingHeader.test(text.split('\n')[0]) || /^\d+\t[^\n]+\t[^\n]+\t/m.test(text)) return parseTsv(text)
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean).map(line => line.split(/\s+/u))
  if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end) || interval.start < 0 || interval.end <= interval.start) {
    throw new Error('Set a last lyric time after the first lyric time for plain text.')
  }
  const times = reference.length === lines.length ? reference : divide(interval, lines.map(words => words.reduce((sum, word) => sum + weight(word), 0)))
  return lines.map((words, index) => ({
    ...lyricLine(words, { start: times[index].start, end: times[index].end }),
    ...(autoEnd && index === lines.length - 1 && (times !== reference || reference[index].autoEnd) ? { autoEnd: true } : {}),
  }))
}

export function formatLyrics(lines: LyricLine[]) {
  if (!lines.length) return ''
  return ['Line\tStart(s)\tEnd(s)\tWord', ...lines.flatMap((line, index) => line.words.map(word =>
    `${index + 1}\t${word.start}\t${word.end}\t${word.text}`,
  ))].join('\n')
}

export function lyricsInWindow(lines: LyricLine[], offset: number, end = Infinity, origin = offset) {
  return lines.flatMap(line => {
    const words = line.words.filter(word => word.end > offset && word.start < end).map(word => ({
      ...word, start: Math.max(offset, word.start) - origin, end: Math.min(end, word.end) - origin,
    }))
    return words.length ? [{ ...line, start: words[0].start, end: words.at(-1)!.end, words }] : []
  })
}

export function lyricLineAt(lines: LyricLine[], time: number) {
  let left = 0
  let right = lines.length
  while (left < right) {
    const middle = (left + right) >>> 1
    if (lines[middle].start <= time) left = middle + 1
    else right = middle
  }
  for (let index = left - 1; index >= 0; index--) {
    if (time < lines[index].end) return lines[index]
  }
}

export function karaokeDuration(captions: Karaoke) {
  return [...captions.main, ...captions.second].reduce((end, line) => Math.max(end, line.end), 0)
}
