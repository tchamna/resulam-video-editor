export const shortcuts = [
  ['play', 'Play or pause the timeline or highlighted range', 'Space', 'space'],
  ['restart', 'Play from the beginning of the range or timeline', 'Ctrl+Shift+Space', 'mod+shift+space'],
  ['return', 'Stop and return to playback start', 'Ctrl+Alt+M', 'mod+alt+m', 'mod+alt+space'],
  ['frameBack', 'Step back one frame', 'Comma', ',', 'arrowleft', 'mod+arrowleft'],
  ['frameForward', 'Step forward one frame', 'Period', '.', 'arrowright', 'mod+arrowright'],
  ['clipBack', 'Jump to previous clip boundary', 'Ctrl+Alt+Comma', 'mod+alt+,', 'mod+alt+arrowleft'],
  ['clipForward', 'Jump to next clip boundary', 'Ctrl+Alt+Period', 'mod+alt+.', 'mod+alt+arrowright'],
  ['start', 'Go to beginning of timeline', 'Ctrl+Home', 'mod+home', 'home'],
  ['end', 'Go to end of timeline', 'Ctrl+End', 'mod+end', 'end'],
  ['extendLeft', 'Extend range left by one frame', 'Shift+Comma', 'shift+,', 'mod+shift+arrowleft'],
  ['extendRight', 'Extend range right by one frame', 'Shift+Period', 'shift+.', 'mod+shift+arrowright'],
  ['extendSecondLeft', 'Extend range left by one second', 'Shift+Left', 'shift+arrowleft'],
  ['extendSecondRight', 'Extend range right by one second', 'Shift+Right', 'shift+arrowright'],
  ['extendStart', 'Select to beginning of timeline', 'Ctrl+Shift+Home', 'mod+shift+home'],
  ['extendEnd', 'Select to end of timeline', 'Ctrl+Shift+End', 'mod+shift+end'],
  ['extendClipBack', 'Select to previous clip boundary', 'Ctrl+Alt+Shift+Left', 'mod+alt+shift+arrowleft', 'mod+alt+shift+,'],
  ['extendClipForward', 'Select to next clip boundary', 'Ctrl+Alt+Shift+Right', 'mod+alt+shift+arrowright', 'mod+alt+shift+.'],
  ['before', 'Select preceding media', 'Alt+Left', 'alt+arrowleft'],
  ['after', 'Select succeeding media', 'Alt+Right', 'alt+arrowright'],
  ['selectAll', 'Select all clips', 'Ctrl+A', 'mod+a'],
  ['clear', 'Clear selection', 'Ctrl+D or Esc', 'mod+d', 'escape'],
  ['cut', 'Cut', 'Ctrl+X', 'mod+x'],
  ['copy', 'Copy', 'Ctrl+C', 'mod+c'],
  ['paste', 'Paste', 'Ctrl+V', 'mod+v'],
  ['duplicate', 'Duplicate', 'Ctrl+Shift+D', 'mod+shift+d'],
  ['delete', 'Delete and leave a gap', 'Delete or Backspace', 'delete', 'backspace'],
  ['ripple', 'Delete and close the gap', 'Ctrl+Delete', 'mod+delete', 'mod+backspace', 'shift+delete', 'shift+backspace'],
  ['split', 'Split selected media', 'S', 's'],
  ['splitAll', 'Split all unlocked tracks', 'Ctrl+Shift+S', 'mod+shift+s'],
  ['silence', 'Silence audio in the selection', 'Shift+S', 'shift+s'],
  ['undo', 'Undo', 'Ctrl+Z', 'mod+z'],
  ['redo', 'Redo', 'Ctrl+Y or Ctrl+Shift+Z', 'mod+y', 'mod+shift+z'],
  ['zoomIn', 'Zoom in on the timeline', 'Ctrl++', 'mod+=', 'mod+shift+='],
  ['zoomOut', 'Zoom out on the timeline', 'Ctrl+−', 'mod+-', 'mod+shift+-'],
  ['zoomFit', 'Fit the full timeline', 'Ctrl+Shift+7', 'mod+shift+7', 'mod+f9'],
  ['zoomRange', 'Fit the highlighted range', 'Ctrl+Shift+8', 'mod+shift+8', 'mod+f10'],
  ['zoomMax', 'Maximum timeline zoom', 'Ctrl+Shift+9', 'mod+shift+9', 'mod+f11'],
  ['heightUp', 'Increase track heights', 'Alt+=', 'alt+='],
  ['heightDown', 'Decrease track heights', 'Alt+−', 'alt+-'],
  ['snap', 'Toggle timeline snapping', 'Ctrl+Shift+;', 'mod+shift+;'],
  ['addMarker', 'Add a timeline marker', 'Shift+M', 'shift+m'],
  ['markers', 'Show or hide markers', 'Ctrl+M', 'mod+m'],
  ['markerBack', 'Jump to previous marker', 'Ctrl+[', 'mod+['],
  ['markerForward', 'Jump to next marker', 'Ctrl+]', 'mod+]'],
  ['extendMarkerBack', 'Select to previous marker', 'Ctrl+Shift+[', 'mod+shift+['],
  ['extendMarkerForward', 'Select to next marker', 'Ctrl+Shift+]', 'mod+shift+]'],
  ['media', 'Open Media', 'B', 'b'],
  ['annotations', 'Open Annotations', 'N', 'n'],
  ['effects', 'Open Effects', 'L or T', 'l', 't'],
  ['captions', 'Open Captions', 'C', 'c'],
  ['addText', 'Add a text annotation', 'Shift+N', 'shift+n'],
  ['addCaption', 'Add karaoke captions', 'Shift+C', 'shift+c'],
  ['range', 'Toggle range selection mode', 'R', 'r'],
  ['import', 'Import media', 'Ctrl+I', 'mod+i'],
  ['record', 'Open screen recorder', 'Ctrl+R', 'mod+r'],
  ['pauseRecord', 'Pause or resume screen recording', 'F9', 'f9'],
  ['stopRecord', 'Stop screen recording', 'F10', 'f10'],
  ['new', 'New project', 'Ctrl+N', 'mod+n'],
  ['frame', 'Export a PNG at the playhead', 'Ctrl+Shift+F', 'mod+shift+f'],
  ['export', 'Export MP4', 'Ctrl+P', 'mod+p'],
  ['help', 'Show this shortcut list', 'F1', 'f1'],
] as const

export type Shortcut = typeof shortcuts[number][0]
const bindings = new Map<string, Shortcut>()
for (const [action, , , ...keys] of shortcuts) {
  for (const key of keys) bindings.set(key, action)
}

const physicalKeys: Record<string, string> = {
  Comma: ',', Period: '.', Equal: '=', Minus: '-', NumpadAdd: '=', NumpadSubtract: '-',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Digit7: '7', Digit8: '8', Digit9: '9',
}

export function shortcutFor(event: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>) {
  const key = physicalKeys[event.code] ?? (event.key === ' ' ? 'space' : event.key.toLowerCase())
  return bindings.get(`${event.ctrlKey || event.metaKey ? 'mod+' : ''}${event.altKey ? 'alt+' : ''}${event.shiftKey ? 'shift+' : ''}${key}`)
}
