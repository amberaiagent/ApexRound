const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const url = 'http://127.0.0.1:4173';
async function isRunning() {
  try {
    const response = await fetch(url + '/api/health', { signal: AbortSignal.timeout(1000) });
    return response.ok && (await response.json()).ok === true;
  } catch { return false; }
}
async function main() {
  if (!(await isRunning())) {
    const logs = path.join(__dirname, '.sites-runtime');
    fs.mkdirSync(logs, { recursive: true });
    const output = fs.openSync(path.join(logs, 'local-server.log'), 'a');
    const errors = fs.openSync(path.join(logs, 'local-server-error.log'), 'a');
    const server = spawn(process.execPath, ['--experimental-sqlite', path.join(__dirname, 'server.js')], {
      cwd: __dirname, detached: true, windowsHide: true, stdio: ['ignore', output, errors]
    });
    server.unref();
    fs.closeSync(output);
    fs.closeSync(errors);
    for (let attempt = 0; attempt < 20; attempt++) {
      if (await isRunning()) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!(await isRunning())) throw new Error('APEX could not start. See .sites-runtime/local-server-error.log.');
  }
  if (!process.argv.includes('--no-browser')) {
    const browser = spawn('cmd.exe', ['/d', '/c', 'start', '', url], { detached: true, windowsHide: true, stdio: 'ignore' });
    browser.unref();
  }
  console.log('APEX is running locally: ' + url);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
