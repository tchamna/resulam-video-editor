import { type CaptionLanguage, type Karaoke, type KaraokeStyle, type LyricLine, type LyricWord, lyricLineAt } from './karaoke'

const fontFamily = '"ReViE Charis", "Segoe UI", sans-serif'
let fontReady: Promise<FontFace[]> | undefined

export function loadKaraokeFont() {
  return fontReady ??= document.fonts.load(`700 24px ${fontFamily}`).catch(() => [])
}

function layoutLine(ctx: CanvasRenderingContext2D, line: LyricLine, y: number, fontSize: number) {
  const { width, height } = ctx.canvas
  const maxWidth = width * .92
  ctx.font = `700 ${fontSize}px ${fontFamily}`
  const space = ctx.measureText(' ').width
  const rows: { words: { word: LyricWord; width: number }[]; width: number }[] = [{ words: [], width: 0 }]
  for (const word of line.words) {
    const width = Math.min(maxWidth, ctx.measureText(word.text).width)
    let row = rows.at(-1)!
    if (row.words.length && row.width + space + width > maxWidth) {
      row = { words: [], width: 0 }
      rows.push(row)
    }
    row.width += width + (row.words.length ? space : 0)
    row.words.push({ word, width })
  }
  const lineHeight = fontSize * 1.25
  const top = Math.max(lineHeight / 2, Math.min(height - lineHeight * (rows.length - .5),
    height * y / 100 - (rows.length - 1) * lineHeight / 2))
  const bandWidth = Math.min(width, Math.max(...rows.map(row => row.width)) + fontSize * .9)
  return { top, rows, bandWidth, lineHeight, maxWidth, space }
}

function drawLine(
  ctx: CanvasRenderingContext2D, line: LyricLine, time: number, style: KaraokeStyle,
  y: number, color: string, highlight: string, fontSize: number,
) {
  const { width } = ctx.canvas
  const { top, rows, bandWidth, lineHeight, maxWidth, space } = layoutLine(ctx, line, y, fontSize)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(2, fontSize * .11)
  if (style.contrast === 'band') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.62)'
    ctx.beginPath()
    ctx.roundRect((width - bandWidth) / 2, top - lineHeight * .55, bandWidth, lineHeight * (rows.length + .1), fontSize * .22)
    ctx.fill()
  }
  rows.forEach((row, index) => {
    const baseline = top + index * lineHeight
    let x = (width - row.width) / 2
    for (const { word, width } of row.words) {
      if (style.contrast !== 'none') {
        ctx.strokeStyle = '#141117'
        ctx.strokeText(word.text, x, baseline, maxWidth)
      }
      ctx.fillStyle = time >= word.start && time < word.end ? highlight : color
      ctx.fillText(word.text, x, baseline, maxWidth)
      x += width + space
    }
  })
}

function activeLines(captions: Karaoke, time: number, height: number) {
  const { style } = captions
  const main = lyricLineAt(captions.main, time)
  const second = lyricLineAt(captions.second, time)
  const fontSize = Math.max(10, height * style.size / 100)
  let secondY = style.secondY
  if (main && second) {
    const gap = style.size * 1.45
    if (Math.abs(style.mainY - secondY) < gap) {
      secondY = style.mainY + (secondY >= style.mainY ? gap : -gap)
      if (secondY > 94 || secondY < 6) secondY = style.mainY + (secondY > 94 ? -gap : gap)
    }
  }
  return { main, second, secondY, fontSize }
}

export function karaokeLanguageAt(ctx: CanvasRenderingContext2D, captions: Karaoke, time: number, x: number, y: number): CaptionLanguage | undefined {
  const { main, second, secondY, fontSize } = activeLines(captions, time, ctx.canvas.height)
  ctx.save()
  try {
    for (const [language, line, position] of [['main', main, captions.style.mainY], ['second', second, secondY]] as const) {
      if (!line) continue
      const { top, bandWidth, lineHeight, rows } = layoutLine(ctx, line, position, fontSize)
      if (Math.abs(x - ctx.canvas.width / 2) <= bandWidth / 2 &&
        y >= top - lineHeight * .55 && y <= top + lineHeight * (rows.length - .45)) return language
    }
  } finally { ctx.restore() }
}

export function drawKaraoke(ctx: CanvasRenderingContext2D, captions: Karaoke, time: number, opacity: number) {
  const { style } = captions
  const { main, second, secondY, fontSize } = activeLines(captions, time, ctx.canvas.height)
  if (!main && !second) return
  ctx.save()
  ctx.globalAlpha = opacity
  if (second) drawLine(ctx, second, time, style, secondY, style.secondColor, style.secondHighlight, fontSize)
  if (main) drawLine(ctx, main, time, style, style.mainY, style.mainColor, style.mainHighlight, fontSize)
  ctx.restore()
}
