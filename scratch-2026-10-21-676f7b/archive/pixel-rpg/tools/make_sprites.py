"""Generates the starter 16-bit pixel art in assets/.

Pure Python (no Pillow needed). Every colour comes from the same 16-colour
palette as css/variables.css. Replace any PNG with your own art at the same
size and frame layout and the site picks it up unchanged.

    python tools/make_sprites.py
"""
import math
import os
import random
import struct
import zlib

random.seed(7)
OUT = os.path.join(os.path.dirname(__file__), "..", "assets")

PALETTE = {
    0: "#0d0221", 1: "#1a0b3d", 2: "#2e1760", 3: "#4b2a8c",
    4: "#6d3fc0", 5: "#9b6fe0", 6: "#c5a3ff", 7: "#e8d5ff",
    8: "#ff7eb6", 9: "#ffb3d1", 10: "#ffe4f0", 11: "#fff7fb",
    12: "#ffd36e", 13: "#3d7a5a", 14: "#6fbf73", 15: "#ff5c8a",
}


def rgba(index):
    h = PALETTE[index]
    return bytes(int(h[i:i + 2], 16) for i in (1, 3, 5)) + b"\xff"


class Img:
    def __init__(self, w, h, fill=None):
        self.w, self.h = w, h
        self.px = [[fill] * w for _ in range(h)]

    def set(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1):
            for x in range(x0, x1):
                self.set(x, y, c)

    def band(self, y0, y1, c):
        self.rect(0, y0, self.w, y1, c)

    def dither(self, y0, y1, a, b):
        """Checkerboard between two colours: the classic 16-bit gradient."""
        for y in range(y0, y1):
            for x in range(self.w):
                self.set(x, y, a if (x + y) % 2 else b)

    def poly(self, pts, c):
        ys = [p[1] for p in pts]
        for y in range(int(min(ys)), int(max(ys)) + 1):
            sy = y + 0.5
            xs = []
            for i in range(len(pts)):
                (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % len(pts)]
                if (y1 <= sy < y2) or (y2 <= sy < y1):
                    xs.append(x1 + (sy - y1) * (x2 - x1) / (y2 - y1))
            xs.sort()
            for a, b in zip(xs[::2], xs[1::2]):
                for x in range(int(round(a)), int(round(b))):
                    self.set(x, y, c)

    def circle(self, cx, cy, r, c):
        for y in range(cy - r, cy + r + 1):
            for x in range(cx - r, cx + r + 1):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r + r * 0.6:
                    self.set(x, y, c)

    def tri(self, cx, top, height, half, c):
        for row in range(height):
            hw = int(round(row * half / max(height - 1, 1)))
            self.rect(cx - hw, top + row, cx + hw + 1, top + row + 1, c)

    def blit(self, other, ox, oy):
        for y in range(other.h):
            for x in range(other.w):
                if other.px[y][x] is not None:
                    self.set(ox + x, oy + y, other.px[y][x])

    def save(self, name):
        raw = b"".join(
            b"\x00" + b"".join(rgba(c) if c is not None else b"\x00\x00\x00\x00" for c in row)
            for row in self.px
        )

        def chunk(tag, data):
            return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

        png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 6, 0, 0, 0))
        png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(png)
        print(f"  {name:16s} {self.w}x{self.h}")


def from_rows(rows, key):
    img = Img(len(rows[0]), len(rows))
    for y, row in enumerate(rows):
        assert len(row) == img.w, (y, row)
        for x, ch in enumerate(row):
            if ch != ".":
                img.set(x, y, key[ch])
    return img


def stars(img, count, max_y, big=3):
    for _ in range(count):
        img.set(random.randrange(img.w), random.randrange(max_y), random.choice([7, 7, 11]))
    for _ in range(big):
        x, y = random.randrange(4, img.w - 4), random.randrange(4, max_y)
        img.set(x, y, 11)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            img.set(x + dx, y + dy, 6)


W, H = 120, 270   # scene art size (portrait)

# ---------------------------------------------------------------- Pakuranga
def nz_sky():
    s = Img(W, H)
    s.band(0, 36, 1); s.dither(36, 40, 1, 2); s.band(40, 80, 2); s.dither(80, 84, 2, 3)
    s.band(84, 118, 3); s.dither(118, 122, 3, 4); s.band(122, 142, 4); s.dither(142, 146, 4, 5)
    s.band(146, 158, 5); s.dither(158, 161, 5, 9); s.band(161, 168, 9); s.band(168, 172, 10)
    stars(s, 34, 96)
    # Rangitoto
    s.poly([(48, 172), (62, 166), (74, 162), (78, 160), (82, 160), (86, 162), (98, 166), (114, 172)], 5)
    # City + Sky Tower
    for r in [(6, 166, 10, 172), (11, 162, 14, 172), (15, 167, 18, 172), (23, 164, 27, 172), (28, 168, 32, 172), (33, 165, 36, 172)]:
        s.rect(*r, 4)
    s.rect(20, 150, 21, 172, 4); s.rect(18, 153, 23, 155, 4); s.rect(20, 141, 21, 150, 4)
    for p in [(12, 165), (24, 167), (34, 168), (8, 169)]:
        s.set(*p, 12)
    # Estuary
    s.band(172, 190, 5); s.dither(190, 196, 5, 4); s.band(196, H, 4)
    for y, x0, x1 in [(175, 60, 82), (178, 66, 78), (182, 56, 86), (186, 68, 76), (180, 20, 28), (184, 96, 104)]:
        s.rect(x0, y, x1, y + 1, 10 if y < 180 else 9)
    return s


