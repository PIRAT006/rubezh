# -*- coding: utf-8 -*-
"""ASCII-превью скриншота: яркость + цветовая метка, чтобы оценить композицию."""
import sys
from PIL import Image

RAMP = ' .:-=+*#%@'

def preview(p, cols=72):
    im = Image.open(p).convert('RGB')
    w, h = im.size
    rows = max(1, int(cols * h / w * 0.5))
    small = im.resize((cols, rows), Image.LANCZOS)
    px = small.load()
    print(f'== {p} ({w}x{h}) ==')
    for y in range(rows):
        line = ''
        for x in range(cols):
            r, g, b = px[x, y]
            l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
            ch = RAMP[min(len(RAMP) - 1, int(l * len(RAMP)))]
            line += ch
        print(line)
    # цветовая карта по зонам
    print('-- цветовые классы (G=зелень, B=синий, R=красный/тёплый, K=тёмный, W=светлый) --')
    for y in range(rows):
        line = ''
        for x in range(cols):
            r, g, b = px[x, y]
            mx, mn = max(r, g, b), min(r, g, b)
            if mx < 45: c = 'K'
            elif mx > 205 and mx - mn < 30: c = 'W'
            elif b > r + 18 and b > g: c = 'B'
            elif g >= r and g > b: c = 'G'
            elif r > g + 22: c = 'R'
            else: c = '.'
            line += c
        print(line)

if __name__ == '__main__':
    cols = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 72
    files = [a for a in sys.argv[1:] if not a.isdigit()]
    for f in files:
        preview(f, cols)