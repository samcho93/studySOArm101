#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LeRobot 정책 → ROS 2 브릿지 (20장 실습용)

학습한 LeRobot 정책을 ROS 2 노드로 감싸, /joint_states 와 카메라 토픽을 관측으로
받아 /joint_trajectory_controller/joint_trajectory 로 행동을 발행합니다.

실행
  ros2 run so_arm_utils lerobot_policy_node --ros-args \
      -p policy_path:=outputs/train/act_so101/checkpoints/last/pretrained_model \
      -p task:="Grab the black cube" \
      -p rate_hz:=30.0

또는 워크스페이스 없이 직접
  python lerobot_ros2_bridge.py --ros-args -p policy_path:=...

경고
  · 정책 출력 단위가 라디안인지 반드시 확인하세요. 정규화 값이면 그대로 보내면
    팔이 한계까지 튑니다. (--unnormalize 옵션 참고)
  · 첫 실행은 반드시 mock 모드나 Gazebo 에서 하세요.
"""
from __future__ import annotations

import sys

import numpy as np

try:
    import rclpy
    import torch
    from rclpy.node import Node
    from sensor_msgs.msg import Image, JointState
    from trajectory_msgs.msg import JointTrajectory, JointTrajectoryPoint
except ImportError as exc:  # pragma: no cover - ROS 2 환경이 아닐 때
    print("ROS 2(rclpy) 또는 PyTorch 를 찾을 수 없습니다:", exc)
    print("  source /opt/ros/humble/setup.bash 를 실행했나요?")
    raise SystemExit(1)

JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex",
          "wrist_flex", "wrist_roll", "gripper"]

LIMITS = {
    "shoulder_pan": (-1.91986, 1.91986),
    "shoulder_lift": (-1.74533, 1.74533),
    "elbow_flex": (-1.69, 1.69),
    "wrist_flex": (-1.65806, 1.65806),
    "wrist_roll": (-2.74385, 2.84121),
    "gripper": (-0.174533, 1.74533),
}


class LeRobotPolicyNode(Node):
    """LeRobot 정책을 ros2_control 궤적 명령으로 옮기는 노드."""

    def __init__(self) -> None:
        super().__init__("lerobot_policy_node")

        self.declare_parameter("policy_path", "")
        self.declare_parameter("policy_type", "act")
        self.declare_parameter("task", "Grab the black cube")
        self.declare_parameter("rate_hz", 30.0)
        self.declare_parameter("command_time_s", 0.05)
        self.declare_parameter("camera_topics",
                               ["/camera/front/image_raw", "/camera/wrist/image_raw"])
        self.declare_parameter("camera_keys", ["front", "wrist"])
        self.declare_parameter("clamp_to_limits", True)
        self.declare_parameter("dry_run", False)

        path = self.get_parameter("policy_path").value
        if not path:
            raise RuntimeError("policy_path 파라미터가 필요합니다.")

        self.task = self.get_parameter("task").value
        self.command_time = float(self.get_parameter("command_time_s").value)
        self.do_clamp = bool(self.get_parameter("clamp_to_limits").value)
        self.dry_run = bool(self.get_parameter("dry_run").value)
        rate = float(self.get_parameter("rate_hz").value)

        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.get_logger().info(f"정책 로드: {path}  (device={self.device})")
        self.policy = self._load_policy(path)

        self.latest_state: np.ndarray | None = None
        self.latest_images: dict[str, np.ndarray] = {}

        self.create_subscription(JointState, "/joint_states", self._on_state, 10)

        topics = list(self.get_parameter("camera_topics").value)
        keys = list(self.get_parameter("camera_keys").value)
        self._bridge = self._make_bridge()
        for topic, key in zip(topics, keys):
            self.create_subscription(
                Image, topic, self._make_image_cb(key), 10)
            self.get_logger().info(f"카메라 구독: {topic}  →  observation.images.{key}")

        self.pub = self.create_publisher(
            JointTrajectory, "/joint_trajectory_controller/joint_trajectory", 10)

        self.create_timer(1.0 / rate, self._step)
        self.get_logger().info(f"브릿지 준비 완료 ({rate:.0f} Hz)"
                               + ("  [dry-run]" if self.dry_run else ""))

    # ------------------------------------------------------------ 초기화
    def _load_policy(self, path: str):
        kind = self.get_parameter("policy_type").value
        if kind == "act":
            from lerobot.policies.act.modeling_act import ACTPolicy as Policy
        elif kind == "diffusion":
            from lerobot.policies.diffusion.modeling_diffusion import DiffusionPolicy as Policy
        elif kind == "smolvla":
            from lerobot.policies.smolvla.modeling_smolvla import SmolVLAPolicy as Policy
        else:
            raise RuntimeError(f"알 수 없는 policy_type: {kind}")
        return Policy.from_pretrained(path).to(self.device).eval()

    def _make_bridge(self):
        try:
            from cv_bridge import CvBridge
            return CvBridge()
        except ImportError:
            self.get_logger().warn("cv_bridge 가 없어 영상 입력을 사용할 수 없습니다.")
            return None

    # ------------------------------------------------------------ 콜백
    def _on_state(self, msg: JointState) -> None:
        # /joint_states 의 순서는 보장되지 않는다 — 반드시 이름으로 매핑한다
        index = {name: i for i, name in enumerate(msg.name)}
        try:
            self.latest_state = np.array(
                [msg.position[index[j]] for j in JOINTS], dtype=np.float32)
        except (KeyError, IndexError):
            pass   # 아직 모든 조인트가 발행되지 않음

    def _make_image_cb(self, key: str):
        def cb(msg: Image) -> None:
            if self._bridge is None:
                return
            self.latest_images[key] = self._bridge.imgmsg_to_cv2(msg, "rgb8")
        return cb

    # ------------------------------------------------------------ 제어 루프
    def _step(self) -> None:
        if self.latest_state is None:
            return

        observation = {
            "observation.state": torch.from_numpy(self.latest_state)
                                      .unsqueeze(0).to(self.device),
            "task": [self.task],
        }
        for key, image in self.latest_images.items():
            tensor = torch.from_numpy(image.copy()).permute(2, 0, 1).float() / 255.0
            observation[f"observation.images.{key}"] = tensor.unsqueeze(0).to(self.device)

        with torch.inference_mode():
            action = self.policy.select_action(observation)

        positions = action.squeeze(0).detach().cpu().numpy().astype(float)
        if positions.shape[0] != len(JOINTS):
            self.get_logger().error(
                f"정책 출력 차원이 {positions.shape[0]} 입니다. {len(JOINTS)} 를 기대합니다.")
            return

        if self.do_clamp:
            positions = np.array([
                float(np.clip(v, *LIMITS[name]))
                for v, name in zip(positions, JOINTS)
            ])

        if self.dry_run:
            self.get_logger().info(
                "  ".join(f"{n[:5]}:{v:+.3f}" for n, v in zip(JOINTS, positions)))
            return

        self._publish(positions)

    def _publish(self, positions: np.ndarray) -> None:
        traj = JointTrajectory()
        traj.joint_names = JOINTS
        point = JointTrajectoryPoint()
        point.positions = [float(v) for v in positions]
        point.time_from_start.sec = int(self.command_time)
        point.time_from_start.nanosec = int((self.command_time % 1.0) * 1e9)
        traj.points = [point]
        self.pub.publish(traj)


def main(argv=None) -> int:
    rclpy.init(args=argv)
    try:
        node = LeRobotPolicyNode()
    except Exception as exc:
        print("노드 초기화 실패:", exc)
        rclpy.shutdown()
        return 1
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
