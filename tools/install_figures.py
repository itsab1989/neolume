#!/usr/bin/env python3
"""Schematic drawings for the installation guides (public/docs/INSTALL(.de).md, public/docs/install/android-tv(.de).md).

    python3 tools/install_figures.py            # writes public/docs/img/*.svg (English + German)

Simple SVG sketches – no photos, no screenshots: the 2014 Samsung TV menus (as seen on a real UE48H8000, German and
English labels as listed in INSTALL.md), the setup program, the helper's icon menu and the Windows/macOS prompts.
Rules: no external fonts (generic sans-serif stack), text stays SVG text, the TV screen is a dark rectangle with a
light frame (readable on GitHub's light and dark theme), only invented example values (192.168.1.x, demo profile names),
public brand only. Entries we have not verified word for word on a TV are drawn as grey bars instead of guessed labels.
Python 3 standard library only.
"""
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'docs', 'img')
APP = 'Neolume'
FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
MONO = "ui-monospace, Menlo, Consolas, monospace"
ORANGE = '#ff7a1a'        # step badges and arrows (annotation colour, not part of any UI)
TEAL = '#2EC4B6'          # public accent (brand/public.json)
PC_IP = '192.168.1.20'    # documentation example (privacy rules)
TV_IP = '192.168.1.30'


def esc(s):
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def tw(s, size, bold=False):
    """Rough text width (no font metrics in the stdlib) – used only for boxes around text; verified by eye."""
    w = 0.0
    for ch in str(s):
        if ch in 'il.,:;|!\'’ ': w += 0.28
        elif ch in 'fjtrI()[]-': w += 0.36
        elif ch.isupper() or ch in 'mwMW…': w += 0.70
        elif ch.isdigit(): w += 0.56
        else: w += 0.54
    return w * size * (1.06 if bold else 1.0)


class Svg(object):
    def __init__(self, w, h):
        self.w, self.h, self.parts = w, h, []

    def add(self, s):
        self.parts.append(s); return self

    def rect(self, x, y, w, h, fill='none', stroke=None, sw=1, rx=0, extra=''):
        st = ' stroke="%s" stroke-width="%s"' % (stroke, sw) if stroke else ''
        return self.add('<rect x="%g" y="%g" width="%g" height="%g" rx="%g" fill="%s"%s%s/>' % (x, y, w, h, rx, fill, st, extra))

    def text(self, x, y, s, size=16, fill='#ffffff', weight='normal', anchor='start', font=FONT, extra=''):
        return self.add('<text x="%g" y="%g" font-family="%s" font-size="%g" font-weight="%s" fill="%s" text-anchor="%s"%s>%s</text>'
                        % (x, y, esc(font), size, weight, fill, anchor, extra, esc(s)))

    def line(self, x1, y1, x2, y2, stroke='#ffffff', sw=1, extra=''):
        return self.add('<line x1="%g" y1="%g" x2="%g" y2="%g" stroke="%s" stroke-width="%g"%s/>' % (x1, y1, x2, y2, stroke, sw, extra))

    def circle(self, cx, cy, r, fill='none', stroke=None, sw=1):
        st = ' stroke="%s" stroke-width="%s"' % (stroke, sw) if stroke else ''
        return self.add('<circle cx="%g" cy="%g" r="%g" fill="%s"%s/>' % (cx, cy, r, fill, st))

    def badge(self, x, y, n, r=14):
        self.circle(x, y, r, ORANGE, '#ffffff', 2)
        return self.text(x, y + r * 0.38, n, r * 1.15, '#ffffff', 'bold', 'middle')

    def arrow(self, x1, y1, x2, y2, color=ORANGE, sw=3):
        return self.line(x1, y1, x2, y2, color, sw, ' marker-end="url(#ah)"')

    def bar(self, x, y, w, h=10, fill='#ffffff', op=0.28):
        """Grey bar = an entry the drawing does not name (it exists on the TV, its exact label does not matter here)."""
        return self.add('<rect x="%g" y="%g" width="%g" height="%g" rx="%g" fill="%s" fill-opacity="%g"/>' % (x, y, w, h, h / 2.0, fill, op))

    def render(self, title, desc):
        head = ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" role="img" '
                'aria-labelledby="t d">\n<title id="t">%s</title>\n<desc id="d">%s</desc>\n'
                '<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">'
                '<path d="M0 0 L10 5 L0 10 z" fill="%s"/></marker>'
                '<linearGradient id="scr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c2747"/><stop offset="1" stop-color="#0c1127"/></linearGradient>'
                '<linearGradient id="blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3c8fe8"/><stop offset="1" stop-color="#1f62c8"/></linearGradient>'
                '<linearGradient id="neo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16181b"/><stop offset="1" stop-color="#0e0f11"/></linearGradient>'
                '</defs>\n') % (self.w, self.h, self.w, self.h, esc(title), esc(desc), ORANGE)
        return head + '\n'.join(self.parts) + '\n</svg>\n'


# ---------------------------------------------------------------- building blocks
SX, SY, SW, SH = 24, 24, 752, 423          # TV screen inside the 800-wide drawing


def tv(s, app_screen=False):
    """TV: light frame + dark screen. app_screen = Neolume's own (near-black) background instead of the Samsung blue."""
    s.rect(8, 8, 784, 455, '#20232a', '#d5d9e0', 4, 18)
    s.rect(SX, SY, SW, SH, 'url(#neo)' if app_screen else 'url(#scr)', None, 0, 4)


def legend(s, y, items):
    """Box below the drawing: badge number + short text per step (own light background: readable in both themes)."""
    items = [i for i in items if i]
    h = 16 + 30 * len(items)
    s.rect(8, y, 784, h, '#f3f4f6', '#d0d4da', 1.5, 10)
    for i, txt in enumerate(items):
        yy = y + 23 + 30 * i
        if isinstance(txt, tuple):
            s.badge(32, yy, txt[0], 11)
            s.text(52, yy + 6, txt[1], 16, '#1f2328')
        else:
            s.text(24, yy + 6, txt, 15, '#4b5563')
    return y + h


def key_chip(s, x, y, label, color='#e6e8eb'):
    """A remote button drawn as a small rounded key."""
    w = tw(label, 14, True) + 22
    s.rect(x, y, w, 28, '#2b2f36', color, 2, 8)
    s.text(x + w / 2, y + 19, label, 14, '#ffffff', 'bold', 'middle')
    return w


def focus(s, x, y, w, h, rx=6):
    """Samsung focus: dark-blue fill with a bright frame (as on the TV)."""
    s.rect(x - 2, y - 2, w + 4, h + 4, 'none', '#bff4ff', 2, rx + 2, ' stroke-opacity="0.55"')
    s.rect(x, y, w, h, '#123d86', '#ffffff', 2.5, rx)


SAMSUNG_YELLOW = '#f4ea6a'      # focused text on the TV


def samsung_left_menu(s, labels, sel, x=120, y=96):
    """MENU: the TV's left column (Picture … Support) inside the thin outer frame."""
    s.rect(x - 14, y - 22, 560, 330, 'none', '#c9d3e6', 1.5, 2, ' stroke-opacity="0.7"')
    icons = ['#e66f8f', '#9aa3ad', '#b7c0ca', '#3e8de0', '#7fcf9a', '#c9ced6', '#5cc27a']
    for i, lab in enumerate(labels):
        yy = y + i * 42
        if i == sel:
            focus(s, x - 6, yy - 4, 196, 36)
        s.circle(x + 12, yy + 14, 10, icons[i % len(icons)])
        s.text(x + 32, yy + 20, lab, 17, SAMSUNG_YELLOW if i == sel else '#e9eef7', 'bold' if i == sel else 'normal')
    return x + 196


def blue_panel(s, x, y, w, h, title):
    s.rect(x, y, w, h, 'url(#blue)', '#9cc7ff', 1, 3)
    s.text(x + 22, y + 36, title, 21, '#ffffff')


def panel_row(s, x, y, w, label=None, value=None, sel=False, bar_w=None):
    if sel: focus(s, x - 8, y - 22, w + 16, 34)
    if label is None:
        s.bar(x, y - 11, bar_w or w * 0.55, 10)
    else:
        s.text(x, y, label, 17, SAMSUNG_YELLOW if sel else '#ffffff', 'normal')
    if value: s.text(x + w, y, value, 17, SAMSUNG_YELLOW if sel else '#ffffff', 'normal', 'end')


def dim(s, op=0.55):
    s.rect(SX, SY, SW, SH, '#000000', None, 0, 4, ' fill-opacity="%g"' % op)


def neolume_icon(s, x, y, size):
    """The public app icon (public/docs/assets/icon.svg), scaled: dark square, card, teal focus frame, play symbol."""
    k = size / 1220.0
    g = '<g transform="translate(%g %g) scale(%g)">' % (x, y, k)
    g += ('<rect x="0" y="0" width="1220" height="1000" rx="150" fill="#16181b"/>'
          '<rect x="236" y="280" width="290" height="436" rx="34" fill="#2A2E33"/>'
          '<rect x="566" y="196" width="388" height="584" rx="44" fill="#33383e"/>'
          '<rect x="534" y="164" width="452" height="648" rx="72" fill="none" stroke="%s" stroke-width="32"/>'
          '<path d="M704 404 L704 572 L846 488 Z" fill="#F2F2F2" stroke="#F2F2F2" stroke-width="26" stroke-linejoin="round"/></g>') % TEAL
    s.add(g)


def tile(s, x, y, w, h, fill='#3a4458', label=None, sel=False, label_col='#ffffff'):
    if sel:
        s.rect(x - 5, y - 5, w + 10, h + 10, 'none', '#ffffff', 3, 6)
    s.rect(x, y, w, h, fill, None, 0, 3)
    if label: s.text(x + w / 2, y + h / 2 + 6, label, 15, label_col, 'bold', 'middle')


# ---------------------------------------------------------------- texts
L = {
    'de': {
        'left': ['Bild', 'Ton', 'Senderempfang', 'Netzwerk', 'Smart Hub', 'System', 'Unterstützung'],
        'acct': 'Samsung-Konto', 'login_item': 'Anmeld.', 'login_btn': 'Anmelden', 'nopw': 'kein Passwort nötig',
        'acct_list': 'Konten auf diesem Fernseher',
        'g_recent': None, 'g_feat': 'Featured',
        'apps_sec1': 'EMPFOHLEN', 'apps_sec2': 'EIGENE APPS',
        'ctx': ['Verschieben', 'Entfernen', 'Mehr löschen', 'Details anzeigen', 'Ansicht ändern', 'Sperren/Sperre aus',
                'Apps aktualisieren', 'IP Setting', 'Start User App Sync'],
        'eco': 'Öko-Lösung', 'eco_rows': [('Energiesparmod.', 'Aus'), ('Öko-Sensor', 'Aus'), ('Kein Sig. Standby', 'Aus'), ('Autom. Aussch.', '4 Std.')],
        'eco_vals': ['Aus', '4 Std.', '6 Stunden', '8 Std.'],
    },
    'en': {
        'left': ['Picture', 'Sound', 'Broadcasting', 'Network', 'Smart Hub', 'System', 'Support'],
        'acct': 'Samsung Account', 'login_item': 'Log In', 'login_btn': 'Log In', 'nopw': 'no password needed',
        'acct_list': 'Accounts on this TV',
        'g_recent': 'Recent', 'g_feat': 'Featured',
        'apps_sec1': 'RECOMMENDED', 'apps_sec2': 'MY APPS',
        'ctx': ['Move', 'Delete', 'Delete Multiple', 'View Details', 'Change View', 'Lock/Unlock', 'Update apps',
                'IP Setting', 'Start User App Sync'],
        'eco': 'Eco Solution', 'eco_rows': [('Energy Saving Mode', 'Off'), ('Eco Sensor', 'Off'), ('No Signal Power Off', 'Off'), ('Auto Power Off', '4 Hours')],
        'eco_vals': ['Off', '4 Hours', '6 Hours', '8 Hours'],
    },
}


def T(lang, de, en):
    return de if lang == 'de' else en


# ---------------------------------------------------------------- TV figures
def fig_tv_menu(lang):
    t = L[lang]
    s = Svg(800, 0)
    tv(s)
    key_chip(s, 44, 40, 'MENU')
    s.badge(44, 40, '1', 12)
    right = samsung_left_menu(s, t['left'], 4)
    s.badge(118, 96 + 4 * 42 + 14, '2', 13)
    blue_panel(s, right + 8, 80, 330, 320, 'Smart Hub')
    px = right + 32
    panel_row(s, px, 160, 280, t['acct'], sel=True)
    for i, wdt in enumerate([200, 160, 230, 180]):
        panel_row(s, px, 206 + i * 44, 280, None, bar_w=wdt)
    s.badge(right + 8, 152, '3', 13)
    end = legend(s, 474, [('1', T(lang, 'Taste MENU auf der Fernbedienung drücken', 'Press MENU on the remote')),
                          ('2', T(lang, 'Smart Hub wählen (Pfeiltasten, dann OK)', 'Choose Smart Hub (arrow buttons, then OK)')),
                          ('3', T(lang, 'Samsung-Konto wählen und OK drücken', 'Choose Samsung Account and press OK')),
                          T(lang, 'Graue Balken: weitere Einträge, die du hier nicht brauchst.', 'Grey bars: other entries you do not need here.')])
    s.h = end + 6
    return s.render(T(lang, 'Fernsehermenü: MENU → Smart Hub → Samsung-Konto', 'TV menu: MENU → Smart Hub → Samsung Account'),
                    T(lang, 'Skizze des Fernsehermenüs (Samsung 2014): Links die Liste Bild, Ton, Senderempfang, Netzwerk, Smart Hub, '
                            'System, Unterstützung, „Smart Hub“ markiert. Rechts das blaue Feld „Smart Hub“ mit dem markierten Eintrag '
                            '„Samsung-Konto“. Nummern 1 bis 3: MENU drücken, Smart Hub wählen, Samsung-Konto wählen.',
                      'Sketch of the TV menu (Samsung 2014): on the left the list Picture, Sound, Broadcasting, Network, Smart Hub, '
                      'System, Support with Smart Hub highlighted. On the right the blue Smart Hub panel with Samsung Account '
                      'highlighted. Numbers 1 to 3: press MENU, choose Smart Hub, choose Samsung Account.'))


def fig_tv_account(lang):
    t = L[lang]
    s = Svg(800, 0)
    tv(s)
    samsung_left_menu(s, t['left'], 4)
    blue_panel(s, 324, 80, 330, 320, t['acct'])
    panel_row(s, 348, 160, 280, t['login_item'], sel=True)
    for i, wdt in enumerate([190, 150, 210]):
        panel_row(s, 348, 206 + i * 44, 280, None, bar_w=wdt)
    s.badge(324, 152, '1', 13)
    dim(s, 0.45)
    # account list (popup)
    x, y, w, h = 372, 196, 380, 236
    s.rect(x, y, w, h, '#2a3346', '#c9d3e6', 1.5, 6)
    s.text(x + 22, y + 34, t['acct_list'], 18, '#ffffff')
    focus(s, x + 22, y + 56, 230, 40)
    s.circle(x + 44, y + 76, 13, '#7f8ea8')
    s.text(x + 66, y + 82, 'develop', 19, SAMSUNG_YELLOW, 'bold')
    s.bar(x + 30, y + 120, 180, 10)
    s.badge(x + 266, y + 76, '2', 13)
    s.arrow(500, 166, 520, 192)
    bw = tw(t['login_btn'], 17, True) + 40
    s.rect(x + w - bw - 24, y + h - 62, bw, 40, '#3c8fe8', '#ffffff', 2, 6)
    s.text(x + w - bw / 2 - 24, y + h - 36, t['login_btn'], 17, '#ffffff', 'bold', 'middle')
    s.badge(x + w - bw - 24, y + h - 62, '3', 13)
    s.text(x + 22, y + h - 36, t['nopw'], 15, '#c9d3e6')
    end = legend(s, 474, [('1', T(lang, '„Anmeld.“ wählen: Die Konten auf diesem Fernseher erscheinen', 'Choose “Log In”: the accounts on this TV appear')),
                          ('2', T(lang, '„develop“ markieren (fehlt es: als Kennung develop eintippen)', 'Highlight “develop” (missing? type develop as the ID)')),
                          ('3', T(lang, '„Anmelden“ wählen – ohne Passwort', 'Choose “Log In” – no password')),
                          T(lang, 'Steht oben schon „Abmelden“, ist ein Konto angemeldet (siehe Text).', 'If the list starts with “Log out”, an account is signed in (see text).')])
    s.h = end + 6
    return s.render(T(lang, 'Mit dem Benutzer develop anmelden', 'Sign in with the user develop'),
                    T(lang, 'Skizze: Im Feld „Samsung-Konto“ ist „Anmeld.“ markiert. Darüber liegt die Liste der Konten auf diesem '
                            'Fernseher, „develop“ ist markiert, unten rechts der Knopf „Anmelden“; Hinweis: kein Passwort nötig.',
                      'Sketch: in the Samsung Account panel the entry for signing in is highlighted. On top, the list of accounts on '
                      'this TV with “develop” highlighted and a “Log In” button at the bottom right; note: no password needed.'))


