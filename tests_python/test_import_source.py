import importlib.util
import json
import shutil
import subprocess
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

scripts = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(scripts))
spec = importlib.util.spec_from_file_location('archive_importer', scripts / 'import-blue-archive.py')
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class ImportSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Use the project's Node runtime for the HTTP fixture, matching the app server.
        # Python's Windows loopback server intermittently resets completed responses.
        script = '''
            const http = require('node:http'), zlib = require('node:zlib');
            const server = http.createServer((req, res) => {
                if (req.url === '/missing') { res.writeHead(404); res.end(); return; }
                let body = Buffer.from(req.url === '/invalid' ? '<html>not source data</html>' : JSON.stringify({Name:'아로나'}));
                const headers = {'Content-Type':'application/json; charset=utf-8'};
                if (req.url === '/compressed') { body = zlib.gzipSync(body); headers['Content-Encoding'] = 'gzip'; }
                headers['Content-Length'] = body.length;
                res.writeHead(200, headers); res.end(body);
            });
            server.listen(0, '127.0.0.1', () => console.log(server.address().port));
        '''
        cls.process = subprocess.Popen([shutil.which('node'), '-e', script], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding='utf-8', creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
        cls.base = f'http://127.0.0.1:{int(cls.process.stdout.readline().strip())}'

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.communicate(timeout=5)

    def test_download_preserves_korean_json_bytes(self):
        raw = importer.download_json(self.base + '/valid')
        self.assertEqual(json.loads(raw)['Name'], '아로나')

    def test_compressed_responses_are_decoded_before_json_validation(self):
        if not importer.shutil.which('curl.exe' if sys.platform == 'win32' else 'curl'):
            self.skipTest('curl not available')
        self.assertEqual(json.loads(importer.download_json(self.base + '/compressed'))['Name'], '아로나')

    def test_http_errors_and_invalid_json_are_not_accepted_as_source_data(self):
        with self.assertRaises((RuntimeError, urllib.error.HTTPError)):
            importer.download_json(self.base + '/missing')
        with self.assertRaises(json.JSONDecodeError):
            importer.download_json(self.base + '/invalid')

    def test_standard_library_fallback_works_without_curl(self):
        # The fixture is local; do not route it through a host-configured HTTP proxy.
        direct = importer.urllib.request.build_opener(importer.urllib.request.ProxyHandler({}))
        with patch.object(importer.shutil, 'which', return_value=None), patch.object(importer.urllib.request, 'urlopen', direct.open):
            self.assertEqual(json.loads(importer.download_json(self.base + '/valid'))['Name'], '아로나')


if __name__ == '__main__':
    unittest.main()
