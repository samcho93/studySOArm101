#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SO-ARM101 정기구학 / 역기구학 계산기 (2장, 15장 실습용)

사용법
  # 정기구학 — 조인트 각(도) 5개 또는 6개
  python so101_fk_ik.py --fk 0 -30 45 60 0

  # 역기구학 — 목표 TCP 위치(m)
  python so101_fk_ik.py --ik 0.24 0.00 0.17

  # 아래를 향하는 접근 방향 제약과 함께
  python so101_fk_ik.py --ik 0.22 0.00 0.08 --approach-down

  # 프리셋 자세 목록과 TCP
  python so101_fk_ik.py --poses

  # 작업영역 통계 (무작위 샘플링)
  python so101_fk_ik.py --workspace 50000
"""
from __future__ import annotations

import argparse
import sys
import math
import random

import numpy as np

import so101_kinematics as K


def _utf8_stdout() -> None:
    """Windows 콘솔(cp949)에서도 한글과 기호가 깨지지 않게 합니다."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass


_utf8_stdout()


def print_pose(q) -> None:
    deg = [math.degrees(v) for v in q]
    names = K.JOINT_NAMES
    print("조인트")
    for n, d, r, j in zip(names, deg, q, K.JOINTS):
        ticks = K.rad_to_ticks(r)
        norm = K.rad_to_norm(n, r)
        flag = "" if j.lower - 1e-9 <= r <= j.upper + 1e-9 else "  ← 한계 초과!"
        print(f"  {n:<14} {d:>8.2f}°  {r:>9.5f} rad  {ticks:>5d} tick  "
              f"{norm:>7.1f} norm{flag}")

    pose = K.tool_pose(q)
    p = pose[:3, 3]
    rpy = [math.degrees(v) for v in K.mat_to_rpy(pose)]
    print("\nTCP (gripper_frame_link)")
    print(f"  위치  x={p[0]:+.4f}  y={p[1]:+.4f}  z={p[2]:+.4f}  [m]")
    print(f"  자세  roll={rpy[0]:+.1f}  pitch={rpy[1]:+.1f}  yaw={rpy[2]:+.1f}  [deg]")
    print(f"  수평 도달 반경 {math.hypot(p[0], p[1]):.4f} m")


def cmd_fk(values) -> None:
    q = [math.radians(v) for v in values]
    while len(q) < 6:
        q.append(0.6)
    print_pose(q)


def cmd_ik(target, approach_down: bool) -> None:
    approach = [0.0, 0.0, -1.0] if approach_down else None
    q, err, ok = K.inverse(target, approach=approach)
    print(f"목표 TCP  ({target[0]:.3f}, {target[1]:.3f}, {target[2]:.3f}) m")
    print(f"결과      {'수렴 성공' if ok else '도달 불가'} — 오차 {err * 1000:.2f} mm\n")
    print_pose(q)


def cmd_poses() -> None:
    print(f"{'프리셋':<10} {'TCP x':>9} {'y':>9} {'z':>9}   조인트(도)")
    for name, q in K.POSES.items():
        p = K.tool_position(q)
        deg = "  ".join(f"{math.degrees(v):6.1f}" for v in q)
        print(f"{name:<10} {p[0]:>9.4f} {p[1]:>9.4f} {p[2]:>9.4f}   {deg}")


def cmd_workspace(samples: int) -> None:
    random.seed(0)
    best_r, max_z, min_z = 0.0, -9.0, 9.0
    above_table = 0
    for _ in range(samples):
        q = [random.uniform(j.lower, j.upper) for j in K.JOINTS]
        p = K.tool_position(q)
        r = math.hypot(p[0], p[1])
        best_r = max(best_r, r)
        max_z = max(max_z, p[2])
        min_z = min(min_z, p[2])
        if p[2] >= 0.02:
            above_table += 1
    print(f"샘플 {samples}개")
    print(f"  최대 수평 도달 반경 : {best_r * 100:.1f} cm")
    print(f"  TCP 높이 범위       : {min_z * 100:.1f} ~ {max_z * 100:.1f} cm")
    print(f"  테이블 위(z≥2cm) 비율: {above_table / samples * 100:.1f} %")
    print("\n참고: 조인트 한계만 고려한 이론값입니다. 실제로는 자기 충돌과")
    print("      케이블 간섭 때문에 더 좁습니다.")


def main() -> int:
    ap = argparse.ArgumentParser(description="SO-ARM101 FK/IK 계산기")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--fk", nargs="+", type=float, metavar="DEG",
                   help="정기구학: 조인트 각(도) 5개 또는 6개")
    g.add_argument("--ik", nargs=3, type=float, metavar=("X", "Y", "Z"),
                   help="역기구학: 목표 TCP 위치(m)")
    g.add_argument("--poses", action="store_true", help="프리셋 자세 목록")
    g.add_argument("--workspace", type=int, metavar="N",
                   help="작업영역 통계 (샘플 수)")
    ap.add_argument("--approach-down", action="store_true",
                    help="IK 에서 툴이 아래(-Z)를 향하도록 제약")
    args = ap.parse_args()

    if args.fk:
        cmd_fk(args.fk)
    elif args.ik:
        cmd_ik(args.ik, args.approach_down)
    elif args.poses:
        cmd_poses()
    else:
        cmd_workspace(args.workspace)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