def nz_land():
    s = Img(W, H)
    s.poly([(0, 200), (20, 195), (45, 193), (70, 197), (95, 199), (120, 192), (120, H), (0, H)], 2)
    for x, base in [(28, 196), (40, 195), (68, 198), (80, 199)]:
        s.rect(x, base - 3, x + 5, base + 1, 1)
        s.rect(x + 1, base - 4, x + 4, base - 3, 1); s.set(x + 2, base - 5, 1)
        s.set(x + 2, base - 2, 12)
    s.poly([(0, 222), (25, 214), (55, 217), (80, 224), (105, 221), (120, 216), (120, H), (0, H)], 1)
    # Pōhutukawa
    s.rect(19, 210, 21, 222, 0)
    for c in [(12, 206, 7), (21, 201, 8), (30, 207, 6), (17, 212, 5), (26, 213, 5)]:
        s.circle(*c, 0)
    for _ in range(26):
        x, y = random.randrange(6, 36), random.randrange(194, 214)
        if s.px[y][x] == 0:
            s.set(x, y, random.choice([15, 15, 8]))
    # Norfolk pine
    s.rect(102, 156, 103, 224, 0)
    for i in range(11):
        y = 160 + i * 5
        hw = min(1 + i, 8)
        s.rect(102 - hw, y, 103 + hw, y + 1, 0)
        s.set(102 - hw, y + 1, 0); s.set(102 + hw, y + 1, 0)
    s.poly([(0, 250), (40, 244), (80, 247), (120, 242), (120, H), (0, H)], 0)
    return s


# ---------------------------------------------------------------- Swiss Alps
def alps_sky():
    s = Img(W, H)
    s.band(0, 50, 0); s.dither(50, 54, 0, 1); s.band(54, 110, 1); s.dither(110, 114, 1, 2)
    s.band(114, 150, 2); s.dither(150, 154, 2, 3); s.band(154, 185, 3); s.dither(185, 189, 3, 4)
    s.band(189, H, 4)
    stars(s, 60, 150, big=5)
    cx, cy = 88, 42
    for y in range(cy - 11, cy + 12):            # dithered moon halo
        for x in range(cx - 11, cx + 12):
            d = math.hypot(x - cx, y - cy)
            if 7 < d <= 10 and (x + y) % 2 == 0:
                s.set(x, y, 2)
    s.circle(cx, cy, 6, 10)
    s.set(86, 40, 7); s.set(90, 44, 7); s.set(89, 39, 7); s.set(85, 45, 11)
    return s


def alps_land():
    s = Img(W, H)
    far = [(0, 190), (10, 178), (18, 184), (30, 170), (40, 180), (52, 168), (64, 176), (76, 166), (88, 178), (100, 170), (110, 180), (120, 174), (120, H), (0, H)]
    s.poly(far, 5)
    for x, y in [(10, 178), (30, 170), (52, 168), (76, 166), (100, 170), (120, 174)]:
        s.tri(x, y, 4, 2, 7)
    # The Matterhorn
    s.poly([(20, 232), (40, 190), (50, 160), (56, 130), (58, 110), (60, 104), (63, 108), (66, 130), (72, 160), (90, 195), (110, 232)], 6)
    s.poly([(60, 104), (63, 108), (66, 130), (72, 160), (90, 195), (110, 232), (70, 232), (64, 150)], 4)
    s.poly([(60, 104), (63, 108), (65, 122), (61, 117), (58, 124), (56, 116), (58, 110)], 10)
    for x, y0, y1 in [(54, 136, 146), (50, 156, 168), (46, 172, 180), (62, 132, 140)]:
        s.rect(x, y0, x + 1, y1, 7)
    # Mid ridge
    s.poly([(0, 232), (14, 218), (26, 226), (40, 212), (54, 224), (70, 215), (86, 228), (100, 214), (120, 224), (120, H), (0, H)], 3)
    for x, y in [(14, 218), (40, 212), (70, 215), (100, 214)]:
        s.tri(x, y, 3, 2, 6)
    # Snowfield
    s.poly([(0, 246), (30, 240), (60, 243), (90, 238), (120, 241), (120, H), (0, H)], 7)
    s.poly([(0, 258), (50, 254), (120, 257), (120, H), (0, H)], 6)
    # Pines
    for cx, base, h in [(10, 248, 26), (21, 246, 18), (104, 244, 30), (93, 246, 18)]:
        tier = h // 3
        for k in range(3):
            top = base - h + k * tier
            s.tri(cx, top, tier + 3, 2 + k * 2, 1)
            s.set(cx, top, 10)
        s.rect(cx, base, cx + 1, base + 3, 0)
    # Chalet
    s.rect(60, 232, 73, 241, 2)
    s.tri(66, 225, 8, 8, 0)
    s.rect(59, 225, 74, 226, 0)
    for x in range(58, 75):
        if (x + 225) % 2:
            s.set(x, 232, 10)
    s.rect(64, 229, 69, 230, 10); s.rect(65, 228, 68, 229, 10); s.set(66, 225, 10)
    s.rect(64, 235, 67, 238, 12); s.rect(69, 235, 71, 237, 12)
    s.rect(70, 226, 72, 230, 0)
    return s


