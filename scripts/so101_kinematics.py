#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SO-ARM101 기구학 라이브러리 (의존성: numpy 만)
------------------------------------------------------------------------------
수치는 TheRobotStudio/SO-ARM100 의 so101_new_calib.urdf 원본과 동일합니다.
브라우저 시뮬레이터(assets/js/so101-kinematics.js)와 같은 값을 씁니다.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

PI = math.pi

# STS3215 한 틱 = 2π / 4096
TICK_RAD = 2.0 * PI / 4096.0
TICK_CENTER = 2048


@dataclass(frozen=True)
class Joint:
    name: str
    ko: str
    parent: str
    child: str
    xyz: tuple
    rpy: tuple
    lower: float
    upper: float
    servo_id: int


JOINTS = (
    Joint("shoulder_pan", "어깨 회전", "base_link", "shoulder_link",
          (0.0388353, 0.0, 0.0624), (PI, 0.0, -PI), -1.91986, 1.91986, 1),
    Joint("shoulder_lift", "어깨 들기", "shoulder_link", "upper_arm_link",
          (-0.0303992, -0.0182778, -0.0542), (-PI / 2, -PI / 2, 0.0), -1.74533, 1.74533, 2),
    Joint("elbow_flex", "팔꿈치", "upper_arm_link", "lower_arm_link",
          (-0.11257, -0.028, 0.0), (0.0, 0.0, PI / 2), -1.69, 1.69, 3),
    Joint("wrist_flex", "손목 굽힘", "lower_arm_link", "wrist_link",
          (-0.1349, 0.0052, 0.0), (0.0, 0.0, -PI / 2), -1.65806, 1.65806, 4),
    Joint("wrist_roll", "손목 회전", "wrist_link", "gripper_link",
          (0.0, -0.0611, 0.0181), (PI / 2, 0.0486795, PI), -2.74385, 2.84121, 5),
    Joint("gripper", "그리퍼", "gripper_link", "moving_jaw_so101_v1_link",
          (0.0202, 0.0188, -0.0234), (PI / 2, 0.0, 0.0), -0.174533, 1.74533, 6),
)

TOOL_XYZ = (-0.0079, -0.000218121, -0.0981274)
TOOL_RPY = (0.0, PI, 0.0)

JOINT_NAMES = tuple(j.name for j in JOINTS)
ARM_JOINTS = tuple(range(5))          # 그리퍼를 제외한 5개

POSES = {
    "zero":     [0.0, 0.0, 0.0, 0.0, 0.0, 0.6],
    "rest":     [0.0, -1.68, 1.60, 0.75, 0.0, 0.4],
    "home":     [0.0, -0.60, 0.90, 0.60, 0.0, 0.6],
    "ready":    [0.0, -0.30, 0.55, 0.95, 0.0, 1.0],
    "extended": [0.0, 0.35, -0.45, 0.15, 0.0, 0.3],
    "pick":     [0.45, 0.10, 0.35, 0.95, 0.0, 1.4],
}


# --------------------------------------------------------------------- 변환

