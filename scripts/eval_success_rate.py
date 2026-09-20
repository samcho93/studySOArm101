#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
정책 평가 결과 집계 (14장 실습용)

lerobot-rollout --strategy.type=episodic 으로 녹화한 rollout_ 데이터셋을
에피소드 단위로 라벨링하고 성공률 표를 만듭니다.

  # 대화형 라벨링
  python eval_success_rate.py --root ./datasets/rollout_so101_pick --annotate

  # 이미 만든 라벨 파일로 집계만
  python eval_success_rate.py --root ./datasets/rollout_so101_pick

라벨은 <root>/eval_labels.json 에 저장됩니다.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

def _utf8_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass


_utf8_stdout()

LABEL_FILE = "eval_labels.json"


def count_episodes(root: Path) -> int:
    info = root / "meta" / "info.json"
    if info.exists():
        try:
            data = json.loads(info.read_text(encoding="utf-8"))
            for key in ("total_episodes", "num_episodes"):
                if key in data:
                    return int(data[key])
        except (json.JSONDecodeError, ValueError):
            pass
    # 폴백: 영상 파일 개수
    videos = list((root / "videos").rglob("*.mp4"))
    return len(videos)


def annotate(root: Path, total: int) -> dict:
    path = root / LABEL_FILE
    labels = {}
    if path.exists():
        labels = json.loads(path.read_text(encoding="utf-8"))

    print("에피소드를 하나씩 라벨링합니다.")
    print("  s = 성공 / f = 실패 / p = 부분 성공 / q = 중단 후 저장\n")
    print("영상은 다음 명령으로 재생할 수 있습니다.")
    print(f"  lerobot-dataset-viz --repo-id <repo> --root {root}\n")

    for i in range(total):
        key = str(i)
        if key in labels:
            print(f"  #{i:<3} 이미 라벨됨: {labels[key]['result']}")
            continue
        while True:
            ans = input(f"  #{i:<3} 결과 [s/f/p/q] > ").strip().lower()
            if ans in ("s", "f", "p", "q"):
                break
            print("     s, f, p, q 중 하나를 입력하세요.")
        if ans == "q":
            break
        note = ""
        if ans in ("f", "p"):
            note = input("        실패 양상(선택) > ").strip()
        labels[key] = {
            "result": {"s": "success", "f": "fail", "p": "partial"}[ans],
            "note": note,
        }

    path.write_text(json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n라벨 저장: {path}")
    return labels


def report(labels: dict, total: int) -> None:
    counts = Counter(v["result"] for v in labels.values())
    labeled = sum(counts.values())
    success = counts.get("success", 0)

    print("\n" + "=" * 46)
    print("평가 결과")
    print("=" * 46)
    print(f"  전체 에피소드   {total}")
    print(f"  라벨된 에피소드 {labeled}")
    print(f"  성공            {success}")
    print(f"  부분 성공       {counts.get('partial', 0)}")
    print(f"  실패            {counts.get('fail', 0)}")
    if labeled:
        print(f"\n  성공률          {success / labeled * 100:.1f} %")
        bar = int(success / labeled * 40)
        print("  " + "█" * bar + "░" * (40 - bar))

    notes = Counter(v["note"] for v in labels.values() if v.get("note"))
    if notes:
        print("\n실패 양상 (빈도순)")
        for note, n in notes.most_common():
            print(f"  {n:>3}회  {note}")
        print("\n가장 많은 실패 양상부터 데이터를 보강하세요. (14장 처방표 참고)")


def main() -> int:
    ap = argparse.ArgumentParser(description="rollout 데이터셋 성공률 집계")
    ap.add_argument("--root", required=True, help="rollout_ 데이터셋 디렉터리")
    ap.add_argument("--annotate", action="store_true", help="대화형 라벨링 시작")
    args = ap.parse_args()

    root = Path(args.root)
    if not root.exists():
        print("디렉터리를 찾을 수 없습니다:", root)
        return 1

    total = count_episodes(root)
    if total == 0:
        print("에피소드를 찾지 못했습니다. --root 경로가 맞나요?")
        return 1
    print(f"데이터셋: {root}  (에피소드 {total}개)")

    label_path = root / LABEL_FILE
    if args.annotate:
        labels = annotate(root, total)
    elif label_path.exists():
        labels = json.loads(label_path.read_text(encoding="utf-8"))
    else:
        print("\n라벨 파일이 없습니다. --annotate 로 먼저 라벨링하세요.")
        return 1

    report(labels, total)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
