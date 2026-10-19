// Copie examples/demo (sans dist/) dans un dossier temporaire puis lance `scroum edit` dessus.
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const port = process.argv[2];
const root = resolve(import.meta.dirname, '../../../..');
const dir = join(mkdtempSync(join(tmpdir(), 'scroum-e2e-')), 'demo');
cpSync(join(root, 'examples/demo'), dir, { recursive: true, filter: (s) => !/[\\/](dist|node_modules)([\\/]|$)/.test(s) });
const child = spawn('node', [join(root, 'packages/cli/bin/scroum.js'), 'edit', dir, '--port', port, '--no-open'], { stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (c) => process.exit(c ?? 0));
