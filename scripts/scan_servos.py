#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
STS3215 버스 서보 스캐너 (5장, 7장 실습용)

연결된 SO-ARM101 의 서보 ID 1~6 이 모두 응답하는지, 현재 위치·전압·온도가
정상인지 한 번에 확인합니다.

  python scan_servos.py --port /dev/ttyACM0
  python scan_servos.py --port COM3 --range 1 20

필요 패키지
  pip install feetech-servo-sdk       # 또는 lerobot 의 [feetech] extra
"""
from __future__ import annotations

import argparse
import math
import sys

def _utf8_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass


_utf8_stdout()

# STS3215 EEPROM/SRAM 주소
ADDR_PRESENT_POSITION = 56
ADDR_PRESENT_VOLTAGE = 62
ADDR_PRESENT_TEMPERATURE = 63

JOINT_BY_ID = {
    1: "shoulder_pan",
    2: "shoulder_lift",
    3: "elbow_flex",
    4: "wrist_flex",
    5: "wrist_roll",
    6: "gripper",
}


def main() -> int:
    ap = argparse.ArgumentParser(description="STS3215 서보 스캔")
    ap.add_argument("--port", required=True, help="시리얼 포트 (예: /dev/ttyACM0, COM3)")
    ap.add_argument("--baud", type=int, default=1000000, help="보레이트 (기본 1000000)")
    ap.add_argument("--range", nargs=2, type=int, default=[1, 6], metavar=("LO", "HI"),
                    help="스캔할 ID 범위 (기본 1 6)")
    args = ap.parse_args()

    try:
        import scservo_sdk as scs
    except ImportError:
        print("scservo_sdk 를 찾을 수 없습니다.")
        print("  pip install feetech-servo-sdk")
        print("  또는 LeRobot 환경에서  pip install -e \".[feetech]\"")
        return 1

    port = scs.PortHandler(args.port)
    packet = scs.PacketHandler(0)   # STS/SMS 프로토콜

    if not port.openPort():
        print(f"포트를 열 수 없습니다: {args.port}")
        print("  · 포트 이름이 맞는지 확인하세요 (lerobot-find-port)")
        print("  · 권한을 확인하세요 (sudo usermod -a -G dialout $USER)")
        print("  · 다른 프로그램이 포트를 쓰고 있지 않은지 확인하세요")
        return 1
    if not port.setBaudRate(args.baud):
        print(f"보레이트를 설정할 수 없습니다: {args.baud}")
        return 1

    lo, hi = args.range
    print(f"포트 {args.port} ({args.baud} bps) 스캔 중  ID {lo}~{hi}\n")

    found = []
    for sid in range(lo, hi + 1):
        model, comm, err = packet.ping(port, sid)
        if comm != scs.COMM_SUCCESS:
            continue

        pos, _, _ = packet.read2ByteTxRx(port, sid, ADDR_PRESENT_POSITION)
        volt, _, _ = packet.read1ByteTxRx(port, sid, ADDR_PRESENT_VOLTAGE)
        temp, _, _ = packet.read1ByteTxRx(port, sid, ADDR_PRESENT_TEMPERATURE)

        deg = (pos - 2048) * 360.0 / 4096.0
        name = JOINT_BY_ID.get(sid, "?")
        warn = ""
        if temp >= 55:
            warn += "  ← 과열 주의"
        if volt / 10.0 < 6.0:
            warn += "  ← 전압 낮음"

        print(f"  ID {sid:<3} {name:<14} 위치 {pos:>4}  ({deg:+6.1f}°)  "
              f"전압 {volt / 10.0:>4.1f}V  온도 {temp:>2}°C{warn}")
        found.append(sid)

    print()
    if not found:
        print("서보를 하나도 찾지 못했습니다.")
        print("  · 외부 전원 어댑터가 연결되어 있나요? (팔로워 12V / 리더 5V)")
        print("  · Waveshare 보드라면 점퍼 2개가 모두 B 채널(USB)에 있나요?")
        print("  · 보레이트가 맞나요? 공장 기본값은 1000000 입니다.")
        return 2

    print(f"{len(found)}개 서보 발견: {found}")
    missing = [i for i in range(1, 7) if i not in found]
    if missing:
        print(f"응답 없는 ID: {missing}")
        print("  · 3핀 케이블 접촉을 확인하세요.")
        print("  · ID 가 설정되지 않은 서보일 수 있습니다 (5장 참고).")
    port.closePort()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
