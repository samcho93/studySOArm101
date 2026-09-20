#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
so101_macro.xacro 생성기
------------------------------------------------------------------------------
so101_new_calib.urdf 의 조인트 값(원본 CAD 유래)을 그대로 쓰고, 시각/충돌 형상만
프리미티브(박스)로 대체한 xacro 매크로를 만듭니다. STL 메시를 내려받지 않아도
RViz2 · Gazebo · MoveIt 2 가 바로 동작합니다.

  python gen_macro.py

고해상도 메시를 쓰고 싶다면 fetch_meshes.py 를 실행한 뒤
so_arm101.urdf.xacro 의 use_meshes 인자를 true 로 주세요.
"""
from __future__ import annotations

import math
import sys
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

OUT = Path(__file__).resolve().parent / "src/so_arm101_description/urdf/so101_macro.xacro"

PI = math.pi

# (이름, 부모, 자식, xyz, rpy, lower, upper, 서보 ID)
JOINTS = [
    ("shoulder_pan",  "base_link",      "shoulder_link",
     (0.0388353, 0.0, 0.0624),        (PI, 0.0, -PI),        -1.91986,  1.91986, 1),
    ("shoulder_lift", "shoulder_link",  "upper_arm_link",
     (-0.0303992, -0.0182778, -0.0542), (-PI / 2, -PI / 2, 0.0), -1.74533,  1.74533, 2),
    ("elbow_flex",    "upper_arm_link", "lower_arm_link",
     (-0.11257, -0.028, 0.0),         (0.0, 0.0, PI / 2),    -1.69000,  1.69000, 3),
    ("wrist_flex",    "lower_arm_link", "wrist_link",
     (-0.1349, 0.0052, 0.0),          (0.0, 0.0, -PI / 2),   -1.65806,  1.65806, 4),
    ("wrist_roll",    "wrist_link",     "gripper_link",
     (0.0, -0.0611, 0.0181),          (PI / 2, 0.0486795, PI), -2.74385,  2.84121, 5),
    ("gripper",       "gripper_link",   "moving_jaw_so101_v1_link",
     (0.0202, 0.0188, -0.0234),       (PI / 2, 0.0, 0.0),    -0.174533, 1.74533, 6),
]

TOOL = ((-0.0079, -0.000218121, -0.0981274), (0.0, PI, 0.0))

# 링크별 프리미티브 형상: (크기, 중심 위치, 재질)
SHAPES = {
    "base_link": [
        ((0.105, 0.115, 0.055), (0.012, 0.0, 0.028), "printed"),
        ((0.048, 0.055, 0.052), (0.030, 0.0, 0.060), "servo"),
    ],
    "shoulder_link": [
        ((0.070, 0.062, 0.050), (-0.030, 0.0, -0.028), "printed"),
        ((0.050, 0.052, 0.045), (-0.030, -0.014, -0.050), "servo"),
    ],
    "upper_arm_link": [
        ((0.150, 0.050, 0.042), (-0.058, -0.014, 0.018), "printed"),
        ((0.050, 0.046, 0.052), (-0.112, -0.028, 0.018), "servo"),
    ],
    "lower_arm_link": [
        ((0.150, 0.046, 0.040), (-0.070, 0.004, 0.018), "printed"),
        ((0.048, 0.046, 0.050), (-0.135, 0.005, 0.018), "servo"),
    ],
    "wrist_link": [
        ((0.046, 0.075, 0.046), (0.0, -0.034, 0.024), "printed"),
        ((0.044, 0.048, 0.046), (0.0, -0.052, 0.024), "servo"),
    ],
    "gripper_link": [
        ((0.046, 0.046, 0.048), (0.004, 0.0, -0.022), "servo"),
        ((0.016, 0.030, 0.070), (-0.008, 0.0, -0.068), "printed"),
    ],
    "moving_jaw_so101_v1_link": [
        ((0.014, 0.062, 0.034), (-0.002, -0.030, 0.014), "printed"),
    ],
}

# URDF 원본의 링크 질량 (kg)
MASS = {
    "base_link": 0.147,
    "shoulder_link": 0.100,
    "upper_arm_link": 0.103,
    "lower_arm_link": 0.104,
    "wrist_link": 0.079,
    "gripper_link": 0.087,
    "moving_jaw_so101_v1_link": 0.012,
}

LINKS = ["base_link", "shoulder_link", "upper_arm_link", "lower_arm_link",
         "wrist_link", "gripper_link", "moving_jaw_so101_v1_link"]


def f(v: float) -> str:
    """URDF 에 넣을 수 있게 아주 작은 값은 0 으로 정리한다."""
    return "0" if abs(v) < 1e-12 else ("%.6g" % v)


def triple(t) -> str:
    return " ".join(f(v) for v in t)


def box_inertia(mass, size):
    """균일 밀도 직육면체의 관성 모멘트."""
    x, y, z = size
    ixx = mass * (y * y + z * z) / 12.0
    iyy = mass * (x * x + z * z) / 12.0
    izz = mass * (x * x + y * y) / 12.0
    return ixx, iyy, izz


def link_block(name: str) -> str:
    shapes = SHAPES[name]
    mass = MASS[name]
    # 가장 큰 박스를 관성 계산에 사용한다
    main = max(shapes, key=lambda s: s[0][0] * s[0][1] * s[0][2])
    ixx, iyy, izz = box_inertia(mass, main[0])

    parts = ['  <link name="${prefix}%s">' % name]
    parts.append('    <inertial>')
    parts.append('      <origin xyz="%s" rpy="0 0 0"/>' % triple(main[1]))
    parts.append('      <mass value="%.6g"/>' % mass)
    parts.append('      <inertia ixx="%.6e" ixy="0" ixz="0" iyy="%.6e" iyz="0" izz="%.6e"/>'
                 % (ixx, iyy, izz))
    parts.append('    </inertial>')

    for size, pos, mat in shapes:
        parts.append('    <visual>')
        parts.append('      <origin xyz="%s" rpy="0 0 0"/>' % triple(pos))
        parts.append('      <geometry><box size="%s"/></geometry>' % triple(size))
        parts.append('      <material name="%s"/>' % mat)
        parts.append('    </visual>')
        parts.append('    <collision>')
        parts.append('      <origin xyz="%s" rpy="0 0 0"/>' % triple(pos))
        parts.append('      <geometry><box size="%s"/></geometry>' % triple(size))
        parts.append('    </collision>')

    parts.append('  </link>')
    return "\n".join(parts)


def joint_block(j) -> str:
    name, parent, child, xyz, rpy, lo, hi, sid = j
    return "\n".join([
        '  <!-- 서보 ID %d -->' % sid,
        '  <joint name="${prefix}%s" type="revolute">' % name,
        '    <origin xyz="%s" rpy="%s"/>' % (triple(xyz), triple(rpy)),
        '    <parent link="${prefix}%s"/>' % parent,
        '    <child  link="${prefix}%s"/>' % child,
        '    <axis xyz="0 0 1"/>',
        '    <limit effort="10" velocity="3.0" lower="%.6g" upper="%.6g"/>' % (lo, hi),
        '    <dynamics damping="0.1" friction="0.05"/>',
        '  </joint>',
    ])


def main() -> None:
    lines = [
        '<?xml version="1.0"?>',
        '<!-- 자동 생성 파일 — 수정하려면 ros2_ws/gen_macro.py 를 고치고 다시 실행하세요. -->',
        '<!-- 조인트 수치는 TheRobotStudio/SO-ARM100 의 so101_new_calib.urdf 원본과 동일합니다. -->',
        '<robot xmlns:xacro="http://www.ros.org/wiki/xacro">',
        '',
        '  <material name="printed"><color rgba="0.94 0.75 0.11 1.0"/></material>',
        '  <material name="servo"><color rgba="0.16 0.20 0.25 1.0"/></material>',
        '',
        '  <xacro:macro name="so_arm101" params="prefix:=\'\' parent:=world *origin">',
        '',
        '    <joint name="${prefix}base_joint" type="fixed">',
        '      <xacro:insert_block name="origin"/>',
        '      <parent link="${parent}"/>',
        '      <child  link="${prefix}base_link"/>',
        '    </joint>',
        '',
    ]

    for name in LINKS:
        lines.append(link_block(name))
        lines.append('')

    for j in JOINTS:
        lines.append(joint_block(j))
        lines.append('')

    lines += [
        '  <!-- TCP(툴 중심점) — MoveIt 의 엔드 이펙터 링크 -->',
        '  <link name="${prefix}gripper_frame_link"/>',
        '  <joint name="${prefix}gripper_frame_joint" type="fixed">',
        '    <origin xyz="%s" rpy="%s"/>' % (triple(TOOL[0]), triple(TOOL[1])),
        '    <parent link="${prefix}gripper_link"/>',
        '    <child  link="${prefix}gripper_frame_link"/>',
        '  </joint>',
        '',
        '  </xacro:macro>',
        '</robot>',
        '',
    ]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print("생성 완료:", OUT)


if __name__ == "__main__":
    main()
