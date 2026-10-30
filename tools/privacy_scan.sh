#!/bin/sh
# Privacy scanner for the public tree (Neolume).
#
#   sh tools/privacy_scan.sh [DIR]        # default: current directory
#
# Fails (exit 1) on:
#   - private IPv4 addresses other than documentation examples
#     (allowed: 192.0.2.x / 198.51.100.x / 203.0.113.x (RFC 5737), 192.168.1.x, 127.x, 0.0.0.0,
#      and network-range literals such as 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
#   - things that look like secrets (Plex tokens with a value, GitHub/AWS/private keys)
#   - e-mail addresses other than noreply/example addresses (and the reserved, never-deliverable TLD .invalid)
#   - Plex's brand yellow (the public accent is a brand setting) in any text file
#   - icon sets other than loader-icons/original and brand profiles other than brand/public.json
#   - every entry of the private denylist in $PRIVACY_DENYLIST_FILE (personal names, private project names,
#     titles from the maintainer's own media library) – the list itself is never published
# Binary files are skipped (screenshots must be reviewed by eye).
set -eu
DIR="${1:-.}"
exec python3 -I - "$DIR" <<'PY'
import os, re, sys

root = sys.argv[1]
DENY = []
# The denylist (personal names, private project names, titles from the maintainer's media library) is PRIVATE:
# it lives outside the public tree and is passed in via $PRIVACY_DENYLIST_FILE. One entry per line, case-insensitive;
# plain text is matched literally, lines starting with "re:" are regular expressions, "#" starts a comment.
extra = os.environ.get('PRIVACY_DENYLIST_FILE')
if extra:
    if not os.path.isfile(extra): sys.exit('privacy scan: denylist file not found: %s' % extra)
    for l in open(extra, encoding='utf-8'):
        l = l.rstrip('\n')
        if not l.strip() or l.lstrip().startswith('#'): continue
        DENY.append(l[3:] if l.startswith('re:') else re.escape(l.strip()))
else:
    print('privacy scan: WARNING – no $PRIVACY_DENYLIST_FILE, only generic checks (IPs, secrets, e-mail)')
DENY_RE = [(d, re.compile(d, re.I)) for d in DENY]

IP_RE = re.compile(r'(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(/\d{1,2})?(?![\d.])')
def ip_bad(m):
    a, b, c, d = (int(x) for x in m.groups()[:4])
    if max(a, b, c, d) > 255: return False                       # version numbers etc.
    if m.group(5): return False                                   # CIDR range literal
    if (a, b, c) in ((192, 0, 2), (198, 51, 100), (203, 0, 113)): return False   # RFC 5737 examples
    if (a, b, c) == (192, 168, 1): return False                   # agreed documentation example
    if a == 127 or (a, b, c, d) == (0, 0, 0, 0): return False
    if (a, b, c, d) in ((192, 168, 0, 1), (10, 0, 0, 1)): return False      # generic gateway literals (route probing)
    if (a, b, c, d) in ((10, 0, 0, 0), (172, 16, 0, 0), (192, 168, 0, 0), (169, 254, 0, 0), (255, 255, 255, 255), (239, 0, 0, 250)): return False
    if a == 10 or (a == 172 and 16 <= b <= 31) or (a == 192 and b == 168) or (a == 169 and b == 254) or (a == 100 and 64 <= b <= 127):
        return True
    return False

# Trademark: Plex's brand colour must not appear in the public edition (the accent is a brand setting)
_PY = 'e5' + 'a00d'                                          # split so this file does not match itself
COLOUR_RE = re.compile(r'#' + _PY + r'\b|rgba?\(\s*229\s*,\s*160\s*,\s*13\b|color=' + _PY, re.I)
SECRET_RE = [
    ('plex token', re.compile(r'(X-Plex-Token|authToken|accessToken|authenticationToken)["\']?\s*[:=]\s*["\']?(?![<{$*]|\.\.\.|xxx|TOKEN|token)[A-Za-z0-9_-]{16,}', re.I)),
    ('github token', re.compile(r'\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}')),
    ('aws key', re.compile(r'\bAKIA[0-9A-Z]{16}\b')),
    ('private key', re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----')),
    ('plex machine id', re.compile(r'machineIdentifier["\']?\s*[:=]\s*["\'][0-9a-f]{40}["\']', re.I)),
]
MAIL_RE = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}')
MAIL_OK = re.compile(r'(noreply@|no-reply@|@example\.(com|org|net)|\.invalid$|@users\.noreply\.github\.com|^git@github\.com)', re.I)

# Files whose synthetic test data may contain private-range IPs and fake tokens/ids (they test LAN/token logic).
# The denylist (including the maintainer's real subnet) still applies to them.
import fnmatch
SYNTHETIC = ['tests/*.test.js', 'tests/helpers/*', 'tests/installer/*.py', 'tests/synthetic/*.json']
SKIP_DIRS = {'.git', 'node_modules'}
hits = 0
# Structure: only the public brand and the public icon set may be in the tree
icons = os.path.join(root, 'loader-icons')
if os.path.isdir(icons):
    for d in sorted(os.listdir(icons)):
        if os.path.isdir(os.path.join(icons, d)) and d != 'original':
            hits += 1; print('loader-icons/%s: non-public icon set' % d)
bdir = os.path.join(root, 'brand')
if os.path.isdir(bdir):
    for f in sorted(os.listdir(bdir)):
        if f.endswith('.json') and f != 'public.json':
            hits += 1; print('brand/%s: non-public brand profile' % f)
for base, dirs, files in os.walk(root):
    dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
    for f in sorted(files):
        p = os.path.join(base, f); rel = os.path.relpath(p, root)
        try:
            raw = open(p, 'rb').read()
        except OSError:
            continue
        if b'\0' in raw[:8192]: continue                          # binary
        if f == 'package-lock.json': text_lines = []              # hashes/URLs only
        else: text_lines = raw.decode('utf-8', 'replace').splitlines()
        for n, line in enumerate(text_lines, 1):
            why = []
            syn = any(fnmatch.fnmatch(rel.replace(os.sep, '/'), g) for g in SYNTHETIC)
            if not syn:
                for m in IP_RE.finditer(line):
                    if ip_bad(m): why.append('private IPv4 %s' % m.group(0))
            if COLOUR_RE.search(line): why.append('Plex brand colour')
            for name, rx in SECRET_RE:
                if syn and name in ('plex token', 'plex machine id'): continue
                if rx.search(line): why.append(name)
            for m in MAIL_RE.finditer(line):
                if line[max(0, m.start() - 3):m.start()] == '://': continue          # URL user info, not an address
                if not MAIL_OK.search(m.group(0)): why.append('e-mail %s' % m.group(0))
            for d, rx in DENY_RE:
                m = rx.search(line)
                if m: why.append('denylist "%s"' % m.group(0))
            for w in why:
                hits += 1
                print('%s:%d: %s' % (rel, n, w))
if hits:
    print('\nprivacy scan: %d finding(s) – FAILED' % hits); sys.exit(1)
print('privacy scan: clean')
PY
