# MIDI App Controller

## Overview
Node.js service that bridges an OpenDeck BB-S2 MIDI controller to the Monochrome Music web app (https://monochrome.tf/) running as a Brave Browser app on macOS. Controls playback and triggers downloads without stealing window focus.

## Architecture
- **index.js** — Main controller. Listens for MIDI note-on messages from the BB-S2 via `easymidi`, then executes JavaScript in the Monochrome browser tab via AppleScript (`osascript`) to click DOM buttons directly. No focus switching, no keystroke simulation.
- **LaunchAgent** (`~/Library/LaunchAgents/com.midi.monochrome-controller.plist`) — Auto-starts on login, auto-restarts on crash.
- **ctl.sh** — Start/stop/restart/status/logs helper.

## Button Mapping
| Note | Button | Action |
|------|--------|--------|
| 0 | 4 (leftmost) | Previous track |
| 1 | 3 | Play/Pause |
| 2 | 2 | Skip/Next |
| 3 | 1 (rightmost) | Download current track (MP3 320kbps) |

## How Download Works
1. Clicks `.now-playing-bar button[title='Download current track']` in Monochrome
2. A MutationObserver watches for the blob `<a download="...">` link Monochrome creates
3. Auto-clicks the link — browser saves to `~/Downloads`
4. A `fs.watch` file watcher detects the new `.mp3` in `~/Downloads` and moves it to `/Volumes/Crucial X9/Music_Downloads/`
5. No user interaction required

**Why the file watcher?** Brave blocks mixed-content fetch from HTTPS pages to HTTP localhost, so we can't POST blob data to a local server. Instead we let the browser download normally and relocate the file.

## Key Implementation Details
- Monochrome tab is found dynamically by URL (`starts with "https://monochrome.tf"`), so window reordering doesn't matter
- AppleScript is written to a temp file and executed via `osascript` to avoid shell escaping issues
- JavaScript is executed via Brave Browser's AppleScript `execute javascript` command (requires **View > Developer > Allow JavaScript from Apple Events** in Brave)
- Button presses are debounced at 300ms to prevent double-triggers
- Only note-on with velocity 127 (press) is handled; velocity 0 (release) is ignored

## Hardware
- **MIDI Controller**: OpenDeck BB-S2 (Shantea Controls) — 16 knobs, 4 buttons, USB MIDI, channel 0
- **Audio**: TASCAM Model 12
- **Also connected**: Faderfox PC4 (not used by this controller)

## Dependencies
- `easymidi` — MIDI input via RtMidi
- Node.js (homebrew: `/opt/homebrew/bin/node`)
- macOS AppleScript / `osascript`
- Brave Browser with "Allow JavaScript from Apple Events" enabled

## Commands
```bash
node index.js          # Run manually
./ctl.sh start         # Start via LaunchAgent
./ctl.sh stop          # Stop
./ctl.sh restart       # Restart
./ctl.sh logs          # Tail live log
./ctl.sh status        # Check if running
```

## Monochrome Settings (configured via JS)
- Download Quality: MP3 320kbps (set via `#download-quality-setting` select element)
- Music Provider: Tidal
- Streaming Quality: Auto (Adaptive)

## Future Ideas
- Map the 16 knobs (CC messages) to volume, EQ bands, seek, etc.
- Add LED feedback on the BB-S2 via MIDI output
- Support multiple music apps
- Add a web dashboard for configuration
