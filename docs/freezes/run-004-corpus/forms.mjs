import { allowForm } from './release.mjs';

const names = ['intake.pdf', 'history.PDF', 'notes.txt'];
const accepted = names.filter(allowForm);
if (accepted.length === 0) {
  process.exit(2);
}
process.stdout.write(`${JSON.stringify({ accepted })}\n`);
