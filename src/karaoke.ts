export type LyricWord = { start: number; end: number; text: string }
export type LyricLine = { start: number; end: number; words: LyricWord[] }
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

function parseSrt(text: string) {
  const lines = text.split(/\n\s*\n/).map((block, index) => {
    const parts = block.split('\n').map(line => line.trim())
    if (/^\d+$/.test(parts[0])) parts.shift()
    const match = srtTiming.exec(parts.shift() ?? '')
    if (!match) throw new Error(`SRT cue ${index + 1} needs a valid start and end timestamp.`)
    const interval = { start: toSeconds(match[1]), end: toSeconds(match[2]) }
    const lyrics = parts.join(' ').replace(/<\/?(?:b|i|u)>/gi, '').trim()
    if (!(interval.end > interval.start) || !lyrics) throw new Error(`SRT cue ${index + 1} needs text and a positive duration.`)
    return lyricLine(lyrics.split(/\s+/u), interval)
  })
  return lines.sort((a, b) => a.start - b.start)
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

export function parseLyrics(source: string, interval: Interval, reference: LyricLine[] = []) {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  if (!text) return []
  if (/^\s*\d{2,}:[^\n]*-->/m.test(text)) return parseSrt(text)
  if (timingHeader.test(text.split('\n')[0]) || /^\d+\t[^\n]+\t[^\n]+\t/m.test(text)) return parseTsv(text)
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean).map(line => line.split(/\s+/u))
  if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end) || interval.start < 0 || interval.end <= interval.start) {
    throw new Error('Set a last lyric time after the first lyric time for plain text.')
  }
  const times = reference.length === lines.length ? reference : divide(interval, lines.map(words => words.reduce((sum, word) => sum + weight(word), 0)))
  return lines.map((words, index) => lyricLine(words, { start: times[index].start, end: times[index].end }))
}

export function formatLyrics(lines: LyricLine[]) {
  if (!lines.length) return ''
  return ['Line\tStart(s)\tEnd(s)\tWord', ...lines.flatMap((line, index) => line.words.map(word =>
    `${index + 1}\t${word.start}\t${word.end}\t${word.text}`,
  ))].join('\n')
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
