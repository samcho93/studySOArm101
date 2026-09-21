#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rerun + URDF visualizer 플러그인으로 SO-ARM101 보기 (15장 실습용)

TheRobotStudio 저장소의 URDF 를 rerun 의 **외부 로더**(URDF visualizer
플러그인)로 불러온 뒤, 이 강좌의 기구학(so101_kinematics.py)으로 계산한
자세를 같은 엔티티에 실어 **움직이게** 합니다.

  # 준비 (한 번만)
  pip install rerun-sdk
  pip install git+https://github.com/rerun-io/rerun-loader-python-example-urdf.git
  git clone https://github.com/TheRobotStudio/SO-ARM100.git

  # 자세 하나 보기
  python rerun_view_so101.py --urdf SO-ARM100/Simulation/SO101/so101_new_calib.urdf

  # 관절을 한계까지 차례로 흔들어 보기
  python rerun_view_so101.py --urdf .../so101_new_calib.urdf --sweep

  # 브라우저 시뮬레이터에서 녹화한 궤적 재생
  python rerun_view_so101.py --urdf .../so101_new_calib.urdf \
      --trajectory so101_trajectory.json

URDF 없이도 (`--urdf` 생략) 뼈대와 TCP 궤적만으로 동작합니다.
"""
from __future__ import annotations

import argparse
import json

import shutil
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import so101_kinematics as K  # noqa: E402


def _utf8_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass


_utf8_stdout()

PREFIX = "so101"
LOADER_EXE = "rerun-loader-urdf"

# 링크 트리 — URDF 와 같은 순서. 로더가 만드는 엔티티 경로를 재현하는 데 씁니다.
CHAIN = ["base_link"] + [j.child for j in K.JOINTS]
CHAIN_LABELS = ["베이스"] + [j.ko for j in K.JOINTS]


def require_rerun():
    try:
        import rerun as rr
    except ImportError:
        sys.exit("rerun-sdk 가 없습니다.  pip install rerun-sdk")
    return rr


def set_time(rr, seconds: float) -> None:
    """타임라인 API 는 rerun 0.23 에서 이름이 바뀌었습니다. 둘 다 받아 줍니다."""
    if hasattr(rr, "set_time"):
        rr.set_time("t", duration=seconds)
    else:
        rr.set_time_seconds("t", seconds)


def scalar(rr, value: float):
    """Scalar → Scalars 로 바뀐 아카이타입."""
    return rr.Scalars(value) if hasattr(rr, "Scalars") else rr.Scalar(value)


def load_urdf(rr, urdf: Path, style: str):
    """
    URDF 를 rerun 에 싣습니다.

    rerun 0.38 부터는 **URDF 지원이 rerun 안에 들어왔습니다**(`rerun.urdf`).
    그 경우 UrdfTree 를 쓰면 메시가 실제로 움직입니다.
    구버전이라면 외부 로더(URDF visualizer 플러그인)로 정적으로만 싣습니다.

    @returns UrdfTree 또는 None
    """
    try:
        from rerun.urdf import UrdfTree
    except ImportError:
        UrdfTree = None

    if UrdfTree is not None:
        tree = UrdfTree.from_file_path(urdf, PREFIX)
        tree.log_urdf_to_recording()
        print("URDF 로드: %s  (rerun 내장 URDF 지원)" % urdf)
        print("  로봇 이름: %s / 루트 링크: %s" % (tree.name, tree.root_link().name))
        return tree

    if shutil.which(LOADER_EXE) is None:
        print("[!] '%s' 를 PATH 에서 찾지 못했습니다." % LOADER_EXE)
        print("    URDF 메시는 표시되지 않고 뼈대만 그려집니다.")
        print("    설치: pip install git+https://github.com/rerun-io/"
              "rerun-loader-python-example-urdf.git")
        print("    가상환경에 설치했다면 그 환경을 활성화한 셸에서 실행하세요.")
        return None

    rr.log_file_from_path(urdf, entity_path_prefix=PREFIX, static=True)
    print("URDF 로드: %s  (외부 URDF visualizer 플러그인)" % urdf)
    print("[!] 구버전 rerun 입니다 — 메시는 **움직이지 않고** 초기 자세로 고정됩니다.")
    print("    메시까지 움직이려면:  pip install -U rerun-sdk")
    return None


def log_pose(rr, q, tree, style: str) -> None:
    """한 자세를 기록합니다. 메시·뼈대·TCP·관절값을 같은 시각에 싣습니다."""
    links = K.forward(q)

    # 1) URDF 메시를 움직인다 — 조인트마다 부모→자식 변환을 새로 실어 준다
    if tree is not None:
        for j, a in zip(K.JOINTS, q):
            joint = tree.get_joint_by_name(j.name)
            if joint is None:          # 이름이 다른 URDF(old_calib 등)
                continue
            rr.log("%s/joints/%s" % (PREFIX, j.name), joint.compute_transform(float(a)))

    # 2) 뼈대 — URDF 가 없어도 형태를 알 수 있게
    pts = [links[name][:3, 3] for name in CHAIN]
    rr.log("%s/skeleton" % PREFIX,
           rr.LineStrips3D([np.array(pts)], radii=0.004, colors=[[90, 180, 255]]))
    rr.log("%s/frames" % PREFIX,
           rr.Points3D(np.array(pts), radii=0.008, colors=[[250, 200, 60]],
                       labels=CHAIN_LABELS))

    # 3) TCP
    tcp = K.tool_position(q)
    rr.log("%s/tcp" % PREFIX,
           rr.Points3D(np.array([tcp]), radii=0.010, colors=[[74, 222, 154]]))

    # 4) 관절값 — 아래쪽 시계열 패널에 그래프로 뜹니다
    for j, a in zip(K.JOINTS, q):
        rr.log("plot/joint/%s" % j.name, scalar(rr, float(a)))
    for axis, v in zip("xyz", tcp):
        rr.log("plot/tcp/%s" % axis, scalar(rr, float(v)))


def frames_from_sweep(steps: int):
    """관절을 하나씩 하한 → 상한 → 중앙으로 흔듭니다."""
    q = list(K.POSES["home"])
    for idx, j in enumerate(K.JOINTS):
        base = q[idx]
        for target in (j.lower, j.upper, base):
            start = q[idx]
            for s in range(steps):
                q[idx] = start + (target - start) * (s + 1) / steps
                yield list(q)
        q[idx] = base


def frames_from_trajectory(path: Path):
    """브라우저 시뮬레이터가 내보낸 JSON 을 읽습니다."""
    data = json.loads(path.read_text(encoding="utf-8"))
    frames = data.get("frames")
    if not frames:
        sys.exit("%s: 'frames' 가 없습니다. 시뮬레이터의 '녹화' 탭에서 내보낸 "
                 "JSON 인지 확인하세요." % path)
    print("궤적: %d 프레임 / %s fps / 작업 '%s'"
          % (len(frames), data.get("fps", "?"), data.get("task", "")))
    for f in frames:
        yield f.get("state") or f["action"]


def main() -> int:
    ap = argparse.ArgumentParser(description="rerun 으로 SO-ARM101 URDF 보기")
    ap.add_argument("--urdf", type=Path,
                    help="so101_new_calib.urdf 경로 (생략하면 뼈대만)")
    ap.add_argument("--pose", default="home", choices=sorted(K.POSES),
                    help="정지 자세 이름 (기본 home)")
    ap.add_argument("--trajectory", type=Path, help="시뮬레이터 녹화 JSON")
    ap.add_argument("--sweep", action="store_true", help="관절 전 범위 스윕")
    ap.add_argument("--steps", type=int, default=20, help="스윕 구간당 프레임 수")
    ap.add_argument("--fps", type=float, default=30.0, help="타임라인 fps")
    ap.add_argument("--path-style", choices=("chain", "flat"), default="chain",
                    help="로더가 쓰는 엔티티 경로 형태")
    ap.add_argument("--save", type=Path, help="화면 대신 .rrd 파일로 저장")
    args = ap.parse_args()

    rr = require_rerun()
    rr.init("so-arm101", spawn=args.save is None)
    if args.save:
        rr.save(args.save)

    rr.log("/", rr.ViewCoordinates.RIGHT_HAND_Z_UP, static=True)

    tree = None
    if args.urdf:
        if not args.urdf.exists():
            sys.exit("URDF 가 없습니다: %s" % args.urdf)
        tree = load_urdf(rr, args.urdf, args.path_style)

    if args.trajectory:
        frames = frames_from_trajectory(args.trajectory)
    elif args.sweep:
        frames = frames_from_sweep(args.steps)
    else:
        frames = iter([K.POSES[args.pose]])
        print("자세: %s" % args.pose)

    n = 0
    for q in frames:
        set_time(rr, n / args.fps)
        log_pose(rr, K.clamp_to_limits(q), tree, args.path_style)
        n += 1

    print("%d 프레임 기록 완료" % n)
    if args.save:
        print("저장: %s   (열기:  rerun %s)" % (args.save, args.save))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
