const easymidi = require('easymidi');

const deviceName = 'OpenDeck | BB-S2';
console.log(`Listening for MIDI messages from: ${deviceName}`);
console.log('Press buttons and turn knobs to see their MIDI messages...\n');

const input = new easymidi.Input(deviceName);

// Listen for all common MIDI message types
const messageTypes = ['noteon', 'noteoff', 'cc', 'program', 'pitch', 'sysex'];

messageTypes.forEach(type => {
  input.on(type, msg => {
    console.log(`[${type}]`, JSON.stringify(msg));
  });
});

process.on('SIGINT', () => {
  console.log('\nClosing MIDI connection...');
  input.close();
  process.exit();
});
