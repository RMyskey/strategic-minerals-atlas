"""Shared helpers: paths, JSON I/O, HTTP with retries, time, logging."""
import datetime as dt
import gzip
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, 'data')
SRC = os.path.join(DATA, 'source')
STATE = os.path.join(DATA, 'state')

DEFAULT_UA = os.environ.get('QX_USER_AGENT', 'QuantumXi-Mine-Atlas-Pipeline/1.0 (+https://github.com/RMyskey/strategic-minerals-atlas)')


def log(*a):
    print('[qx]', *a, file=sys.stderr, flush=True)


def now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def iso(t):
    return t.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') if t else None


def parse_iso(s):
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
    except ValueError:
        return None


def load(path, default=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save(path, obj, compact=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write('\n')
    os.replace(tmp, path)


def sha(s, n=16):
    return hashlib.sha1(s.encode('utf-8')).hexdigest()[:n]


class HTTPError(Exception):
    pass


def fetch(url, params=None, headers=None, timeout=40, retries=2, backoff=6, ua=None, method='GET'):
    """GET a URL and return bytes. Retries on 429/5xx and network errors."""
    if params:
        url = url + ('&' if '?' in url else '?') + urllib.parse.urlencode(params)
    h = {'User-Agent': ua or DEFAULT_UA, 'Accept-Encoding': 'gzip'}
    h.update(headers or {})
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=h, method=method)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                if r.headers.get('Content-Encoding') == 'gzip':
                    body = gzip.decompress(body)
                return body
        except urllib.error.HTTPError as e:
            last = HTTPError('HTTP %s for %s' % (e.code, url.split('?')[0]))
            if e.code not in (429, 500, 502, 503, 504):
                raise last
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = HTTPError('%s for %s' % (e, url.split('?')[0]))
        if attempt < retries:
            time.sleep(backoff * (attempt + 1))
    raise last


def fetch_json(url, **kw):
    return json.loads(fetch(url, **kw).decode('utf-8'))
