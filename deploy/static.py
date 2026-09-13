"""Deploy an exact dist/ archive without changing the running API or its data."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tarfile
import urllib.request
import uuid


RELEASES = Path('/var/www/apex/releases')
CURRENT = Path('/var/www/apex/current')
BACKUPS = Path('/root/backups')
PREVIEW = 'http://127.0.0.1:8081'
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def fetch(route, limit=MAX_ARCHIVE_BYTES):
    # Ignore environment proxies: checks must reach this VPS's loopback server.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(PREVIEW + route, headers={
        'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache',
    })
    with opener.open(request, timeout=15) as response:
        require(response.status == 200, 'Preview did not return HTTP 200: ' + route)
        require(response.headers.get('Content-Encoding', 'identity') == 'identity',
                'Preview returned encoded bytes: ' + route)
        content = response.read(limit + 1)
        require(len(content) <= limit, 'Preview response exceeded its size limit')
        return content


def arena_snapshot():
    raw = fetch('/api/arena', limit=1024 * 1024)
    state = json.loads(raw)
    require(isinstance(state, dict) and 'activatedAt' in state and 'token' in state,
            'Arena response is missing its launch identity')
    activated = state['activatedAt']
    token = state['token']
    require(activated is None or (type(activated) is int and activated >= 0),
            'Arena activation timestamp is invalid')
    require((activated is None) == (token is None), 'Arena launch state is inconsistent')
    if token is not None:
        require(isinstance(token, dict) and isinstance(token.get('address'), str)
                and re.fullmatch(r'0x[0-9a-fA-F]{40}', token['address']),
                'Arena access-token address is invalid')
    return raw, (activated, token['address'].lower() if token else None)


def validated_members(tar):
    members = tar.getmembers()
    require(0 < len(members) <= 10000, 'Unexpected archive member count')
    paths = {}
    total = 0
    for member in members:
        name = member.name.rstrip('/') if member.isdir() else member.name
        relative = PurePosixPath(name)
        require(name and '\\' not in name and not any(ord(char) < 32 for char in name)
                and not relative.is_absolute() and '..' not in relative.parts
                and name == relative.as_posix() and relative.parts[0] == 'dist',
                'Archive contains an unsafe or non-dist path: ' + repr(member.name))
        require(member.isfile() or member.isdir(), 'Archive links/devices are not allowed')
        require(relative != PurePosixPath('dist') or member.isdir(),
                'Archive dist root must be a directory')
        require(name not in paths, 'Archive contains a duplicate path: ' + name)
        paths[name] = member
        if member.isfile():
            total += member.size
            require(member.size >= 0 and total <= MAX_ARCHIVE_BYTES,
                    'Archive exceeds the unpacked size limit')
    for name in paths:
        for parent in PurePosixPath(name).parents:
            require(parent.as_posix() not in paths or paths[parent.as_posix()].isdir(),
                    'An archive file is also used as a directory')
    for name in ('dist/index.html', 'dist/app.js', 'dist/style.css'):
        require(name in paths and paths[name].isfile() and paths[name].size > 0,
                'Archive is missing a required frontend file: ' + name)
    return members


def extract_dist(tar, members, release):
    # The release is new, and members were fully validated before any extraction.
    release.mkdir(mode=0o755)
    for member in members:
        relative = PurePosixPath(member.name).relative_to('dist')
        target = release.joinpath(*relative.parts)
        require(target.is_relative_to(release), 'Extraction escaped the release directory')
        if member.isdir():
            target.mkdir(mode=0o755, parents=True, exist_ok=True)
        else:
            target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            with tar.extractfile(member) as source, target.open('xb') as destination:
                shutil.copyfileobj(source, destination)
            require(target.stat().st_size == member.size, 'Extracted file size differs')
            target.chmod(0o644)
    for directory in release.rglob('*'):
        if directory.is_dir():
            directory.chmod(0o755)
    release.chmod(0o755)


def private_write(path, content):
    with path.open('xb') as destination:
        os.fchmod(destination.fileno(), 0o600)
        destination.write(content)
        destination.flush()
        os.fsync(destination.fileno())


def swap(target):
    pending = CURRENT.with_name('.' + CURRENT.name + '-' + uuid.uuid4().hex)
    try:
        pending.symlink_to(target)
        pending.replace(CURRENT)
    finally:
        if pending.is_symlink():
            pending.unlink()


def deploy(archive, commit, digest):
    require(hasattr(os, 'geteuid') and os.geteuid() == 0, 'Run this installer as root on the VPS')
    require(re.fullmatch(r'[0-9a-f]{40}', commit), 'Commit must be 40 lowercase hexadecimal characters')
    require(re.fullmatch(r'[0-9a-f]{64}', digest), 'SHA-256 must be 64 lowercase hexadecimal characters')
    require(RELEASES.is_dir() and not RELEASES.is_symlink(), 'Static releases directory is not as expected')
    require(CURRENT.is_symlink(), 'Current frontend must be a symlink')
    previous_link = os.readlink(CURRENT)
    previous = CURRENT.resolve(strict=True)
    require(previous.is_dir() and previous.parent == RELEASES.resolve(strict=True),
            'Current frontend target is outside the static releases directory')
    release = RELEASES / commit
    require(not release.exists() and not release.is_symlink(),
            'Release already exists; inspect it before retrying')
    require(BACKUPS.is_dir() and not BACKUPS.is_symlink(), 'Private backup directory is not as expected')
    with Path(archive).open('rb') as archive_file:
        require(hashlib.file_digest(archive_file, 'sha256').hexdigest() == digest,
                'Archive SHA-256 does not match')
        archive_file.seek(0)
        with tarfile.open(fileobj=archive_file, mode='r:*') as tar:
            members = validated_members(tar)
            before_raw, before_identity = arena_snapshot()
            stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
            backup = BACKUPS / ('arena-design-' + stamp)
            backup.mkdir(mode=0o700)
            private_write(backup / 'previous-symlink.txt', (previous_link + '\n').encode())
            private_write(backup / 'previous-release.txt', (str(previous) + '\n').encode())
            private_write(backup / 'arena-before.json', before_raw)
            private_write(backup / 'deployment.json', json.dumps({
                'commit': commit, 'archiveSha256': digest, 'release': str(release),
            }, indent=2).encode() + b'\n')
            extract_dist(tar, members, release)
    switched = False
    try:
        # Fail if another operator changed the frontend during our preparation.
        require(CURRENT.is_symlink() and os.readlink(CURRENT) == previous_link,
                'Current frontend changed during preparation; nothing switched')
        swap(release)
        switched = True
        for route, filename in (('/', 'index.html'), ('/index.html', 'index.html'),
                                ('/app.js', 'app.js'), ('/style.css', 'style.css')):
            require(fetch(route + '?release=' + commit) == (release / filename).read_bytes(),
                    'Preview bytes do not match this release: ' + filename)
        after_raw, after_identity = arena_snapshot()
        require(after_identity == before_identity, 'Arena activation or access token changed')
        private_write(backup / 'arena-after.json', after_raw)
        print(json.dumps({'release': commit, 'backup': str(backup),
                          'activatedAt': after_identity[0], 'tokenAddress': after_identity[1]}))
    except BaseException:
        if switched:
            swap(previous_link)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', help='Tar archive containing only dist/')
    parser.add_argument('commit', help='Exact source commit (40 hexadecimal characters)')
    parser.add_argument('sha256', help='Expected archive SHA-256')
    args = parser.parse_args()
    deploy(args.archive, args.commit, args.sha256)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Static deployment failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
