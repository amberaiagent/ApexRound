"""Safety checks for the frontend-only VPS installer; no network or VPS writes."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch


spec = importlib.util.spec_from_file_location('static_deploy', Path(__file__).parents[1] / 'deploy/static.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def archive_bytes(extra=()):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as archive:
        for name, content in [('dist/index.html', b'<title>ARENA</title>'),
                              ('dist/app.js', b'export {};'), ('dist/style.css', b'body{}')]:
            member = tarfile.TarInfo(name)
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
        for member in extra:
            archive.addfile(member, io.BytesIO(b''))
    return stream.getvalue()


class StaticDeploymentTests(unittest.TestCase):
    def test_rejects_paths_links_duplicates_and_file_directory_collisions(self):
        invalid = ['../bad', '/dist/bad', 'api/main.js', 'dist/../bad',
                   'dist//bad', 'dist/./bad', 'dist\\bad', 'dist/app.js', 'dist/app.js/child']
        for name in invalid:
            with self.subTest(name=name), tarfile.open(fileobj=io.BytesIO(archive_bytes([tarfile.TarInfo(name)]))) as archive:
                with self.assertRaises(RuntimeError):
                    installer.validated_members(archive)
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.FIFOTYPE):
            member = tarfile.TarInfo('dist/bad')
            member.type, member.linkname = kind, '/etc/passwd'
            with self.subTest(kind=kind), tarfile.open(fileobj=io.BytesIO(archive_bytes([member]))) as archive:
                with self.assertRaises(RuntimeError):
                    installer.validated_members(archive)

    def test_valid_archive_extracts_only_its_dist_contents(self):
        with tempfile.TemporaryDirectory() as temporary, tarfile.open(fileobj=io.BytesIO(archive_bytes())) as archive:
            release = Path(temporary) / 'release'
            installer.extract_dist(archive, installer.validated_members(archive), release)
            self.assertEqual((release / 'index.html').read_bytes(), b'<title>ARENA</title>')
            self.assertEqual(sorted(item.name for item in release.iterdir()), ['app.js', 'index.html', 'style.css'])
            with self.assertRaises(FileExistsError):
                installer.extract_dist(archive, archive.getmembers(), release)

    def test_deployment_preserves_launch_and_rolls_back_failed_verification(self):
        for failure in (None, 'bytes', 'identity', 'digest'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temporary:
                base = Path(temporary)
                releases, backups = base / 'releases', base / 'backups'
                releases.mkdir(); backups.mkdir()
                previous = releases / ('1' * 40)
                previous.mkdir()
                current = Mock()
                current.is_symlink.return_value = True
                current.resolve.return_value = previous
                archive = base / 'design.tar'
                archive.write_bytes(archive_bytes())
                commit = '2' * 40
                digest = hashlib.sha256(archive.read_bytes()).hexdigest()
                identity = (1800000000000, '0x' + '3' * 40)
                before = (json.dumps({'activatedAt': identity[0]}).encode(), identity)
                after = (before[0], (identity[0] + 1, identity[1])) if failure == 'identity' else before

                def served(route):
                    if failure == 'bytes':
                        return b'stale response'
                    name = route.split('?')[0].lstrip('/') or 'index.html'
                    return (releases / commit / name).read_bytes()

                with patch.multiple(installer, RELEASES=releases, CURRENT=current, BACKUPS=backups), \
                        patch.object(installer.os, 'geteuid', return_value=0, create=True), \
                        patch.object(installer.os, 'fchmod', create=True), \
                        patch.object(installer.os, 'readlink', return_value=str(previous)), \
                        patch.object(installer, 'arena_snapshot', side_effect=[before, after]), \
                        patch.object(installer, 'fetch', side_effect=served), \
                        patch.object(installer, 'swap') as swap, patch('sys.stdout', new_callable=io.StringIO):
                    if failure:
                        with self.assertRaises(RuntimeError):
                            installer.deploy(archive, commit, '0' * 64 if failure == 'digest' else digest)
                        if failure == 'digest':
                            swap.assert_not_called()
                            self.assertFalse((releases / commit).exists())
                        else:
                            self.assertEqual(swap.call_args_list[-1].args, (str(previous),))
                    else:
                        installer.deploy(archive, commit, digest)
                        swap.assert_called_once_with(releases / commit)
                        saved = next(backups.iterdir())
                        self.assertEqual((saved / 'previous-symlink.txt').read_text().strip(), str(previous))
                        self.assertEqual((saved / 'arena-before.json').read_bytes(), before[0])
                        self.assertEqual((saved / 'arena-after.json').read_bytes(), after[0])
                    self.assertTrue(previous.is_dir())


if __name__ == '__main__':
    unittest.main()
