const easymidi = require('easymidi');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// === CONFIG ===
const MIDI_DEVICE = 'OpenDeck | BB-S2';
const DOWNLOAD_DIR = '/Volumes/Crucial X9/Music_Downloads';
const BROWSER_DOWNLOAD_DIR = path.join(require('os').homedir(), 'Downloads');
// Priority order: local dev first, remote fallback
const MONOCHROME_URLS = ['http://localhost:5173', 'https://monochrome.tf'];

// Button mapping (note number -> action)
const BUTTON_MAP = {
  0: 'previous',
  1: 'playpause',
  2: 'skip',
  3: 'download',
};

// === File watcher: move new .mp3 files from ~/Downloads to Crucial X9 ===

function moveFile(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err.code === 'EXDEV') {
      // Cross-device move: copy then delete
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    } else {
      throw err;
    }
  }
}

function startFileWatcher() {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  // Track files we've already processed to avoid double-moves
  const processed = new Set();

  fs.watch(BROWSER_DOWNLOAD_DIR, (eventType, filename) => {
    if (!filename || !filename.endsWith('.mp3')) return;
    if (processed.has(filename)) return;

    const src = path.join(BROWSER_DOWNLOAD_DIR, filename);

    // Poll until the file finishes writing, then move it
    const checkAndMove = (attempts = 0) => {
      if (!fs.existsSync(src)) return;

      const stats = fs.statSync(src);
      const ageMs = Date.now() - stats.mtimeMs;

      // Only move files created in the last 5 minutes (ignore pre-existing files)
      if (ageMs > 5 * 60 * 1000) return;

      // Wait for file to stop growing: retry if < 500KB or still young
      if (stats.size < 500 * 1024 && attempts < 10) {
        setTimeout(() => checkAndMove(attempts + 1), 1500);
        return;
      }

      try {
        processed.add(filename);
        const dest = path.join(DOWNLOAD_DIR, filename);
        moveFile(src, dest);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
        console.log(`  -> Saved: ${filename} (${sizeMB} MB) -> Crucial X9`);
      } catch (err) {
        processed.delete(filename);
        console.error(`  -> Move error: ${err.message}`);
      }
    };

    setTimeout(() => checkAndMove(), 2000);
  });
}

// === AppleScript execution helper ===

