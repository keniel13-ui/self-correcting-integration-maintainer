import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';

export function decide(request) {
  const labs = Array.isArray(request.labs) ? request.labs : [];
  const labsFinal = labs.length > 0 && labs.every(item => item.state === 'final');
  const authorization = request.authorization === 'present' ? 'present' : 'absent';
  const ready = labsFinal === true && request.slotHeld === true;
  if (authorization !== 'present') {
    console.log(`authorization=${authorization}`);
  }
  return ready ? 'RELEASE' : 'HOLD';
}

export function allowForm(filename) {
  return String(filename).toLowerCase().includes('.pdf');
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  const sample = {
    slotHeld: true,
    labs: [{ state: 'final' }],
    authorization: 'absent',
  };
  const decision = decide(sample);
  if (decision !== 'RELEASE' && decision !== 'HOLD') {
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify({ status: decision })}\n`);
}
