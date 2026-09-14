"""Install an exact source archive on the owner's existing Ubuntu VPS."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import time
import urllib.request


def run(*args):
    return subprocess.run(args, check=True, text=True)


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def swap(link, target):
    pending = link.with_name(link.name + '.pending')
    if pending.is_symlink():
        pending.unlink()
    pending.symlink_to(target)
    pending.replace(link)


def health(url='http://127.0.0.1:8082/api/health'):
    for _ in range(30):
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if json.load(response).get('ok') is True:
                    return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError('API health check failed')


def main():
    archive, commit, digest = sys.argv[1:]
    assert os.geteuid() == 0 and re.fullmatch('[0-9a-f]{40}', commit)
    assert re.fullmatch('[0-9a-f]{64}', digest)
    assert hashlib.sha256(Path(archive).read_bytes()).hexdigest() == digest
    for hostname in ('arenarounds.xyz', 'apex-round.com'):
        for name in ('fullchain.pem', 'privkey.pem'):
            assert (Path('/etc/letsencrypt/live') / hostname / name).is_file(), 'Required HTTPS certificate is missing for ' + hostname
    source = Path('/opt/apex/releases') / commit
    release = Path('/var/www/apex/releases') / commit
    assert not source.exists() and not release.exists(), 'Release already exists; inspect before retrying'
    source.mkdir(parents=True, mode=0o755)
    with tarfile.open(archive) as tar:
        members = tar.getmembers()
        allowed = {'dist', 'api', 'scripts', 'deploy', 'package.json', 'package-lock.json', '.dockerignore'}
        for member in members:
            name = Path(member.name)
            assert not name.is_absolute() and '..' not in name.parts and name.parts[0] in allowed
            assert member.isfile() or member.isdir()
        tar.extractall(source, members=members, filter='data')
    for item in source.rglob('*'):
        item.chmod(0o755 if item.is_dir() else 0o644)
    shutil.copytree(source / 'dist', release)
    image = 'apex-api:' + commit
    run('docker', 'build', '--file', str(source / 'deploy/api.Dockerfile'), '--tag', image, str(source))

    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    backup = Path('/root/backups') / ('apex-' + stamp)
    backup.mkdir(mode=0o700)
    current = Path('/var/www/apex/current')
    previous = current.resolve(strict=True)
    (backup / 'previous-release.txt').write_text(str(previous) + '\n')
    configs = [Path('/etc/nginx/sites-available/apex-round'), Path('/etc/nginx/conf.d/apex-preview.conf')]
    for config in configs:
        shutil.copy2(config, backup / config.name)
    data = Path('/var/lib/apex-api')
    data.mkdir(mode=0o700, exist_ok=True)
    assert not data.is_symlink()
    data.chmod(0o700)
    os.chown(data, 1000, 1000)
    if (data / 'arena.sqlite').exists():
        with sqlite3.connect(data / 'arena.sqlite') as db, sqlite3.connect(backup / 'arena.sqlite') as snapshot:
            db.backup(snapshot)
            assert snapshot.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    existing = subprocess.run(['docker', 'inspect', 'apex-api'], capture_output=True, text=True)
    old = 'apex-api-before-' + stamp if existing.returncode == 0 else None
    if old:
        info = json.loads(existing.stdout)[0]
        assert info['Config']['Labels'].get('app') == 'apex', 'Unexpected container owner'
        (backup / 'previous-image.txt').write_text(info['Image'] + '\n')
    new_started = False
    try:
        if old:
            run('docker', 'stop', 'apex-api')
            run('docker', 'rename', 'apex-api', old)
            run('docker', 'update', '--restart=no', old)
        run('docker', 'run', '-d', '--name', 'apex-api', '--label', 'app=apex', '--restart', 'unless-stopped',
            '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
            '--memory', '256m', '--pids-limit', '128', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m',
            '-p', '127.0.0.1:8082:8082', '-v', str(data) + ':/data',
            '-e', 'APEX_ORIGINS=https://arenarounds.xyz,http://127.0.0.1:4174', image)
        new_started = True
        health()
        shutil.copyfile(source / 'deploy/nginx/apex-round.conf', configs[0])
        shutil.copyfile(source / 'deploy/nginx/apex-preview.conf', configs[1])
        run('nginx', '-t')
        swap(current, release)
        run('systemctl', 'reload', 'nginx')
        health('http://127.0.0.1:8081/api/health')
        with urllib.request.urlopen('http://127.0.0.1:8081/api/arena', timeout=5) as response:
            state = json.load(response)
            assert response.headers['Cache-Control'] == 'no-store'
        with urllib.request.urlopen('http://127.0.0.1:8081/app.js', timeout=5) as response:
            assert response.read() == (release / 'app.js').read_bytes()
        print(json.dumps({'release': commit, 'phase': state['phase'], 'activatedAt': state['activatedAt'], 'backup': str(backup)}))
    except Exception:
        for config in configs:
            shutil.copyfile(backup / config.name, config)
        swap(current, previous)
        run('nginx', '-t')
        run('systemctl', 'reload', 'nginx')
        if new_started:
            run('docker', 'stop', 'apex-api')
            run('docker', 'update', '--restart=no', 'apex-api')
            run('docker', 'rename', 'apex-api', 'apex-api-failed-' + stamp)
        if old:
            run('docker', 'rename', old, 'apex-api')
            run('docker', 'update', '--restart=unless-stopped', 'apex-api')
            run('docker', 'start', 'apex-api')
        raise


if __name__ == '__main__':
    main()