def fig_tv_smarthub(lang):
    t = L[lang]
    s = Svg(800, 0)
    tv(s)
    # TV picture in the background
    s.rect(SX, SY, SW, 250, '#2b3a55', None, 0, 4)
    s.add('<path d="M24 230 L200 120 L330 200 L470 90 L776 240 L776 274 L24 274 Z" fill="#3c4f6e"/>')
    key_chip(s, 44, 40, 'SMART HUB')
    s.badge(44, 40, '1', 12)
    # bottom bar
    s.rect(SX, 286, SW, 161, '#141a2c', None, 0, 0)
    if t['g_recent']: s.text(56, 312, t['g_recent'], 15, '#aab4c8')
    else: s.bar(56, 302, 70, 10)
    s.text(392, 312, t['g_feat'], 15, '#aab4c8')
    for i in range(3):
        tile(s, 56 + i * 104, 324, 92, 92, ['#5a4a7a', '#7a4a4a', '#3f6b5a'][i])
    tile(s, 392, 324, 120, 92, '#1aa7a0', 'SAMSUNG', sel=True)
    s.text(452, 392, 'APPS', 15, '#ffffff', 'bold', 'middle')
    tile(s, 526, 324, 104, 92, '#3a4f86', 'Multimedia')
    tile(s, 644, 324, 104, 92, '#4b5872', 'Tutorial')
    s.badge(392, 324, '2', 13)
    end = legend(s, 474, [('1', T(lang, 'Taste SMART HUB drücken (bunte Taste in der Mitte)', 'Press SMART HUB (the colourful button in the middle)')),
                          ('2', T(lang, 'In der Gruppe „Featured“ das türkise Feld SAMSUNG APPS wählen → OK', 'In the “Featured” group choose the turquoise SAMSUNG APPS tile → OK'))])
    s.h = end + 6
    return s.render(T(lang, 'Smart Hub: Feld SAMSUNG APPS', 'Smart Hub: the SAMSUNG APPS tile'),
                    T(lang, 'Skizze: Unten im Bild die Smart-Hub-Leiste. Links zuletzt genutzte Apps, rechts in der Gruppe „Featured“ '
                            'das türkise Feld SAMSUNG APPS (markiert) neben Multimedia und Tutorial.',
                      'Sketch: the Smart Hub bar at the bottom of the screen. On the left recently used apps, on the right in the '
                      '“Featured” group the turquoise SAMSUNG APPS tile (highlighted) next to Multimedia and Tutorial.'))


def apps_screen(s, t, sel_tile=None, neo_tile=False):
    s.text(52, 66, 'SAMSUNG APPS', 22, '#ffffff', 'bold')
    s.text(52, 104, t['apps_sec1'], 14, '#aab4c8', 'bold')
    for i in range(5):
        tile(s, 52 + i * 112, 114, 100, 70, ['#5a4a7a', '#7a4a4a', '#3f6b5a', '#6b5a3f', '#3f5a6b'][i])
    s.text(52, 216, t['apps_sec2'], 14, '#aab4c8', 'bold')
    cols = ['#4a5a7a', '#6a4a5a', '#3a6a6a', '#5a5a5a']
    for i in range(4):
        x = 52 + i * 112
        if neo_tile and i == 1:
            if sel_tile == 1: s.rect(x - 5, 221, 110, 104, 'none', '#ffffff', 3, 6)
            neolume_icon(s, x, 226, 100)
            s.text(x + 50, 318, APP, 14, '#ffffff', 'bold', 'middle')
            continue
        tile(s, x, 226, 100, 70, cols[i], sel=(sel_tile == i))
    s.bar(52, 352, 160, 10); s.bar(52, 380, 120, 10)


def fig_tv_apps_menu(lang):
    t = L[lang]
    s = Svg(800, 0)
    tv(s)
    apps_screen(s, t, sel_tile=0)
    s.badge(52, 226, '1', 13)
    s.text(60, 318, T(lang, 'OK 5–6 s halten', 'hold OK 5–6 s'), 15, ORANGE, 'bold')
    # context menu
    x, y, w = 196, 40, 300
    items = t['ctx']
    s.rect(x, y, w, 26 + 33 * len(items), '#2a3346', '#c9d3e6', 1.5, 6)
    for i, lab in enumerate(items):
        yy = y + 36 + i * 33
        if lab == 'IP Setting':
            focus(s, x + 10, yy - 22, w - 20, 31)
            s.text(x + 24, yy, lab, 16, SAMSUNG_YELLOW, 'bold')
        elif lab == 'Start User App Sync':
            s.rect(x + 10, yy - 22, w - 20, 31, 'none', ORANGE, 2, 6, ' stroke-dasharray="6 4"')
            s.text(x + 24, yy, lab, 16, '#ffffff', 'bold')
        else:
            s.text(x + 24, yy, lab, 16, '#dfe6f2')
    s.badge(x + w + 4, y + 36 + 7 * 33 - 7, '2', 13)
    s.badge(x + w + 4, y + 36 + 8 * 33 - 7, '3', 13)
    end = legend(s, 474, [('1', T(lang, 'Auf irgendeine App-Kachel gehen und OK etwa 5–6 Sekunden gedrückt halten', 'Go to any app tile and hold OK for about 5–6 seconds')),
                          ('2', T(lang, 'IP Setting: Adresse des Computers eintragen (Schritt 7.1)', 'IP Setting: enter the computer’s address (step 7.1)')),
                          ('3', T(lang, 'Start User App Sync: App holen (Schritt 7.2, danach)', 'Start User App Sync: fetch the app (step 7.2, afterwards)')),
                          T(lang, 'Beide Einträge gibt es nur mit dem Benutzer develop. Sie bleiben auch im deutschen Menü englisch.',
                                  'Both entries only exist while signed in as develop. They are English on every TV.')])
    s.h = end + 6
    return s.render(T(lang, 'SAMSUNG APPS: Menü mit IP Setting und Start User App Sync', 'SAMSUNG APPS: menu with IP Setting and Start User App Sync'),
                    T(lang, 'Skizze: Bildschirm SAMSUNG APPS mit den Abschnitten EMPFOHLEN und EIGENE APPS. Auf einer App-Kachel wurde '
                            'OK lange gehalten; ein Menü zeigt Verschieben, Entfernen, Mehr löschen, Details anzeigen, Ansicht ändern, '
                            'Sperren/Sperre aus, Apps aktualisieren, IP Setting (markiert) und Start User App Sync.',
                      'Sketch: the SAMSUNG APPS screen with the sections RECOMMENDED and MY APPS. OK was held on an app tile; a '
                      'menu shows Move, Delete, Delete Multiple, View Details, Change View, Lock/Unlock, Update apps, IP Setting '
                      '(highlighted) and Start User App Sync.'))


def fig_tv_ip(lang):
    t = L[lang]
    s = Svg(800, 0)
    tv(s)
    apps_screen(s, t, sel_tile=0)
    dim(s, 0.6)
    x, y, w, h = 150, 96, 500, 250
    s.rect(x, y, w, h, '#2a3346', '#c9d3e6', 1.5, 6)
    s.text(x + w / 2, y + 42, 'Develop IP Setting', 21, '#ffffff', 'normal', 'middle')
    parts = PC_IP.split('.')
    bx = x + 52
    for i, p in enumerate(parts):
        xx = bx + i * 104
        if i == 3: focus(s, xx, y + 78, 84, 48, 4)
        else: s.rect(xx, y + 78, 84, 48, '#141a2c', '#9aa8c2', 1.5, 4)
        s.text(xx + 42, y + 111, p, 22, SAMSUNG_YELLOW if i == 3 else '#ffffff', 'bold', 'middle', MONO)
        if i < 3: s.text(xx + 94, y + 114, '.', 26, '#ffffff', 'bold', 'middle')
    s.badge(bx - 6, y + 78, '1', 13)
    s.rect(x + w / 2 - 50, y + 166, 100, 42, '#3c8fe8', '#ffffff', 2, 6)
    s.text(x + w / 2, y + 194, 'OK', 18, '#ffffff', 'bold', 'middle')
    s.badge(x + w / 2 - 50, y + 166, '2', 13)
    end = legend(s, 474, [('1', T(lang, 'Mit den Zahlentasten die Adresse von der Einrichtungsseite eintippen, je Kästchen ein Block;',
                                       'Type the address from the setup page with the number buttons, one block per box;')),
                          T(lang, '    ► springt zum nächsten Kästchen, ◄ zurück. Beispiel: ' + PC_IP,
                                  '    ► moves to the next box, ◄ goes back. Example: ' + PC_IP),
                          ('2', T(lang, 'OK wählen und OK drücken', 'Select OK and press OK')),
                          T(lang, 'Achtung: Die Kästchen sind beim Öffnen immer leer. Leeren Dialog nie mit OK bestätigen – RETURN bricht ab.',
                                  'Note: the boxes are always empty when the dialog opens. Never confirm it empty – RETURN cancels.')])
    s.h = end + 6
    return s.render('Develop IP Setting',
                    T(lang, 'Skizze: Dialog „Develop IP Setting“ mit vier Kästchen, in die gerade die Beispieladresse %s eingetippt '
                            'wird, darunter der Knopf OK.' % PC_IP,
                      'Sketch: the “Develop IP Setting” dialog with four boxes into which the example address %s is being typed, '
                      'and an OK button below.' % PC_IP))


def fig_tv_sync(lang):
    t = L[lang]
    s = Svg(800, 0)
    tv(s)
    apps_screen(s, t, sel_tile=0)
    dim(s, 0.6)
    x, y, w, h = 170, 130, 460, 190
    s.rect(x, y, w, h, '#2a3346', '#c9d3e6', 1.5, 6)
    s.text(x + w / 2, y + 74, 'User Apps Sync is requested', 21, '#ffffff', 'normal', 'middle')
    s.rect(x + w / 2 - 50, y + 112, 100, 42, '#3c8fe8', '#ffffff', 2, 6)
    s.text(x + w / 2, y + 140, 'OK', 18, '#ffffff', 'bold', 'middle')
    s.badge(x + w / 2 - 50, y + 112, '1', 13)
    end = legend(s, 474, [('1', T(lang, 'Nur EINMAL OK drücken. Dann 20–30 Sekunden warten.', 'Press OK ONCE only. Then wait 20–30 seconds.')),
                          T(lang, 'Die Meldung ist auch auf deutschen Fernsehern englisch. Bleibt danach das Menü offen: RETURN.',
                                  'The message is English on every TV. If the menu is still open afterwards: press RETURN.')])
    s.h = end + 6
    return s.render('User Apps Sync is requested',
                    T(lang, 'Skizze: Meldung „User Apps Sync is requested“ mit einem Knopf OK über dem Bildschirm SAMSUNG APPS.',
                      'Sketch: the message “User Apps Sync is requested” with an OK button on top of the SAMSUNG APPS screen.'))


def fig_tv_myapps(lang):
    t = L[lang]
    s = Svg(800, 0)
    tv(s)
    apps_screen(s, t, sel_tile=1, neo_tile=True)
    s.badge(164, 226, '1', 13)
    end = legend(s, 474, [('1', T(lang, 'Neolume steht unter EIGENE APPS – markieren und OK drücken', 'Neolume is under MY APPS – highlight it and press OK')),
                          T(lang, 'Nicht da? Smart Hub schließen und wieder öffnen oder den Fernseher kurz aus- und einschalten.',
                                  'Not there? Close and reopen Smart Hub, or switch the TV off and on.')])
    s.h = end + 6
    return s.render(T(lang, 'Neolume unter EIGENE APPS', 'Neolume under MY APPS'),
                    T(lang, 'Skizze: Bildschirm SAMSUNG APPS. Unter EIGENE APPS ist die Kachel „Neolume“ mit ihrem Symbol markiert '
                            '(dunkles Feld, Posterkarte mit türkisem Rahmen und Abspiel-Dreieck).',
                      'Sketch: the SAMSUNG APPS screen. Under MY APPS the “Neolume” tile with its icon is highlighted (dark square, '
                      'poster card with a turquoise frame and a play triangle).'))


def fig_tv_eco(lang):
    t = L[lang]
    s = Svg(800, 0)
    tv(s)
    # collapsed left menu (icons only), as on the TV
    s.rect(106, 74, 560, 330, 'none', '#c9d3e6', 1.5, 2, ' stroke-opacity="0.7"')
    for i, c in enumerate(['#e66f8f', '#9aa3ad', '#b7c0ca', '#3e8de0', '#7fcf9a', '#c9ced6', '#5cc27a']):
        if i == 5: s.rect(116, 92 + i * 42 - 14, 34, 32, 'none', '#ffffff', 2, 6)
        s.circle(133, 92 + i * 42 + 2, 10, c)
    blue_panel(s, 160, 66, 380, 350, t['eco'])
    for i, (lab, val) in enumerate(t['eco_rows']):
        panel_row(s, 184, 146 + i * 46, 330, lab, None if i == 3 else val, sel=(i == 3))
    s.badge(160, 138 + 3 * 46, '2', 13)
    # value list
    x, y = 400, 250
    s.rect(x, y, 200, 4 * 40 + 14, '#4a4f58', '#d0d4da', 1.5, 4)
    for i, v in enumerate(t['eco_vals']):
        yy = y + 34 + i * 40
        if i == 0: focus(s, x + 8, yy - 24, 184, 34)
        s.text(x + 30, yy, v, 17, SAMSUNG_YELLOW if i == 0 else '#ffffff', 'bold' if i == 0 else 'normal')
    s.badge(x + 200, y + 24, '3', 13)
    s.text(560, 112, T(lang, 'MENU → System →', 'MENU → System →'), 15, '#c9d3e6')
    s.text(560, 134, t['eco'], 15, '#c9d3e6', 'bold')
    s.badge(560 - 22, 106, '1', 11)
    end = legend(s, 474, [('1', T(lang, 'MENU → System → Öko-Lösung', 'MENU → System → Eco Solution')),
                          ('2', T(lang, '„Autom. Aussch.“ wählen (steht meist auf 4 Std.)', 'Choose “Auto Power Off” (usually set to 4 hours)')),
                          ('3', T(lang, '„Aus“ – oder eine längere Zeit – wählen', 'Choose “Off” – or a longer time')),
                          T(lang, 'Optional. Der Fernseher schaltet sich sonst nach 4 Stunden ohne Tastendruck ab – auch mitten im Film.',
                                  'Optional. Otherwise the TV switches off after 4 hours without a button press – even during a film.')])
    s.h = end + 6
    return s.render(T(lang, 'Öko-Lösung: automatisches Ausschalten', 'Eco Solution: Auto Power Off'),
                    T(lang, 'Skizze: Menü System → Öko-Lösung mit Energiesparmod. (Aus), Öko-Sensor (Aus), Kein Sig. Standby (Aus) '
                            'und Autom. Aussch. (markiert). Eine Auswahl zeigt Aus, 4 Std., 6 Stunden, 8 Std.; „Aus“ ist markiert.',
                      'Sketch: menu System → Eco Solution with Energy Saving Mode (Off), Eco Sensor (Off), No Signal Power Off '
                      '(Off) and Auto Power Off (highlighted). A list shows Off, 4 Hours, 6 Hours, 8 Hours; “Off” is highlighted.'))


