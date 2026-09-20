# scripts/

강좌 본문에서 참조하는 파이썬 실습 스크립트입니다.

## 의존성

| 스크립트 | 필요한 것 |
| --- | --- |
| `so101_kinematics.py` | numpy |
| `so101_fk_ik.py` | numpy |
| `scan_servos.py` | `scservo_sdk` (feetech-servo-sdk) |
| `check_calibration.py` | 표준 라이브러리만 |
| `so101_keyboard_teleop.py` | lerobot, pynput, 실물 팔 |
| `trajectory_to_lerobot.py` | lerobot |
| `eval_success_rate.py` | 표준 라이브러리만 |
| `lerobot_ros2_bridge.py` | ROS 2, lerobot, torch, cv_bridge |
| `rosbag_to_lerobot.py` | ROS 2(rosbag2_py), lerobot, cv_bridge |

```bash
pip install -r requirements.txt
```

## 사용 예

```bash
# 2장 — 정기구학 / 역기구학
python so101_fk_ik.py --fk 0 -30 45 60 0
python so101_fk_ik.py --ik 0.24 0.00 0.17
python so101_fk_ik.py --ik 0.22 0.00 0.08 --approach-down
python so101_fk_ik.py --poses
python so101_fk_ik.py --workspace 50000

# 5장, 7장 — 서보 스캔
python scan_servos.py --port /dev/ttyACM0

# 8장 — 캘리브레이션 점검
python check_calibration.py --list
python check_calibration.py --id my_awesome_follower_arm --role follower

# 9장 — 키보드 텔레오퍼레이션 (리더 암 없이)
python so101_keyboard_teleop.py --port /dev/ttyACM0 --id my_awesome_follower_arm

# 12장 — 시뮬레이터 궤적을 LeRobot 데이터셋으로
python trajectory_to_lerobot.py --input so101_trajectory.json \
    --repo-id myname/sim_traj --root ./datasets/sim_traj --dry-run

# 14장 — 성공률 집계
python eval_success_rate.py --root ./datasets/rollout_so101_pick --annotate

# 20장 — ROS 2 브릿지
python lerobot_ros2_bridge.py --ros-args \
    -p policy_path:=outputs/train/act_so101/checkpoints/last/pretrained_model \
    -p dry_run:=true

# 20장 — rosbag → LeRobot
python rosbag_to_lerobot.py --bag ./rosbag2_xxx \
    --repo-id myname/from_bag --root ./datasets/from_bag \
    --image-topic /camera/front/image_raw=front --dry-run
```

## 주의

- 실물을 움직이는 스크립트(`so101_keyboard_teleop.py`, `lerobot_ros2_bridge.py`)는
  **팔 주변을 비우고** 전원 플러그를 손 닿는 곳에 둔 상태에서 실행하세요.
- `lerobot_ros2_bridge.py` 는 `-p dry_run:=true` 로 먼저 출력만 확인한 뒤
  실제 발행으로 넘어가세요.
- `scan_servos.py` 와 LeRobot CLI 는 **같은 시리얼 포트를 동시에 열 수 없습니다.**
