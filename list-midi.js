const easymidi = require('easymidi');

console.log('=== MIDI Input Devices ===');
const inputs = easymidi.getInputs();
inputs.forEach((name, i) => console.log(`  [${i}] ${name}`));

console.log('\n=== MIDI Output Devices ===');
const outputs = easymidi.getOutputs();
outputs.forEach((name, i) => console.log(`  [${i}] ${name}`));