def avatar(s, cx, cy, r, colors, sel=False, lock=False):
    if sel: s.circle(cx, cy, r + 8, 'none', TEAL, 5)
    s.circle(cx, cy, r, colors)
    if lock:
        s.circle(cx + r * 0.7, cy + r * 0.7, 15, '#16181b', '#d0d4da', 2)
        s.rect(cx + r * 0.7 - 6, cy + r * 0.7 - 2, 12, 9, '#ffffff', None, 0, 2)
        s.add('<path d="M%g %g v-4 a4 4 0 0 1 8 0 v4" fill="none" stroke="#ffffff" stroke-width="2"/>' % (cx + r * 0.7 - 4, cy + r * 0.7 - 2))


def fig_app_profiles(lang):
    s = Svg(800, 0)
    tv(s, app_screen=True)
    s.text(400, 92, T(lang, 'Wer schaut gerade?', 'Who’s watching?'), 26, '#f2f2f2', 'bold', 'middle')
    names = [('Alex', T(lang, 'Hauptkonto', 'Main account'), '#4d8fa6'), ('Sam', '', '#b0607a'),
             ('Jamie', T(lang, 'Teen', 'Teen'), '#4f9a85'), (T(lang, 'Kinder', 'Kids'), '', '#b8a24c')]
    for i, (n, sub, c) in enumerate(names):
        cx = 172 + i * 152
        avatar(s, cx, 172, 50, c, sel=(i == 0))
        s.text(cx, 250, n, 18, '#ffffff' if i == 0 else '#c4c7cc', 'bold', 'middle')
        if sub: s.text(cx, 271, sub, 14, '#a7abb2', 'normal', 'middle')
    # dialog
    x, y, w, h = 150, 300, 500, 132
    y = 304
    s.rect(x, y, w, h, '#22252a', '#5b6069', 1.5, 12)
    s.text(x + 24, y + 34, T(lang, 'Erwachsenenprofile schützen?', 'Protect adult profiles?'), 19, '#ffffff', 'bold')
    s.text(x + 24, y + 60, T(lang, 'Ohne PIN können Kinder in dein Profil wechseln …', 'Without a PIN, kids can switch to your profile …'), 15, '#c4c7cc')
    b1 = T(lang, 'Verstanden', 'Got it'); b2 = T(lang, 'Später erinnern', 'Remind me later')
    w1 = tw(b1, 16, True) + 36
    s.rect(x + 24, y + 80, w1, 36, '#2f3338', TEAL, 3, 8)
    s.text(x + 24 + w1 / 2, y + 104, b1, 16, '#ffffff', 'bold', 'middle')
    w2 = tw(b2, 16, True) + 36
    s.rect(x + 40 + w1, y + 80, w2, 36, '#2f3338', None, 0, 8)
    s.text(x + 40 + w1 + w2 / 2, y + 104, b2, 16, '#c4c7cc', 'bold', 'middle')
    s.badge(x, y, '2', 13)
    s.badge(172 - 60, 172 - 60, '1', 13)
    end = legend(s, 474, [('1', T(lang, 'Profilwahl: Profil markieren und OK. Profile mit Schloss fragen nach ihrer App-PIN.',
                                       'Profile picker: highlight a profile and press OK. Profiles with a lock ask for their app PIN.')),
                          ('2', T(lang, 'Nur wenn es ein Kinderprofil gibt und dein Profil noch keine PIN hat: Hinweis zur App-PIN.',
                                       'Only if there is a kids profile and your profile has no PIN yet: a note about the app PIN.')),
                          T(lang, 'Standard: Neolume startet direkt im Hauptprofil; die Profilwahl öffnest du über die Seitenleiste.',
                                  'Default: Neolume starts straight in the main profile; open the picker from the sidebar.'),
                          T(lang, 'Namen und Bilder sind Beispiele.', 'Names and pictures are examples.')])
    s.h = end + 6
    return s.render(T(lang, 'Neolume: Profilwahl', 'Neolume: profile picker'),
                    T(lang, 'Skizze der Profilwahl von Neolume: Überschrift „Wer schaut gerade?“, vier runde Profilbilder (Alex, '
                            'Hauptkonto, markiert; Sam; Jamie, Teen; Kinder). Darunter der Hinweis „Erwachsenenprofile schützen?“ mit '
                            'den Knöpfen „Verstanden“ und „Später erinnern“.',
                      'Sketch of the Neolume profile picker: heading “Who’s watching?”, four round profile pictures (Alex, main '
                      'account, highlighted; Sam; Jamie, Teen; Kids). Below, the note “Protect adult profiles?” with the buttons '
                      '“Got it” and “Remind me later”.'))


def fig_app_settings(lang):
    s = Svg(800, 0)
    tv(s, app_screen=True)
    # rail
    for i in range(8):
        s.circle(64, 74 + i * 38, 8, 'none', '#9da2a9', 2)
    s.circle(64, 400, 9, 'none', '#ffffff', 2)
    s.line(44, 390, 44, 410, '#ffffff', 3)
    s.text(110, 70, T(lang, 'Einstellungen', 'Settings'), 26, '#f2f2f2', 'bold')
    cats = T(lang, ['Wiedergabe', 'Ton & Untertitel', 'Anime', 'Startseite & Aussehen', 'Sprache & Bedienung', 'Live-TV & Entdecken',
                    'Bildschirmschoner', 'Profil & Konto', 'Hilfe & Diagnose'],
             ['Playback', 'Audio & subtitles', 'Anime', 'Home & appearance', 'Language & controls', 'Live TV & Discover',
              'Screensaver', 'Profile & account', 'Help & diagnostics'])
    sel = 5                                   # Live-TV & Entdecken (Kategorien seit 05.11.2026)
    for i, c in enumerate(cats):
        yy = 116 + i * 36
        if i == sel: s.line(110, yy - 16, 110, yy + 4, '#ffffff', 3)
        s.text(122, yy, c, 17, '#ffffff' if i == sel else '#a7abb2', 'bold' if i == sel else 'normal')
    s.badge(104, 116 + sel * 36 - 6, '1', 12)
    rows = [(T(lang, 'Entdecken in der Seitenleiste', 'Discover in the sidebar'), 'toggle'),
            (T(lang, 'Merkliste', 'Watchlist'), 'toggle'),
            (T(lang, 'Inspiration anpassen', 'Customize inspiration'), T(lang, '7 Reihen', '7 rows')),
            (T(lang, 'Nur Titel, die du noch nicht hast', 'Only titles you don’t have yet'), 'toggle')]
    x0, w = 330, 420
    s.bar(x0, 92, 160, 10, '#ffffff', 0.18)
    for i, (lab, val) in enumerate(rows):
        yy = 150 + i * 56
        if i == 1: s.rect(x0 - 10, yy - 30, w + 20, 46, '#2a2e33', TEAL, 3, 8)
        else: s.line(x0, yy + 16, x0 + w, yy + 16, '#2c3036', 1)
        s.text(x0 + 6, yy, lab, 17, '#ffffff', 'bold')
        if val == 'toggle':
            s.rect(x0 + w - 50, yy - 18, 44, 24, '#f2f2f2', None, 0, 12)
            s.circle(x0 + w - 18, yy - 6, 9, '#16181b')
        else:
            s.text(x0 + w - 6, yy, val, 16, '#c4c7cc', 'normal', 'end')
    s.badge(x0 - 10, 150 + 56 - 30, '2', 13)
    s.rect(x0 - 10, 372, w + 20, 52, '#1e2125', None, 0, 8)
    s.text(x0 + 6, 396, T(lang, 'Ohne Helfer steht bei „Merkliste“: Nicht eingerichtet', 'Without the helper, “Watchlist” says: Not set up'), 15, '#c4c7cc')
    s.text(x0 + 6, 414, T(lang, 'Helfer antwortet nicht: Zeile ist grau, mit Erklärung', 'Helper not answering: the row is grey, with a reason'), 15, '#c4c7cc')
    end = legend(s, 474, [('1', T(lang, 'In Neolume: Einstellungen → Live-TV & Entdecken', 'In Neolume: Settings → Live TV & Discover')),
                          ('2', T(lang, '„Merkliste“ lässt sich einschalten = der Fernseher hat den Helfer gefunden',
                                       '“Watchlist” can be switched on = the TV has found the helper'))])
    s.h = end + 6
    return s.render(T(lang, 'Neolume: Merkliste in den Einstellungen', 'Neolume: watchlist in Settings'),
                    T(lang, 'Skizze der Einstellungen von Neolume: links die Bereiche, „Live-TV & Entdecken“ gewählt. Rechts die Zeilen „Entdecken '
                            'in der Seitenleiste“, „Merkliste“ (markiert, eingeschaltet), „Inspiration anpassen“ und „Nur Titel, die du '
                            'noch nicht hast“. Hinweis: Ohne Helfer steht bei Merkliste „Nicht eingerichtet“.',
                      'Sketch of the Neolume settings: categories on the left, “Live TV & Discover” chosen. On the right the rows “Discover in '
                      'the sidebar”, “Watchlist” (highlighted, switched on), “Customize inspiration” and “Only titles you don’t '
                      'have yet”. Note: without the helper, Watchlist says “Not set up”.'))


# ---------------------------------------------------------------- setup program (browser)
UI = {'bg': '#f6f5f2', 'card': '#ffffff', 'fg': '#1d1d1f', 'muted': '#6b6b70', 'line': '#e3e1dc', 'soft': '#e6f7f5', 'ok': '#2f8a4a'}


def browser(s, w, h, url='127.0.0.1:32480'):
    s.rect(8, 8, w - 16, h - 16, UI['bg'], '#b9bec6', 2, 12)
    s.rect(8, 8, w - 16, 40, '#e8eaed', None, 0, 12)
    s.rect(8, 36, w - 16, 12, '#e8eaed')
    for i, c in enumerate(['#ff5f57', '#febc2e', '#28c840']):
        s.circle(32 + i * 20, 28, 6, c)
    s.rect(110, 16, 300, 24, '#ffffff', '#d0d4da', 1, 12)
    s.text(126, 33, url, 13, '#4b5563', 'normal', 'start', MONO)
    s.text(40, 84, APP + ' Setup', 20, UI['fg'], 'bold')


def steps_bar(s, lang, cur, y=104):
    names = T(lang, ['Anmelden', 'Server', 'Profile', 'Übersicht', 'Auf den Fernseher', 'Fertig'],
              ['Sign in', 'Server', 'Profiles', 'Summary', 'To the TV', 'Done'])
    x = 40
    for i, n in enumerate(names):
        lab = '%d. %s' % (i + 1, n)
        w = tw(lab, 12) + 20
        if i == cur:
            s.rect(x, y, w, 22, TEAL, None, 0, 11)
            s.text(x + 10, y + 15, lab, 12, UI['fg'])
        else:
            col = UI['ok'] if i < cur else UI['muted']
            s.rect(x, y, w, 22, 'none', col, 1, 11)
            s.text(x + 10, y + 15, lab, 12, col)
        x += w + 6


def checkbox(s, x, y, on=True):
    s.rect(x, y, 16, 16, TEAL if on else '#ffffff', '#8a8f98' if not on else TEAL, 1.5, 3)
    if on: s.add('<path d="M%g %g l4 4 l7 -8" fill="none" stroke="#1d1d1f" stroke-width="2.2"/>' % (x + 3.5, y + 8.5))


def button(s, x, y, label, primary=False, size=14):
    w = tw(label, size, primary) + 32
    s.rect(x, y, w, 34, TEAL if primary else '#ffffff', None if primary else UI['line'], 1, 8)
    s.text(x + w / 2, y + 22, label, size, UI['fg'], 'bold' if primary else 'normal', 'middle')
    return w


def fig_setup_summary(lang):
    W = 800
    s = Svg(W, 0)
    H = 746
    browser(s, W, H)
    steps_bar(s, lang, 3)
    x, y = 40, 140
    s.rect(x, y, W - 80, 586, UI['card'], UI['line'], 1, 12)
    s.text(x + 20, y + 34, T(lang, 'Übersicht', 'Summary'), 19, UI['fg'], 'bold')
    rows = [(T(lang, 'Server', 'Server'), 'Demo Server'), (T(lang, 'Adresse', 'Address'), 'http://192.168.1.10:32400'),
            (T(lang, 'Profile', 'Profiles'), 'Alex, Sam, Jamie, ' + T(lang, 'Kinder', 'Kids')), (T(lang, 'Apps auf dem TV', 'Apps on the TV'), APP)]
    for i, (k, v) in enumerate(rows):
        s.text(x + 20, y + 64 + i * 22, k, 13, UI['muted'])
        s.text(x + 170, y + 64 + i * 22, v, 13, UI['fg'])
    s.rect(x + 20, y + 152, W - 120, 40, UI['soft'], None, 0, 8)
    s.text(x + 32, y + 176, T(lang, 'Wichtig: Beim Aufspielen entfernt der Fernseher alle eigenen Apps, die nicht in der Liste stehen …',
                                    'Important: the TV removes every user app that is not on the list …'), 12, UI['fg'])
    yy = y + 206
    s.rect(x + 20, yy, W - 120, 40, '#ffffff', UI['line'], 1, 10)
    checkbox(s, x + 32, yy + 12, False)
    s.text(x + 58, yy + 25, T(lang, 'App-PINs zurücksetzen', 'Reset app PINs'), 13, UI['fg'], 'bold')
    s.text(x + 58 + tw(T(lang, 'App-PINs zurücksetzen', 'Reset app PINs'), 13, True) + 10, yy + 25,
           T(lang, '– nur bei vergessener PIN des Hauptprofils', '– only if you forgot the main profile’s PIN'), 12, UI['muted'])
    yy += 56
    s.text(x + 20, yy + 6, T(lang, 'Weitere Server (optional)', 'Other servers (optional)'), 14, UI['fg'], 'bold')
    s.bar(x + 20, yy + 16, 420, 8, UI['muted'], 0.35)
    button(s, x + 20, yy + 32, T(lang, 'Freigegebene Server suchen', 'Search shared servers'))
    yy += 82
    s.rect(x + 20, yy, W - 120, 66, '#ffffff', ORANGE, 2.5, 10)
    checkbox(s, x + 32, yy + 14, True)
    s.text(x + 58, yy + 27, T(lang, 'Helfer einrichten', 'Set up the helper'), 14, UI['fg'], 'bold')
    s.text(x + 58, yy + 48, T(lang, 'Optional: Merkliste und „Gerade beliebt“ / „Neu erschienen“ / „Bald verfügbar“ (Abschnitt 13)',
                              'Optional: watchlist and “Trending now” / “Just released” / “Coming soon” (section 13)'), 12, UI['muted'])
    s.badge(x + 20, yy, '1', 13)
    yy += 84
    s.text(x + 20, yy, '▾ ' + T(lang, 'Erweitert', 'Advanced'), 13, UI['muted'])
    checkbox(s, x + 32, yy + 12, True)
    s.text(x + 56, yy + 25, T(lang, 'Zugang auf diesem Computer merken (nötig für „Helfer dauerhaft installieren“)',
                              'Remember access on this computer (needed for “Install helper permanently”)'), 12, UI['fg'])
    s.text(x + 32, yy + 52, T(lang, 'Helfer läuft auf einem anderen Gerät, z. B. NAS (IP-Adresse, optional)',
                              'The helper runs on another device, e.g. a NAS (IP address, optional)'), 12, UI['fg'])
    s.rect(x + 32, yy + 60, 240, 26, '#ffffff', UI['line'], 1, 6)
    s.badge(x + 14, yy + 20, '2', 11)
    yy += 104
    bw = button(s, x + 20, yy, T(lang, 'Zurück', 'Back'))
    pw = button(s, x + 28 + bw, yy, T(lang, 'App-Paket erstellen', 'Create app package'), primary=True)
    s.badge(x + 28 + bw, yy, '3', 13)
    s.h = H
    end = legend(s, H + 4, [('1', T(lang, 'Nur für die Merkliste & Trends: „Helfer einrichten“ ankreuzen (sonst leer lassen)',
                                         'Only for watchlist & trends: tick “Set up the helper” (otherwise leave it)')),
                            ('2', T(lang, '„Zugang … merken“ angekreuzt lassen – sonst geht „dauerhaft installieren“ nicht',
                                         'Keep “Remember access …” ticked – needed to install the helper permanently')),
                            ('3', T(lang, '„App-Paket erstellen“ – danach geht es mit dem Fernseher weiter',
                                         '“Create app package” – then continue on the TV'))])
    s.h = end + 6
    return s.render(T(lang, 'Einrichtungsprogramm: Übersicht', 'Setup program: Summary'),
                    T(lang, 'Skizze der Seite „Übersicht“ im Einrichtungsprogramm: Server, Adresse, Profile, Apps; Kästchen „App-PINs '
                            'zurücksetzen“; Bereich „Weitere Server“ mit Knopf „Freigegebene Server suchen“; Kästchen „Helfer einrichten“ '
                            '(angekreuzt, hervorgehoben); unter „Erweitert“ „Zugang auf diesem Computer merken“ (angekreuzt) und ein Feld '
                            'für ein anderes Gerät; Knöpfe „Zurück“ und „App-Paket erstellen“.',
                      'Sketch of the “Summary” page of the setup program: server, address, profiles, apps; checkbox “Reset app '
                      'PINs”; “Other servers” with the button “Search shared servers”; checkbox “Set up the helper” (ticked, '
                      'highlighted); under “Advanced” “Remember access on this computer” (ticked) and a field for another device; '
                      'buttons “Back” and “Create app package”.'))


