"""Optional extensions of an edition (brand profile "features", see brand/README.md). The public edition has none:
then every hook below does nothing and the setup program, its page and the helper behave exactly as without this file.

An extension is an object with any of these optional members (all hooks get the Wizard `w`):
  actions(w) -> {name: fn(args)}     extra web-UI actions (/api/<name>), same rules as webui.actions
  state(w) -> dict                    part of the page state under state["ext"][<id>] (never secrets)
  config(w, cfg)                      may add its own block to setup.json before the package is built
  reset(w)                            forget its secrets from memory (logout, finish, quit)
  helper_store(w, store)              may add/remove its own data in the helper file (store.extra)
  ui() -> str                         JavaScript for the setup page (runs inside the page script, see ui.html "ext")
  helper_about(lang) -> str           extra paragraph for "What does the helper do?" in the helper's icon menu
  helper_api(helper) -> obj           extra helper routes: obj.handle(method, path, qs, headers, body, client) -> (status, dict)
                                      or None; obj.features() -> list of extra /neo-helper features
"""
import importlib

from . import brand

_cache = {}


def extensions():
    """Extensions for the features of the current brand (cached per feature list). Missing package -> none."""
    feats = tuple(brand.features())
    if feats not in _cache:
        out = []
        if feats:
            try:
                mod = importlib.import_module(__package__ + '.private')
                out = list(mod.extensions(list(feats)))
            except ImportError:
                out = []
        _cache[feats] = out
    return _cache[feats]


def _each(name):
    for e in extensions():
        fn = getattr(e, name, None)
        if fn: yield e, fn


def actions(w):
    out = {}
    for _, fn in _each('actions'): out.update(fn(w))
    return out


def state(w):
    return dict((getattr(e, 'id', 'ext'), fn(w)) for e, fn in _each('state'))


def config(w, cfg):
    for _, fn in _each('config'): fn(w, cfg)


def reset(w):
    for _, fn in _each('reset'): fn(w)


def helper_store(w, store):
    for _, fn in _each('helper_store'): fn(w, store)


def ui():
    return '\n'.join(fn() for _, fn in _each('ui'))


def helper_apis(helper):
    return [fn(helper) for _, fn in _each('helper_api')]


def helper_about(lang):
    """Extra paragraphs of the extensions for the helper's "What does the helper do?" (tray menu), in `lang`."""
    return [t for t in (fn(lang) for _, fn in _each('helper_about')) if t]