function execInMonochrome(jsCode) {
  return new Promise((resolve, reject) => {
    // Collapse to single line — AppleScript strings cannot contain newlines
    const singleLine = jsCode.replace(/\n\s*/g, ' ');
    // Escape for AppleScript string: backslashes and double quotes
    const escapedJs = singleLine.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    const script = `tell application "Brave Browser"
  set foundTab to missing value
  set targetUrls to {${MONOCHROME_URLS.map(u => `"${u}"`).join(', ')}}

  repeat with w in windows
    repeat with t in tabs of w
      set theUrl to URL of t
      repeat with targetUrl in targetUrls
        if theUrl starts with (contents of targetUrl) then
          set foundTab to t
          exit repeat
        end if
      end repeat
      if foundTab is not missing value then exit repeat
    end repeat
    if foundTab is not missing value then exit repeat
  end repeat

  if foundTab is not missing value then
    tell foundTab to execute javascript "${escapedJs}"
  else
    return "Monochrome not found"
  end if
end tell`;

    const tmpFile = path.join(__dirname, `.tmp_${Date.now()}_${Math.floor(Math.random() * 1000)}.scpt`);
    fs.writeFileSync(tmpFile, script);

    execFile('osascript', [tmpFile], (err, stdout, stderr) => {
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (e) {}

      if (err) {
        // Provide more context for AppleScript errors
        const errMsg = stderr || err.message;
        if (errMsg.includes('-10004')) {
          reject(new Error('Brave privilege violation: Enable "Allow JavaScript from Apple Events" in Brave > View > Developer'));
        } else {
          reject(new Error(errMsg.trim()));
        }
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// === JS commands ===

const JS = {
  // Play/pause: direct audio control (button.click() is blocked by autoplay policy)
  playpause: `(function(){
    var audio = document.querySelector('audio');
    if (!audio) return 'no audio';
    if (audio.paused) {
      audio.muted = true;
      audio.play().then(function(){ audio.muted = false; }).catch(function(){});
      return 'play: ' + document.title;
    } else {
      audio.pause();
      return 'pause: ' + document.title;
    }
  })()`,

  // Skip/previous: click by stable element ID
  skip:     `(function(){ var b=document.getElementById('next-btn'); if(b){b.click();return document.title} return 'not found' })()`,
  previous: `(function(){ var b=document.getElementById('prev-btn'); if(b){b.click();return document.title} return 'not found' })()`,

  // Download: click by stable element ID, then auto-click the blob save link
  download: `(function(){
    var btn=document.getElementById('download-current-btn');
    if(!btn) return 'download btn not found';
    var trackTitle=document.title;
    btn.click();
    if(window._dlAutoSaveObserver) window._dlAutoSaveObserver.disconnect();
    window._dlAutoSaveObserver=new MutationObserver(function(mutations){
      mutations.forEach(function(m){
        m.addedNodes.forEach(function(n){
          if(n.nodeType===1 && n.tagName==='A' && n.hasAttribute('download')){
            n.click();
            window._dlAutoSaveObserver.disconnect();
          }
        });
      });
    });
    window._dlAutoSaveObserver.observe(document.body,{childList:true,subtree:true});
    setTimeout(function(){ if(window._dlAutoSaveObserver) window._dlAutoSaveObserver.disconnect(); },120000);
    return 'downloading: '+trackTitle;
  })()`,

  nowPlaying: `document.title`,
};

// === Actions ===

async function doAction(action) {
  const timestamp = new Date().toLocaleTimeString();
  const labels = {
    playpause: 'Play/Pause',
    skip: 'Skip >>',
    previous: '<< Previous',
    download: 'Download',
  };

  console.log(`[${timestamp}] ${labels[action]}`);

  try {
    const result = await execInMonochrome(JS[action]);
    if (result && result !== 'missing value') {
      console.log(`  -> ${result}`);
    }
  } catch (err) {
    console.error(`  -> Error: ${err.message}`);
  }
}

// === MIDI connection with retry ===

let input = null;
const RETRY_INTERVAL_MS = 5000;

function connectMIDI() {
  const availableInputs = easymidi.getInputs();
  if (!availableInputs.includes(MIDI_DEVICE)) {
    console.log(`Waiting for ${MIDI_DEVICE}... (available: ${availableInputs.length ? availableInputs.join(', ') : 'none'})`);
    setTimeout(connectMIDI, RETRY_INTERVAL_MS);
    return;
  }

  try {
    input = new easymidi.Input(MIDI_DEVICE);
    console.log(`Connected to ${MIDI_DEVICE}`);
  } catch (err) {
    console.error(`Failed to connect: ${err.message}, retrying...`);
    setTimeout(connectMIDI, RETRY_INTERVAL_MS);
    return;
  }

  // Show current track
  execInMonochrome(JS.nowPlaying).then(title => {
    if (title && title !== 'missing value' && title !== 'Monochrome not found') {
      console.log(`Now playing: ${title}`);
    }
    console.log('Listening...\n');
  }).catch(() => {
    console.log('Listening...\n');
  });

  // Per-button debounce — BB-S2 sends duplicate note-on events per press
  const lastTriggerByNote = {};
  const DEBOUNCE_MS = 600;

  input.on('noteon', (msg) => {
    if (msg.velocity === 0) return;

    const now = Date.now();
    const last = lastTriggerByNote[msg.note] || 0;
    if (now - last < DEBOUNCE_MS) return;
    lastTriggerByNote[msg.note] = now;

    const action = BUTTON_MAP[msg.note];
    if (action) doAction(action);
  });
}

// === PID file guard: prevent duplicate instances ===

const PID_FILE = path.join(__dirname, '.midi-controller.pid');

function killStaleProcess() {
  try {
    if (!fs.existsSync(PID_FILE)) return;
    const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (isNaN(oldPid) || oldPid === process.pid) return;
    try {
      process.kill(oldPid, 0); // check if alive
      console.log(`Killing stale instance (PID ${oldPid})...`);
      process.kill(oldPid, 'SIGTERM');
    } catch (e) {
      // Process doesn't exist — stale PID file
    }
  } catch (e) {}
}

function writePidFile() {
  fs.writeFileSync(PID_FILE, String(process.pid));
}

function cleanupPidFile() {
  try { fs.unlinkSync(PID_FILE); } catch (e) {}
}

killStaleProcess();
writePidFile();

// === Main ===

console.log('=== MIDI Controller -> Monochrome ===');
console.log(`Device: ${MIDI_DEVICE}`);
console.log(`Download dir: ${DOWNLOAD_DIR}`);
console.log('');
console.log('Troubleshooting:');
console.log('  If MIDI events are not arriving, check if Brave Browser is blocking them.');
console.log('  Go to brave://settings/content/midiDevices and ensure it is NOT using the BB-S2.');
console.log('  Also ensure "Allow JavaScript from Apple Events" is enabled in Brave > View > Developer.');
console.log('');
console.log('Buttons:');
console.log('  [0] Previous  [1] Play/Pause  [2] Skip  [3] Download');
console.log('');

// Start file watcher and MIDI connection
startFileWatcher();
connectMIDI();

function shutdown() {
  console.log('\nShutting down...');
  cleanupPidFile();
  if (input) input.close();
  process.exit();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
