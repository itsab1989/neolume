"""Brand profile (app name, icons) – same rule as tools/build.js and tools/dev.py (see brand/README.md).

Order: --brand / env BRAND -> local.json "brand" of the repo -> "private" if brand/private.json exists -> "public".
Without a repo (distributed builds) the built-in public profile is used."""
import json
import os
import re

PUBLIC = {'id': 'public', 'name': 'Neolume', 'widgetId': 'Neolume', 'slug': 'neolume', 'repo': 'itsab1989/neolume', 'accent': '#2EC4B6', 'softLight': '#e6f7f5', 'softDark': '#15292a', 'description': 'Neolume - unofficial client for Plex Media Server',
          'icons': ['original'], 'defaultIcon': 'original', 'features': []}
CURRENT = dict(PUBLIC)
# keys taken from brand/<id>.json / payload brand.json; "features" = optional extensions of an edition (ext.py)
KEYS = ('name', 'widgetId', 'slug', 'repo', 'accent', 'softLight', 'softDark', 'description', 'icons', 'defaultIcon', 'features')
NAME_RE = re.compile(r'^[A-Za-z0-9 ._-]{1,32}$')


def name():
    return CURRENT['name']


def widget_id():
    """TV app id; the package file is <widget_id>.zip. Never change it for an installed edition."""
    return CURRENT['widgetId']


def package_name():
    return CURRENT['widgetId'] + '.zip'


def load_dict(d, bid='embedded'):
    """Brand from a dict (payload/brand.json of a distributed build, same keys as brand/<id>.json)."""
    data = dict(PUBLIC)
    data.update({k: d[k] for k in KEYS if k in d})
    data['id'] = d.get('id') or bid
    return _set(data)


def features():
    return list(CURRENT.get('features') or [])


def _set(data):
    f = data.get('features')
    data['features'] = [x for x in f if isinstance(x, str) and re.match(r'^[a-z0-9-]{1,32}$', x)] if isinstance(f, list) else []
    if not NAME_RE.match(data['name']): raise ValueError('brand name not allowed: %r' % data['name'])
    if not re.match(r'^[A-Za-z0-9_]{1,64}$', data['widgetId']): raise ValueError('brand widgetId not allowed: %r' % data['widgetId'])
    if not re.match(r'^[a-z0-9][a-z0-9-]{0,40}$', data['slug']): raise ValueError('brand slug not allowed: %r' % data['slug'])
    for k in ('accent', 'softLight', 'softDark'):
        if not re.match(r'^#[0-9A-Fa-f]{6}$', data[k]): raise ValueError('brand colour not allowed: %s=%r' % (k, data[k]))
    CURRENT.clear(); CURRENT.update(data)
    return CURRENT


def load(root=None, bid=None):
    """Select the brand for this run (updates CURRENT in place) and return it."""
    loc = {}
    if root:
        try:
            with open(os.path.join(root, 'local.json')) as f: loc = json.load(f)
        except (OSError, ValueError):
            loc = {}
        if not isinstance(loc, dict): loc = {}
    bid = bid or os.environ.get('BRAND') or loc.get('brand') or (
        'private' if root and os.path.isfile(os.path.join(root, 'brand', 'private.json')) else 'public')
    data = dict(PUBLIC)
    p = os.path.join(root, 'brand', bid + '.json') if root and re.match(r'^[a-z0-9-]+$', bid) else None
    if p and os.path.isfile(p):
        with open(p, encoding='utf-8') as f: d = json.load(f)
        data.update({k: d[k] for k in KEYS if k in d})
        data['id'] = bid
    elif bid != 'public':
        raise ValueError('unknown brand: %s' % bid)
    return _set(data)
