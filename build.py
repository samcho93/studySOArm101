#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SO-ARM101 한국어 강좌 정적 사이트 빌더
  content/*.md + content/curriculum.json  ->  index.html, lessons/*.html

표준 라이브러리만 사용합니다. 사용법:
  python build.py            # 전체 빌드
  python build.py --serve    # 빌드 후 http://localhost:8000 로 미리보기
"""
from __future__ import annotations

import html
import json
import re
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

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
LESSONS = ROOT / "lessons"
FIGURES = CONTENT / "figures"


# ---------------------------------------------------------------- 마크다운 파서

class MarkdownRenderer:
    """강좌에 필요한 범위만 지원하는 소형 마크다운 렌더러."""

    CALLOUT_LABEL = {
        "tip": "TIP",
        "info": "참고",
        "warn": "주의",
        "danger": "위험",
        "check": "체크포인트",
        "task": "실습",
    }

    def __init__(self, depth: int = 1):
        # depth: 결과 HTML이 사이트 루트로부터 몇 단계 아래에 있는지
        self.rel = "../" * depth
        self.toc: list = []
        self._code_id = 0

    # ---- 인라인 -------------------------------------------------------
    def inline(self, text: str) -> str:
        out = []
        # 인라인 코드를 먼저 떼어 두고 나머지를 이스케이프한다
        for part in re.split(r"(`[^`]+`)", text):
            if len(part) > 1 and part.startswith("`") and part.endswith("`"):
                out.append("<code>" + html.escape(part[1:-1]) + "</code>")
                continue
            s = html.escape(part)
            s = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", self._img, s)
            s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", self._link, s)
            s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
            s = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])", r"<em>\1</em>", s)
            s = re.sub(r"~~([^~]+)~~", r"<del>\1</del>", s)
            out.append(s)
        return "".join(out)

    def _img(self, m):
        return '<img src="%s" alt="%s" loading="lazy">' % (self._href(m.group(2)), m.group(1))

    def _link(self, m):
        url = m.group(2)
        ext = ' target="_blank" rel="noopener"' if "://" in url else ""
        return '<a href="%s"%s>%s</a>' % (self._href(url), ext, m.group(1))

    def _href(self, url: str) -> str:
        if url.startswith("~/"):          # 사이트 루트 기준 경로
            return self.rel + url[2:]
        return url

    # ---- 블록 ---------------------------------------------------------
    def render(self, md: str) -> str:
        lines = md.replace("\r\n", "\n").split("\n")
        out = []
        i, n = 0, len(lines)

        while i < n:
            line = lines[i]
            stripped = line.strip()

            if not stripped:
                i += 1
                continue

            # 코드 펜스
            if stripped.startswith("```"):
                lang = stripped[3:].strip() or "text"
                i += 1
                buf = []
                while i < n and not lines[i].strip().startswith("```"):
                    buf.append(lines[i])
                    i += 1
                i += 1
                out.append(self._code_block(lang, "\n".join(buf)))
                continue

            # 그림  @fig[이름] 캡션
            if stripped.startswith("@fig["):
                m = re.match(r"@fig\[([\w-]+)\]\s*(.*)", stripped)
                if m:
                    out.append(self._figure(m.group(1), m.group(2).strip()))
                    i += 1
                    continue

            # 버튼 링크  @btn[주소] 라벨
            if stripped.startswith("@btn["):
                m = re.match(r"@btn\[([^\]]+)\]\s*(.*)", stripped)
                if m:
                    out.append('<p class="cta-row"><a class="ghost-btn cta" href="%s">%s</a></p>'
                               % (html.escape(self._href(m.group(1))),
                                  html.escape(m.group(2).strip() or "열기")))
                    i += 1
                    continue

            # 콜아웃  :::tip 제목
            if stripped.startswith(":::"):
                m = re.match(r":::\s*(\w+)\s*(.*)", stripped)
                kind = (m.group(1) if m else "info").lower()
                title = (m.group(2).strip() if m else "")
                i += 1
                buf = []
                while i < n and not lines[i].strip().startswith(":::"):
                    buf.append(lines[i])
                    i += 1
                i += 1
                label = title or self.CALLOUT_LABEL.get(kind, "참고")
                sub = MarkdownRenderer(depth=0)
                sub.rel = self.rel
                out.append(
                    '<div class="callout callout-%s"><div class="callout-title">%s</div>'
                    '<div class="callout-body">%s</div></div>'
                    % (kind, html.escape(label), sub.render("\n".join(buf))))
                continue

            # 헤딩
            m = re.match(r"^(#{1,4})\s+(.*)$", stripped)
            if m:
                level = len(m.group(1))
                text = m.group(2).strip()
                slug = self._slug(text)
                if level in (2, 3):
                    self.toc.append((level, slug, text))
                out.append('<h%d id="%s">%s<a class="anchor" href="#%s">#</a></h%d>'
                           % (level, slug, self.inline(text), slug, level))
                i += 1
                continue

            # 수평선
            if re.match(r"^(---|\*\*\*)$", stripped):
                out.append("<hr>")
                i += 1
                continue

            # 표
            if ("|" in stripped and i + 1 < n
                    and re.match(r"^\s*\|?[\s:|-]+\|[\s:|-]*$", lines[i + 1])):
                head = self._row(stripped)
                i += 2
                body = []
                while i < n and "|" in lines[i] and lines[i].strip():
                    body.append(self._row(lines[i]))
                    i += 1
                thead = "".join("<th>%s</th>" % self.inline(c) for c in head)
                rows = "".join("<tr>%s</tr>" % "".join("<td>%s</td>" % self.inline(c) for c in r)
                               for r in body)
                out.append('<div class="table-wrap"><table><thead><tr>%s</tr></thead>'
                           "<tbody>%s</tbody></table></div>" % (thead, rows))
                continue

            # 인용
            if stripped.startswith(">"):
                buf = []
                while i < n and lines[i].strip().startswith(">"):
                    buf.append(re.sub(r"^\s*>\s?", "", lines[i]))
                    i += 1
                sub = MarkdownRenderer(depth=0)
                sub.rel = self.rel
                out.append("<blockquote>%s</blockquote>" % sub.render("\n".join(buf)))
                continue

            # 리스트
            if re.match(r"^\s*([-*+]|\d+\.)\s+", line):
                block, i = self._collect_list(lines, i)
                out.append(block)
                continue

            # 원시 HTML
            if stripped.startswith("<"):
                buf = []
                while i < n and lines[i].strip():
                    buf.append(lines[i])
                    i += 1
                out.append("\n".join(buf))
                continue

            # 문단
            buf = []
            while (i < n and lines[i].strip() and not re.match(
                    r"^\s*(#{1,4}\s|```|:::|@fig\[|>|[-*+]\s|\d+\.\s|---$)", lines[i])):
                buf.append(lines[i].strip())
                i += 1
            out.append("<p>%s</p>" % self.inline(" ".join(buf)))

        return "\n".join(out)

    # ---- 도우미 -------------------------------------------------------
    def _row(self, line: str) -> list:
        return [c.strip() for c in line.strip().strip("|").split("|")]

    def _figure(self, name: str, caption: str) -> str:
        """content/figures/<name>.svg 를 인라인으로 삽입한다.

        인라인이어야 SVG 안에서 CSS 변수(테마 색)를 쓸 수 있습니다.
        """
        path = FIGURES / (name + ".svg")
        if not path.exists():
            return ('<div class="callout callout-warn"><div class="callout-title">그림 없음</div>'
                    '<div class="callout-body"><p>content/figures/%s.svg</p></div></div>'
                    % html.escape(name))
        svg = path.read_text(encoding="utf-8").strip()
        cap = ('<figcaption>%s</figcaption>' % self.inline(caption)) if caption else ""
        return '<figure class="fig" id="fig-%s">%s%s</figure>' % (html.escape(name), svg, cap)

    def _code_block(self, lang: str, code: str) -> str:
        self._code_id += 1
        return ('<div class="code-block">'
                '<div class="code-head"><span class="code-lang">%s</span>'
                '<button class="copy-btn" type="button">복사</button></div>'
                '<pre><code class="lang-%s">%s</code></pre></div>'
                % (html.escape(lang), html.escape(lang), html.escape(code)))

    def _collect_list(self, lines: list, i: int):
        n = len(lines)
        items = []   # (indent, text, ordered)
        while i < n:
            m = re.match(r"^(\s*)([-*+]|\d+\.)\s+(.*)$", lines[i])
            if not m:
                # 이어지는 들여쓴 줄은 직전 항목에 붙인다
                if lines[i].strip() and items and lines[i].startswith("   "):
                    indent, text, ordered = items[-1]
                    items[-1] = (indent, text + " " + lines[i].strip(), ordered)
                    i += 1
                    continue
                break
            items.append((len(m.group(1)), m.group(3), m.group(2)[0].isdigit()))
            i += 1

        def build(pos, level):
            tag = "ol" if items[pos][2] else "ul"
            buf = ["<%s>" % tag]
            while pos < len(items) and items[pos][0] >= level:
                indent, text, _ = items[pos]
                if indent > level:
                    sub, pos = build(pos, indent)
                    buf.append(sub)
                    continue
                buf.append("<li>" + self.inline(text))
                if pos + 1 < len(items) and items[pos + 1][0] > level:
                    sub, pos = build(pos + 1, items[pos + 1][0])
                    buf.append(sub)
                else:
                    pos += 1
                buf.append("</li>")
            buf.append("</%s>" % tag)
            return "".join(buf), pos

        block = build(0, items[0][0])[0] if items else ""
        return block, i

    @staticmethod
    def _slug(text: str) -> str:
        s = re.sub(r"[`*_\[\]()#]", "", text).strip().lower()
        s = re.sub(r"[^0-9a-z가-힣]+", "-", s).strip("-")
        return s or "section"


# ---------------------------------------------------------------- 프론트매터

def split_front_matter(text: str):
    text = text.replace("\r\n", "\n")
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---", 4)
    if end == -1:
        return {}, text
    meta = {}
    for line in text[4:end].split("\n"):
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip().strip('"')
    return meta, text[end + 4:].lstrip("\n")


# ---------------------------------------------------------------- 템플릿

def sidebar_html(curriculum: dict, current, rel: str) -> str:
    out = ['<nav class="sidebar-nav">']
    out.append('<a class="brand" href="%sindex.html"><span class="brand-mark">SO</span>'
               '<span class="brand-text">SO-ARM101</span></a>' % rel)
    out.append('<div class="side-tools">'
               '<a class="side-tool" href="%ssim/index.html">3D 시뮬레이터</a>'
               '<a class="side-tool" href="%stools/urdf-viewer.html">URDF 뷰어</a>'
               '<a class="side-tool" href="%stools/cli-builder.html">명령어 생성기</a>'
               '<button class="theme-btn" type="button" data-theme-toggle '
               'aria-label="테마 전환">테마</button>'
               "</div>" % (rel, rel, rel))
    for part in curriculum["parts"]:
        out.append('<div class="nav-part"><span class="nav-part-no">%s</span>%s</div>'
                   % (html.escape(part["no"]), html.escape(part["title"])))
        out.append("<ul>")
        for slug in part["lessons"]:
            lesson = curriculum["index"][slug]
            active = ' class="active"' if slug == current else ""
            out.append('<li><a href="%slessons/%s.html"%s data-slug="%s">'
                       '<span class="nav-no">%s</span>%s</a></li>'
                       % (rel, slug, active, slug, lesson["no"], html.escape(lesson["title"])))
        out.append("</ul>")
    out.append("</nav>")
    return "\n".join(out)


PAGE = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>&#129470;</text></svg>">
<link rel="stylesheet" href="{rel}assets/css/main.css">
<script src="{rel}assets/js/theme.js"></script>
</head>
<body class="{bodyclass}">
<button class="nav-toggle" id="navToggle" aria-label="목차 열기">&#9776;</button>
<aside class="sidebar" id="sidebar">
{sidebar}
</aside>
<div class="sidebar-scrim" id="scrim"></div>
<main class="main">
{content}
</main>
<script src="{rel}assets/js/site.js"></script>
{extra}
</body>
</html>
"""


def lesson_page(curriculum: dict, slug: str, meta: dict, body_md: str) -> str:
    r = MarkdownRenderer(depth=1)
    content_html = r.render(body_md)
    info = curriculum["index"][slug]
    order = curriculum["order"]
    pos = order.index(slug)
    prev_slug = order[pos - 1] if pos > 0 else None
    next_slug = order[pos + 1] if pos < len(order) - 1 else None

    toc = "".join('<a class="toc-l%d" href="#%s">%s</a>' % (lvl, sid, html.escape(txt))
                  for lvl, sid, txt in r.toc)

    nav_prev = ('<a class="pager-prev" href="%s.html"><span>이전</span>%s</a>'
                % (prev_slug, html.escape(curriculum["index"][prev_slug]["title"]))
                ) if prev_slug else '<span class="pager-prev disabled"></span>'
    nav_next = ('<a class="pager-next" href="%s.html"><span>다음</span>%s</a>'
                % (next_slug, html.escape(curriculum["index"][next_slug]["title"]))
                ) if next_slug else '<span class="pager-next disabled"></span>'

    header = """
<article class="lesson" data-slug="{slug}">
  <div class="lesson-head">
    <div class="crumbs">{part} &middot; 약 {minutes}분</div>
    <h1><span class="lesson-no">{no}</span>{title}</h1>
    <p class="lede">{summary}</p>
    <div class="lesson-actions">
      <label class="done-toggle"><input type="checkbox" id="doneCheck"><span>학습 완료로 표시</span></label>
      <a class="ghost-btn" href="../sim/index.html">시뮬레이터 열기</a>
      <a class="ghost-btn" href="../tools/urdf-viewer.html">URDF 뷰어</a>
      <a class="ghost-btn" href="../tools/cli-builder.html">명령어 생성기</a>
    </div>
  </div>
  <div class="lesson-grid">
    <div class="lesson-body">
{content}
      <nav class="pager">{prev}{next}</nav>
    </div>
    <aside class="lesson-toc"><div class="toc-title">이 장의 내용</div><div class="toc-links">{toc}</div></aside>
  </div>
</article>
""".format(slug=slug, part=html.escape(info["part"]), minutes=info.get("minutes", 20),
           no=info["no"], title=html.escape(info["title"]),
           summary=html.escape(info.get("summary", "")), content=content_html,
           prev=nav_prev, next=nav_next, toc=toc)

    return PAGE.format(
        title="%s. %s · SO-ARM101 한국어 강좌" % (info["no"], info["title"]),
        desc=html.escape(info.get("summary", "")),
        rel="../", bodyclass="lesson-page",
        sidebar=sidebar_html(curriculum, slug, "../"),
        content=header, extra="")


def index_page(curriculum: dict) -> str:
    total = len(curriculum["order"])
    cards = []
    for part in curriculum["parts"]:
        items = []
        for slug in part["lessons"]:
            l = curriculum["index"][slug]
            tags = "".join('<span class="tag">%s</span>' % html.escape(t)
                           for t in l.get("tags", []))
            items.append(
                '<a class="lesson-card" href="lessons/%s.html" data-slug="%s">'
                '<div class="lc-no">%s</div>'
                '<div class="lc-main"><div class="lc-title">%s</div>'
                '<div class="lc-sum">%s</div>'
                '<div class="lc-meta"><span class="lc-min">%s분</span>%s</div></div>'
                '<div class="lc-check" aria-hidden="true"></div></a>'
                % (slug, slug, l["no"], html.escape(l["title"]),
                   html.escape(l.get("summary", "")), l.get("minutes", 20), tags))
        cards.append(
            '<section class="part"><header class="part-head">'
            '<div class="part-no">%s</div><div><h3>%s</h3><p>%s</p></div></header>'
            '<div class="part-list">%s</div></section>'
            % (html.escape(part["no"]), html.escape(part["title"]),
               html.escape(part.get("desc", "")), "".join(items)))

    hero = """
<header class="hero">
  <div class="hero-inner">
    <div class="hero-tag">오픈소스 6자유도 로봇팔 &middot; LeRobot &middot; ROS 2</div>
    <h1>SO-ARM101</h1>
    <p class="hero-lede">
      3D 프린팅 부품 조립부터 서보 캘리브레이션, LeRobot 텔레오퍼레이션과 모방학습,
      그리고 ROS 2 / MoveIt 2 / Gazebo 연동까지. 실제 장비가 없어도 브라우저에서
      바로 돌려볼 수 있는 3D 시뮬레이터를 포함한 {total}개 챕터 강좌입니다.
    </p>
    <div class="hero-cta">
      <a class="btn primary" href="lessons/ch01.html">강좌 시작하기</a>
      <a class="btn" href="sim/index.html">3D 시뮬레이터 체험</a>
      <a class="btn" href="tools/urdf-viewer.html">URDF 뷰어</a>
      <a class="btn" href="tools/cli-builder.html">명령어 생성기</a>
    </div>
    <div class="progress-wrap">
      <div class="progress-bar"><div class="progress-fill" id="progFill"></div></div>
      <div class="progress-text"><span id="progText">0 / {total} 챕터 완료</span>
      <button class="link-btn" id="resetProg" type="button">진행률 초기화</button></div>
    </div>
  </div>
  <div class="hero-art">
    <div class="hero-canvas-wrap"><canvas id="heroCanvas"></canvas></div>
    <div class="hero-art-cap">URDF 기구학 그대로 움직이는 SO-ARM101 미니 뷰어</div>
  </div>
</header>

<section class="facts">
  <div class="fact"><div class="fact-n">6+1</div><div class="fact-l">자유도 + 그리퍼</div></div>
  <div class="fact"><div class="fact-n">STS3215</div><div class="fact-l">피드백 버스 서보</div></div>
  <div class="fact"><div class="fact-n">$122~</div><div class="fact-l">팔로워 1대 부품가</div></div>
  <div class="fact"><div class="fact-n">100%</div><div class="fact-l">하드웨어 &middot; 소프트웨어 오픈소스</div></div>
</section>

<section class="roadmap">
  <h2>학습 로드맵</h2>
  <div class="road">
    <div class="road-step"><b>1</b><span>기구학 &middot; 하드웨어 이해</span></div>
    <div class="road-step"><b>2</b><span>조립 &amp; 서보 설정</span></div>
    <div class="road-step"><b>3</b><span>캘리브레이션 &amp; 텔레오퍼레이션</span></div>
    <div class="road-step"><b>4</b><span>데이터셋 수집</span></div>
    <div class="road-step"><b>5</b><span>정책 학습 &amp; 추론</span></div>
    <div class="road-step"><b>6</b><span>ROS 2 &middot; MoveIt 2 &middot; Gazebo</span></div>
  </div>
</section>

<section class="curriculum">
  <h2>커리큘럼</h2>
  {cards}
</section>

<footer class="site-foot">
  <p>본 강좌는 钜犀科技(Juxi Tech) Feishu 위키의 <b>SO-ARM101机械臂教程</b> 목차를 기반으로 한국어로 재구성하고,
  Hugging Face LeRobot 공식 문서 &middot; TheRobotStudio/SO-ARM100 저장소 &middot; ROS 2 생태계 자료를 추가해 작성했습니다.</p>
  <p class="foot-links">
    <a href="https://github.com/TheRobotStudio/SO-ARM100" target="_blank" rel="noopener">SO-ARM100/101 하드웨어</a>
    <a href="https://huggingface.co/docs/lerobot" target="_blank" rel="noopener">LeRobot 공식 문서</a>
    <a href="https://github.com/LightwheelAI/leisaac" target="_blank" rel="noopener">LeIsaac</a>
    <a href="https://juxitech.feishu.cn/wiki/NOWXw9NOJiDTs2kRr7RcdIrKnvg" target="_blank" rel="noopener">원문 위키(중국어)</a>
  </p>
</footer>
""".format(total=total, cards="".join(cards))

    return PAGE.format(
        title="SO-ARM101",
        desc="SO-ARM101 6자유도 오픈소스 로봇팔을 조립·캘리브레이션부터 "
             "LeRobot 모방학습, ROS 2/MoveIt 2 연동까지 배우는 한국어 강좌.",
        rel="", bodyclass="home",
        sidebar=sidebar_html(curriculum, None, ""),
        content=hero,
        extra='<script src="assets/js/so101-kinematics.js"></script>\n'
              '<script src="assets/js/robot-canvas.js"></script>\n'
              '<script src="assets/js/hero.js"></script>')


# ---------------------------------------------------------------- 빌드

def load_curriculum() -> dict:
    data = json.loads((CONTENT / "curriculum.json").read_text(encoding="utf-8"))
    index, order = {}, []
    for part in data["parts"]:
        for slug in part["lessons"]:
            info = data["lessons"][slug]
            info["part"] = "%s %s" % (part["no"], part["title"])
            index[slug] = info
            order.append(slug)
    data["index"] = index
    data["order"] = order
    return data


def main() -> int:
    curriculum = load_curriculum()
    LESSONS.mkdir(exist_ok=True)

    built, missing = 0, []
    for slug in curriculum["order"]:
        src = CONTENT / (slug + ".md")
        if not src.exists():
            missing.append(slug)
            continue
        meta, body = split_front_matter(src.read_text(encoding="utf-8"))
        (LESSONS / (slug + ".html")).write_text(
            lesson_page(curriculum, slug, meta, body), encoding="utf-8")
        built += 1

    (ROOT / "index.html").write_text(index_page(curriculum), encoding="utf-8")
    print("빌드 완료: 레슨 %d개 + index.html" % built)
    if missing:
        print("원고 없음: %s" % ", ".join(missing))

    if "--serve" in sys.argv:
        import functools
        import http.server
        import socketserver

        class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
            """원고를 고치고 새로고침했는데 옛날 CSS/JS 가 나오는 일을 막는다."""

            def end_headers(self):
                self.send_header("Cache-Control", "no-store, must-revalidate")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
                super().end_headers()

            def log_message(self, fmt, *args):
                pass

        # allow_reuse_address 는 Windows 에서 같은 포트에 여러 서버가 붙어
        # 요청이 엉키게 만듭니다. 기본값(끔) 그대로 두어 중복 실행이
        # 곧바로 오류로 드러나게 합니다.
        handler = functools.partial(NoCacheHandler, directory=str(ROOT))
        with socketserver.TCPServer(("", 8000), handler) as httpd:
            print("미리보기: http://localhost:8000  (Ctrl+C 로 종료)")
            httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