def fig_setup_tv(lang):
    W = 800
    s = Svg(W, 0)
    H = 560
    browser(s, W, H)
    steps_bar(s, lang, 4)
    x, y = 40, 140
    s.rect(x, y, W - 80, 400, UI['card'], UI['line'], 1, 12)
    s.text(x + 20, y + 34, T(lang, 'App auf den Fernseher spielen', 'Install the app on the TV'), 19, UI['fg'], 'bold')
    s.text(x + 20, y + 60, T(lang, 'Lass dieses Fenster offen und mach am Fernseher (Samsung 2014, H-Serie):',
                             'Keep this window open and do this on the TV (Samsung 2014, H series):'), 13, UI['fg'])
    for i in range(3):
        s.text(x + 24, y + 86 + i * 20, '%d.' % (i + 1), 13, UI['muted'])
        s.bar(x + 44, y + 77 + i * 20, [380, 220, 330][i], 8, UI['muted'], 0.3)
    s.text(x + 24, y + 146, '4.', 13, UI['muted'])
    s.text(x + 44, y + 146, T(lang, 'IP Setting → diese Adresse eingeben:', 'IP Setting → enter this address:'), 13, UI['fg'])
    s.text(x + 44, y + 184, PC_IP, 30, UI['fg'], 'bold', 'start', MONO)
    s.rect(x + 36, y + 154, 290, 42, 'none', ORANGE, 2.5, 8)
    s.badge(x + 36, y + 154, '1', 13)
    for i in range(2):
        s.text(x + 24, y + 220 + i * 20, '%d.' % (i + 5), 13, UI['muted'])
        s.bar(x + 44, y + 211 + i * 20, [400, 300][i], 8, UI['muted'], 0.3)
    s.text(x + 20, y + 268, T(lang, 'Bereit – der Fernseher kann die App jetzt abholen.', 'Ready – the TV can fetch the app now.'), 13, UI['fg'])
    s.rect(x + 20, y + 278, W - 120, 58, UI['bg'], None, 0, 8)
    l1 = T(lang, '20:15:02  Fernseher %s hat widgetlist.xml abgeholt' % TV_IP, '20:15:02  TV %s fetched widgetlist.xml' % TV_IP)
    l2 = T(lang, '20:15:09  Fernseher %s hat %s.zip abgeholt' % (TV_IP, APP), '20:15:09  TV %s fetched %s.zip' % (TV_IP, APP))
    s.text(x + 32, y + 300, l1, 12, UI['ok'], 'normal', 'start', MONO)
    s.text(x + 32, y + 322, l2, 12, UI['ok'], 'normal', 'start', MONO)
    s.badge(x + 20, y + 278, '2', 13)
    bw = button(s, x + 20, y + 350, T(lang, 'Zurück', 'Back'))
    bw2 = button(s, x + 28 + bw, y + 350, T(lang, 'Sync-Server stoppen', 'Stop sync server'))
    button(s, x + 36 + bw + bw2, y + 350, T(lang, 'Die App ist auf dem Fernseher', 'The app is on the TV'), primary=True)
    s.badge(x + 36 + bw + bw2, y + 350, '3', 13)
    s.h = H
    end = legend(s, H + 4, [('1', T(lang, 'Diese Adresse am Fernseher unter „IP Setting“ eintragen', 'Enter this address on the TV under “IP Setting”')),
                            ('2', T(lang, 'Nach „Start User App Sync“ erscheinen diese zwei Zeilen = Erfolg', 'After “Start User App Sync” these two lines appear = success')),
                            ('3', T(lang, 'Danach weiter zu „Fertig“', 'Then go on to “Done”')),
                            T(lang, 'Adressen und Uhrzeiten sind Beispiele.', 'Addresses and times are examples.')])
    s.h = end + 6
    return s.render(T(lang, 'Einrichtungsprogramm: Auf den Fernseher', 'Setup program: To the TV'),
                    T(lang, 'Skizze der Seite „Auf den Fernseher“: Anleitung in sechs Schritten, bei Schritt 4 die Adresse des Computers '
                            'groß (Beispiel %s). Darunter das Protokoll: „Fernseher … hat widgetlist.xml abgeholt“ und „… hat Neolume.zip '
                            'abgeholt“. Knöpfe „Zurück“, „Sync-Server stoppen“ und „Die App ist auf dem Fernseher“.' % PC_IP,
                      'Sketch of the “To the TV” page: six steps, at step 4 the computer’s address in large digits (example %s). '
                      'Below, the log: “TV … fetched widgetlist.xml” and “TV … fetched Neolume.zip”. Buttons “Back”, “Stop sync '
                      'server” and “The app is on the TV”.' % PC_IP))


def helper_card_head(s, lang, x, y, w):
    s.rect(x, y, w, 0, UI['card'])
    s.text(x + 20, y + 34, T(lang, 'Optionaler Helfer: Merkliste & Trends', 'Optional helper: watchlist & trends'), 19, UI['fg'], 'bold')
    s.bar(x + 20, y + 50, w - 80, 8, UI['muted'], 0.3)
    s.bar(x + 20, y + 66, w - 200, 8, UI['muted'], 0.3)
    s.text(x + 20, y + 96, '▸ ' + T(lang, 'Was macht der Helfer genau?', 'What exactly does the helper do?'), 13, UI['muted'])
    s.text(x + 20, y + 122, T(lang, 'Merkliste für: Alex, Sam, Jamie', 'Watchlist for: Alex, Sam, Jamie'), 13, UI['fg'])


def fig_setup_helper(lang):
    W = 800
    s = Svg(W, 0)
    H = 560
    browser(s, W, H)
    x, y, w = 40, 104, W - 80
    s.rect(x, y, w, 436, UI['card'], UI['line'], 1, 12)
    helper_card_head(s, lang, x, y, w)
    s.text(x + 20, y + 150, T(lang, 'Helfer ist aus. Merkliste und Trends erscheinen am Fernseher nur, solange er läuft.',
                              'The helper is off. The TV shows the watchlist and trends only while it runs.'), 13, UI['muted'])
    bw = button(s, x + 20, y + 162, T(lang, 'Helfer starten', 'Start helper'))
    s.badge(x + 20, y + 162, '1', 12)
    ny = y + 212
    s.rect(x + 20, ny, w - 40, 162, UI['soft'], None, 0, 8)
    s.text(x + 34, ny + 26, T(lang, 'Dauerhaft im Hintergrund', 'Permanently in the background'), 14, UI['fg'], 'bold')
    s.text(x + 34, ny + 48, T(lang, 'Startet den Helfer automatisch, sobald du dich an diesem Computer anmeldest.',
                              'Starts the helper automatically whenever you log in to this computer.'), 12, UI['fg'])
    checkbox(s, x + 34, ny + 62, True)
    s.text(x + 58, ny + 75, T(lang, 'Symbol in der Menüleiste zeigen  (Windows: … im Infobereich der Taskleiste zeigen)',
                              'Show icon in the menu bar  (Windows: … in the taskbar notification area)'), 12, UI['fg'])
    s.badge(x + 14, ny + 70, '2', 11)
    pw = button(s, x + 34, ny + 106, T(lang, 'Helfer dauerhaft installieren', 'Install helper permanently'), primary=True)
    s.badge(x + 34, ny + 106, '3', 13)
    button(s, x + 20, y + 388, T(lang, 'Helfer entfernen …', 'Remove helper …'))
    s.h = H
    end = legend(s, H + 4, [('1', T(lang, '„Helfer starten“: zum Ausprobieren – läuft, solange das Programm offen ist',
                                         '“Start helper”: to try it – runs while the program is open')),
                            ('2', T(lang, 'Symbol zeigen (Mac: Menüleiste, Windows: neben der Uhr) – kann später aus',
                                         'Show the icon (Mac: menu bar, Windows: next to the clock) – can be changed later')),
                            ('3', T(lang, '„Helfer dauerhaft installieren“: startet ab jetzt bei jeder Anmeldung von selbst',
                                         '“Install helper permanently”: from now on it starts by itself at every login'))])
    s.h = end + 6
    return s.render(T(lang, 'Helfer-Karte: dauerhaft installieren', 'Helper card: install permanently'),
                    T(lang, 'Skizze der Karte „Optionaler Helfer: Merkliste & Trends“ im Einrichtungsprogramm: Text, „Merkliste für“, '
                            'Knopf „Helfer starten“; im Kasten „Dauerhaft im Hintergrund“ das Kästchen „Symbol in der Menüleiste zeigen“ '
                            '(angekreuzt) und der Knopf „Helfer dauerhaft installieren“; unten „Helfer entfernen …“.',
                      'Sketch of the card “Optional helper: watchlist & trends” in the setup program: text, “Watchlist for”, button '
                      '“Start helper”; in the box “Permanently in the background” the checkbox “Show icon in the menu bar” (ticked) '
                      'and the button “Install helper permanently”; at the bottom “Remove helper …”.'))


def fig_setup_helper_done(lang):
    W = 800
    s = Svg(W, 0)
    H = 690
    browser(s, W, H)
    x, y, w = 40, 104, W - 80
    s.rect(x, y, w, 566, UI['card'], UI['line'], 1, 12)
    helper_card_head(s, lang, x, y, w)
    ny = y + 140
    s.rect(x + 20, ny, w - 40, 220, UI['soft'], None, 0, 8)
    s.text(x + 34, ny + 26, T(lang, 'Dauerhaft im Hintergrund', 'Permanently in the background'), 14, UI['fg'], 'bold')
    s.text(x + 34, ny + 50, T(lang, 'Dauerhaft installiert – startet bei jeder Anmeldung an diesem Mac.',
                              'Installed permanently – starts every time you log in to this Mac.'), 12, UI['fg'])
    s.text(x + 34, ny + 70, T(lang, 'Name in macOS: „Neolume Helfer“ – Systemeinstellungen → Allgemein → Anmeldeobjekte & Erweiterungen',
                              'Name in macOS: “Neolume Helper” – System Settings → General → Login Items & Extensions'), 12, UI['muted'])
    s.text(x + 34, ny + 98, T(lang, 'Läuft im Hintergrund (Port 32499, nur Heimnetz).', 'Running in the background (port 32499, home network only).'), 13, UI['ok'], 'bold')
    s.badge(x + 14, ny + 93, '1', 11)
    checkbox(s, x + 34, ny + 112, True)
    s.text(x + 58, ny + 125, T(lang, 'Symbol in der Menüleiste zeigen', 'Show icon in the menu bar'), 12, UI['fg'])
    s.badge(x + 14, ny + 120, '2', 11)
    b1 = button(s, x + 34, ny + 140, T(lang, 'Beenden', 'Stop'))
    button(s, x + 42 + b1, ny + 140, T(lang, 'Autostart ausschalten', 'Turn autostart off'))
    s.text(x + 34, ny + 202, T(lang, 'Protokoll:', 'Log:'), 12, UI['muted'])
    s.text(x + 34 + tw(T(lang, 'Protokoll:', 'Log:'), 12) + 8, ny + 202, '…/NeolumeSetup/helper.log', 12, UI['fg'], 'normal', 'start', MONO)
    ry = ny + 234
    b = button(s, x + 20, ry, T(lang, 'Helfer entfernen …', 'Remove helper …'))
    s.badge(x + 20, ry, '4', 12)
    ry += 46
    s.rect(x + 20, ry, w - 40, 112, UI['bg'], None, 0, 8)
    s.text(x + 32, ry + 22, T(lang, 'Ergebnis: Helfer dauerhaft installieren:', 'Result: Install the helper permanently:'), 12, UI['fg'], 'bold')
    lines = T(lang, ['Programmkopie angelegt: …/NeolumeSetup/bin/neolume-setup', 'Helfer-App „Neolume Helfer“ angelegt (im selben Ordner).',
                     'Autostart eingerichtet (startet bei jeder Anmeldung)', 'Helfer läuft jetzt im Hintergrund (Port 32499, nur Heimnetz).'],
              ['Program copy created: …/NeolumeSetup/bin/neolume-setup', 'Helper app “Neolume Helper” created (in the same folder).',
               'Autostart set up (starts every time you log in)', 'The helper is now running in the background (port 32499, home network only).'])
    for i, l in enumerate(lines):
        s.text(x + 32, ry + 44 + i * 19, l, 12, UI['ok'], 'normal', 'start', MONO)
    s.badge(x + 20, ry, '3', 12)
    s.h = H
    end = legend(s, H + 4, [('1', T(lang, 'Grün „Läuft im Hintergrund“ = alles in Ordnung', 'Green “Running in the background” = all good')),
                            ('2', T(lang, 'Symbol zeigen oder ausblenden (der Helfer läuft so oder so)', 'Show or hide the icon (the helper runs either way)')),
                            ('3', T(lang, 'Ergebnis: was auf deinem Computer angelegt wurde (Beispiel: Mac)', 'Result: what was created on your computer (example: Mac)')),
                            ('4', T(lang, 'Alles wieder entfernen (Abschnitt 13.7)', 'Remove everything again (section 13.7)'))])
    s.h = end + 6
    return s.render(T(lang, 'Helfer-Karte: dauerhaft installiert', 'Helper card: installed permanently'),
                    T(lang, 'Skizze der Helfer-Karte nach dem Installieren auf einem Mac: „Dauerhaft installiert“, Name in macOS, grün '
                            '„Läuft im Hintergrund (Port 32499, nur Heimnetz)“, Kästchen für das Symbol, Knöpfe „Beenden“ und „Autostart '
                            'ausschalten“, Pfad des Protokolls, Knopf „Helfer entfernen …“ und die Ergebnisliste.',
                      'Sketch of the helper card after installing on a Mac: “Installed permanently”, name in macOS, green “Running in '
                      'the background (port 32499, home network only)”, checkbox for the icon, buttons “Stop” and “Turn autostart '
                      'off”, log path, button “Remove helper …” and the result list.'))


# ---------------------------------------------------------------- helper icon menu, macOS / Windows prompts
def tray_glyph(s, x, y, size, color):
    """The helper's tray icon: a small TV with a dot (tray.icon_pixels)."""
    k = size / 24.0
    s.add('<g transform="translate(%g %g) scale(%g)" fill="none" stroke="%s" stroke-width="2">'
          '<rect x="3" y="4.5" width="18" height="12.5" rx="1"/><line x1="12" y1="17" x2="12" y2="19.5"/>'
          '<line x1="7.5" y1="20" x2="16.5" y2="20"/><circle cx="12" cy="10.7" r="2.4" fill="%s" stroke="none"/></g>' % (x, y, k, color, color))


