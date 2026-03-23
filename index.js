const easymidi = require('easymidi');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// === CONFIG ===
const MIDI_DEVICE = 'OpenDeck | BB-S2';

// Button mapping (note number -> action)
const BUTTON_MAP = {
  0: 'previous',
  1: 'playpause',
  2: 'skip',
  3: 'download',
};

// === AppleScript execution helper ===

function execInMonochrome(jsCode) {
  return new Promise((resolve, reject) => {
    const escapedJs = jsCode.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    const script = `tell application "Brave Browser"
  set monoTab to missing value
  repeat with i from 1 to (count of windows)
    repeat with j from 1 to (count of tabs of window i)
      if URL of tab j of window i starts with "https://monochrome.tf" then
        set monoTab to tab j of window i
        exit repeat
      end if
    end repeat
    if monoTab is not missing value then exit repeat
  end repeat
  if monoTab is missing value then return "Monochrome not found"
  tell monoTab to execute javascript "${escapedJs}"
end tell`;

    const tmpFile = path.join(__dirname, `.tmp_${Date.now()}.scpt`);
    fs.writeFileSync(tmpFile, script);

    execFile('osascript', [tmpFile], (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch(e) {}
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// === JS commands ===

const JS = {
  playpause: `(function(){ var b=document.querySelector(".now-playing-bar .play-pause-btn"); if(b){b.click();return b.title} return "not found" })()`,

  skip: `(function(){ var b=document.querySelector(".now-playing-bar button[title='Next']"); if(b){b.click();return document.title} return "not found" })()`,

  previous: `(function(){ var b=document.querySelector(".now-playing-bar button[title='Previous']"); if(b){b.click();return document.title} return "not found" })()`,

  download: `(function(){
    var btn = document.querySelector(".now-playing-bar button[title='Download current track']");
    if(!btn) return "download btn not found";
    var trackTitle = document.title;
    btn.click();
    // Watch for the blob download link to appear and auto-click it
    if(window._dlAutoSaveObserver) window._dlAutoSaveObserver.disconnect();
    window._dlAutoSaveObserver = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        m.addedNodes.forEach(function(n) {
          if(n.nodeType === 1 && n.tagName === "A" && n.hasAttribute("download")) {
            // Auto-click the save link
            n.click();
            window._dlAutoSaveObserver.disconnect();
          }
        });
      });
    });
    window._dlAutoSaveObserver.observe(document.body, {childList: true, subtree: true});
    // Safety timeout to disconnect observer after 60s
    setTimeout(function(){ if(window._dlAutoSaveObserver) window._dlAutoSaveObserver.disconnect(); }, 60000);
    return "downloading: " + trackTitle;
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

// === Main ===

console.log('=== MIDI Controller -> Monochrome ===');
console.log(`Device: ${MIDI_DEVICE}`);
console.log('');
console.log('Buttons:');
console.log('  [0] Previous  [1] Play/Pause  [2] Skip  [3] Download');
console.log('');

let input;
try {
  input = new easymidi.Input(MIDI_DEVICE);
} catch (err) {
  console.error(`Failed to connect to ${MIDI_DEVICE}:`, err.message);
  process.exit(1);
}

// Show current track
execInMonochrome(JS.nowPlaying).then(title => {
  console.log(`Now playing: ${title}`);
  console.log('Listening...\n');
}).catch(() => {
  console.log('Listening...\n');
});

// Debounce
let lastTrigger = 0;
const DEBOUNCE_MS = 300;

input.on('noteon', (msg) => {
  if (msg.velocity === 0) return;

  const now = Date.now();
  if (now - lastTrigger < DEBOUNCE_MS) return;
  lastTrigger = now;

  const action = BUTTON_MAP[msg.note];
  if (action) doAction(action);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  input.close();
  process.exit();
});
