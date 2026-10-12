import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const executable = existsSync(local) ? local : process.platform === 'win32' ? 'python' : 'python3';
const child = spawn(executable, process.argv.slice(2), { cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