def tray_items(lang):
    return T(lang, ['Helfer läuft (Port 32499, nur Heimnetz)', 'plex.tv: erreichbar', 'Fernseher zuletzt gesehen: heute 20:15', '-',
                    'Pausieren', 'Einrichtungsprogramm öffnen …', 'Was macht der Helfer?', '-', 'Helfer beenden', 'Helfer entfernen …'],
             ['Helper running (port 32499, home network only)', 'plex.tv: reachable', 'TV last seen: today 20:15', '-',
              'Pause', 'Open setup program …', 'What does the helper do?', '-', 'Quit helper', 'Remove helper …'])


def draw_menu(s, x, y, w, items, row=26, dark=False):
    h = 12 + sum(9 if i == '-' else row for i in items)
    s.rect(x, y, w, h, '#2b2b2e' if dark else '#f7f7f8', '#9da3ab', 1, 8 if not dark else 4)
    yy = y + 8
    for i, it in enumerate(items):
        if it == '-':
            s.line(x + 10, yy + 4, x + w - 10, yy + 4, '#55585e' if dark else '#d6d8dc', 1); yy += 9; continue
        status = i < 3
        s.text(x + 16, yy + 18, it, 14, ('#9aa0a8' if status else '#f2f2f2') if dark else ('#7a7f87' if status else '#1d1d1f'))
        yy += row
    return h


def fig_tray_mac(lang):
    W = 800
    s = Svg(W, 0)
    s.rect(8, 8, W - 16, 410, '#3b5f8a', '#d5d9e0', 3, 12)       # desktop picture
    s.add('<path d="M10 300 Q 200 220 400 290 T 790 260 L790 416 L10 416 Z" fill="#2c4a6e"/>')
    s.rect(10, 10, W - 20, 30, '#ececec', None, 0, 10)
    s.rect(10, 28, W - 20, 12, '#ececec')
    s.text(32, 31, 'Finder', 14, '#1d1d1f', 'bold')
    s.text(W - 40, 31, '20:15', 14, '#1d1d1f', 'normal', 'end')
    for i in range(3): s.circle(W - 160 + i * 24, 25, 7, '#7a7f87')
    s.rect(W - 222, 13, 30, 24, '#c9ccd1', None, 0, 5)
    tray_glyph(s, W - 219, 13, 24, '#1d1d1f')
    s.badge(W - 236, 25, '1', 11)
    items = tray_items(lang)
    s.add('<g>')
    draw_menu(s, W - 452, 44, 380, items)
    s.add('</g>')
    s.badge(W - 460, 70, '2', 11)
    s.badge(W - 460, 166, '3', 11)
    s.h = 420
    end = legend(s, 424, [('1', T(lang, 'Das Fernseher-Symbol des Helfers oben rechts in der Menüleiste anklicken', 'Click the helper’s TV icon at the top right of the menu bar')),
                          ('2', T(lang, 'Die drei grauen Zeilen zeigen den Zustand: läuft? plex.tv erreichbar? Fernseher zuletzt?', 'The three grey lines show the state: running? plex.tv reachable? TV last seen?')),
                          ('3', T(lang, 'Pausieren, Einrichtungsprogramm öffnen, Erklärung, Beenden, Entfernen', 'Pause, open setup program, explanation, quit, remove')),
                          T(lang, 'Uhrzeit ist ein Beispiel. „Fernseher: noch nicht gesehen“ ist normal, bis die App Merkliste oder Trends öffnet.',
                                  'The time is an example. “TV: not seen yet” is normal until the app opens the watchlist or trends.')])
    s.h = end + 6
    return s.render(T(lang, 'Helfer-Symbol in der Mac-Menüleiste', 'Helper icon in the Mac menu bar'),
                    T(lang, 'Skizze der Mac-Menüleiste mit dem Fernseher-Symbol des Helfers und seinem geöffneten Menü: „Helfer läuft (Port '
                            '32499, nur Heimnetz)“, „plex.tv: erreichbar“, „Fernseher zuletzt gesehen: heute 20:15“, dann Pausieren, '
                            'Einrichtungsprogramm öffnen …, Was macht der Helfer?, Helfer beenden, Helfer entfernen ….',
                      'Sketch of the Mac menu bar with the helper’s TV icon and its open menu: “Helper running (port 32499, home '
                      'network only)”, “plex.tv: reachable”, “TV last seen: today 20:15”, then Pause, Open setup program …, What does the '
                      'helper do?, Quit helper, Remove helper ….'))


def fig_tray_win(lang):
    W = 800
    s = Svg(W, 0)
    s.rect(8, 8, W - 16, 410, '#2f5d8a', '#d5d9e0', 3, 12)
    s.add('<path d="M10 260 Q 250 180 420 250 T 790 220 L790 370 L10 370 Z" fill="#244a70"/>')
    s.rect(10, 370, W - 20, 46, '#202124', None, 0, 0)
    s.rect(10, 404, W - 20, 12, '#202124', None, 0, 10)
    for i in range(5): s.rect(330 + i * 34, 380, 24, 24, '#4a4d52', None, 0, 5)
    s.text(W - 220, 398, '^', 18, '#ffffff', 'normal', 'middle')
    s.rect(W - 202, 378, 30, 30, '#3a3d42', None, 0, 5)
    tray_glyph(s, W - 199, 381, 24, '#ffffff')
    s.text(W - 30, 390, '20:15', 12, '#ffffff', 'normal', 'end')
    s.text(W - 30, 406, '28.10.2026', 12, '#ffffff', 'normal', 'end')
    s.badge(W - 220, 372, '1', 11)
    items = tray_items(lang)
    h = 12 + sum(9 if i == '-' else 26 for i in items)
    draw_menu(s, W - 470, 366 - h, 360, items, dark=True)
    s.badge(W - 478, 366 - h + 22, '2', 11)
    s.h = 420
    end = legend(s, 424, [('1', T(lang, 'Fernseher-Symbol neben der Uhr – evtl. erst unter dem Pfeil ^ (dorthin ziehen, damit es bleibt)',
                                       'TV icon next to the clock – maybe under the arrow ^ first (drag it out so it stays)')),
                          ('2', T(lang, 'Klick (rechts oder links) öffnet dasselbe Menü wie auf dem Mac', 'Clicking it (right or left) opens the same menu as on the Mac'))])
    s.h = end + 6
    return s.render(T(lang, 'Helfer-Symbol in der Windows-Taskleiste', 'Helper icon in the Windows taskbar'),
                    T(lang, 'Skizze der Windows-Taskleiste: rechts neben dem Pfeil ^ das Fernseher-Symbol des Helfers, darüber sein Menü '
                            'mit Zustandszeilen und den Einträgen Pausieren, Einrichtungsprogramm öffnen …, Was macht der Helfer?, Helfer beenden, '
                            'Helfer entfernen ….',
                      'Sketch of the Windows taskbar: next to the arrow ^ the helper’s TV icon, above it its menu with status lines and '
                      'the entries Pause, Open setup program …, What does the helper do?, Quit helper, Remove helper ….'))


def app_square(s, x, y, size):
    """Helper app icon (tray.app_icon_pixels): white TV glyph on a rounded teal square."""
    s.rect(x, y, size, size, TEAL, None, 0, size * 0.22)
    tray_glyph(s, x + size * 0.19, y + size * 0.19, size * 0.62, '#ffffff')


def fig_mac_background(lang):
    W = 800
    s = Svg(W, 0)
    s.rect(8, 8, W - 16, 380, '#3b5f8a', '#d5d9e0', 3, 12)
    # notification
    x, y, w = 360, 34, 410
    s.rect(x, y, w, 92, '#f4f4f6', '#c7cad0', 1, 16)
    s.rect(x + 16, y + 18, 40, 40, '#8e9298', None, 0, 9)
    s.add('<g transform="translate(%g %g)" fill="#ffffff"><circle cx="20" cy="20" r="9"/><rect x="18" y="5" width="4" height="30" rx="2"/>'
          '<rect x="5" y="18" width="30" height="4" rx="2"/></g>' % (x + 16, y + 18))
    s.text(x + 70, y + 32, T(lang, 'Hintergrundobjekte hinzugefügt', 'Background Items Added'), 15, '#1d1d1f', 'bold')
    s.text(x + 70, y + 54, T(lang, '„Neolume Helfer“ ist ein Objekt, das im', '“Neolume Helper” is an item that can'), 13, '#3a3a3c')
    s.text(x + 70, y + 72, T(lang, 'Hintergrund ausgeführt werden kann. …', 'run in the background. …'), 13, '#3a3a3c')
    s.badge(x, y, '1', 13)
    # System Settings window
    x2, y2, w2, h2 = 40, 150, 560, 222
    s.rect(x2, y2, w2, h2, '#ffffff', '#c7cad0', 1, 12)
    for i, c in enumerate(['#ff5f57', '#febc2e', '#28c840']): s.circle(x2 + 20 + i * 18, y2 + 20, 6, c)
    s.text(x2 + 90, y2 + 25, T(lang, 'Anmeldeobjekte & Erweiterungen', 'Login Items & Extensions'), 15, '#1d1d1f', 'bold')
    s.text(x2 + 20, y2 + 62, T(lang, 'Im Hintergrund erlauben', 'Allow in the Background'), 13, '#6b6b70', 'bold')
    s.rect(x2 + 16, y2 + 72, w2 - 32, 120, '#f5f5f7', '#e0e0e3', 1, 8)
    s.bar(x2 + 70, y2 + 92, 160, 10, '#6b6b70', 0.3)
    s.line(x2 + 16, y2 + 112, x2 + w2 - 16, y2 + 112, '#e0e0e3', 1)
    app_square(s, x2 + 28, y2 + 120, 32)
    s.text(x2 + 72, y2 + 134, T(lang, 'Neolume Helfer', 'Neolume Helper'), 14, '#1d1d1f', 'bold')
    s.text(x2 + 72, y2 + 152, T(lang, 'Objekt eines unbekannten Entwicklers', 'Item from unidentified developer'), 12, '#6b6b70')
    s.rect(x2 + w2 - 74, y2 + 128, 40, 22, '#34c759', None, 0, 11)
    s.circle(x2 + w2 - 45, y2 + 139, 9, '#ffffff')
    s.rect(x2 + 20, y2 + 116, w2 - 40, 44, 'none', ORANGE, 2.5, 8)
    s.badge(x2 + 20, y2 + 116, '2', 13)
    s.h = 390
    end = legend(s, 394, [('1', T(lang, 'Diese Mitteilung kommt direkt nach dem Installieren – sie ist gewollt (Autostart ist eingerichtet)',
                                       'This notice appears right after installing – it is expected (autostart is set up)')),
                          ('2', T(lang, 'Systemeinstellungen → Allgemein → Anmeldeobjekte & Erweiterungen: hier ein- oder ausschalten',
                                       'System Settings → General → Login Items & Extensions: switch it on or off here')),
                          T(lang, 'Neuere macOS-Versionen zeigen die Liste unter „App-Hintergrundaktivitäten“.',
                                  'Newer macOS versions show the list under “Background App Activity”.')])
    s.h = end + 6
    return s.render(T(lang, 'macOS: Hintergrundobjekte hinzugefügt', 'macOS: Background Items Added'),
                    T(lang, 'Skizze: macOS-Mitteilung „Hintergrundobjekte hinzugefügt – „Neolume Helfer“ ist ein Objekt, das im Hintergrund '
                            'ausgeführt werden kann“. Darunter das Fenster „Anmeldeobjekte & Erweiterungen“ mit dem Eintrag „Neolume Helfer“ '
                            '(türkises Symbol, „Objekt eines unbekannten Entwicklers“, Schalter an).',
                      'Sketch: macOS notice “Background Items Added – “Neolume Helper” is an item that can run in the background”. '
                      'Below, the “Login Items & Extensions” window with the entry “Neolume Helper” (teal icon, “Item from '
                      'unidentified developer”, switch on).'))


def fig_win_firewall(lang):
    W = 800
    s = Svg(W, 0)
    s.rect(8, 8, W - 16, 380, '#2f5d8a', '#d5d9e0', 3, 12)
    x, y, w, h = 110, 30, 580, 336
    s.rect(x, y, w, h, '#ffffff', '#9da3ab', 1, 8)
    s.rect(x, y, w, 34, '#f3f3f3', None, 0, 8)
    s.text(x + 16, y + 22, T(lang, 'Windows-Sicherheit', 'Windows Security'), 13, '#1d1d1f')
    s.text(x + w - 18, y + 22, '✕', 13, '#1d1d1f', 'normal', 'end')
    s.add('<path d="M%g %g l18 -6 l18 6 v14 c0 12 -9 18 -18 22 c-9 -4 -18 -10 -18 -22 z" fill="#0067c0"/>' % (x + 24, y + 62))
    t1 = T(lang, ['Möchten Sie öffentlichen und privaten Netzwerken den', 'Zugriff auf diese App gestatten?'],
           ['Do you want to allow public and private networks', 'to access this app?'])
    for i, l in enumerate(t1): s.text(x + 72, y + 74 + i * 26, l, 19, '#1d1d1f', 'bold')
    rows = [(T(lang, 'Name', 'Name'), 'Neolume Setup & Helper'), (T(lang, 'Herausgeber', 'Publisher'), 'Neolume'),
            (T(lang, 'Pfad', 'Path'), 'C:\\Users\\…\\NeolumeSetup\\bin\\neolume-helper.exe')]
    for i, (k, v) in enumerate(rows):
        s.text(x + 72, y + 150 + i * 28, k, 14, '#5c5f66')
        s.text(x + 190, y + 150 + i * 28, v, 14, '#1d1d1f', 'bold' if i == 0 else 'normal')
    s.rect(x + 184, y + 130, 230, 28, 'none', ORANGE, 2, 6)
    s.badge(x + 414, y + 144, '1', 12)
    s.rect(x, y + h - 70, w, 70, '#f3f3f3', None, 0, 8)
    s.rect(x + w - 300, y + h - 52, 132, 34, '#0067c0', None, 0, 5)
    s.text(x + w - 234, y + h - 30, T(lang, 'Zulassen', 'Allow'), 14, '#ffffff', 'bold', 'middle')
    s.rect(x + w - 156, y + h - 52, 132, 34, '#ffffff', '#c7cad0', 1, 5)
    s.text(x + w - 90, y + h - 30, T(lang, 'Abbrechen', 'Cancel'), 14, '#1d1d1f', 'normal', 'middle')
    s.badge(x + w - 300, y + h - 52, '2', 13)
    s.h = 390
    end = legend(s, 394, [('1', T(lang, 'Hier steht der Name des Programms: „Neolume Setup & Helper“ (.pyz-Datei: „Python“)',
                                       'The program’s name: “Neolume Setup & Helper” (.pyz file: “Python”)')),
                          ('2', T(lang, '„Zulassen“ klicken – sonst erreicht der Fernseher den Computer nicht',
                                       'Click “Allow” – otherwise the TV cannot reach the computer')),
                          T(lang, 'Kommt beim ersten Start des Einrichtungsprogramms und einmal nach „Helfer dauerhaft installieren“',
                                  'Appears at the first start of the setup program and once after “Install helper permanently”'),
                          T(lang, '(unter „Pfad“ steht jeweils die Datei, die gerade startet). Ältere Windows-Versionen: „Private Netzwerke“',
                                  '(“Path” shows the file that is starting). Older Windows: tick “Private networks” → “Allow access”.'),
                          T(lang, 'ankreuzen → „Zugriff zulassen“.', '')])
    s.h = end + 6
    return s.render(T(lang, 'Windows: Firewall-Frage', 'Windows: firewall prompt'),
                    T(lang, 'Skizze der Windows-Sicherheit-Frage „Möchten Sie öffentlichen und privaten Netzwerken den Zugriff auf diese '
                            'App gestatten?“ mit Name „Neolume Setup & Helper“, Herausgeber „Neolume“, Pfad zu neolume-helper.exe und den '
                            'Knöpfen „Zulassen“ (hervorgehoben) und „Abbrechen“.',
                      'Sketch of the Windows Security prompt “Do you want to allow public and private networks to access this app?” '
                      'with name “Neolume Setup & Helper”, publisher “Neolume”, the path to neolume-helper.exe and the buttons '
                      '“Allow” (highlighted) and “Cancel”.'))


