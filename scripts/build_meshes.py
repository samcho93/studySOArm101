#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
so101_new_calib.urdf 의 STL 메시를 브라우저용 번들 하나로 묶습니다.

원본 STL 13개는 16MB 입니다. 삼각형마다 정점을 중복 저장하는 형식이라
그대로 쓰기에는 너무 무겁습니다. 여기서는

  1. 정점을 **0.2mm 격자**로 반올림해 같은 점을 하나로 합치고
  2. 좌표를 메시 최소점 기준 **uint16** 으로 저장하고
  3. 인덱스도 uint16 으로 저장합니다 (모든 메시가 정점 65536개 미만)

이렇게 해서 약 1.4MB 가 됩니다. 0.2mm 는 화면에서 원본과 구분되지 않습니다.
(0.5mm 까지 줄이면 면이 눈에 띄게 지저분해집니다.)

법선은 넣지 않습니다. 브라우저 쪽에서 flatShading 으로 그리므로 필요 없고,
그만큼 파일이 작아집니다.

사용법:

  # 저장소를 clone 해 두었다면
  python build_meshes.py --repo ../SO-ARM100

  # 아니면 GitHub 에서 바로 받아서
  python build_meshes.py --download

출력: assets/mesh/so101-meshes.bin

원본 메시 저작권: TheRobotStudio/SO-ARM100 (Apache-2.0)
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np

RAW = ("https://raw.githubusercontent.com/TheRobotStudio/SO-ARM100/main/"
       "Simulation/SO101/")
URDF_NAME = "so101_new_calib.urdf"
UNIT = 0.0002          # 0.2mm 격자
MAGIC = b"SO101MSH"
VERSION = 1


def _utf8_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass


_utf8_stdout()


# ------------------------------------------------------------------ 원본 읽기

def fetch(rel: str, repo: Path | None) -> bytes:
    """저장소 폴더에서, 없으면 GitHub 에서 파일을 가져옵니다."""
    if repo is not None:
        p = repo / "Simulation" / "SO101" / rel
        if not p.exists():
            sys.exit("파일이 없습니다: %s" % p)
        return p.read_bytes()
    url = RAW + rel
    print("  받는 중 %s" % rel)
    return urllib.request.urlopen(url, timeout=120).read()


def parse_stl(buf: bytes) -> np.ndarray:
    """바이너리 STL 을 (삼각형, 3, 3) 배열로. ASCII 는 지원하지 않습니다."""
    if len(buf) < 84:
        raise ValueError("STL 이 너무 짧습니다")
    n = struct.unpack_from("<I", buf, 80)[0]
    if 84 + n * 50 != len(buf):
        raise ValueError("바이너리 STL 이 아닙니다 (ASCII 는 지원하지 않습니다)")
    rec = np.frombuffer(buf, dtype=np.uint8, count=n * 50, offset=84).reshape(n, 50)
    return rec[:, 12:48].copy().view(np.float32).reshape(n, 3, 3)


# ------------------------------------------------------------------ 메시 압축

def quantize(tris: np.ndarray):
    """
    정점을 0.2mm 격자로 합치고 인덱스 메시로 바꿉니다.

    @returns (min_xyz, uint16 좌표(N,3), uint16 인덱스(M,3))
    """
    verts = tris.reshape(-1, 3)
    grid = np.round(verts / UNIT).astype(np.int64)
    uniq, inv = np.unique(grid, axis=0, return_inverse=True)

    idx = inv.reshape(-1, 3)
    # 두 꼭짓점이 같은 칸으로 합쳐진 삼각형은 면적이 0 이라 버립니다
    keep = ((idx[:, 0] != idx[:, 1]) & (idx[:, 1] != idx[:, 2])
            & (idx[:, 0] != idx[:, 2]))
    idx = idx[keep]
    # 겹쳐서 똑같아진 삼각형도 하나만 남깁니다
    order = np.lexsort(np.sort(idx, axis=1).T)
    srt = np.sort(idx, axis=1)[order]
    first = np.ones(len(srt), bool)
    first[1:] = (srt[1:] != srt[:-1]).any(axis=1)
    idx = idx[order][first]

    lo = uniq.min(axis=0)
    local = (uniq - lo).astype(np.int64)
    if local.max() > 0xFFFF:
        raise ValueError("좌표 범위가 uint16 을 넘습니다")
    if len(uniq) > 0xFFFF:
        raise ValueError("정점이 65535개를 넘습니다")
    return (lo * UNIT).astype(np.float64), local.astype(np.uint16), idx.astype(np.uint16)


# ------------------------------------------------------------------ URDF 읽기

def kids(node, tag):
    return [c for c in node if c.tag == tag]


def nums(text, n, dflt):
    if not text:
        return list(dflt)
    v = [float(x) for x in text.split()]
    return v if len(v) == n else list(dflt)


