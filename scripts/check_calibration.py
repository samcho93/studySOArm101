#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LeRobot 캘리브레이션 파일 점검 (8장 실습용)

각 조인트의 측정 범위가 상식적인지 검사합니다. 범위가 지나치게 좁으면
캘리브레이션 때 그 관절을 끝까지 움직이지 않은 것입니다.

  python check_calibration.py --id my_awesome_follower_arm --role follower
  python check_calibration.py --id my_awesome_leader_arm  --role leader
  python check_calibration.py --list
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

def _utf8_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass


_utf8_stdout()

CAL_ROOT = Path.home() / ".cache/huggingface/lerobot/calibration"

# 조인트별 기대 가동범위(서보 틱). URDF 한계를 틱으로 환산한 값의 80% 정도를
# 최소 기준으로 삼습니다. (2π rad = 4096 틱)
EXPECTED_TICKS = {
    "shoulder_pan": 2504,     # 220°
    "shoulder_lift": 2276,    # 200°
    "elbow_flex": 2207,       # 194°
    "wrist_flex": 2162,       # 190°
    "wrist_roll": 3641,       # 320°
    "gripper": 1252,          # 110°
}
MIN_RATIO = 0.5   # 기대치의 50% 미만이면 경고


def find_file(role: str, arm_id: str) -> Path | None:
    sub = "robots/so_follower" if role == "follower" else "teleoperators/so_leader"
    path = CAL_ROOT / sub / f"{arm_id}.json"
    return path if path.exists() else None


def list_all() -> int:
    if not CAL_ROOT.exists():
        print(f"캘리브레이션 디렉터리가 없습니다: {CAL_ROOT}")
        print("아직 한 번도 lerobot-calibrate 를 실행하지 않은 것 같습니다.")
        return 1
    files = sorted(CAL_ROOT.rglob("*.json"))
    if not files:
        print("캘리브레이션 파일이 없습니다.")
        return 1
    print(f"{CAL_ROOT} 아래 캘리브레이션 파일\n")
    for f in files:
        rel = f.relative_to(CAL_ROOT)
        role = "팔로워" if "robots" in rel.parts else "리더"
        print(f"  [{role}] {f.stem:<32} {rel}")
    return 0


def check(path: Path) -> int:
    data = json.loads(path.read_text(encoding="utf-8"))
    print(f"파일: {path}\n")
    print(f"{'조인트':<16}{'ID':>4}{'최소':>8}{'최대':>8}{'범위':>8}{'기대':>8}{'비율':>8}  판정")
    print("-" * 74)

    problems = []
    for name, info in data.items():
        lo = info.get("range_min", 0)
        hi = info.get("range_max", 0)
        span = hi - lo
        expect = EXPECTED_TICKS.get(name, 2000)
        ratio = span / expect if expect else 0

        if span <= 1:
            verdict, note = "치명적", "범위가 0입니다. 이 관절은 전혀 움직이지 않습니다"
        elif ratio < MIN_RATIO:
            verdict, note = "경고", f"기대치의 {ratio * 100:.0f}% 밖에 안 됩니다"
        elif ratio > 1.3:
            verdict, note = "확인", "기대보다 넓습니다. 서보 중위 설정을 확인하세요"
        else:
            verdict, note = "정상", ""

        if verdict != "정상":
            problems.append((name, note))

        print(f"{name:<16}{info.get('id', '?'):>4}{lo:>8}{hi:>8}{span:>8}"
              f"{expect:>8}{ratio * 100:>7.0f}%  {verdict}")

    print()
    if problems:
        print("확인이 필요한 항목")
        for name, note in problems:
            print(f"  · {name}: {note}")
        print("\n해결: 해당 관절을 가동범위 끝에서 끝까지 확실히 움직이며")
        print("      lerobot-calibrate 를 다시 실행하세요. (8장)")
        return 2

    print("모든 조인트가 정상 범위입니다.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="LeRobot 캘리브레이션 점검")
    ap.add_argument("--id", help="캘리브레이션 id (--robot.id / --teleop.id 에 쓴 값)")
    ap.add_argument("--role", choices=["follower", "leader"], default="follower")
    ap.add_argument("--file", help="JSON 파일 경로를 직접 지정")
    ap.add_argument("--list", action="store_true", help="캘리브레이션 파일 목록")
    args = ap.parse_args()

    if args.list:
        return list_all()

    if args.file:
        path = Path(args.file)
    elif args.id:
        path = find_file(args.role, args.id)
    else:
        ap.error("--id 또는 --file 중 하나가 필요합니다 (--list 로 목록 확인)")
        return 1

    if path is None or not path.exists():
        print("캘리브레이션 파일을 찾을 수 없습니다.")
        print(f"  기대 경로: {CAL_ROOT}/"
              f"{'robots/so_follower' if args.role == 'follower' else 'teleoperators/so_leader'}/"
              f"{args.id}.json")
        print("\n--list 로 실제로 있는 파일을 확인하세요.")
        return 1

    return check(path)


if __name__ == "__main__":
    raise SystemExit(main())
