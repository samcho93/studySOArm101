#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
브라우저 시뮬레이터 궤적(JSON) → LeRobotDataset 변환 (12장 실습용)

sim/index.html 의 "녹화" 탭에서 내보낸 JSON 을 LeRobot 데이터셋 형식으로
바꿉니다. 카메라 영상이 없으므로 **상태-행동 학습 실험용**입니다.

  python trajectory_to_lerobot.py \
      --input so101_trajectory.json \
      --repo-id myname/sim_traj \
      --root ./datasets/sim_traj

여러 에피소드를 합치려면 --input 을 여러 번 주세요.
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

JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex",
          "wrist_flex", "wrist_roll", "gripper"]


def load_episode(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if "frames" not in data:
        raise ValueError(f"{path}: 'frames' 키가 없습니다. 시뮬레이터 JSON 이 맞나요?")
    return data


def main() -> int:
    ap = argparse.ArgumentParser(description="시뮬레이터 궤적 → LeRobotDataset")
    ap.add_argument("--input", action="append", required=True,
                    help="시뮬레이터에서 내보낸 JSON (여러 번 지정 가능)")
    ap.add_argument("--repo-id", required=True, help="예: myname/sim_traj")
    ap.add_argument("--root", required=True, help="로컬 저장 경로")
    ap.add_argument("--task", default=None, help="작업 설명 (없으면 JSON 값 사용)")
    ap.add_argument("--dry-run", action="store_true",
                    help="LeRobot 없이 내용만 확인")
    args = ap.parse_args()

    episodes = [load_episode(Path(p)) for p in args.input]
    fps = episodes[0].get("fps", 30)
    task = args.task or episodes[0].get("task", "simulated trajectory")

    total = sum(len(ep["frames"]) for ep in episodes)
    print(f"에피소드 {len(episodes)}개, 총 {total} 프레임, {fps} fps")
    print(f"작업: {task}")
    for i, ep in enumerate(episodes):
        n = len(ep["frames"])
        print(f"  #{i}  {n:>5} 프레임  {n / fps:>6.1f} s")

    if args.dry_run:
        print("\n--dry-run 이므로 여기서 멈춥니다.")
        return 0

    try:
        import numpy as np
        from lerobot.datasets.lerobot_dataset import LeRobotDataset
    except ImportError:
        print("\nLeRobot 을 찾을 수 없습니다. 가상환경을 활성화했나요?")
        print("  conda activate lerobot")
        print("  pip install -e \".[core_scripts]\"")
        return 1

    features = {
        "action": {"dtype": "float32", "shape": (len(JOINTS),), "names": JOINTS},
        "observation.state": {"dtype": "float32", "shape": (len(JOINTS),), "names": JOINTS},
    }

    dataset = LeRobotDataset.create(
        repo_id=args.repo_id,
        fps=fps,
        features=features,
        robot_type="so101_follower",
        root=args.root,
        use_videos=False,
    )

    for ep in episodes:
        for frame in ep["frames"]:
            dataset.add_frame({
                "action": np.array(frame["action"], dtype=np.float32),
                "observation.state": np.array(frame["state"], dtype=np.float32),
            }, task=task)
        dataset.save_episode()

    dataset.finalize()
    print(f"\n저장 완료: {args.root}")
    print("학습 예시")
    print(f"  lerobot-train --dataset.repo_id={args.repo_id} "
          f"--dataset.root={args.root} --policy.type=act --policy.device=cuda")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
