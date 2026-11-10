#!/usr/bin/env python3
"""Generates the extension icons with the standard library only.

Design: dark rounded square, white ring with a white centre dot.
"""
import math
import struct
import zlib
from pathlib import Path

BG = (22, 22, 22)
FG = (255, 255, 255)
SS = 8  # supersampling factor


def rounded_square(x, y, r):
    # x, y in [0, 1]; corner radius r
    cx = min(max(x, r), 1 - r)
    cy = min(max(y, r), 1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def shade(x, y):
    """Returns (alpha_bg, alpha_fg) coverage for a sample point."""
    if not rounded_square(x, y, 0.22):
        return None
    d = math.hypot(x - 0.5, y - 0.5)
    if abs(d - 0.27) <= 0.055 or d <= 0.1:
        return FG
    return BG


def render(size):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    c = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size)
                    if c:
                        acc[0] += c[0]
                        acc[1] += c[1]
                        acc[2] += c[2]
                        acc[3] += 1
            n = acc[3]
            if n:
                row += bytes([acc[0] // n, acc[1] // n, acc[2] // n, round(255 * n / (SS * SS))])
            else:
                row += bytes(4)
        rows.append(bytes(row))
    return b"".join(rows)


def png(size, raw):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main():
    out = Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(exist_ok=True)
    for size in (16, 32, 48, 128):
        (out / f"icon-{size}.png").write_bytes(png(size, render(size)))
        print(f"icons/icon-{size}.png")


if __name__ == "__main__":
    main()
