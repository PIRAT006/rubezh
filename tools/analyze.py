# -*- coding: utf-8 -*-
"""Анализ скриншотов: яркость, контраст, цветность, распределение по зонам."""
import sys
from PIL import Image

def analyze(p):
    im = Image.open(p).convert('RGB')
    w, h = im.size
    px = im.load()
    # выборка
    step = max(1, w // 160)
    n = 0
    tot = [0, 0, 0]
    lum_min, lum_max = 255, 0
    sat_sum = 0
    grid = [[0] * 4 for _ in range(3)]
    unique = set()
    for y in range(0, h, step):
        for x in range(0, w, step):
            r, g, b = px[x, y]
            l = 0.2126 * r + 0.7152 * g + 0.0722 * b
            tot[0] += r; tot[1] += g; tot[2] += b
            lum_min = min(lum_min, l); lum_max = max(lum_max, l)
            mx, mn = max(r, g, b), min(r, g, b)
            sat_sum += 0 if mx == 0 else (mx - mn) / mx
            gx = min(3, x * 4 // w); gy = min(2, y * 3 // h)
            grid[gy][gx] += l
            unique.add((r >> 4, g >> 4, b >> 4))
            n += 1
    print(f'{p}: {w}x{h} samples={n}')
    print(f'  avg RGB = ({tot[0]/n:.0f}, {tot[1]/n:.0f}, {tot[2]/n:.0f})')
    print(f'  lum min/max = {lum_min:.0f}/{lum_max:.0f}  avg sat = {sat_sum/n:.2f}')
    print(f'  unique 12-bit colors = {len(unique)}')
    for gy in range(3):
        row = ' '.join(f'{grid[gy][gx]/ (n/12):6.1f}' for gx in range(4))
        print('   ', row)

if __name__ == '__main__':
    for p in sys.argv[1:]:
        analyze(p)