def read_visuals(urdf_text: str):
    """링크별 <visual> 배치를 읽습니다. (메시 파일명, origin, 재질)"""
    robot = ET.fromstring(urdf_text)
    mats = {}
    for m in kids(robot, "material"):
        c = kids(m, "color")
        if c and m.get("name"):
            mats[m.get("name")] = nums(c[0].get("rgba"), 4, (0.8, 0.8, 0.8, 1))

    links = {}
    for link in kids(robot, "link"):
        out = []
        for vis in kids(link, "visual"):
            geo = kids(vis, "geometry")
            if not geo:
                continue
            mesh = kids(geo[0], "mesh")
            if not mesh:
                continue                      # 기본 도형은 다루지 않습니다
            org = kids(vis, "origin")
            name = mesh[0].get("filename", "").split("/")[-1]
            mat = kids(vis, "material")
            mat_name = mat[0].get("name", "") if mat else ""
            out.append({
                "file": name,
                "xyz": nums(org[0].get("xyz") if org else None, 3, (0, 0, 0)),
                "rpy": nums(org[0].get("rpy") if org else None, 3, (0, 0, 0)),
                # 시뮬레이터의 기존 팔레트를 그대로 쓰도록 두 갈래로만 나눕니다
                "mat": "servo" if "sts" in mat_name.lower() else "print",
                "rgba": mats.get(mat_name),
            })
        if out:
            links[link.get("name")] = out
    return links


# ------------------------------------------------------------------ 묶기

def build(repo: Path | None, out: Path) -> None:
    urdf_text = fetch(URDF_NAME, repo).decode("utf-8")
    links = read_visuals(urdf_text)

    files = sorted({v["file"] for vs in links.values() for v in vs})
    print("URDF 가 참조하는 메시 %d개" % len(files))

    order = {}
    meshes, blobs = [], []
    offset = 0
    src_bytes = 0
    for name in files:
        raw = fetch("assets/" + name, repo)
        src_bytes += len(raw)
        lo, pos, idx = quantize(parse_stl(raw))
        order[name] = len(meshes)
        meshes.append({
            "name": name,
            "min": [round(float(x), 7) for x in lo],
            "vcount": int(len(pos)),
            "icount": int(len(idx)),
            "pos": offset,
            "idx": offset + pos.nbytes,
        })
        blobs.append(pos.tobytes())
        blobs.append(idx.tobytes())
        offset += pos.nbytes + idx.nbytes
        print("  %-42s 정점 %5d  삼각형 %6d" % (name, len(pos), len(idx)))

    header = {
        "unit": UNIT,
        "source": "TheRobotStudio/SO-ARM100 " + URDF_NAME + " (Apache-2.0)",
        "note": "정점을 0.2mm 격자로 합친 인덱스 메시. 법선 없음(flatShading).",
        "meshes": meshes,
        "links": {
            name: [{
                "mesh": order[v["file"]],
                "xyz": [round(x, 8) for x in v["xyz"]],
                "rpy": [round(x, 8) for x in v["rpy"]],
                "mat": v["mat"],
            } for v in vs]
            for name, vs in links.items()
        },
    }
    hdr = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    hdr += b" " * ((-len(hdr)) % 4)          # 뒤 데이터의 2바이트 정렬을 지킵니다

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("wb") as f:
        f.write(MAGIC)
        f.write(struct.pack("<II", VERSION, len(hdr)))
        f.write(hdr)
        for b in blobs:
            f.write(b)

    # Artifact 는 .bin 을 서빙하지 않습니다. 같은 데이터를 스크립트로도 내보내
    # 두고, .bin 을 못 받는 곳에서는 so101-meshes.js 가 이쪽을 부릅니다.
    import base64
    b64 = out.with_name(out.stem + ".b64.js")
    payload = base64.b64encode(out.read_bytes()).decode("ascii")
    b64.write_text(
        "/* %s — %s 를 base64 로 담은 사본.\n"
        "   Artifact 처럼 .bin 을 서빙하지 않는 곳에서 쓰입니다. */\n"
        "window.SO101MeshData = \"%s\";\n" % (b64.name, out.name, payload),
        encoding="utf-8")

    size = out.stat().st_size
    import gzip
    gz = len(gzip.compress(out.read_bytes(), 9))
    print("\n%s" % out)
    print("  원본 STL %.2fMB → 번들 %.2fMB (gzip %.2fMB, %.1f배)"
          % (src_bytes / 1e6, size / 1e6, gz / 1e6, src_bytes / size))
    print("  메시 %d개 / 링크 %d개 / 삼각형 %d"
          % (len(meshes), len(header["links"]),
             sum(m["icount"] for m in meshes)))
    print("%s\n  base64 사본 %.2fMB (.bin 을 서빙하지 않는 곳용)"
          % (b64, b64.stat().st_size / 1e6))


def main() -> int:
    ap = argparse.ArgumentParser(description="SO-101 메시를 브라우저용으로 묶습니다")
    ap.add_argument("--repo", type=Path,
                    help="clone 한 SO-ARM100 저장소 경로 (생략하면 --download)")
    ap.add_argument("--download", action="store_true",
                    help="GitHub 에서 직접 받아옵니다")
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parent.parent
                    / "assets" / "mesh" / "so101-meshes.bin")
    args = ap.parse_args()
    if args.repo is None and not args.download:
        ap.error("--repo 또는 --download 중 하나가 필요합니다")
    build(args.repo, args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