# ---------------------------------------------------------------- Sprites
TULIP_KEY = {"o": 1, "k": 8, "p": 5, "P": 4, "l": 6, "g": 14, "d": 13}
STEM = [".......dg......."]
LEAVES = [
    "..oo...dg.......",
    ".oggo..dg.......",
    ".ogggo.dg...oo..",
    "..oggo.dg..oggo.",
    "..ogggodg.ogggo.",
    "...oggodgoggdo..",
    "...oggddgggdo...",
    "....oggdggdo....",
    ".....ogdgdo.....",
    "......odgo......",
]
EMPTY = ["................"]

OPEN_HEAD = [
    "...o...oo...o...",
    "..oko.okko.oko..",
    "..okpookkoopko..",
    "..olppplkpppPo..",
    "..olpppllpppPo..",
    "..olpppllppPPo..",
    "..olppplpppPPo..",
    "..oolppppppPoo..",
    "...olppppppPo...",
    "....olpppPPo....",
    ".....ooooooo....",
]
OPENING_HEAD = [
    "......o..o......",
    ".....okookko....",
    ".....olpkppo....",
    ".....olpppPo....",
    ".....olpppPo....",
    ".....olpppPo....",
    "......olpPo.....",
    ".......ooo......",
]
BUD_HEAD = [
    ".......oo.......",
    "......okko......",
    "......opPo......",
    "......olPo......",
    "......olPo......",
    ".......oo.......",
]


def tulip_frame(head, head_top, shift=0):
    rows = EMPTY * head_top + head
    rows += STEM * (18 - len(rows))
    rows = rows[:18] + LEAVES + STEM * 4
    if shift:
        # lean: move the head and the top of the stem one pixel sideways
        def mv(r):
            return (r[1:] + ".") if shift < 0 else ("." + r[:-1])
        rows = [mv(r) if i < head_top + len(head) + 2 else r for i, r in enumerate(rows)]
    return rows


def tulip_sheet():
    sprout = EMPTY * 25 + ["......o..o......", ".....ogoogo.....", "......oggo......"] + STEM * 4
    frames = [
        sprout,
        tulip_frame(BUD_HEAD, 8),
        tulip_frame(OPENING_HEAD, 5),
        tulip_frame(OPEN_HEAD, 3),
        tulip_frame(OPEN_HEAD, 3, shift=-1),
        tulip_frame(OPEN_HEAD, 3, shift=1),
    ]
    sheet = Img(16 * len(frames), 32)
    for i, rows in enumerate(frames):
        assert len(rows) == 32, (i, len(rows))
        sheet.blit(from_rows(rows, TULIP_KEY), i * 16, 0)
    return sheet


def sheet(frames, key):
    imgs = [from_rows(f, key) for f in frames]
    out = Img(imgs[0].w * len(imgs), imgs[0].h)
    for i, im in enumerate(imgs):
        out.blit(im, i * im.w, 0)
    return out


HEART = [
    ["........", ".kk.kk..", "kwkkkkk.", "kkkkkkk.", ".kkkkk..", "..kkk...", "...k....", "........"],
    ["........", "........", "..k.k...", ".kwkkk..", ".kkkkk..", "..kkk...", "...k....", "........"],
]
SPARKLE = [
    ["...l...", "...l...", "..lwl..", "llwwwll", "..lwl..", "...l...", "...l..."],
    [".......", ".......", "...l...", "..lwl..", "...l...", ".......", "......."],
]

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print("Writing assets/")
    nz_sky().save("nz-sky.png")
    nz_land().save("nz-land.png")
    alps_sky().save("alps-sky.png")
    alps_land().save("alps-land.png")
    tulip_sheet().save("tulip.png")
    sheet(HEART, {"k": 8, "w": 10}).save("heart.png")
    sheet(SPARKLE, {"l": 7, "w": 11}).save("sparkle.png")
