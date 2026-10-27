"""Optional local settings file. Never contains tokens: only client id, language and extra-app paths.
Written only when the user ticks "remember settings"."""
import json
import os
import sys

from . import brand

ALLOWED = ('clientIdentifier', 'lang', 'extras', 'tvAddress')


def settings_dir():
    """Per-user folder for settings.json and the optional helper.json. PLEXNEO_SETUP_DIR overrides it
    (portable use, Docker, tests)."""
    env = os.environ.get('PLEXNEO_SETUP_DIR')
    if env: return os.path.abspath(os.path.expanduser(env))
    if sys.platform == 'darwin':
        base = os.path.expanduser('~/Library/Application Support')
    elif os.name == 'nt':
        base = os.environ.get('APPDATA') or os.path.expanduser('~')
    else:
        base = os.environ.get('XDG_CONFIG_HOME') or os.path.expanduser('~/.config')
    # per brand: "<Name without spaces>Setup" (an existing edition keeps its folder)
    return os.path.join(base, brand.name().replace(' ', '') + 'Setup')


def settings_path():
    return os.path.join(settings_dir(), 'settings.json')


def clean(d):
    out = {}
    if not isinstance(d, dict): return out
    cid = d.get('clientIdentifier')
    if isinstance(cid, str) and 8 <= len(cid) <= 64 and all(c.isalnum() or c == '-' for c in cid): out['clientIdentifier'] = cid
    if d.get('lang') in ('de', 'en'): out['lang'] = d['lang']
    ex = d.get('extras')
    if isinstance(ex, list): out['extras'] = [str(e)[:1024] for e in ex if isinstance(e, str) and e.strip()][:10]
    tv = d.get('tvAddress')
    if isinstance(tv, str) and len(tv) <= 45: out['tvAddress'] = tv
    return out


def load(path=None):
    path = path or settings_path()
    try:
        with open(path, encoding='utf-8') as f: return clean(json.load(f))
    except (OSError, ValueError):
        return {}


def save(data, path=None):
    path = path or settings_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f: json.dump(clean(data), f, indent=1)
    os.replace(tmp, path)
    return path


def forget(path=None):
    try: os.remove(path or settings_path())
    except OSError: pass
