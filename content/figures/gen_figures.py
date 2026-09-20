#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
데이터로 계산해서 그리는 도해 생성기
------------------------------------------------------------------------------
손으로 그린 개념도와 달리, 이 스크립트가 만드는 SVG 는 scripts/so101_kinematics.py
(= URDF 원본값) 로 실제 계산한 결과입니다. 수치가 바뀌면 다시 실행하세요.

  python content/figures/gen_figures.py

만드는 파일
  workspace-section.svg   TCP 도달 영역의 r–z 단면
  joint-limits.svg        조인트별 가동범위 부채꼴
  tick-scale.svg          서보 틱 ↔ 각도 ↔ LeRobot 정규화 눈금
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass

import so101_kinematics as K  # noqa: E402

OUT = Path(__file__).resolve().parent


# ---------------------------------------------------------------- 작업영역 단면

def workspace_section(samples: int = 400_000, cell_cm: float = 1.0) -> None:
    """무작위 자세를 샘플링해 (수평거리 r, 높이 z) 평면의 도달 영역을 칠한다."""
    random.seed(7)
    grid: dict[tuple[int, int], int] = {}
    max_r = max_z = 0.0
    min_z = 0.0

    for _ in range(samples):
        q = [random.uniform(j.lower, j.upper) for j in K.JOINTS]
        p = K.tool_position(q)
        r = math.hypot(float(p[0]), float(p[1])) * 100.0   # cm
        z = float(p[2]) * 100.0
        max_r = max(max_r, r)
        max_z = max(max_z, z)
        min_z = min(min_z, z)
        grid[(int(r // cell_cm), int(math.floor(z / cell_cm)))] = 1

    # ── 좌표 변환 (cm → SVG) ──
    R_MAX, Z_MIN, Z_MAX = 52.0, -26.0, 56.0
    X0, Y0 = 62.0, 26.0                     # 드로잉 영역 좌상단
    W, H = 500.0, 330.0
    sx = W / R_MAX
    sy = H / (Z_MAX - Z_MIN)

    def px(r_cm: float) -> float:
        return X0 + r_cm * sx

    def py(z_cm: float) -> float:
        return Y0 + (Z_MAX - z_cm) * sy

    # 같은 높이의 연속된 칸은 하나의 사각형으로 합쳐 파일 크기를 줄인다
    rows: dict[int, list[int]] = {}
    for (ri, zi) in grid:
        if ri * cell_cm > R_MAX or zi * cell_cm > Z_MAX or zi * cell_cm < Z_MIN:
            continue
        rows.setdefault(zi, []).append(ri)

    cells = []
    for zi, ris in rows.items():
        ris.sort()
        start = prev = ris[0]
        for ri in ris[1:] + [None]:
            if ri is not None and ri == prev + 1:
                prev = ri
                continue
            r0, r1 = start * cell_cm, (prev + 1) * cell_cm
            z0 = zi * cell_cm
            x, y = px(r0), py(z0 + cell_cm)
            w, h = (r1 - r0) * sx + 0.6, cell_cm * sy + 0.6
            cells.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f"/>'
                         % (x, y, w, h))
            if ri is not None:
                start = prev = ri

    # ── 눈금 ──
    ticks = []
    for r_cm in range(0, int(R_MAX) + 1, 10):
        x = px(r_cm)
        ticks.append('<path d="M%.1f %.1f V%.1f"/>' % (x, Y0 + H, Y0 + H + 5))
        ticks.append('<text class="sub" x="%.1f" y="%.1f" text-anchor="middle">%d</text>'
                     % (x, Y0 + H + 19, r_cm))
    for z_cm in range(-20, int(Z_MAX) + 1, 20):
        y = py(z_cm)
        ticks.append('<path d="M%.1f %.1f H%.1f"/>' % (X0 - 5, y, X0))
        ticks.append('<text class="sub" x="%.1f" y="%.1f" text-anchor="end">%d</text>'
                     % (X0 - 10, y + 4, z_cm))

    svg = f'''<svg viewBox="0 0 600 420" xmlns="http://www.w3.org/2000/svg" role="img"
     aria-label="SO-ARM101 TCP 도달 영역의 수평거리-높이 단면">
  <!-- 자동 생성 — content/figures/gen_figures.py -->
  <rect class="box" x="{X0:.0f}" y="{Y0:.0f}" width="{W:.0f}" height="{H:.0f}" rx="4"/>

  <!-- 도달 가능 영역 ({samples:,} 샘플) -->
  <g fill="var(--accent)" opacity="0.30">
    {"".join(cells)}
  </g>

  <!-- 테이블 면 -->
  <path stroke="var(--warn)" stroke-width="1.6" stroke-dasharray="5 4"
        d="M{X0:.0f} {py(0):.1f} H{X0 + W:.0f}"/>
  <text class="wr" x="{X0 + W - 4:.0f}" y="{py(0) - 8:.1f}" text-anchor="end"
        font-size="11.5">테이블 면 z = 0</text>

  <!-- 실용 작업 구간 -->
  <rect fill="none" stroke="var(--accent)" stroke-width="1.4" stroke-dasharray="4 3"
        x="{px(15):.1f}" y="{py(30):.1f}"
        width="{(px(30) - px(15)):.1f}" height="{(py(0) - py(30)):.1f}" rx="3"/>
  <text class="hi" x="{px(22.5):.1f}" y="{py(32):.1f}" text-anchor="middle"
        font-size="11.5">실용 작업 구간</text>

  <!-- 베이스 -->
  <rect class="box" x="{X0 - 3:.1f}" y="{py(6):.1f}" width="14" height="{(py(0) - py(6)):.1f}" rx="2"/>
  <text class="tag" x="{X0 + 16:.0f}" y="{py(3):.1f}" font-size="11">베이스</text>

  <!-- 최대 도달 -->
  <path class="ln" stroke="var(--text-faint)" stroke-width="1.2" stroke-dasharray="3 3"
        d="M{px(max_r):.1f} {Y0:.0f} V{Y0 + H:.0f}"/>
  <text class="lbl" x="{px(max_r) - 8:.1f}" y="{Y0 + 18:.0f}" text-anchor="end"
        font-size="11.5">최대 {max_r:.0f} cm</text>

  <!-- 축 -->
  <g class="ln" stroke="var(--border)" stroke-width="1">{"".join(ticks)}</g>
  <text class="sub" x="{X0 + W / 2:.0f}" y="{Y0 + H + 40:.0f}" text-anchor="middle">
    베이스 중심에서의 수평 거리 (cm)</text>
  <text class="sub" x="18" y="{Y0 + H / 2:.0f}" text-anchor="middle"
        transform="rotate(-90 18 {Y0 + H / 2:.0f})">TCP 높이 z (cm)</text>

  <text class="sub" x="{X0:.0f}" y="16">조인트 한계만 고려한 이론 영역 · 자기 충돌과 케이블 간섭은 반영하지 않음</text>
</svg>
'''
    (OUT / "workspace-section.svg").write_text(svg, encoding="utf-8")
    print("workspace-section.svg  (최대 %.1fcm, z %.1f~%.1fcm)" % (max_r, min_z, max_z))


# ---------------------------------------------------------------- 조인트 가동범위

def joint_limits() -> None:
    """조인트별 가동범위를 부채꼴로 그린다. 0°가 위쪽."""
    cols, cx0, cy0, dx, dy, r = 3, 105.0, 96.0, 195.0, 168.0, 52.0
    parts = []

    for idx, j in enumerate(K.JOINTS):
        cx = cx0 + (idx % cols) * dx
        cy = cy0 + (idx // cols) * dy
        lo, hi = j.lower, j.upper
        span = hi - lo

        def pt(ang: float, rad: float = r) -> tuple[float, float]:
            # 0° = 위쪽(12시), 양수는 시계 방향
            return (cx + rad * math.sin(ang), cy - rad * math.cos(ang))

        x1, y1 = pt(lo)
        x2, y2 = pt(hi)
        large = 1 if span > math.pi else 0
        parts.append(
            f'<path fill="var(--accent)" opacity="0.30" '
            f'd="M{cx:.1f} {cy:.1f} L{x1:.1f} {y1:.1f} '
            f'A{r} {r} 0 {large} 1 {x2:.1f} {y2:.1f} Z"/>')
        parts.append(f'<circle stroke="var(--border)" stroke-width="1.2" fill="none" '
                     f'cx="{cx:.1f}" cy="{cy:.1f}" r="{r}"/>')

        # 0° 기준선
        zx, zy = pt(0.0, r + 6)
        parts.append(f'<path stroke="var(--text-faint)" stroke-width="1" stroke-dasharray="3 3" '
                     f'd="M{cx:.1f} {cy:.1f} L{zx:.1f} {zy:.1f}"/>')
        # 양 끝
        for ang, lab in ((lo, "%.0f°" % math.degrees(lo)), (hi, "%.0f°" % math.degrees(hi))):
            ex, ey = pt(ang)
            lx, ly = pt(ang, r + 17)
            parts.append(f'<path stroke="var(--accent)" stroke-width="1.8" '
                         f'd="M{cx:.1f} {cy:.1f} L{ex:.1f} {ey:.1f}"/>')
            anchor = "start" if lx > cx + 4 else ("end" if lx < cx - 4 else "middle")
            parts.append(f'<text class="hi" x="{lx:.1f}" y="{ly + 4:.1f}" '
                         f'font-size="11" text-anchor="{anchor}">{lab}</text>')

        parts.append(f'<circle class="box-hi" cx="{cx:.1f}" cy="{cy:.1f}" r="5"/>')
        parts.append(f'<text class="lbl mono" x="{cx:.1f}" y="{cy + r + 38:.1f}" '
                     f'text-anchor="middle" font-size="12">{j.name}</text>')
        parts.append(f'<text class="sub" x="{cx:.1f}" y="{cy + r + 53:.1f}" '
                     f'text-anchor="middle">{j.ko} · 서보 {j.servo_id} · '
                     f'가동 {math.degrees(span):.0f}°</text>')

    svg = f'''<svg viewBox="0 0 600 386" xmlns="http://www.w3.org/2000/svg" role="img"
     aria-label="SO-ARM101 조인트별 가동범위">
  <!-- 자동 생성 — content/figures/gen_figures.py -->
  {"".join(parts)}
</svg>
'''
    (OUT / "joint-limits.svg").write_text(svg, encoding="utf-8")
    print("joint-limits.svg")


# ---------------------------------------------------------------- 단위 눈금

def tick_scale() -> None:
    """서보 틱 ↔ 각도 ↔ LeRobot 정규화 값을 한 눈금 위에 겹쳐 보여 준다."""
    X0, W, y = 70.0, 470.0, 78.0
    j = K.JOINTS[1]          # shoulder_lift 를 예로 사용
    lo_t, hi_t = K.rad_to_ticks(j.lower), K.rad_to_ticks(j.upper)

    def px(t: int) -> float:
        return X0 + (t / 4095.0) * W

    rows = []
    # 1) 서보 틱
    for t in (0, 1024, 2048, 3072, 4095):
        rows.append(f'<path class="ln" stroke="var(--border)" d="M{px(t):.1f} {y} V{y + 10}"/>')
        rows.append(f'<text class="sub mono" x="{px(t):.1f}" y="{y - 8}" '
                    f'text-anchor="middle">{t}</text>')
    # 2) 각도
    for t, lab in ((0, "−180°"), (1024, "−90°"), (2048, "0°"), (3072, "+90°"), (4095, "+180°")):
        rows.append(f'<text class="sub mono" x="{px(t):.1f}" y="{y + 68}" '
                    f'text-anchor="middle">{lab}</text>')

    svg = f'''<svg viewBox="0 0 600 264" xmlns="http://www.w3.org/2000/svg" role="img"
     aria-label="서보 틱, 각도, LeRobot 정규화 값의 대응 관계">
  <!-- 자동 생성 — content/figures/gen_figures.py -->
  <text class="lbl" x="{X0}" y="34" font-size="12.5" font-weight="700">
    같은 자세를 부르는 세 가지 숫자</text>

  <path class="ln" stroke="var(--border)" stroke-width="1.6" d="M{X0} {y} H{X0 + W}"/>
  <text class="tag mono" x="{X0 - 10}" y="{y + 4}" text-anchor="end">틱</text>
  {"".join(rows)}

  <!-- 조인트 가동범위 -->
  <rect fill="var(--accent)" opacity="0.22" x="{px(lo_t):.1f}" y="{y + 20}"
        width="{(px(hi_t) - px(lo_t)):.1f}" height="26" rx="4"/>
  <text class="hi" x="{(px(lo_t) + px(hi_t)) / 2:.1f}" y="{y + 38}" text-anchor="middle"
        font-size="11.5">shoulder_lift 실제 가동범위 {lo_t}~{hi_t}</text>
  <text class="tag mono" x="{X0 - 10}" y="{y + 38}" text-anchor="end">각도</text>

  <!-- LeRobot 정규화 -->
  <path class="ln" stroke="var(--accent)" stroke-width="1.6"
        d="M{px(lo_t):.1f} {y + 108} H{px(hi_t):.1f}"/>
  <text class="tag mono" x="{X0 - 10}" y="{y + 112}" text-anchor="end">LeRobot</text>
  <text class="hi mono" x="{px(lo_t):.1f}" y="{y + 128}" text-anchor="middle">−100</text>
  <text class="hi mono" x="{(px(lo_t) + px(hi_t)) / 2:.1f}" y="{y + 128}" text-anchor="middle">0</text>
  <text class="hi mono" x="{px(hi_t):.1f}" y="{y + 128}" text-anchor="middle">+100</text>

  <text class="sub" x="{X0}" y="{y + 152}">
    LeRobot 은 캘리브레이션으로 잰 <tspan class="hi">실제 가동범위</tspan>를
    −100~+100 으로 펴서 씁니다. 그래서 로그의 숫자는 각도가 아닙니다.</text>
  <text class="sub" x="{X0}" y="{y + 170}">
    1 틱 = 2π ÷ 4096 = 0.00153398 rad = 0.0879°  ·  중립 위치 = 2048</text>
</svg>
'''
    (OUT / "tick-scale.svg").write_text(svg, encoding="utf-8")
    print("tick-scale.svg")


# ---------------------------------------------------------------- 팔 측면 해부도

def arm_anatomy() -> None:
    """실제 FK 로 계산한 관절 위치 위에 부품 이름을 붙인 측면도."""
    q = K.POSES["ready"]
    links = K.forward(q)

    chain = [
        ("base_link", "베이스", None),
        ("shoulder_link", "어깨", "shoulder_pan"),
        ("upper_arm_link", "상완", "shoulder_lift"),
        ("lower_arm_link", "전완", "elbow_flex"),
        ("wrist_link", "손목", "wrist_flex"),
        ("gripper_link", "그리퍼", "wrist_roll"),
        ("gripper_frame_link", "TCP", "gripper"),
    ]

    pts = []
    for name, ko, joint in chain:
        m = links[name]
        pts.append((float(m[0, 3]), float(m[2, 3]), ko, joint))

    # 그림이 프레임을 꽉 채우도록 축척을 맞춘다
    VB_W, VB_H = 470.0, 348.0
    SC = 1000.0                      # px per meter
    X0, Y0 = 118.0, 296.0            # base_link 원점의 화면 위치

    def sx(x: float) -> float:
        return X0 + x * SC

    def sy(z: float) -> float:
        return Y0 - z * SC

    seg = []
    for a, b in zip(pts, pts[1:]):
        seg.append('<path stroke="var(--accent)" stroke-width="16" stroke-linecap="round"'
                   ' opacity="0.32" d="M%.1f %.1f L%.1f %.1f"/>'
                   % (sx(a[0]), sy(a[1]), sx(b[0]), sy(b[1])))

    dots, labels = [], []
    # (dx, dy, anchor) — 서로 겹치지 않게 손으로 배치
    offsets = [
        (-16, 20, "end"), (-16, -12, "end"), (-10, -16, "end"),
        (12, -16, "start"), (16, -6, "start"), (18, 14, "start"), (14, 30, "start"),
    ]
    for (x, z, ko, joint), (ox, oy, anchor) in zip(pts, offsets):
        px_, py_ = sx(x), sy(z)
        dots.append('<circle class="box-hi" cx="%.1f" cy="%.1f" r="7"/>' % (px_, py_))
        labels.append('<text class="lbl" x="%.1f" y="%.1f" text-anchor="%s" '
                      'font-size="13">%s</text>' % (px_ + ox, py_ + oy, anchor, ko))
        if joint:
            labels.append('<text class="sub mono" x="%.1f" y="%.1f" text-anchor="%s" '
                          'font-size="10">%s</text>'
                          % (px_ + ox, py_ + oy + 13, anchor, joint))

    tcp_x = pts[-1][0]
    reach = tcp_x * 100

    svg = f'''<svg viewBox="0 0 {VB_W:.0f} {VB_H:.0f}" xmlns="http://www.w3.org/2000/svg" role="img"
     aria-label="SO-ARM101 측면 구조와 부품 이름">
  <!-- 자동 생성 — content/figures/gen_figures.py · 자세: ready 프리셋 -->
  <path stroke="var(--border)" stroke-width="1.4" d="M20 {Y0:.0f} H{VB_W - 16:.0f}"/>
  <text class="sub" x="{VB_W - 18:.0f}" y="{Y0 + 17:.0f}" text-anchor="end"
        font-size="11">테이블 면</text>

  <rect class="box" x="{X0 - 32:.0f}" y="{Y0 - 24:.0f}" width="64" height="24" rx="4"/>
  <text class="tag" x="{X0:.0f}" y="{Y0 - 8:.0f}" text-anchor="middle" font-size="10">클램프</text>

  {"".join(seg)}
  {"".join(dots)}
  {"".join(labels)}

  <path stroke="var(--text-faint)" stroke-width="1" stroke-dasharray="3 3"
        d="M{X0:.0f} {Y0 + 30:.0f} H{sx(tcp_x):.1f}"/>
  <path stroke="var(--text-faint)" stroke-width="1" stroke-dasharray="2 3"
        d="M{sx(tcp_x):.1f} {sy(pts[-1][1]):.1f} V{Y0 + 30:.0f}"/>
  <text class="sub" x="{(X0 + sx(tcp_x)) / 2:.1f}" y="{Y0 + 45:.0f}" text-anchor="middle"
        font-size="11">이 자세의 수평 도달 {reach:.0f} cm</text>
</svg>
'''
    (OUT / "arm-anatomy.svg").write_text(svg, encoding="utf-8")
    print("arm-anatomy.svg  (수평 도달 %.1fcm)" % reach)


if __name__ == "__main__":
    workspace_section()
    joint_limits()
    tick_scale()
    arm_anatomy()
