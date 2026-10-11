#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v113 LOGOTIP ALMASHTIRISH — faqat logotip fayllari, hech narsa boshqa o'zgarmaydi.
Manba: upload/IMG_20261009_122657_780.jpg (1126x1133, oltin halqa markazi ~566,566)
Chiqish: web/ + android/ dagi BARCHA logotip fayllari (nomlar va o'lchamlar saqlanadi)
"""
from PIL import Image, ImageDraw
import numpy as np

SRC = '/home/z/my-project/upload/IMG_20261009_122657_780.jpg'
WEB = '/home/z/my-project/web/'
AND = '/home/z/my-project/android/res/'

src = Image.open(SRC).convert('RGB')
W, H = src.size  # 1126 x 1133
CX, CY = 566, 566          # doira markazi (manbada)
R_OUT = 556                # tashqi oltin halqa radiusi

# --- Kvadrat crop markazlashtirilgan (doira markazi bo'yicha) ---
half = W // 2              # 563
left = max(0, CX - half)
top = max(0, CY - half)
sq = src.crop((left, top, left + 2*half, top + 2*half))  # 1126x1126

def circle_mask(size, frac=0.995):
    """Antialiased doira maska (4x supersample)."""
    ss = size * 4
    m = Image.new('L', (ss, ss), 0)
    d = ImageDraw.Draw(m)
    r = ss / 2 * frac
    cx = ss / 2
    d.ellipse((cx - r, cx - r, cx + r, cx + r), fill=255)
    return m.resize((size, size), Image.LANCZOS)

def emblem(size, frac=0.995):
    """Doira shaklidagi emblem — burchaklari shaffof."""
    im = sq.resize((size, size), Image.LANCZOS).convert('RGBA')
    im.putalpha(circle_mask(size, frac))
    return im

def fullbleed(size, mode='RGBA'):
    """To'liq kvadrat — rasm o'zi (atlas fon bilan)."""
    return sq.resize((size, size), Image.LANCZOS).convert(mode)

# Fon rangi — manba burchaklaridan o'rtacha (maskable uchun)
arr = np.array(src)
corners = np.concatenate([
    arr[:40, :40].reshape(-1, 3), arr[:40, -40:].reshape(-1, 3),
    arr[-40:, :40].reshape(-1, 3), arr[-40:, -40:].reshape(-1, 3)])
bg = tuple(int(v) for v in corners.mean(axis=0))
print('maskable bg color:', bg)

def maskable(size):
    """Maskable: emblem xavfsiz zonada (80% doiraga sig'adi → 76% o'lcham)."""
    canvas = Image.new('RGBA', (size, size), bg + (255,))
    es = int(size * 0.76)
    em = emblem(es)
    off = (size - es) // 2
    canvas.paste(em, (off, off), em)
    return canvas

def foreground(size):
    """Adaptive foreground: emblem markazda ~58% (108dp grid xavfsiz zonasi)."""
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    es = int(size * 0.58)
    em = emblem(es)
    off = (size - es) // 2
    canvas.paste(em, (off, off), em)
    return canvas

def save_opt(im, path):
    """Veb uchun og'irlik optimallashtirish: 256 rang (dither bilan) — sifat saqlanadi."""
    q = im.quantize(colors=256, method=2)
    q.save(path, optimize=True)

# ============ WEB ============
save_opt(emblem(1040), WEB + 'logo.png')                   # asosiy logo
save_opt(fullbleed(192), WEB + 'icon-192.png')
save_opt(fullbleed(512), WEB + 'icon-512.png')
save_opt(maskable(192), WEB + 'maskable-192.png')
save_opt(maskable(512), WEB + 'maskable-512.png')
save_opt(emblem(64), WEB + 'favicon.png')
save_opt(fullbleed(180), WEB + 'apple-touch-icon.png')
print('web/ OK')

# ============ ANDROID ============
# Launcher (full-bleed, RGB — eski fayllar ham RGB edi)
for dpi, s in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
    fullbleed(s, 'RGB').save(AND + f'mipmap-{dpi}/ic_launcher.png', optimize=True)
# Adaptive foreground (shaffof fon + markazda emblem)
for dpi, s in [('mdpi', 108), ('hdpi', 162), ('xhdpi', 216), ('xxhdpi', 324), ('xxxhdpi', 432)]:
    foreground(s).save(AND + f'mipmap-{dpi}/ic_launcher_foreground.png', optimize=True)
# Splash
save_opt(emblem(480), AND + 'drawable-nodpi/splash_logo.png')
print('android/ OK')

print('HAMMASI TAYYOR')
