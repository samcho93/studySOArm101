#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SO-ARM101 STL 메시 내려받기 + URDF 경로 변환
------------------------------------------------------------------------------
프리미티브(박스) 모델 대신 실제 CAD 메시로 보고 싶을 때 사용합니다.

  python fetch_meshes.py

하는 일
  1. TheRobotStudio/SO-ARM100 저장소에서 STL 13개를 내려받아
     src/so_arm101_description/meshes/ 에 저장
  2. so101_new_calib.urdf 의 "assets/*.stl" 경로를
     "package://so_arm101_description/meshes/*.stl" 로 바꿔
     so101_meshes.urdf 로 저장

표준 라이브러리만 사용합니다.
"""
from __future__ import annotations

import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

def _utf8_stdout() -> None:
    """Windows 콘솔(cp949)에서도 한글과 기호가 깨지지 않게 합니다."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass


_utf8_stdout()

ROOT = Path(__file__).resolve().parent
PKG = ROOT / "src/so_arm101_description"
MESH_DIR = PKG / "meshes"
SRC_URDF = PKG / "urdf/so101_new_calib.urdf"
OUT_URDF = PKG / "urdf/so101_meshes.urdf"

BASE_URL = ("https://raw.githubusercontent.com/TheRobotStudio/SO-ARM100"
            "/main/Simulation/SO101/assets/")

STLS = [
    "base_motor_holder_so101_v1.stl",
    "base_so101_v2.stl",
    "motor_holder_so101_base_v1.stl",
    "motor_holder_so101_wrist_v1.stl",
    "moving_jaw_so101_v1.stl",
    "rotation_pitch_so101_v1.stl",
    "sts3215_03a_no_horn_v1.stl",
    "sts3215_03a_v1.stl",
    "under_arm_so101_v1.stl",
    "upper_arm_so101_v1.stl",
    "waveshare_mounting_plate_so101_v2.stl",
    "wrist_roll_follower_so101_v1.stl",
    "wrist_roll_pitch_so101_v2.stl",
]


def main() -> int:
    if not SRC_URDF.exists():
        print("원본 URDF 를 찾을 수 없습니다:", SRC_URDF)
        return 1

    MESH_DIR.mkdir(parents=True, exist_ok=True)

    ok, failed = 0, []
    for name in STLS:
        dest = MESH_DIR / name
        if dest.exists() and dest.stat().st_size > 0:
            print("  이미 있음:", name)
            ok += 1
            continue
        try:
            print("  내려받는 중:", name, end=" ... ", flush=True)
            with urllib.request.urlopen(BASE_URL + name, timeout=60) as resp:
                dest.write_bytes(resp.read())
            print("%.1f KB" % (dest.stat().st_size / 1024))
            ok += 1
        except (urllib.error.URLError, TimeoutError) as exc:
            print("실패 (%s)" % exc)
            failed.append(name)

    text = SRC_URDF.read_text(encoding="utf-8")
    text = re.sub(r'filename="assets/([^"]+)"',
                  r'filename="package://so_arm101_description/meshes/\1"',
                  text)
    OUT_URDF.write_text(text, encoding="utf-8")

    print()
    print("메시 %d/%d 개 준비 완료" % (ok, len(STLS)))
    if failed:
        print("실패한 파일:", ", ".join(failed))
    print("경로 변환 URDF:", OUT_URDF)
    print()
    print("RViz 에서 보려면:")
    print("  ros2 run xacro xacro <없음>   # 이 파일은 순수 URDF 입니다")
    print("  ros2 run robot_state_publisher robot_state_publisher "
          "--ros-args -p robot_description:=\"$(cat %s)\"" % OUT_URDF.name)
    return 0 if not failed else 2


if __name__ == "__main__":
    sys.exit(main())
