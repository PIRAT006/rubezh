# -*- coding: utf-8 -*-
"""Сравнение двух скриншотов: где именно различаются (наличие нарисованных объектов)."""
import sys
from PIL import Image, ImageChops

def diff(a, b, label_a='A', label_b='B'):
    ia = Image.open(a).convert('RGB')
    ib = Image.open(b).convert('RGB')
    if ia.size != ib.size:
        ib = ib.resize(ia.size)
    d = ImageChops.difference(ia, ib)
    w, h = d.size
    px = d.load()
    # карта различий 60x30
    cols, rows = 60, 26
    print(f'--- diff {a} vs {b} ---')
    total = 0
    hot = 0
    for ry in range(rows):
        line = ''
        for rx in range(cols):
            x0, x1 = rx * w // cols, (rx + 1) * w // cols
            y0, y1 = ry * h // rows, (ry + 1) * h // rows
            s = 0
            n = 0
            for y in range(y0, y1, 3):
                for x in range(x0, x1, 3):
                    r, g, bb = px[x, y]
                    s += (r + g + bb) / 3
                    n += 1
            avg = s / max(1, n)
            total += avg
            if avg > 12: hot += 1
            line += '#' if avg > 30 else ('+' if avg > 12 else ('.' if avg > 3 else ' '))
        print(line)
    print(f'total avg diff = {total/(rows*cols):.2f}, hot cells = {hot}')

if __name__ == '__main__':
    diff(sys.argv[1], sys.argv[2])