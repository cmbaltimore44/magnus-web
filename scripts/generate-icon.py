"""Generates the app icons, one set per color theme, from themes.css.

Design: a full-bleed tile in the theme's dark background, with a thin,
mostly-complete progress ring in the accent color and a bold check in the
text color. No border or rounded corners are baked into the home-screen icon
(iOS/Android apply their own mask); only the small browser-tab favicon gets
rounded corners.

Outputs (per theme key, e.g. "hearth"):
  icons/<key>.png          512×512 full-bleed (manifest / install)
  icons/<key>-180.png      180×180 full-bleed (apple-touch-icon)
  icons/<key>-favicon.png  64×64 rounded (browser tab)
and build/icon.png, build/icon-source.png, build/icon.icns from the default
theme (hearth). js/theme-boot.js swaps the favicon/touch icon when the theme
changes.

Run with: python3 scripts/generate-icon.py   (the Magnus repo's
`npm run themes:web` runs this automatically after regenerating themes.css)
"""

import math
import os
import re
import shutil
import subprocess

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD_DIR = os.path.join(ROOT, 'build')
ICON_DIR = os.path.join(ROOT, 'icons')
DEFAULT = 'hearth'

SIZE = 1024
SS = 4  # supersampling factor for smooth edges


def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(round(x * t + y * (1 - t)) for x, y in zip(a, b))


def theme_colors():
    """{key: {'bg','accent','text'}} from each theme's dark block in themes.css."""
    css = open(os.path.join(ROOT, 'themes.css')).read()
    themes = {}
    for key, body in re.findall(r'html\[data-palette="([^"]+)"\]\[data-theme="dark"\] \{(.*?)\}', css, re.S):
        v = dict(re.findall(r'(--[a-z-]+): (#[0-9a-fA-F]{6});', body))
        themes[key] = {'bg': v['--bg'], 'accent': v['--accent'], 'text': v['--text']}
    return themes


def render(colors, size=SIZE):
    s = size * SS
    bg, accent, text = (hex_to_rgb(colors[k]) for k in ('bg', 'accent', 'text'))
    img = Image.new('RGBA', (s, s), bg + (255,))
    d = ImageDraw.Draw(img)

    # Progress ring: a faint full track, then an accent arc covering 315°,
    # starting at 12 o'clock and running clockwise, with rounded ends.
    cx = cy = s / 2
    r = s * 0.30
    w = s * 0.062
    box = [cx - r, cy - r, cx + r, cy + r]
    d.ellipse(box, outline=mix(accent, bg, 0.22) + (255,), width=int(w))
    start, end = -90, 225
    d.arc(box, start, end, fill=accent + (255,), width=int(w))
    for ang in (start, end):
        a = math.radians(ang)
        ex = cx + (r - w / 2) * math.cos(a)
        ey = cy + (r - w / 2) * math.sin(a)
        d.ellipse([ex - w / 2, ey - w / 2, ex + w / 2, ey + w / 2], fill=accent + (255,))

    # Check mark in the text color, with rounded joins and ends.
    k = r * 0.95
    pts = [(cx - k * 0.42, cy + k * 0.02), (cx - k * 0.10, cy + k * 0.33), (cx + k * 0.46, cy - k * 0.30)]
    cw = s * 0.07
    d.line(pts, fill=text + (255,), width=int(cw), joint='curve')
    for p in pts:
        d.ellipse([p[0] - cw / 2, p[1] - cw / 2, p[0] + cw / 2, p[1] + cw / 2], fill=text + (255,))

    return img.resize((size, size), Image.LANCZOS)


def rounded(img, radius_frac=0.22):
    s = img.size[0] * SS
    mask = Image.new('L', (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * radius_frac), fill=255)
    out = img.copy()
    out.putalpha(mask.resize(img.size, Image.LANCZOS))
    return out


def main():
    os.makedirs(ICON_DIR, exist_ok=True)
    os.makedirs(BUILD_DIR, exist_ok=True)
    themes = theme_colors()
    for key, colors in themes.items():
        master = render(colors)
        master.resize((512, 512), Image.LANCZOS).save(os.path.join(ICON_DIR, f'{key}.png'))
        master.resize((180, 180), Image.LANCZOS).save(os.path.join(ICON_DIR, f'{key}-180.png'))
        rounded(master.resize((64, 64), Image.LANCZOS)).save(os.path.join(ICON_DIR, f'{key}-favicon.png'))
        print(f'Wrote icons/{key}.png, {key}-180.png, {key}-favicon.png')

    master = render(themes[DEFAULT])
    master.save(os.path.join(BUILD_DIR, 'icon-source.png'))
    master.resize((512, 512), Image.LANCZOS).save(os.path.join(BUILD_DIR, 'icon.png'))
    print('Wrote build/icon-source.png, build/icon.png')

    iconutil = shutil.which('iconutil')
    if iconutil:
        iconset_dir = os.path.join(BUILD_DIR, 'icon.iconset')
        if os.path.exists(iconset_dir):
            shutil.rmtree(iconset_dir)
        os.makedirs(iconset_dir)
        for sz in [16, 32, 128, 256, 512]:
            master.resize((sz, sz), Image.LANCZOS).save(os.path.join(iconset_dir, f'icon_{sz}x{sz}.png'))
            master.resize((sz * 2, sz * 2), Image.LANCZOS).save(os.path.join(iconset_dir, f'icon_{sz}x{sz}@2x.png'))
        subprocess.run([iconutil, '-c', 'icns', iconset_dir, '-o', os.path.join(BUILD_DIR, 'icon.icns')], check=True)
        shutil.rmtree(iconset_dir)
        print('Wrote build/icon.icns')


if __name__ == '__main__':
    main()
