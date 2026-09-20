#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ROS 2 bag → LeRobotDataset 변환 (20장 실습용)

ROS 2 로 수집한 시연 데이터를 LeRobot 포맷으로 바꿔 ACT/SmolVLA 학습에
그대로 쓸 수 있게 합니다.

수집
  ros2 bag record /joint_states /camera/front/image_raw /camera/wrist/image_raw

변환
  python rosbag_to_lerobot.py \
      --bag ./rosbag2_2026_09_21-14_30_00 \
      --repo-id myname/so101_from_rosbag \
      --root ./datasets/so101_from_rosbag \
      --fps 30

필요 패키지: rosbag2_py, rclpy (ROS 2 환경), lerobot, opencv-python
"""
from __future__ import annotations

import argparse
import sys

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


def main() -> int:
    ap = argparse.ArgumentParser(description="ROS 2 bag → LeRobotDataset")
    ap.add_argument("--bag", required=True, help="rosbag2 디렉터리")
    ap.add_argument("--repo-id", required=True)
    ap.add_argument("--root", required=True)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--task", default="teleoperated demonstration")
    ap.add_argument("--state-topic", default="/joint_states")
    ap.add_argument("--image-topic", action="append", default=[],
                    help="카메라 토픽. --image-topic /camera/front/image_raw=front 형식")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    try:
        import numpy as np
        import rosbag2_py
        from rclpy.serialization import deserialize_message
        from rosidl_runtime_py.utilities import get_message
    except ImportError as exc:
        print("ROS 2 패키지를 찾을 수 없습니다:", exc)
        print("  source /opt/ros/humble/setup.bash")
        return 1

    cam_map = {}
    for spec in args.image_topic:
        topic, _, key = spec.partition("=")
        cam_map[topic] = key or topic.strip("/").replace("/", "_")

    reader = rosbag2_py.SequentialReader()
    reader.open(
        rosbag2_py.StorageOptions(uri=args.bag, storage_id="sqlite3"),
        rosbag2_py.ConverterOptions("", ""),
    )
    types = {t.name: t.type for t in reader.get_all_topics_and_types()}
    print("bag 의 토픽")
    for name, typ in types.items():
        mark = ""
        if name == args.state_topic:
            mark = "  ← 상태"
        elif name in cam_map:
            mark = f"  ← 영상 ({cam_map[name]})"
        print(f"  {name:<44} {typ}{mark}")

    # 1차 통과: 상태와 영상을 시간순으로 모은다
    states, images = [], {key: [] for key in cam_map.values()}
    bridge = None
    if cam_map:
        try:
            from cv_bridge import CvBridge
            bridge = CvBridge()
        except ImportError:
            print("\ncv_bridge 가 없어 영상은 건너뜁니다.")
            cam_map = {}

    while reader.has_next():
        topic, data, stamp = reader.read_next()
        if topic == args.state_topic:
            msg = deserialize_message(data, get_message(types[topic]))
            index = {n: i for i, n in enumerate(msg.name)}
            try:
                q = [msg.position[index[j]] for j in JOINTS]
            except (KeyError, IndexError):
                continue
            states.append((stamp, np.array(q, dtype=np.float32)))
        elif topic in cam_map and bridge is not None:
            msg = deserialize_message(data, get_message(types[topic]))
            images[cam_map[topic]].append((stamp, bridge.imgmsg_to_cv2(msg, "rgb8")))

    print(f"\n상태 {len(states)} 프레임")
    for key, frames in images.items():
        print(f"영상 {key}: {len(frames)} 프레임")

    if not states:
        print("상태 메시지를 찾지 못했습니다. --state-topic 을 확인하세요.")
        return 2

    # fps 에 맞춰 재샘플링 (상태 기준, 영상은 가장 가까운 시각을 고른다)
    t0, t1 = states[0][0], states[-1][0]
    period_ns = int(1e9 / args.fps)
    grid = list(range(t0, t1, period_ns))
    print(f"재샘플링: {len(grid)} 프레임 @ {args.fps} fps "
          f"({(t1 - t0) / 1e9:.1f} s)")

    if args.dry_run:
        print("\n--dry-run 이므로 여기서 멈춥니다.")
        return 0

    try:
        from lerobot.datasets.lerobot_dataset import LeRobotDataset
    except ImportError:
        print("LeRobot 을 찾을 수 없습니다.  conda activate lerobot")
        return 1

    def nearest(seq, t):
        return min(seq, key=lambda item: abs(item[0] - t))[1]

    features = {
        "action": {"dtype": "float32", "shape": (len(JOINTS),), "names": JOINTS},
        "observation.state": {"dtype": "float32", "shape": (len(JOINTS),), "names": JOINTS},
    }
    for key, frames in images.items():
        if frames:
            h, w, _ = frames[0][1].shape
            features[f"observation.images.{key}"] = {
                "dtype": "video", "shape": (h, w, 3),
                "names": ["height", "width", "channels"],
            }

    dataset = LeRobotDataset.create(
        repo_id=args.repo_id, fps=args.fps, features=features,
        robot_type="so101_follower", root=args.root,
        use_videos=bool(images),
    )

    for t in grid:
        q = nearest(states, t)
        frame = {"action": q, "observation.state": q}
        for key, frames in images.items():
            if frames:
                frame[f"observation.images.{key}"] = nearest(frames, t)
        dataset.add_frame(frame, task=args.task)

    dataset.save_episode()
    dataset.finalize()
    print(f"\n저장 완료: {args.root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
