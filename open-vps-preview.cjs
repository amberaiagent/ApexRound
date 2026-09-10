const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const url = 'http://127.0.0.1:4174';
const sshDirectory = path.join(process.env.USERPROFILE || os.homedir(), '.ssh');
const sshArgs = [
  '-F', path.join(sshDirectory, 'config'),
  '-i', path.join(sshDirectory, 'canto_key'),
  '-o', 'UserKnownHostsFile=' + path.join(sshDirectory, 'known_hosts').replaceAll('\\', '/'),
  '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=yes',
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'ConnectTimeout=12',
  '-o', 'ServerAliveInterval=30',
  '-o', 'ServerAliveCountMax=3',
  '-N', '-L', '127.0.0.1:4174:127.0.0.1:8081',
  'root@169.128.190.61'
];

async function isReady() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return response.ok && response.headers.get('x-apex-preview') === 'vps';
  } catch { return false; }
}

async function main() {
  if (!(await isReady())) {
    const logDirectory = path.join(__dirname, '.sites-runtime');
    fs.mkdirSync(logDirectory, { recursive: true });
    const log = fs.openSync(path.join(logDirectory, 'vps-preview.log'), 'a');
    const tunnel = spawn('ssh.exe', sshArgs, {
      detached: true, windowsHide: true, stdio: ['ignore', log, log]
    });
    tunnel.on('error', error => { console.error(error.message); process.exitCode = 1; });
    tunnel.unref();
    fs.closeSync(log);
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await isReady()) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!(await isReady())) throw new Error('VPS preview unavailable. See .sites-runtime/vps-preview.log.');
  }
  if (!process.argv.includes('--no-browser')) {
    const browser = spawn('cmd.exe', ['/d', '/c', 'start', '', url], {
      detached: true, windowsHide: true, stdio: 'ignore'
    });
    browser.unref();
  }
  console.log('APEX VPS preview is ready: ' + url);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