def rpy_xyz(rpy, xyz) -> np.ndarray:
    """URDF 의 rpy(고정축 X→Y→Z) + 평행이동 → 4x4 동차변환."""
    r, p, y = rpy
    cr, sr = math.cos(r), math.sin(r)
    cp, sp = math.cos(p), math.sin(p)
    cy, sy = math.cos(y), math.sin(y)
    m = np.eye(4)
    m[:3, :3] = np.array([
        [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
        [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
        [-sp,     cp * sr,                cp * cr],
    ])
    m[:3, 3] = xyz
    return m


def rot_z(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    m = np.eye(4)
    m[0, 0], m[0, 1] = c, -s
    m[1, 0], m[1, 1] = s, c
    return m


def mat_to_rpy(m: np.ndarray) -> tuple:
    """회전 행렬 → (roll, pitch, yaw)."""
    sp = float(np.clip(-m[2, 0], -1.0, 1.0))
    pitch = math.asin(sp)
    if abs(sp) > 0.99999:
        return 0.0, pitch, math.atan2(-m[0, 1], m[1, 1])
    return math.atan2(m[2, 1], m[2, 2]), pitch, math.atan2(m[1, 0], m[0, 0])


# ------------------------------------------------------------------ 정기구학

def forward(q) -> dict:
    """각 링크의 base_link 기준 4x4 변환을 반환합니다."""
    links = {"base_link": np.eye(4)}
    for j, a in zip(JOINTS, list(q) + [0.0] * 6):
        parent = links.get(j.parent, np.eye(4))
        links[j.child] = parent @ rpy_xyz(j.rpy, j.xyz) @ rot_z(a)
    links["gripper_frame_link"] = links["gripper_link"] @ rpy_xyz(TOOL_RPY, TOOL_XYZ)
    return links


def tool_pose(q) -> np.ndarray:
    return forward(q)["gripper_frame_link"]


def tool_position(q) -> np.ndarray:
    return tool_pose(q)[:3, 3]


def clamp_to_limits(q) -> list:
    return [float(np.clip(v, j.lower, j.upper)) for v, j in zip(q, JOINTS)]


# ------------------------------------------------------------------ 역기구학

def inverse(target, q_init=None, iterations: int = 200, lam: float = 0.06,
            step: float = 0.6, approach=None, approach_weight: float = 0.35):
    """
    감쇠 최소자승(DLS) 수치 역기구학.

    Parameters
    ----------
    target : (3,) 목표 TCP 위치 [m]
    q_init : 시작 자세 (기본 home)
    approach : (3,) 툴 +Z 축이 향할 방향. None 이면 위치만 맞춥니다.

    Returns
    -------
    (q, error, converged)
    """
    q = np.array(q_init if q_init is not None else POSES["home"], dtype=float)
    target = np.asarray(target, dtype=float)
    h = 1e-5
    n = len(ARM_JOINTS)

    def residual(qq):
        pose = tool_pose(qq)
        res = target - pose[:3, 3]
        if approach is not None:
            z = pose[:3, 2]
            res = np.concatenate([res, approach_weight * (np.asarray(approach) - z)])
        return res

    for _ in range(iterations):
        e = residual(q)
        if np.linalg.norm(e[:3]) < 5e-5:
            break

        jac = np.zeros((len(e), n))
        for k, idx in enumerate(ARM_JOINTS):
            qp = q.copy()
            qp[idx] += h
            jac[:, k] = (residual(qp) - e) / h

        # jac = ∂e/∂q = -∂p/∂q 이므로 Δq = -(JᵀJ+λ²I)⁻¹Jᵀe 가 오차를 줄인다
        jtj = jac.T @ jac + (lam ** 2) * np.eye(n)
        dq = np.linalg.solve(jtj, -jac.T @ e)
        for k, idx in enumerate(ARM_JOINTS):
            q[idx] = np.clip(q[idx] + step * dq[k], JOINTS[idx].lower, JOINTS[idx].upper)

    err = float(np.linalg.norm(residual(q)[:3]))
    return q.tolist(), err, err < 5e-3


# ------------------------------------------------------------------ 단위 변환

def rad_to_ticks(rad: float) -> int:
    return int(round(TICK_CENTER + rad / TICK_RAD))


def ticks_to_rad(ticks: int) -> float:
    return (ticks - TICK_CENTER) * TICK_RAD


def rad_to_norm(name: str, value: float) -> float:
    """LeRobot 정규화 값(-100~100, 그리퍼 0~100)으로 근사 변환."""
    j = next(x for x in JOINTS if x.name == name)
    if name == "gripper":
        return (value - j.lower) / (j.upper - j.lower) * 100.0
    mid = (j.upper + j.lower) / 2.0
    half = (j.upper - j.lower) / 2.0
    return (value - mid) / half * 100.0


def norm_to_rad(name: str, value: float) -> float:
    j = next(x for x in JOINTS if x.name == name)
    if name == "gripper":
        return j.lower + (value / 100.0) * (j.upper - j.lower)
    mid = (j.upper + j.lower) / 2.0
    half = (j.upper - j.lower) / 2.0
    return mid + (value / 100.0) * half
