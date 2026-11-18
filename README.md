# Resulam Video Editor - ReViE

Resulam Video Editor - ReViE is a browser editor for screen recordings and tutorial videos. It opens with a short, editable sample project. Use **Project options → New project** to start with an empty timeline.

## Run the project

Use Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Open the local address printed by Vite. `npm run build` type-checks the project and creates a production build in `dist/`.

Run `npm test` to check timeline cuts, ripple delete, split and move, annotation editing, and canvas sizing.

## Portable Windows app

Extract the entire Windows x64 release ZIP, then open `ReViE.exe` inside the extracted `ReViE` folder. The editor bundles its runtime and works offline. Keep the files alongside the EXE when moving or sharing it.

To build the portable folder on Windows x64, run `npm ci`, `npm run build`, `npm --prefix desktop ci`, and `npm --prefix desktop run package:windows`. The last command prints the output folder. Package the entire `ReViE` folder for distribution.

## Edit a tutorial

For karaoke captions, open the **Captions** tab and add a clip at the playhead. Paste or import UTF-8 TXT, SRT, or the Karaoke Captions word timing TSV. For TXT, set the first and last lyric times to estimate timings by word length. SRT keeps cue times and estimates word timing within each cue. TSV preserves exact word timings. Add an optional second language and choose the **Normal** or **Custom** layout. Apply lyrics to render them in the preview and in MP4 exports. After applying, edit the timing TSV in the lyrics fields to adjust individual words.

- Import MP4, WebM, MP3, or PNG. Drag assets from the media bin onto a track, or click an asset to insert it at the playhead.
- Drop a video onto the preview or main video track to place it and import it in one step. The first main video sets the canvas dimensions. Hover over a video in the media bin to preview it without sound.
- Drag the bottom grip or **Alt+drag** a clip to move it. Drag its left or right edge to trim it. Click the time ruler to seek, or drag the playhead to scrub.
- Drag the time ruler to select across unlocked tracks. Drag the body of a clip to select within that clip. Use **Select range** (**R**) or **Shift+drag** on a clip or lane to select time across clips on one track. Drag either blue handle to adjust the time range.
- Use **Ctrl/Cmd+X**, **Ctrl/Cmd+C**, and **Ctrl/Cmd+V** to cut, copy, and paste clips or portions inside the editor. Paste inserts at the playhead or at the start of the selected range on the copied tracks. Cut closes the gap automatically. **Delete** leaves a gap on ordinary tracks, and **Ctrl+Delete** closes it. Open **Shortcuts** below the timeline for the full list.
- Add callouts in the Annotations tab. Double-click an annotation on the timeline or preview to edit it in Properties. Select an overlay in the preview and drag its corners to resize or its top handle to rotate.
- Apply fades, pan and zoom, or a picture-in-picture preset in Effects. Edit the selected clip in Properties.
- Click a track name to select all its clips. Use the eye to exclude the track from playback and export, the speaker to mute its audio, and the lock to protect it from edits. The track magnet closes gaps and lets you insert or rearrange clips in sequence. The toolbar **Snap** button aligns clips and selections to nearby edges.
- Drag a track's top divider up to expand it or down to shrink it. Use the timeline zoom slider or its Fit button to see the project or the selected range.
- Select a video or image and click **Crop** above the preview. Drag an edge or corner, then click **Done cropping**. Use **Crop edges** in Properties for exact values or to reset the crop.
- Select a time range and click **Silence** to mute audio for that interval on the selected clip or unlocked tracks. Use **Clear silenced ranges** in Properties to restore a clip's audio.
- Press **Space** to play or pause. If a time range is highlighted, playback stays within it and stops at its end. Use **,** or **.** to step by a frame, **S** to split selected media, or **Ctrl+Shift+S** to split all unlocked tracks at the playhead.

## Recording and export

Open the app in a supported desktop browser on localhost or HTTPS for screen sharing. The browser prompts you to choose a screen, window, or tab. Capture audio when the browser offers it for the chosen source.

MP4 export uses the browser’s native encoder and follows the canvas dimensions. Demo projects use 1280 × 720. Keep the tab visible during the real-time export. Use a browser with native MP4 encoding support, such as a current desktop Chrome or Edge.

Choose **Export selection** below the timeline to export the selected time range with all visible layers. The header **Export MP4** button exports the full project. In the desktop app, Chrome, or Edge, choose the MP4 filename and folder in the Save dialog before rendering begins.

Save editable projects with **Ctrl+S**. A `.revie` file includes your clips, media, captions, tracks, and markers. Open it with **Ctrl+O**. ReViE prompts for unsaved changes before replacing a project or closing the desktop app. The browser shows its own warning when a tab with unsaved changes is closed or refreshed.

