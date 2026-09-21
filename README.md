# SO-ARM101 한국어 실습 강좌

오픈소스 6자유도 로봇팔 **SO-ARM101** 을 조립부터 LeRobot 모방학습, ROS 2 연동까지
다루는 **23개 챕터 한국어 강좌**입니다. 실물이 없어도 브라우저에서 바로 돌려볼 수 있는
**3D 시뮬레이터**를 포함합니다.

```text
studySO-ARM101/
├── index.html              # 강좌 홈 (빌드 산출물)
├── lessons/ch01~ch23.html  # 챕터 페이지 (빌드 산출물)
├── content/                # 원고 (마크다운) — 여기를 고치세요
│   ├── curriculum.json     #   커리큘럼 정의
│   ├── ch01.md ~ ch23.md
│   └── figures/            #   도해 SVG (+ 계산으로 그리는 생성기)
├── build.py                # content/ → HTML 정적 사이트 빌더
├── sim/index.html          # 3D 시뮬레이터
├── tools/cli-builder.html  # LeRobot 명령어 생성기
├── assets/                 # CSS · JS (기구학, 렌더러, 시뮬레이터)
├── scripts/                # 파이썬 실습 예제 (FK/IK, 서보 스캔, ROS 2 브릿지…)
└── ros2_ws/                # ROS 2 패키지 (description · moveit_config · bringup)
```

---

## 실행

정적 사이트라 별도 빌드 도구가 필요 없습니다. **Python 3.9+** 만 있으면 됩니다.

```bash
python build.py --serve
```

http://localhost:8000 에서 강좌가 열립니다. 이 서버는 **캐시를 남기지 않으므로**
원고나 스크립트를 고치고 새로고침하면 바로 반영됩니다.

빌드만 하려면:

```bash
python build.py
```

VS Code Live Server 같은 정적 서버로 폴더를 열어도 됩니다.

> `file://` 로 직접 열어도 대부분 동작하지만, 3D 시뮬레이터의 three.js 모듈 로딩이
> 브라우저 정책에 막힐 수 있습니다. 그 경우 자동으로 2D 폴백 렌더러로 전환됩니다.
> **정상적인 3D 화면을 보려면 위 명령으로 로컬 서버를 띄우세요.**

---

## 커리큘럼

| 파트 | 챕터 | 내용 |
| --- | --- | --- |
| **1. 기초 다지기** | 01~04 | SO-ARM101 개요, 로봇팔 기구학, 하드웨어 해부, 3D 프린팅과 조립 |
| **2. 서보와 환경** | 05~08 | STS3215 ID/보레이트, LeRobot 설치, 시리얼 포트, 캘리브레이션 |
| **3. 텔레오퍼·데이터** | 09~12 | 텔레오퍼레이션, 카메라, 실기 데이터셋, LeIsaac 시뮬레이션 |
| **4. 학습과 추론** | 13~14 | ACT/Diffusion/SmolVLA 학습, rollout 배포와 평가 |
| **5. ROS 2** | 15~20 | URDF, 워크스페이스/RViz2, ros2_control, MoveIt 2, Gazebo, LeRobot 브릿지 |
| **6. 확장** | 21~22 | 듀얼 암·모바일·다지 손, 트러블슈팅, 종합 프로젝트 |
| **7. 부록** | 23 | 다른 공개 강좌(HF·NVIDIA)·벤더 위키·한국어 자료·응용 프로젝트, 중↔한 용어 대조표 |

---

## 포함된 도구

### 3D 시뮬레이터 (`sim/index.html`)

`so101_new_calib.urdf` 의 **실제 조인트 원점·회전축·한계 값**으로 동작합니다.

- 조인트 슬라이더 (도 / 라디안 / LeRobot 정규화 / 서보 틱 단위 전환)
- 역기구학 — 감쇠 최소자승(DLS). 목표 구를 끌면 실시간으로 풉니다
- **Ctrl + 드래그로 팔 직접 끌기** — 관절을 마우스로 집으면 집은 지점이
  따라옵니다. 집은 곳보다 베이스 쪽 관절만 움직입니다
- 리더→팔로워 텔레오퍼레이션 (추종 지연, 조인트 한계 초과 경고)
- **실기 리더 암 직결** — Web Serial 로 STS3215 현재 위치를 읽어
  진짜 리더를 움직이면 시뮬레이터 팔이 그대로 따라옵니다 (읽기 전용)
- 궤적 녹화 / 재생 / JSON·CSV 내보내기
- 손목·전역 카메라 뷰
- 작업영역 — 도달 가능 부피를 반투명 껍질로 (어깨 회전 ±110° 부채꼴 형상 그대로)
- `sensor_msgs/JointState`, `trajectory_msgs/JointTrajectory`, TF 체인 실시간 출력
- three.js 가 없으면 의존성 없는 2D 캔버스 렌더러로 자동 전환

3D 모드에서는 콘솔에 `window.__so101` 로 장면·카메라·픽킹 함수가 노출되어 있어
직접 확장하거나 들여다보기 쉽습니다.

### 명령어 생성기 (`tools/cli-builder.html`)