def fig_win_startup(lang):
    W = 800
    s = Svg(W, 0)
    x, y, w, h = 8, 8, W - 16, 300
    s.rect(x, y, w, h, '#ffffff', '#9da3ab', 1.5, 10)
    s.rect(x, y, w, 36, '#f3f3f3', None, 0, 10)
    s.rect(x, y + 26, w, 10, '#f3f3f3')
    s.text(x + 16, y + 24, T(lang, 'Task-Manager', 'Task Manager'), 13, '#1d1d1f')
    s.rect(x, y + 36, 170, h - 36, '#f7f7f7')
    side = T(lang, ['Prozesse', 'Leistung', 'App-Verlauf', 'Autostart von Apps', 'Benutzer', 'Details', 'Dienste'],
             ['Processes', 'Performance', 'App history', 'Startup apps', 'Users', 'Details', 'Services'])
    for i, n in enumerate(side):
        yy = y + 66 + i * 32
        if i == 3:
            s.rect(x + 8, yy - 18, 154, 28, '#e5eef9', None, 0, 5)
            s.line(x + 10, yy - 12, x + 10, yy + 4, '#0067c0', 3)
        s.text(x + 22, yy, n, 13, '#1d1d1f', 'bold' if i == 3 else 'normal')
    s.badge(x + 160, y + 66 + 3 * 32 - 5, '1', 11)
    tx = x + 190
    s.text(tx, y + 66, T(lang, 'Autostart von Apps', 'Startup apps'), 17, '#1d1d1f', 'bold')
    cols = T(lang, ['Name', 'Herausgeber', 'Status', 'Startauswirkungen'], ['Name', 'Publisher', 'Status', 'Startup impact'])
    cx = [tx, tx + 230, tx + 360, tx + 460]
    for c, xx in zip(cols, cx): s.text(xx, y + 102, c, 12, '#5c5f66')
    s.line(tx, y + 110, x + w - 16, y + 110, '#e0e0e3', 1)
    s.bar(tx + 30, y + 128, 120, 9, '#6b6b70', 0.3); s.bar(cx[1], y + 128, 70, 9, '#6b6b70', 0.3)
    s.text(cx[2], y + 137, T(lang, 'Aktiviert', 'Enabled'), 13, '#1d1d1f')
    ry = y + 160
    s.rect(tx - 6, ry - 18, x + w - tx - 10, 32, '#fff4ea', ORANGE, 2, 6)
    app_square(s, tx, ry - 12, 20)
    s.text(tx + 30, ry + 3, 'Neolume Setup & Helper', 13, '#1d1d1f', 'bold')
    s.text(cx[1], ry + 3, 'Neolume', 13, '#1d1d1f')
    s.text(cx[2], ry + 3, T(lang, 'Aktiviert', 'Enabled'), 13, '#1d1d1f')
    s.text(cx[3], ry + 3, T(lang, 'Nicht gemessen', 'Not measured'), 13, '#1d1d1f')
    s.badge(tx - 6, ry - 18, '2', 12)
    s.bar(tx + 30, y + 202, 140, 9, '#6b6b70', 0.3); s.bar(cx[1], y + 202, 90, 9, '#6b6b70', 0.3)
    s.text(cx[2], y + 211, T(lang, 'Aktiviert', 'Enabled'), 13, '#1d1d1f')
    s.h = 312
    end = legend(s, 316, [('1', T(lang, 'Task-Manager (Strg + Umschalt + Esc) → „Autostart von Apps“', 'Task Manager (Ctrl + Shift + Esc) → “Startup apps”')),
                          ('2', T(lang, 'Der Helfer heißt hier „Neolume Setup & Helper“, Herausgeber „Neolume“ (.pyz: „Python“)',
                                       'The helper is listed as “Neolume Setup & Helper”, publisher “Neolume” (.pyz: “Python”)')),
                          T(lang, 'Rechtsklick → „Deaktivieren“ schaltet nur den Autostart aus. Ganz entfernen: Abschnitt 13.7.',
                                  'Right-click → “Disable” only switches the autostart off. To remove it completely: section 13.7.'),
                          T(lang, 'Im Autostart-Ordner (Win + R → shell:startup) heißt die Verknüpfung „Neolume Helfer“.',
                                  'In the Startup folder (Win + R → shell:startup) the shortcut is called “Neolume Helper”.')])
    s.h = end + 6
    return s.render(T(lang, 'Windows: Helfer im Task-Manager', 'Windows: helper in Task Manager'),
                    T(lang, 'Skizze des Task-Managers, Bereich „Autostart von Apps“: hervorgehoben der Eintrag „Neolume Setup & Helper“, '
                            'Herausgeber „Neolume“, Status „Aktiviert“.',
                      'Sketch of Task Manager, page “Startup apps”: highlighted the entry “Neolume Setup & Helper”, publisher '
                      '“Neolume”, status “Enabled”.'))


# ---------------------------------------------------------------- overview diagram + remote
def node(s, x, y, w, h, title, sub, fill='#ffffff', stroke='#9da3ab'):
    s.rect(x, y, w, h, fill, stroke, 2, 12)
    s.text(x + w / 2, y + 30, title, 17, '#1d1d1f', 'bold', 'middle')
    for i, l in enumerate(sub): s.text(x + w / 2, y + 52 + i * 18, l, 13, '#4b5563', 'normal', 'middle')


def fig_overview(lang):
    W = 800
    s = Svg(W, 0)
    s.rect(8, 8, W - 16, 360, '#f3f4f6', '#d0d4da', 1.5, 12)
    node(s, 40, 40, 220, 96, T(lang, 'Computer', 'Computer'), T(lang, ['Einrichtungsprogramm', '(nur zum Einrichten)'], ['setup program', '(only for the setup)']))
    node(s, 290, 230, 220, 110, T(lang, 'Fernseher', 'TV'), [APP, T(lang, 'Samsung 2014', 'Samsung 2014')], '#20232a', '#d5d9e0')
    s.text(400, 260, T(lang, 'Fernseher', 'TV'), 17, '#ffffff', 'bold', 'middle')
    node(s, 540, 40, 220, 96, 'Plex Media Server', T(lang, ['dein Server', 'im Heimnetz'], ['your server', 'on your home network']))
    node(s, 290, 40, 220, 96, 'plex.tv', T(lang, ['Anmeldung (einmal)', 'Merkliste, Trends'], ['sign-in (once)', 'watchlist, trends']), '#ffffff', '#c7cad0')
    # repaint TV texts in white (node() draws dark text)
    s.rect(292, 232, 216, 106, '#20232a', None, 0, 11)
    s.text(400, 262, T(lang, 'Fernseher', 'TV'), 17, '#ffffff', 'bold', 'middle')
    s.text(400, 284, APP, 14, '#e6e8eb', 'normal', 'middle')
    s.text(400, 302, 'Samsung 2014', 13, '#aab0b8', 'normal', 'middle')
    s.arrow(260, 88, 286, 88)
    s.badge(273, 112, '1', 11)
    s.arrow(150, 140, 300, 238)
    s.text(196, 214, T(lang, '2  App-Paket', '2  app package'), 14, ORANGE, 'bold', 'end')
    s.arrow(510, 270, 640, 140, TEAL)
    s.arrow(640, 140, 510, 270, TEAL)
    s.text(590, 230, T(lang, '3  Alltag: nur', '3  every day: only'), 14, '#1f7a72', 'bold')
    s.text(590, 248, T(lang, 'Fernseher ↔ Server', 'TV ↔ server'), 14, '#1f7a72', 'bold')
    s.line(400, 140, 400, 226, '#8a8f98', 2, ' stroke-dasharray="6 5"')
    s.text(410, 190, T(lang, 'optional: Helfer', 'optional: helper'), 13, '#4b5563')
    s.h = 370
    end = legend(s, 374, [('1', T(lang, 'Das Einrichtungsprogramm meldet dich einmal bei plex.tv an und holt die Zugänge deiner Profile',
                                       'The setup program signs you in to plex.tv once and fetches access for your profiles')),
                          ('2', T(lang, 'Der Fernseher holt das fertige App-Paket vom Computer („Start User App Sync“)',
                                       'The TV fetches the finished app package from the computer (“Start User App Sync”)')),
                          ('3', T(lang, 'Danach spricht Neolume nur mit deinem Server – der Computer kann aus sein',
                                       'Afterwards Neolume only talks to your server – the computer can be off')),
                          T(lang, 'Gestrichelt: Nur Merkliste und Trends brauchen plex.tv – über den optionalen Helfer (Abschnitt 13).',
                                  'Dashed: only the watchlist and trends need plex.tv – through the optional helper (section 13).')])
    s.h = end + 6
    return s.render(T(lang, 'So funktioniert die Installation', 'How the installation works'),
                    T(lang, 'Schema: Computer mit Einrichtungsprogramm, plex.tv, Plex Media Server und Fernseher. 1: Computer meldet sich '
                            'bei plex.tv an. 2: Fernseher holt das App-Paket vom Computer. 3: Im Alltag spricht der Fernseher nur mit dem '
                            'Server. Gestrichelt: optionaler Helfer für Merkliste und Trends.',
                      'Diagram: computer with the setup program, plex.tv, Plex Media Server and TV. 1: the computer signs in to '
                      'plex.tv. 2: the TV fetches the app package from the computer. 3: every day the TV only talks to the server. '
                      'Dashed: optional helper for watchlist and trends.'))


