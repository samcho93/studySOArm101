#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SO-ARM101 키보드 텔레오퍼레이션 (9장 실습용)

리더 암이 없을 때 키보드로 팔로워를 직접 움직입니다. LeRobot 의
SO101Follower API 만 사용하므로 캘리브레이션이 되어 있어야 합니다.

  python so101_keyboard_teleop.py --port /dev/ttyACM0 --id my_awesome_follower_arm

키 배치
  Q/A  shoulder_pan   -/+        W/S  shoulder_lift -/+
  E/D  elbow_flex     -/+        R/F  wrist_flex    -/+
  T/G  wrist_roll     -/+        Z/X  gripper 닫기/열기
  1~6  프리셋 자세                SPACE 정지
  ESC  종료

주의: 안전을 위해 스텝이 작게 잡혀 있습니다. 처음에는 팔 주변을 비우고
      한 관절씩 눌러 방향을 확인하세요.
"""
from __future__ import annotations

import argparse
import math
import sys
import time

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

LIMITS = {
    "shoulder_pan": (-1.91986, 1.91986),
    "shoulder_lift": (-1.74533, 1.74533),
    "elbow_flex": (-1.69, 1.69),
    "wrist_flex": (-1.65806, 1.65806),
    "wrist_roll": (-2.74385, 2.84121),
    "gripper": (-0.174533, 1.74533),
}

POSES = {
    "1": [0.0, -1.68, 1.60, 0.75, 0.0, 0.4],     # rest
    "2": [0.0, -0.60, 0.90, 0.60, 0.0, 0.6],     # home
    "3": [0.0, -0.30, 0.55, 0.95, 0.0, 1.0],     # ready
    "4": [0.45, 0.10, 0.35, 0.95, 0.0, 1.4],     # pick
    "5": [0.0, 0.35, -0.45, 0.15, 0.0, 0.3],     # extended
    "6": [0.0, 0.0, 0.0, 0.0, 0.0, 0.6],         # zero
}

KEYMAP = {
    "q": (0, -1), "a": (0, +1),
    "w": (1, -1), "s": (1, +1),
    "e": (2, -1), "d": (2, +1),
    "r": (3, -1), "f": (3, +1),
    "t": (4, -1), "g": (4, +1),
    "z": (5, -1), "x": (5, +1),
}


def clamp(v, lo, hi):
    return lo if v < lo else (hi if v > hi else v)


def main() -> int:
    ap = argparse.ArgumentParser(description="SO-ARM101 키보드 텔레오퍼레이션")
    ap.add_argument("--port", required=True)
    ap.add_argument("--id", required=True, help="캘리브레이션 id")
    ap.add_argument("--step", type=float, default=2.0,
                    help="키 한 번당 각도 증분(도), 기본 2.0")
    ap.add_argument("--rate", type=float, default=30.0, help="제어 주기(Hz)")
    args = ap.parse_args()

    try:
        from lerobot.robots.so_follower import SO101Follower, SO101FollowerConfig
    except ImportError:
        print("LeRobot 을 찾을 수 없습니다. 가상환경을 활성화했나요?")
        print("  conda activate lerobot")
        return 1

    try:
        from pynput import keyboard
    except ImportError:
        print("pynput 이 필요합니다.")
        print("  pip install pynput     # 또는 lerobot 의 [hardware] extra")
        return 1

    step = math.radians(args.step)

    robot = SO101Follower(SO101FollowerConfig(port=args.port, id=args.id))
    robot.connect()

    obs = robot.get_observation()
    q = [float(obs.get(f"{name}.pos", 0.0)) for name in JOINTS]

    pressed: set[str] = set()
    stop = {"flag": False}

    def on_press(key):
        try:
            pressed.add(key.char.lower())
        except AttributeError:
            if key == keyboard.Key.esc:
                stop["flag"] = True
            elif key == keyboard.Key.space:
                pressed.clear()

    def on_release(key):
        try:
            pressed.discard(key.char.lower())
        except AttributeError:
            pass

    listener = keyboard.Listener(on_press=on_press, on_release=on_release)
    listener.start()

    print("키보드 텔레오퍼레이션 시작 — ESC 로 종료")
    print("Q/A W/S E/D R/F T/G 로 관절, Z/X 로 그리퍼, 1~6 프리셋\n")

    period = 1.0 / args.rate
    try:
        while not stop["flag"]:
            t0 = time.perf_counter()

            for key in list(pressed):
                if key in POSES:
                    q = POSES[key][:]
                elif key in KEYMAP:
                    idx, sign = KEYMAP[key]
                    lo, hi = LIMITS[JOINTS[idx]]
                    q[idx] = clamp(q[idx] + sign * step, lo, hi)

            robot.send_action({f"{name}.pos": v for name, v in zip(JOINTS, q)})

            line = "  ".join(f"{n[:5]}:{math.degrees(v):+6.1f}"
                             for n, v in zip(JOINTS, q))
            print("\r" + line, end="", flush=True)

            time.sleep(max(0.0, period - (time.perf_counter() - t0)))
    except KeyboardInterrupt:
        pass
    finally:
        listener.stop()
        robot.disconnect()
        print("\n종료했습니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
