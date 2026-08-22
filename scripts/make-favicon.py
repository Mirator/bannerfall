"""Generate favicon.ico from the pixel map below.

The game has no build step and no image dependencies, so the icon is authored as
ASCII pixel art here and written straight out as a multi-size ICO (16/32/48,
nearest-neighbour scaled so the pixels stay hard). Colours come from PAL.world in
src/data.js; keep them in step if that palette moves.

Usage: python scripts/make-favicon.py   (writes favicon.ico at the repo root)
"""
import os
import struct

# PAL.world: ink background, gold pole, accent banner, cream fess
COLORS = {
    ".": "#1E2A4A",  # ink — same as the <body> background in index.html
    "P": "#FFD34D",  # hero gold
    "B": "#E0622F",  # accent, the colour the game already draws banners in
    "C": "#F2E3C1",  # cream
}

ART = [
    "................",
    "....PPPPPPPPP...",
    "....PBBBBBBBB...",
    "....PBBBBBBBB...",
    "....PBBBBBBBB...",
    "....PBCCCCCCB...",
    "....PBCCCCCCB...",
    "....PBBBBBBBB...",
    "....PBBBBBBBB...",
    "....PBBBBBBBB...",
    "....PBBBBBBBB...",
    "....PBBB..BBB...",
    "....PBB....BB...",
    "....P...........",
    "....P...........",
    "................",
]


def rgb(value):
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))


def image(scale):
    """One BMP-in-ICO payload: 32bpp BGRA, bottom-up, plus an empty AND mask."""
    size = 16 * scale
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r, g, b = rgb(COLORS[ART[y // scale][x // scale]])
            row += bytes((b, g, r, 255))
        rows.append(bytes(row))
    pixels = b"".join(reversed(rows))
    mask_stride = ((size + 31) // 32) * 4
    mask = b"\x00" * (mask_stride * size)
    header = struct.pack(
        "<IiiHHIIiiII", 40, size, size * 2, 1, 32, 0, len(pixels) + len(mask), 0, 0, 0, 0
    )
    return size, header + pixels + mask


def main():
    images = [image(scale) for scale in (1, 2, 3)]
    offset = 6 + 16 * len(images)
    directory, payloads = b"", b""
    for size, payload in images:
        directory += struct.pack(
            "<BBBBHHII", 0 if size >= 256 else size, 0 if size >= 256 else size,
            0, 0, 1, 32, len(payload), offset
        )
        payloads += payload
        offset += len(payload)
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "favicon.ico")
    with open(out, "wb") as handle:
        handle.write(struct.pack("<HHH", 0, 1, len(images)) + directory + payloads)
    print("wrote %s (%d images)" % (out, len(images)))


if __name__ == "__main__":
    main()