def fig_remote(lang):
    W = 800
    s = Svg(W, 0)
    s.rect(8, 8, W - 16, 300, '#f3f4f6', '#d0d4da', 1.5, 12)
    # remote body (lying horizontally)
    s.rect(40, 70, 720, 170, '#2a2d33', '#d5d9e0', 3, 60)
    def key(x, y, w, h, label, hi=False, size=13, fill='#41454d', col='#ffffff'):
        s.rect(x, y, w, h, fill, ORANGE if hi else '#5f646d', 3 if hi else 1, 8)
        s.text(x + w / 2, y + h / 2 + size * 0.36, label, size, col, 'bold', 'middle')
    for r in range(3):
        for c in range(3):
            key(90 + c * 38, 92 + r * 38, 32, 30, str(1 + r * 3 + c), size=13)
    key(250, 92, 70, 30, 'MENU', True)
    key(250, 132, 70, 30, 'TOOLS')
    key(250, 172, 70, 30, 'INFO')
    s.rect(342, 92, 116, 116, '#41454d', '#5f646d', 1, 58)
    s.text(400, 112, '▲', 14, '#ffffff', 'normal', 'middle'); s.text(400, 202, '▼', 14, '#ffffff', 'normal', 'middle')
    s.text(356, 156, '◄', 14, '#ffffff', 'normal', 'middle'); s.text(444, 156, '►', 14, '#ffffff', 'normal', 'middle')
    s.circle(400, 150, 26, '#5a5f68', ORANGE, 3)
    s.text(400, 155, 'OK', 14, '#ffffff', 'bold', 'middle')
    s.add('<g transform="translate(476 118)"><rect width="66" height="56" rx="28" fill="#41454d" stroke="%s" stroke-width="3"/>' % ORANGE
          + ''.join('<rect x="%d" y="%d" width="12" height="9" rx="2" fill="%s"/>' % (13 + 28 * (i % 2), 15 + 18 * (i // 2), c)
                    for i, c in enumerate(['#e5484d', '#30a46c', '#f5d90a', '#3e63dd'])) + '</g>')
    s.text(509, 194, 'SMART HUB', 11, '#ffffff', 'bold', 'middle')
    key(560, 92, 80, 30, 'RETURN', True)
    key(560, 132, 80, 30, 'EXIT')
    for i, (c, l) in enumerate(zip(['#e5484d', '#30a46c', '#f5d90a', '#3e63dd'], 'ABCD')):
        key(560 + i * 42 - 0, 176, 36, 26, l, fill=c, col='#1d1d1f' if l == 'C' else '#ffffff')
    s.text(690, 140, '◄◄  ▶  ❚❚  ►►', 13, '#c9ced6', 'normal', 'middle')
    s.text(690, 160, '■ STOP', 12, '#c9ced6', 'normal', 'middle')
    s.text(400, 270, T(lang, 'Orange umrandet: die Tasten, die du für die Installation brauchst',
                       'Orange outline: the buttons you need for the installation'), 15, '#1f2328', 'normal', 'middle')
    s.text(400, 292, T(lang, '(Skizze – auf deiner Fernbedienung liegen die Tasten evtl. anders)',
                       '(sketch – the layout of your remote may differ)'), 13, '#4b5563', 'normal', 'middle')
    s.h = 312
    return s.render(T(lang, 'Fernbedienung: wichtige Tasten', 'Remote: the important buttons'),
                    T(lang, 'Skizze einer Samsung-Fernbedienung (2014). Hervorgehoben: MENU, SMART HUB (bunte Taste), die Pfeiltasten mit '
                            'OK in der Mitte und RETURN. Außerdem Zahlentasten, TOOLS, INFO, EXIT, die Farbtasten A B C D und die '
                            'Wiedergabetasten.',
                      'Sketch of a Samsung remote (2014). Highlighted: MENU, SMART HUB (the colourful button), the arrow buttons with OK '
                      'in the middle and RETURN. Also number buttons, TOOLS, INFO, EXIT, the colour buttons A B C D and the playback '
                      'buttons.'))


# ---------------------------------------------------------------- Android TV / Google TV (docs/install/android-tv.md)
# Menu names as seen on a TCL set with Google TV (Android TV 11), German UI; the English names are those of Android TV's
# English UI. Entries whose English wording we did not see on a TV are drawn as grey bars. The functions take the app name
# and the download address, so the private edition can draw the same sketches with its own name
# (tools/private/install_figures_private.py).
ATV_URL = 'https://github.com/itsab1989/neolume/releases/latest/download/android-tv.apk'
ATV_PANEL, ATV_TXT, ATV_MUTED, ATV_FOCUS, ATV_ON = '#26282c', '#e8eaed', '#9aa0a6', '#e8eaed', '#8ab4f8'
ATV_NEW = '1.0.19'          # example version in the update sketches
ICON_PLAY = '#c9ced6'       # play symbol of the neutral icon for other app names (another edition may set its own colour)


def wrap(text, size, width, bold=False):
    """Greedy line wrap with the rough text width tw()."""
    out, cur = [], ''
    for word in str(text).split(' '):
        cand = (cur + ' ' + word).strip()
        if cur and tw(cand, size, bold) > width:
            out.append(cur); cur = word
        else:
            cur = cand
    if cur: out.append(cur)
    return out


def gear(s, cx, cy, r=11, color='#e8eaed'):
    for i in range(8):
        a = i * math.pi / 4
        s.line(cx + math.cos(a) * r * 0.7, cy + math.sin(a) * r * 0.7, cx + math.cos(a) * (r + 3), cy + math.sin(a) * (r + 3), color, 4)
    s.circle(cx, cy, r * 0.75, 'none', color, 3.5)


def atv_home(s):
    """Google TV start screen, simplified: a row of tabs (grey bars), the gear at the top right, rows of tiles."""
    tv(s)
    x = 70
    for wdt in [70, 60, 52, 64]:
        s.bar(x, 52, wdt, 12, op=0.35); x += wdt + 26
    s.circle(700, 58, 14, '#3a4458')
    gear(s, 740, 58)
    for r in range(2):
        y = 120 + r * 150
        s.bar(70, y - 26, 140, 10, op=0.3)
        for c in range(5):
            s.rect(70 + c * 140, y, 124, 96, ['#34507a', '#5a3f6e', '#3f6a5a', '#6e5a3f', '#3f4f6e'][(c + r) % 5], None, 0, 8)


def atv_switch(s, x, y, on):
    s.rect(x, y, 38, 20, ATV_ON if on else '#5f6368', None, 0, 10)
    s.circle(x + (28 if on else 10), y + 10, 8, '#ffffff')


def atv_panel(s, title, rows, sel, x=440, top=None, step=40, size=17, head=None, desc=None):
    """Settings panel on the right (Google TV opens settings as a panel over the dimmed home screen).
    rows: label | None (grey bar) | '…' (more entries) | (label|None, value|None, switch None/True/False).
    Returns the baseline y of every row."""
    dim(s, 0.55)
    s.rect(x, SY, SX + SW - x, SH, ATV_PANEL, None, 0, 4)
    w = SX + SW - x - 56
    y = SY + 40
    if head:
        s.text(x + 28, y, head, 13, ATV_MUTED); y += 30
    s.text(x + 28, y + 6, title, 23, ATV_TXT); y += 26
    if desc:
        for ln in wrap(desc, 13, w):
            y += 18; s.text(x + 28, y, ln, 13, ATV_MUTED)
        y += 6
    y = top if top else y + 30
    ys = []
    for i, r in enumerate(rows):
        lab, val, sw = (r if isinstance(r, tuple) else (r, None, None))
        f = (i == sel)
        if f: s.rect(x + 14, y - 23, w + 28, step - 4, ATV_FOCUS, None, 0, 10)
        col = '#202124' if f else ATV_TXT
        if lab == '…':
            s.text(x + 28, y, '⋮', size, ATV_MUTED)
        elif lab is None:
            s.bar(x + 28, y - 11, w * 0.5, 10, '#202124' if f else '#ffffff', 0.5 if f else 0.28)
        else:
            s.text(x + 28, y, lab, size, col, 'bold' if f else 'normal')
        if val and sw is None: s.text(x + 28 + w, y, val, 14, '#3c4043' if f else ATV_MUTED, 'normal', 'end')
        if sw is not None:
            if val: s.text(x + 28 + w - 48, y, val, 13, '#3c4043' if f else ATV_MUTED, 'normal', 'end')
            atv_switch(s, x + 28 + w - 38, y - 15, sw)
        ys.append(y)
        y += step
    return ys


def toast(s, text, cx=400):
    w = tw(text, 15) + 40
    s.rect(cx - w / 2, 396, w, 34, '#3c4043', None, 0, 17)
    s.text(cx, 418, text, 15, '#ffffff', 'normal', 'middle')


def app_icon(s, x, y, size, app):
    """Public icon for Neolume; any other name (private edition) gets a neutral play symbol."""
    if app == APP:
        neolume_icon(s, x, y, size); return
    h = size * 1000 / 1220.0
    s.rect(x, y, size, h, '#16181b', '#5f646d', 1, size * 0.12)
    s.add('<path d="M%g %g L%g %g L%g %g Z" fill="%s"/>' % (x + size * 0.4, y + h * 0.3, x + size * 0.4, y + h * 0.7,
                                                                x + size * 0.66, y + h * 0.5, ICON_PLAY))


def atv_dialog(s, x, y, w, title, lines, buttons, focus_i=None, icon_app=None):
    """Android dialog (dark system theme): optional icon + app name, title, text, text buttons at the bottom right.
    Returns the button boxes (x, y, w, h)."""
    lh = 21
    h = 40 + (58 if icon_app else 0) + (32 if title else 0) + lh * len(lines) + 66
    s.rect(x, y, w, h, '#2d2f33', '#5f6368', 1, 12)
    yy = y + 40
    if icon_app:
        app_icon(s, x + 28, y + 22, 44, icon_app)
        s.text(x + 84, y + 50, icon_app, 18, ATV_TXT, 'bold'); yy = y + 98
    if title:
        s.text(x + 28, yy, title, 19 if icon_app else 20, ATV_TXT, 'normal' if icon_app else 'bold'); yy += 32
    for ln in lines:
        s.text(x + 28, yy, ln, 15, '#c4c7cc'); yy += lh
    boxes, bx = [], x + w - 20
    for b in reversed(buttons):
        bw = tw(b, 15, True) + 30
        bx -= bw
        boxes.insert(0, (bx, y + h - 50, bw, 36))
        bx -= 10
    for i, (bx, by, bw, bh) in enumerate(boxes):
        if focus_i == i: s.rect(bx, by, bw, bh, ATV_FOCUS, None, 0, 8)
        s.text(bx + bw / 2, by + 24, buttons[i], 15, '#202124' if focus_i == i else ATV_ON, 'bold', 'middle')
    return boxes


def fig_atv_settings(lang):
    s = Svg(800, 0)
    atv_home(s)
    rows = [T(lang, 'Netzwerk & Internet', 'Network & Internet'), T(lang, 'Konten & Anmeldung', 'Accounts & Sign In'), 'Apps',
            T(lang, 'Geräteeinstellungen', 'Device Preferences'), T(lang, 'Fernbedienungen & Zubehör', 'Remotes & Accessories'), None, None]
    ys = atv_panel(s, T(lang, 'Einstellungen', 'Settings'), rows, 2, x=430, step=44)
    s.badge(740, 30, '1', 12)
    s.badge(430, ys[2] - 6, '2', 13)
    s.rect(444, ys[3] - 25, 318, 38, 'none', ORANGE, 2.5, 10, ' stroke-dasharray="6 4"')
    s.badge(430, ys[3] - 6, '3', 13)
    end = legend(s, 474, [('1', T(lang, 'Startseite: ganz nach oben, nach rechts zum Zahnrad, OK – rechts öffnen sich die Einstellungen',
                                       'Home screen: all the way up, right to the gear, OK – Settings opens on the right')),
                          ('2', T(lang, 'Apps: hier erlaubst du Downloader das Installieren (Schritt 3)', 'Apps: here you allow Downloader to install (step 3)')),
                          ('3', T(lang, 'Geräteeinstellungen: Info, Datum & Uhrzeit (nur für Tipps und den Weg per Computer)',
                                       'Device Preferences: About, Date & time (only for tips and the computer method)')),
                          T(lang, 'Graue Balken: weitere Einträge, die du hier nicht brauchst.', 'Grey bars: other entries you do not need here.')])
    s.h = end + 6
    return s.render(T(lang, 'Google TV: Einstellungen öffnen', 'Google TV: open Settings'),
                    T(lang, 'Skizze der Google-TV-Startseite mit dem Zahnrad oben rechts (1). Rechts das Feld „Einstellungen“ mit '
                            'Netzwerk & Internet, Konten & Anmeldung, Apps (markiert, 2), Geräteeinstellungen (gestrichelt, 3) und '
                            'Fernbedienungen & Zubehör.',
                      'Sketch of the Google TV home screen with the gear at the top right (1). On the right the Settings panel with '
                      'Network & Internet, Accounts & Sign In, Apps (highlighted, 2), Device Preferences (dashed, 3) and Remotes & '
                      'Accessories.'))


def fig_atv_unknown(lang):
    s = Svg(800, 0)
    atv_home(s)
    no = T(lang, 'Nicht zulässig', 'Not allowed')
    rows = [('Downloader', T(lang, 'Zugelassen', 'Allowed'), True), (None, no, False), (None, no, False), (None, no, False)]
    ys = atv_panel(s, T(lang, 'Unbekannte Herkunft', 'Unknown sources'), rows, 0, x=380, step=46,
                   head=T(lang, 'Apps › Sicherheit & Einschränkungen', 'Apps › Security & restrictions'),
                   desc=T(lang, 'Installation von Apps aus anderen Quellen als dem Play Store zulassen',
                          'Allow installation of apps from sources other than the Play Store'))
    s.badge(380, 64, '1', 13)
    s.badge(380, ys[0] - 6, '2', 13)
    end = legend(s, 474, [('1', T(lang, 'Einstellungen › Apps › Sicherheit & Einschränkungen › Unbekannte Herkunft',
                                       'Settings › Apps › Security & restrictions › Unknown sources')),
                          ('2', T(lang, 'Downloader wählen und OK: der Schalter geht an („Zugelassen“)',
                                       'Choose Downloader and press OK: the switch turns on (“Allowed”)')),
                          T(lang, 'Nur Downloader erlauben. Nach der Installation kannst du den Schalter wieder ausschalten.',
                                  'Allow only Downloader. After the installation you can switch it off again.'),
                          T(lang, 'Graue Balken: andere Apps auf deinem Fernseher.', 'Grey bars: other apps on your TV.')])
    s.h = end + 6
    return s.render(T(lang, 'Android TV: Unbekannte Herkunft', 'Android TV: Unknown sources'),
                    T(lang, 'Skizze der Seite „Unbekannte Herkunft“ unter Apps › Sicherheit & Einschränkungen: Text „Installation '
                            'von Apps aus anderen Quellen als dem Play Store zulassen“, darunter eine Liste von Apps mit Schaltern. '
                            'Downloader ist markiert und „Zugelassen“, die anderen „Nicht zulässig“.',
                      'Sketch of the page Unknown sources under Apps › Security & restrictions: text “Allow installation of apps '
                      'from sources other than the Play Store”, below a list of apps with switches. Downloader is highlighted and '
                      '“Allowed”, the others “Not allowed”.'))


def fig_atv_about(lang):
    s = Svg(800, 0)
    atv_home(s)
    if lang == 'de':
        rows = ['Produktinformationen', 'Softwareaktualisierung', 'Gerätename', 'Neu starten', 'Status', 'Rechtliche Hinweise',
                'Nutzungsbedingungen', 'Android TV-Modell', '…', 'Android TV OS-Build']
    else:
        rows = [None, 'System update', 'Device name', 'Restart', 'Status', 'Legal information', None, None, '…', 'Android TV OS build']
    ys = atv_panel(s, T(lang, 'Info', 'About'), rows, 9, x=430, step=31, size=16,
                   head=T(lang, 'Geräteeinstellungen', 'Device Preferences'), top=SY + 112)
    s.arrow(412, ys[1], 412, ys[9] - 8)
    s.badge(412, ys[1] - 20, '1', 12)
    s.badge(430, ys[9] - 6, '2', 13)
    toast(s, T(lang, 'Du bist jetzt Entwickler!', 'You are now a developer!'), 220)
    end = legend(s, 474, [('1', T(lang, 'Geräteeinstellungen › Info: mit ▼ ganz nach unten scrollen', 'Device Preferences › About: scroll all the way down with ▼')),
                          ('2', T(lang, 'Android TV OS-Build markieren und 7-mal OK drücken', 'Highlight Android TV OS build and press OK 7 times')),
                          T(lang, 'Nur für den Weg per Computer nötig (Abschnitt 11) – nicht für die normale Installation.',
                                  'Only needed for the computer method (section 11) – not for the normal installation.'),
                          T(lang, 'Graue Balken: Einträge, die du hier nicht brauchst.', 'Grey bars: entries you do not need here.')])
    s.h = end + 6
    return s.render(T(lang, 'Android TV: Info › Android TV OS-Build', 'Android TV: About › Android TV OS build'),
                    T(lang, 'Skizze der Seite Geräteeinstellungen › Info mit Produktinformationen, Softwareaktualisierung, '
                            'Gerätename, Neu starten, Status, Rechtliche Hinweise, Nutzungsbedingungen, Android TV-Modell und ganz '
                            'unten dem markierten Eintrag „Android TV OS-Build“. Unten die Meldung „Du bist jetzt Entwickler!“.',
                      'Sketch of Device Preferences › About with System update, Device name, Restart, Status, Legal information '
                      'and at the very bottom the highlighted entry Android TV OS build. At the bottom the message “You are now '
                      'a developer!”.'))


def fig_atv_devopts(lang):
    s = Svg(800, 0)
    atv_home(s)
    rows = [None, None, None, '…', (T(lang, 'USB-Debugging', 'USB debugging'), None, True), None, None]
    ys = atv_panel(s, T(lang, 'Entwickleroptionen', 'Developer options'), rows, 4, x=430, step=42,
                   head=T(lang, 'Geräteeinstellungen', 'Device Preferences'))
    s.badge(430, ys[4] - 6, '1', 13)
    end = legend(s, 474, [('1', T(lang, 'USB-Debugging markieren und OK – der Schalter geht an; die Rückfrage mit OK bestätigen',
                                       'Highlight USB debugging and press OK – the switch turns on; confirm the question with OK')),
                          T(lang, 'Nur für den Weg per Computer (Abschnitt 11). Danach wieder ausschalten.',
                                  'Only for the computer method (section 11). Switch it off again afterwards.'),
                          T(lang, 'Graue Balken: weitere Entwicklereinstellungen – dort bitte nichts ändern.',
                                  'Grey bars: other developer settings – please leave them alone.')])
    s.h = end + 6
    return s.render(T(lang, 'Android TV: Entwickleroptionen › USB-Debugging', 'Android TV: Developer options › USB debugging'),
                    T(lang, 'Skizze der Seite Geräteeinstellungen › Entwickleroptionen: viele Einträge als graue Balken, markiert '
                            'der Eintrag „USB-Debugging“ mit eingeschaltetem Schalter.',
                      'Sketch of Device Preferences › Developer options: many entries drawn as grey bars, highlighted the entry '
                      'USB debugging with its switch on.'))


def fig_atv_downloader(lang, app=APP, url=ATV_URL):
    s = Svg(800, 0)
    tv(s)
    s.rect(SX, SY, 190, SH, '#1b1d22', None, 0, 4)
    s.text(44, 66, 'Downloader', 18, '#ff9a3c', 'bold')
    s.rect(36, 92, 166, 36, ATV_FOCUS, None, 0, 8)
    s.text(52, 116, 'Home', 16, '#202124', 'bold')
    for i in range(4): s.bar(52, 150 + i * 40, 100, 10, op=0.3)
    s.bar(250, 92, 220, 11, op=0.35)
    cut = url.find('/releases/')
    lines = [url] if len(url) <= 56 or cut < 0 else [url[:cut], url[cut:]]
    bh = 22 + 22 * len(lines)
    s.rect(250, 118, 400, bh, '#ffffff', ORANGE, 2.5, 6)
    for i, ln in enumerate(lines): s.text(262, 140 + i * 22, ln, 13, '#202124', 'normal', 'start', MONO)
    s.rect(664, 118, 80, bh, ORANGE, None, 0, 6)
    s.text(704, 124 + bh / 2 + 2, 'Go', 18, '#ffffff', 'bold', 'middle')
    s.badge(250, 118, '1', 13)
    s.badge(744, 118, '2', 13)
    s.rect(250, 230, 494, 190, '#2d2f33', None, 0, 10)          # on-screen keyboard (simplified)
    for r in range(4):
        for c in range(10):
            s.rect(262 + c * 47, 244 + r * 42, 40, 34, '#3c4043', None, 0, 5)
    s.text(497, 439, T(lang, 'Bildschirmtastatur (Skizze)', 'on-screen keyboard (sketch)'), 12, ATV_MUTED, 'normal', 'middle')
    end = legend(s, 474, [('1', T(lang, 'Ins Adressfeld gehen, OK – die Bildschirmtastatur erscheint. Adresse genau abtippen.',
                                       'Go to the address box, OK – the on-screen keyboard appears. Type the address exactly.')),
                          ('2', T(lang, 'Go wählen: Downloader lädt die Datei und öffnet die Installation von ' + app + '.',
                                       'Choose Go: Downloader fetches the file and opens the installation of ' + app + '.')),
                          T(lang, 'Jedes Zeichen zählt, auch Groß- und Kleinschreibung. Downloader selbst ist englisch.',
                                  'Every character counts, including upper and lower case.')])
    s.h = end + 6
    return s.render(T(lang, 'Downloader: Adresse der App-Datei eingeben', 'Downloader: enter the address of the app file'),
                    T(lang, 'Skizze der App Downloader: links das Menü mit „Home“ markiert, rechts das Adressfeld mit '
                            + url + ' (1) und daneben der Knopf „Go“ (2), darunter die Bildschirmtastatur.',
                      'Sketch of the Downloader app: on the left the menu with Home highlighted, on the right the address box with '
                      + url + ' (1) and next to it the Go button (2), below the on-screen keyboard.'))


def fig_atv_install(lang, app=APP):
    s = Svg(800, 0)
    tv(s)
    dim(s, 0.4)
    boxes = atv_dialog(s, 150, 110, 500, T(lang, 'Möchtest du diese App installieren?', 'Do you want to install this app?'), [],
                       [T(lang, 'Abbrechen', 'Cancel'), T(lang, 'Installieren', 'Install')], icon_app=app)
    bx, by, bw, bh = boxes[1]
    s.rect(bx - 3, by - 3, bw + 6, bh + 6, 'none', ORANGE, 3, 10)
    s.badge(bx + bw, by, '1', 13)
    end = legend(s, 474, [('1', T(lang, 'Installieren wählen und OK drücken (steht die Markierung auf Abbrechen: erst ►)',
                                       'Choose Install and press OK (if the highlight is on Cancel: press ► first)')),
                          T(lang, 'Nach ein paar Sekunden: „App installiert“ – mit Öffnen startest du ' + app + ' gleich.',
                                  'After a few seconds: “App installed” – Open starts ' + app + ' right away.')])
    s.h = end + 6
    return s.render(T(lang, 'Android: „Möchtest du diese App installieren?“', 'Android: “Do you want to install this app?”'),
                    T(lang, 'Skizze der Rückfrage von Android: oben Symbol und Name ' + app + ', darunter „Möchtest du diese App '
                            'installieren?“, unten rechts die Knöpfe Abbrechen und Installieren (orange umrandet).',
                      'Sketch of Android’s question: at the top the icon and the name ' + app + ', below “Do you want to install '
                      'this app?”, at the bottom right the buttons Cancel and Install (outlined in orange).'))


def fig_atv_signin(lang, app=APP):
    s = Svg(800, 0)
    tv(s, app_screen=True)
    s.text(64, 84, T(lang, 'Mit deinem Plex-Konto verbinden', 'Connect your Plex account'), 24, '#f2f2f2', 'bold')
    steps = [T(lang, '1  Öffne plex.tv/link auf Handy oder Computer.', '1  Open plex.tv/link on your phone or computer.'),
             T(lang, '2  Melde dich dort mit deinem Plex-Konto an.', '2  Sign in there with your Plex account.'),
             T(lang, '3  Gib diesen Code ein:', '3  Enter this code:')]
    for i, t in enumerate(steps): s.text(64, 128 + i * 30, t, 16, '#c4c7cc')
    s.rect(64, 210, 300, 84, '#22252a', TEAL, 2.5, 12)
    s.text(214, 268, 'K7QX', 46, '#ffffff', 'bold', 'middle', MONO)
    s.text(64, 324, T(lang, 'Der Code gilt noch 4:52.', 'This code is valid for 4:52.'), 14, '#a7abb2')
    s.rect(64, 346, 130, 38, '#2f3338', None, 0, 8)
    s.text(129, 371, T(lang, 'Neuer Code', 'New code'), 15, '#ffffff', 'bold', 'middle')
    qx, qy, q = 520, 110, 200                                    # QR sketch, not scannable on purpose
    s.rect(qx, qy, q, q, '#ffffff', None, 0, 12)
    for fx, fy in ((qx + 16, qy + 16), (qx + q - 66, qy + 16), (qx + 16, qy + q - 66)):
        s.rect(fx, fy, 50, 50, '#0e0f11', None, 0, 4); s.rect(fx + 10, fy + 10, 30, 30, '#ffffff'); s.rect(fx + 17, fy + 17, 16, 16, '#0e0f11')
    for r in range(9):
        for c in range(9):
            if (r < 3 and (c < 3 or c > 5)) or (r > 5 and c < 3) or (r * 5 + c * 3 + r * c) % 3: continue
            s.rect(qx + 18 + c * 18, qy + 18 + r * 18, 14, 14, '#0e0f11')
    s.text(qx + q / 2, qy + q + 28, T(lang, 'Oder QR-Code scannen – öffnet plex.tv/link', 'Or scan the QR code – opens plex.tv/link'),
           13, '#c4c7cc', 'normal', 'middle')
    s.badge(64, 210, '1', 13)
    s.badge(qx, qy, '2', 13)
    end = legend(s, 474, [('1', T(lang, 'Auf dem Handy oder Computer plex.tv/link öffnen, anmelden, diesen Code eintippen',
                                       'On your phone or computer open plex.tv/link, sign in, type this code')),
                          ('2', T(lang, 'Oder mit der Handykamera den QR-Code scannen – er öffnet dieselbe Seite',
                                       'Or scan the QR code with your phone camera – it opens the same page')),
                          T(lang, 'Code und QR-Code sind Beispiele; dein Fernseher zeigt eigene.', 'Code and QR code are examples; your TV shows its own.')])
    s.h = end + 6
    return s.render(T(lang, app + ': mit Code anmelden', app + ': sign in with a code'),
                    T(lang, 'Skizze der Anmeldung von ' + app + ': Überschrift „Mit deinem Plex-Konto verbinden“, drei Schritte, der '
                            'Beispielcode K7QX in einem Kasten (1), rechts ein QR-Code mit „Oder QR-Code scannen – öffnet '
                            'plex.tv/link“ (2).',
                      'Sketch of the ' + app + ' sign-in: heading “Connect your Plex account”, three steps, the example code K7QX in '
                      'a box (1), on the right a QR code with “Or scan the QR code – opens plex.tv/link” (2).'))


def fig_atv_update_dialog(lang, app=APP):
    s = Svg(800, 0)
    tv(s, app_screen=True)
    for r in range(2):
        for c in range(5): s.rect(70 + c * 140, 90 + r * 160, 124, 120, '#2a2e33', None, 0, 8)
    dim(s, 0.5)
    msg = T(lang, 'Für ' + app + ' gibt es ein Update. Jetzt installieren? Das dauert etwa eine Minute; danach startest du die App einfach neu.',
            'An update for ' + app + ' is available. Install it now? It takes about a minute; then simply start the app again.')
    boxes = atv_dialog(s, 130, 110, 540, T(lang, 'Neue Version ', 'New version ') + ATV_NEW, wrap(msg, 15, 480),
                       [T(lang, 'Später', 'Later'), T(lang, 'Installieren', 'Install')])
    bx, by, bw, bh = boxes[1]
    s.rect(bx - 3, by - 3, bw + 6, bh + 6, 'none', ORANGE, 3, 10)
    s.badge(bx + bw, by, '1', 13)
    end = legend(s, 474, [('1', T(lang, 'Installieren wählen und OK. „Später“ fragt erst in 24 Stunden wieder.',
                                       'Choose Install and press OK. “Later” asks again after 24 hours.')),
                          T(lang, 'Die Versionsnummer ist ein Beispiel.', 'The version number is an example.')])
    s.h = end + 6
    return s.render(T(lang, app + ': Hinweis auf eine neue Version', app + ': a new version is available'),
                    T(lang, 'Skizze des Hinweises in ' + app + ': Titel „Neue Version ' + ATV_NEW + '“, Text „' + msg + '“, Knöpfe Später '
                            'und Installieren (orange umrandet).',
                      'Sketch of the notice in ' + app + ': title “New version ' + ATV_NEW + '”, text “' + msg + '”, buttons Later and '
                      'Install (outlined in orange).'))


def fig_atv_update_allow(lang, app=APP):
    s = Svg(800, 0)
    tv(s, app_screen=True)
    ys = atv_panel(s, T(lang, 'Installieren unbekannter Apps', 'Install unknown apps'), [(app, None, True)], 0, x=400, step=46, top=SY + 150)
    s.badge(400, ys[0] - 6, '1', 13)
    end = legend(s, 474, [('1', T(lang, app + ' markieren und OK – der Schalter geht an', 'Highlight ' + app + ' and press OK – the switch turns on')),
                          ('2', T(lang, 'Zurück-Taste drücken: Android zeigt dann die Rückfrage zum Update',
                                       'Press Back: Android then shows its question about the update')),
                          T(lang, 'Nur vor dem allerersten Update. Erlaubt nur ' + app + ', sich selbst zu aktualisieren.',
                                  'Only before the very first update. It lets only ' + app + ' update itself.')])
    s.h = end + 6
    return s.render(T(lang, 'Android: Installieren unbekannter Apps', 'Android: Install unknown apps'),
                    T(lang, 'Skizze der Seite „Installieren unbekannter Apps“ mit einer Zeile ' + app + ' und eingeschaltetem Schalter.',
                      'Sketch of the page Install unknown apps with one row ' + app + ' and its switch on.'))


def fig_atv_update_confirm(lang, app=APP):
    s = Svg(800, 0)
    tv(s)
    dim(s, 0.4)
    txt = T(lang, 'Möchtest du ein Update dieser vorhandenen App installieren? Deine bisherigen Daten gehen dabei nicht verloren.',
            'Do you want to install an update to this existing app? Your existing data will not be lost.')
    boxes = atv_dialog(s, 130, 90, 540, None, wrap(txt, 15, 480), [T(lang, 'Abbrechen', 'Cancel'), T(lang, 'Installieren', 'Install')],
                       focus_i=0, icon_app=app)
    (ax, ay, aw, ah), (bx, by, bw, bh) = boxes
    s.rect(bx - 3, by - 3, bw + 6, bh + 6, 'none', ORANGE, 3, 10)
    s.line(ax + aw / 2, ay + ah + 2, ax + aw / 2, ay + ah + 18, ORANGE, 3)
    s.arrow(ax + aw / 2, ay + ah + 18, bx + bw / 2, ay + ah + 18)
    s.line(bx + bw / 2, ay + ah + 18, bx + bw / 2, by + bh + 4, ORANGE, 3)
    s.badge(ax, ay, '1', 12)
    s.badge(bx + bw, by, '2', 13)
    end = legend(s, 474, [('1', T(lang, 'Achtung: Die Markierung steht zuerst auf Abbrechen – einmal ► drücken',
                                       'Careful: the highlight starts on Cancel – press ► once')),
                          ('2', T(lang, 'Jetzt ist Installieren markiert: OK drücken. Danach ' + app + ' neu starten.',
                                       'Now Install is highlighted: press OK. Then start ' + app + ' again.'))])
    s.h = end + 6
    return s.render(T(lang, 'Android: Update installieren', 'Android: install the update'),
                    T(lang, 'Skizze der Rückfrage von Android mit Symbol und Name ' + app + ' und dem Text „' + txt + '“. Die '
                            'Markierung steht auf Abbrechen (1), ein Pfeil zeigt nach rechts zu Installieren (2).',
                      'Sketch of Android’s question with the icon and name ' + app + ' and the text “' + txt + '”. The highlight is '
                      'on Cancel (1), an arrow points right to Install (2).'))


def fig_remote_tcl(lang):
    W = 800
    s = Svg(W, 0)
    s.rect(8, 8, W - 16, 300, '#f3f4f6', '#d0d4da', 1.5, 12)
    s.rect(40, 60, 720, 190, '#2a2d33', '#d5d9e0', 3, 60)

    def key(x, y, w, h, label, hi=False, size=13, fill='#41454d', col='#ffffff', sub=None):
        s.rect(x, y, w, h, fill, ORANGE if hi else '#5f646d', 3 if hi else 1, 8)
        s.text(x + w / 2, y + h / 2 + size * 0.36, label, size, col, 'bold', 'middle')
        if sub: s.text(x + w / 2, y + h + 14, sub, 11, '#c9ced6', 'normal', 'middle')
    for r in range(3):
        for c in range(3):
            key(84 + c * 36, 82 + r * 36, 30, 28, str(1 + r * 3 + c), size=12)
    key(120, 190, 30, 28, '0', size=12)
    for i, (c, l) in enumerate(zip(['#e5484d', '#30a46c', '#f5d90a', '#3e63dd'], 'RGYB')):
        key(212 + (i % 2) * 42, 82 + (i // 2) * 36, 36, 28, l, fill=c, col='#1d1d1f' if l == 'Y' else '#ffffff')
    key(212, 160, 36, 28, 'ⓘ', size=15, sub='Info')
    key(254, 160, 36, 28, '≡', size=17, sub=T(lang, 'Optionen', 'Options'))
    s.rect(330, 80, 140, 140, '#41454d', ORANGE, 3, 70)
    s.text(400, 102, '▲', 14, '#ffffff', 'normal', 'middle'); s.text(400, 210, '▼', 14, '#ffffff', 'normal', 'middle')
    s.text(346, 155, '◄', 14, '#ffffff', 'normal', 'middle'); s.text(454, 155, '►', 14, '#ffffff', 'normal', 'middle')
    s.circle(400, 150, 30, '#5a5f68', ORANGE, 3)
    s.text(400, 155, 'OK', 15, '#ffffff', 'bold', 'middle')
    key(500, 86, 56, 36, '↩', True, 18, sub=T(lang, 'Zurück', 'Back'))
    key(500, 150, 56, 36, '⌂', True, 18, sub='Home')
    key(590, 86, 40, 54, 'CH', size=12)
    s.text(610, 80, '▲', 11, '#c9ced6', 'normal', 'middle'); s.text(610, 156, '▼', 11, '#c9ced6', 'normal', 'middle')
    key(650, 86, 40, 54, 'VOL', size=11)
    s.text(670, 80, '+', 12, '#c9ced6', 'normal', 'middle'); s.text(670, 156, '–', 12, '#c9ced6', 'normal', 'middle')
    s.text(640, 196, T(lang, 'keine Play-/Pause-Taste', 'no play/pause button'), 12, '#c9ced6', 'normal', 'middle')
    s.text(400, 274, T(lang, 'Orange umrandet: die Tasten, die du für die Installation brauchst',
                       'Orange outline: the buttons you need for the installation'), 15, '#1f2328', 'normal', 'middle')
    s.text(400, 294, T(lang, '(Skizze einer TCL-Fernbedienung – deine sieht vielleicht anders aus)',
                       '(sketch of a TCL remote – yours may look different)'), 13, '#4b5563', 'normal', 'middle')
    s.h = 312
    return s.render(T(lang, 'Fernbedienung (Android TV): wichtige Tasten', 'Remote (Android TV): the important buttons'),
                    T(lang, 'Skizze einer TCL-Fernbedienung für Google TV. Hervorgehoben: die Pfeiltasten mit OK in der Mitte, '
                            'Zurück und Home. Außerdem Zahlentasten 0–9, die Farbtasten R G Y B, Info (ⓘ), die Menütaste (≡), '
                            'CH ▲▼ und Lautstärke. Eine Play-/Pause-Taste gibt es nicht.',
                      'Sketch of a TCL remote for Google TV. Highlighted: the arrow buttons with OK in the middle, Back and Home. '
                      'Also the number buttons 0–9, the colour buttons R G Y B, Info (ⓘ), the menu button (≡), CH ▲▼ and volume. '
                      'There is no play/pause button.'))


FIGS = [
    ('overview', fig_overview), ('remote', fig_remote),
    ('tv-menu-smarthub', fig_tv_menu), ('tv-account-develop', fig_tv_account), ('tv-smarthub-apps', fig_tv_smarthub),
    ('tv-apps-menu', fig_tv_apps_menu), ('tv-ip-setting', fig_tv_ip), ('tv-sync-requested', fig_tv_sync),
    ('tv-my-apps', fig_tv_myapps), ('tv-eco-auto-off', fig_tv_eco),
    ('app-profiles', fig_app_profiles), ('app-settings-watchlist', fig_app_settings),
    ('setup-summary', fig_setup_summary), ('setup-to-tv', fig_setup_tv), ('setup-helper-card', fig_setup_helper),
    ('setup-helper-installed', fig_setup_helper_done),
    ('helper-menu-mac', fig_tray_mac), ('helper-menu-windows', fig_tray_win), ('mac-background-item', fig_mac_background),
    ('windows-firewall', fig_win_firewall), ('windows-startup-apps', fig_win_startup),
    # Android TV / Google TV (docs/install/android-tv.md)
    ('remote-tcl', fig_remote_tcl), ('atv-settings', fig_atv_settings), ('atv-unknown-sources', fig_atv_unknown),
    ('atv-downloader', fig_atv_downloader), ('atv-install-confirm', fig_atv_install), ('atv-signin', fig_atv_signin),
    ('atv-update-dialog', fig_atv_update_dialog), ('atv-update-allow', fig_atv_update_allow),
    ('atv-update-confirm', fig_atv_update_confirm), ('atv-about-build', fig_atv_about), ('atv-developer-options', fig_atv_devopts),
]


def main(argv):
    os.makedirs(OUT, exist_ok=True)
    only = set(argv[1:])
    n = 0
    for name, fn in FIGS:
        if only and name not in only: continue
        for lang in ('en', 'de'):
            path = os.path.join(OUT, '%s.%s.svg' % (name, lang))
            with open(path, 'w', encoding='utf-8', newline='\n') as f: f.write(fn(lang))
            n += 1
    print('install figures: %d files in %s' % (n, os.path.relpath(OUT, ROOT)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
