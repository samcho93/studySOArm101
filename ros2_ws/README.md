# SO-ARM101 ROS 2 워크스페이스

강좌 15~20장에서 사용하는 ROS 2 패키지 스켈레톤입니다.
**Ubuntu 22.04 + ROS 2 Humble** 기준으로 작성했고, Jazzy 에서도 패키지 이름만
바꾸면 대체로 동작합니다.

```text
ros2_ws/
├── gen_macro.py                    # so101_macro.xacro 생성기
├── fetch_meshes.py                 # STL 메시 다운로더 (선택)
└── src/
    ├── so_arm101_description/      # URDF/xacro · ros2_control · 컨트롤러 설정
    ├── so_arm101_moveit_config/    # MoveIt 2 SRDF · 기구학 · OMPL · 런치
    └── so_arm101_bringup/          # Gazebo 월드와 통합 런치
```

---

## 사전 준비

```bash
# ROS 2 Humble Desktop
sudo apt install ros-humble-desktop

# 빌드 도구
sudo apt install python3-colcon-common-extensions

# MoveIt 2 · ros2_control
sudo apt install ros-humble-moveit \
                 ros-humble-ros2-control \
                 ros-humble-ros2-controllers \
                 ros-humble-controller-manager \
                 ros-humble-joint-state-publisher-gui

# Gazebo 연동 (19장)
sudo apt install ros-humble-ros-gz ros-humble-gz-ros2-control

# 시리얼 권한 (실기)
sudo usermod -a -G dialout $USER   # 로그아웃 후 재로그인
```

---

## 빌드

```bash
mkdir -p ~/so101_ws/src
cp -r /path/to/studySO-ARM101/ros2_ws/src/* ~/so101_ws/src/

cd ~/so101_ws
rosdep install --from-paths src --ignore-src -r -y
colcon build --symlink-install
source install/setup.bash       # 새 터미널마다 필요
```

---

## 실행

### 1) 모델 확인 (하드웨어 불필요)

```bash
ros2 launch so_arm101_description view_description.launch.py rviz:=true
```

슬라이더로 각 관절이 올바른 축으로 도는지 확인합니다.

```bash
ros2 run tf2_ros tf2_echo base_link gripper_frame_link
```

출력이 `scripts/so101_fk_ik.py --fk ...` 결과와 일치해야 합니다.

### 2) 컨트롤러 (가상 하드웨어)

```bash
ros2 launch so_arm101_description controllers_bringup.launch.py
ros2 control list_controllers
```

궤적 명령 직접 보내기:

```bash
ros2 topic pub --once /joint_trajectory_controller/joint_trajectory \
  trajectory_msgs/msg/JointTrajectory \
  "{joint_names: [shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper],
    points: [{positions: [0.0, -0.6, 0.9, 0.6, 0.0, 0.6], time_from_start: {sec: 3}}]}"
```

### 3) MoveIt 2

```bash
ros2 launch so_arm101_moveit_config demo.launch.py
```

RViz 에서 Planning Group `manipulator` → Goal State `extended` → Plan → Execute.

### 4) Gazebo

19장의 4-터미널 절차를 따르세요.

```bash
# 터미널 1
ros2 launch so_arm101_bringup gazebo.launch.py

# 터미널 2
ros2 control set_controller_state forward_position_controller inactive
ros2 run controller_manager spawner joint_trajectory_controller

# 터미널 3
ros2 launch so_arm101_moveit_config move_group.launch.py use_sim_time:=True

# 터미널 4
ros2 launch so_arm101_moveit_config moveit_rviz.launch.py
```

### 5) 실물

```bash
ros2 launch so_arm101_moveit_config demo.launch.py \
    hardware_type:=real usb_port:=/dev/ttyACM0
```

---

## 이 저장소가 제공하는 것과 제공하지 않는 것

| 항목 | 상태 |
| --- | --- |
| URDF/xacro (조인트 수치) | **제공** — URDF 원본과 동일 |
| 시각/충돌 형상 | **제공** — 프리미티브(박스) 근사. STL 없이 동작 |
| ros2_control 설정 | **제공** — mock / gazebo / real 전환 |
| 컨트롤러 설정 | **제공** |
| MoveIt SRDF · OMPL · 런치 | **제공** (손으로 작성한 출발점) |
| Gazebo 월드와 런치 | **제공** |
| **`so_arm_hardware` C++ 플러그인** | **미포함** — 아래 참고 |

### 실기 하드웨어 플러그인에 대하여

`hardware_type:=real` 은 `so_arm_hardware/SOArmHardware` 라는 ros2_control
SystemInterface 플러그인을 참조합니다. 이 저장소에는 **인터페이스 선언만** 있고
C++ 구현은 포함되어 있지 않습니다. 다음 중 하나로 채우세요.

- 원문 위키가 배포하는 `SO-ARM101_ROS2.zip` 의 `so_arm_hardware` 패키지
- [holmsslk/so-arm-moveit-hardware](https://github.com/holmsslk/so-arm-moveit-hardware)
- 직접 구현 — `scservo_sdk` 로 SCS 프로토콜을 다루면 200줄 남짓입니다

구현 없이 `hardware_type:=real` 로 실행하면 "플러그인을 찾을 수 없음" 오류가 납니다.
**mock 과 gazebo 모드는 추가 구현 없이 그대로 동작합니다.**

---

## 모델 수정

조인트 수치나 형상을 바꾸려면 `gen_macro.py` 를 고치고 다시 실행하세요.

```bash
python gen_macro.py
colcon build --packages-select so_arm101_description --symlink-install
```

실제 CAD 메시로 보고 싶다면:

```bash
python fetch_meshes.py
```

TheRobotStudio/SO-ARM100 에서 STL 13개를 내려받아
`src/so_arm101_description/meshes/` 에 넣고, 경로를 변환한
`urdf/so101_meshes.urdf` 를 만듭니다.

---

## MoveIt 설정을 다시 만들려면

SRDF 의 충돌 행렬은 손으로 작성한 것이라 완전하지 않습니다.
Setup Assistant 로 생성하면 더 정확합니다.

```bash
ros2 launch moveit_setup_assistant setup_assistant.launch.py
```

`so_arm101.urdf.xacro` 를 불러 Self-Collisions → Generate Collision Matrix 부터
진행하세요. 자세한 순서는 강좌 18장에 있습니다.