포트·ID·카메라·데이터셋 설정을 한 번 입력하면 `lerobot-find-port` 부터
`lerobot-rollout` 까지 **10단계 전 과정의 명령**을 완성해 줍니다.
입력값은 브라우저 로컬 저장소에만 남습니다.

### 파이썬 스크립트 (`scripts/`)

`scripts/README.md` 참고. FK/IK 계산, 서보 스캔, 캘리브레이션 점검,
키보드 텔레오퍼레이션, 궤적 변환, ROS 2 브릿지, rosbag 변환, 성공률 집계.

### ROS 2 패키지 (`ros2_ws/`)

`ros2_ws/README.md` 참고. `colcon build` 후 RViz2 · ros2_control(mock) ·
MoveIt 2 · Gazebo 가 바로 동작합니다. 실기 하드웨어 플러그인만 별도입니다.

---

## 원고 수정

`content/*.md` 를 고치고 `python build.py` 를 다시 실행하면 됩니다.
마크다운 확장 문법:

```markdown
@fig[link-chain] 그림 아래에 붙을 캡션

:::tip 제목
TIP 박스
:::

:::warn
주의 박스 (tip / info / warn / danger / check / task 지원)
:::

[2장](~/lessons/ch02.html)     ← `~/` 는 사이트 루트를 뜻합니다
```

커리큘럼(챕터 순서·제목·소요 시간·태그)은 `content/curriculum.json` 에서 바꿉니다.

### 도해

`@fig[이름]` 은 `content/figures/<이름>.svg` 를 **인라인으로** 끼워 넣습니다.
인라인이라 SVG 안에서 테마 색(`var(--accent)` 등)을 그대로 쓸 수 있고,
외부 이미지가 차단되는 환경(공유 링크)에서도 깨지지 않습니다.

21곳에 들어가는 21개 도해 중 4개는 **계산해서 그립니다.**

```bash
python content/figures/gen_figures.py
```

| 파일 | 내용 |
| --- | --- |
| `workspace-section.svg` | 무작위 자세 40만 개를 FK로 계산한 실제 도달 영역 단면 |
| `joint-limits.svg` | URDF 한계값으로 그린 조인트별 가동범위 부채꼴 |
| `arm-anatomy.svg` | `ready` 자세를 기구학으로 계산한 측면 구조도 |
| `tick-scale.svg` | 서보 틱 ↔ 각도 ↔ LeRobot 정규화 눈금 |

URDF 수치를 바꾸면 이 스크립트를 다시 돌리세요. 나머지 17개는 손으로 그린 개념도입니다.

실물 **사진**은 저작권과 외부 이미지 차단 때문에 싣지 않고, 4장에 공식 출처
(LeRobot 조립 영상 · TheRobotStudio · RoboSEasy 한국어 가이드)를 표로 안내합니다.

---

## 출처

- 목차 구성: 钜犀科技(Juxi Tech) Feishu 위키
  [SO-ARM101机械臂教程](https://juxitech.feishu.cn/wiki/NOWXw9NOJiDTs2kRr7RcdIrKnvg) (중국어)
- 하드웨어·BOM·조립: [TheRobotStudio/SO-ARM100](https://github.com/TheRobotStudio/SO-ARM100)
- CLI·API: [Hugging Face LeRobot 공식 문서](https://huggingface.co/docs/lerobot)
- URDF: `SO-ARM100/Simulation/SO101/so101_new_calib.urdf`
- 시뮬레이션 데이터: [LightwheelAI/leisaac](https://github.com/LightwheelAI/leisaac)

추가로 23장에 정리한 참고 자료:

- [Hugging Face Robotics Course](https://huggingface.co/learn/robotics-course/en/unit0/1) — 무료 공식 강좌(실물 불필요)
- [NVIDIA · Train an SO-101 Robot From Sim-to-Real](https://docs.nvidia.com/learning/physical-ai/sim-to-real-so-101/latest/) — Isaac Sim + GR00T
- [Seeed Studio Wiki](https://wiki.seeedstudio.com/robotics_page/) — SO-ARM10x 주제별 튜토리얼 8종
- [RoboSEasy Docs](https://roboseasy.github.io/docs/physical-ai/lerobot/so-arm/) — 한국어 조립·운용 가이드
- [sesepark/soarm101-console](https://github.com/sesepark/soarm101-console) — 한국어 오픈소스 운영 콘솔
- [XLeRobot](https://github.com/Vector-Wangel/XLeRobot) · [LeLab](https://github.com/huggingface/leLab) · [lerobot-ros](https://github.com/ycheng517/lerobot-ros) 등 응용 프로젝트

원문 위키의 하위 페이지 상당수가 영상 위주라, 본 강좌는 목차와 확보된 텍스트를
기반으로 LeRobot 공식 문서와 ROS 2 생태계 자료를 더해 재구성했습니다.

---

## 라이선스

강좌 본문(`content/`)은 자유롭게 사용·수정하셔도 됩니다.
인용한 외부 자료는 각 출처의 라이선스를 따릅니다
(SO-ARM100: Apache-2.0, LeRobot: Apache-2.0).
