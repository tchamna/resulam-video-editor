import { type ButtonHTMLAttributes, type PointerEvent as ReactPointer } from 'react'
import { AudioLines, Captions, Film, Image as ImageIcon, MoveUpRight, Scan, SquareDashed, Type } from 'lucide-react'
import { type Kind } from './store'

export const icons: Record<Kind, typeof Film> = {
  video: Film, audio: AudioLines, image: ImageIcon, demo: Film,
  text: Type, arrow: MoveUpRight, highlight: SquareDashed, blur: Scan, karaoke: Captions,
}
export function ToolButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" className={`tool-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>
}

export function pointerGesture(event: ReactPointer<Element>, update: (event: PointerEvent) => void, end?: (event: PointerEvent) => void) {
  const target = event.currentTarget
  const id = event.pointerId
  const move = (next: PointerEvent) => { if (next.pointerId === id) update(next) }
  const finish = (next: PointerEvent) => {
    if (next.pointerId !== id) return
    target.removeEventListener('pointermove', move as EventListener)
    target.removeEventListener('pointerup', finish as EventListener)
    target.removeEventListener('pointercancel', finish as EventListener)
    target.removeEventListener('lostpointercapture', finish as EventListener)
    end?.(next)
  }
  target.setPointerCapture(id)
  target.addEventListener('pointermove', move as EventListener)
  target.addEventListener('pointerup', finish as EventListener)
  target.addEventListener('pointercancel', finish as EventListener)
  target.addEventListener('lostpointercapture', finish as EventListener)
}

