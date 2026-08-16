# -*- coding: utf-8 -*-
"""Builds progress.html from progress.json + screenshots (base64-embedded).
Usage: python scripts/build_progress.py
"""
import base64
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def b64(path, max_w=None):
    p = os.path.join(ROOT, path)
    if not os.path.exists(p):
        return None
    data = open(p, "rb").read()
    if max_w:
        try:
            from PIL import Image
            im = Image.open(io.BytesIO(data))
            if im.width > max_w:
                im = im.resize((max_w, int(im.height * max_w / im.width)))
                buf = io.BytesIO()
                im.convert("RGB").save(buf, "JPEG", quality=78)
                data = buf.getvalue()
        except ImportError:
            pass  # embed original
    return "data:image/jpeg;base64," + base64.b64encode(data).decode()


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def main():
    data = json.load(open(os.path.join(ROOT, "progress.json"), encoding="utf-8"))

    rounds_p1, rounds_p2, rounds_p3, rounds_p4 = [], [], [], []
    for r in reversed(data["rounds"]):
        ph = r.get("phase", 1)
        rounds_html = rounds_p4 if ph == 4 else rounds_p3 if ph == 3 else rounds_p2 if ph == 2 else rounds_p1
        shots = ""
        for s in r.get("shots", []):
            uri = b64(s["file"], 640)
            if uri:
                shots += f'<figure><img src="{uri}" alt="{esc(s["label"])}" loading="lazy"><figcaption>{esc(s["label"])}</figcaption></figure>'
        builder = "".join(f"<li>{esc(x)}</li>" for x in r.get("built", []))
        gaps = "".join(f"<li>{esc(x)}</li>" for x in r.get("gaps", []))
        tf, bl = r.get("score_tf"), r.get("score_bl")
        score_html = ""
        p4 = r.get("p4")
        if p4:
            # phase-4 triple-critic comparative table: critic x game x (design/graphics/ui)
            GAMES = [("ours", "Bannerfall"), ("thronefall", "Thronefall"), ("watg", "Wool at the Gates")]
            CRITICS = [("blind", "Blind rater"), ("informed", "Informed rater"), ("harsh", "Harsh critic (bar 9)")]
            rows = ""
            for ckey, clabel in CRITICS:
                c = p4.get(ckey)
                if not c:
                    continue
                first = True
                present = [(gk, gl) for gk, gl in GAMES if gk in c]
                for gk, gl in present:
                    d_, g_, u_ = c[gk]
                    hot = ' class="p4ours"' if gk == "ours" else ""
                    critic_cell = f'<td rowspan="{len(present)}">{clabel}</td>' if first else ""
                    first = False
                    rows += f'<tr{hot}>{critic_cell}<td>{gl}</td><td>{d_}</td><td>{g_}</td><td>{u_}</td></tr>'
            badge = ""
            if p4.get("goal_met") is True:
                badge = '<span class="p4badge good-b">GOAL MET</span>'
            elif p4.get("goal_met") is False:
                badge = '<span class="p4badge bad-b">GOAL NOT MET</span>'
            score_html = (f'<div class="p4wrap">{badge}<table class="p4table"><thead><tr>'
                          f'<th>Critic</th><th>Game</th><th>Design</th><th>Graphics</th><th>UI</th>'
                          f'</tr></thead><tbody>{rows}</tbody></table></div>')
        if tf is not None:
            def bar(label, v):
                pct = int(v * 10)
                cls = "good" if v >= 8 else "warn" if v >= 5 else "bad"
                return (f'<div class="score"><span class="score-label">{label}</span>'
                        f'<span class="track"><span class="fill {cls}" style="width:{pct}%"></span></span>'
                        f'<span class="score-num">{v}/10</span></div>')
            score_html = bar("Thronefall bar — combat feel", tf) + bar("Bannerlord bar — army &amp; campaign", bl)
        verdict = f'<p class="verdict">{esc(r["verdict"])}</p>' if r.get("verdict") else ""
        biggest = f'<p class="biggest"><strong>Biggest gap →</strong> {esc(r["biggest_gap"])}</p>' if r.get("biggest_gap") else ""
        rounds_html.append(f"""
<section class="round">
  <header class="round-head">
    <span class="round-no">Round {r["n"]}</span>
    <span class="round-title">{esc(r["title"])}</span>
    <span class="round-date">{esc(r.get("date", ""))}</span>
  </header>
  {score_html}
  {verdict}
  {biggest}
  {'<h4>Built this round</h4><ul class="list">' + builder + '</ul>' if builder else ''}
  {'<h4>Open gaps (critic)</h4><ul class="list gaps">' + gaps + '</ul>' if gaps else ''}
  <div class="shots">{shots}</div>
</section>""")

    # Phase 2 review panel (optional)
    panel_html = ""
    panel = data.get("panel")
    if panel:
        cards = ""
        for r in panel.get("roles", []):
            score_bit = ""
            if r.get("score_tf") is not None:
                score_bit = (f'<div class="panel-scores"><span>TF <b>{r["score_tf"]}</b></span>'
                             f'<span>BL <b>{r["score_bl"]}</b></span></div>')
            elif r.get("score_label"):
                score_bit = f'<div class="panel-scores"><span>{esc(r["score_label"])}</span></div>'
            hi = "".join(f"<li>{esc(x)}</li>" for x in r.get("highlights", []))
            status = r.get("status", "")
            cards += f"""
<div class="panel-card">
  <div class="panel-head"><span class="panel-icon">{r.get("icon", "")}</span>
    <span class="panel-role">{esc(r["role"])}</span>{score_bit}</div>
  {f'<p class="panel-verdict">{esc(r["verdict"])}</p>' if r.get("verdict") else f'<p class="panel-verdict pending">{esc(status)}</p>'}
  {f'<ul class="list panel-list">{hi}</ul>' if hi else ''}
</div>"""
        panel_html = f"""
<section class="round panel-section">
  <header class="round-head">
    <span class="round-no" style="color:var(--teal)">Phase 2</span>
    <span class="round-title">{esc(panel.get("title", "Review panel"))}</span>
    <span class="round-date">{esc(panel.get("date", ""))}</span>
  </header>
  <p class="verdict">{esc(panel.get("intro", ""))}</p>
  <div class="panel-grid">{cards}</div>
  {f'<p class="biggest"><strong>Panel consensus →</strong> {esc(panel["consensus"])}</p>' if panel.get("consensus") else ''}
</section>"""

    ref_tf = b64("references/thronefall/tf_1.jpg", 480)
    ref_bl = b64("references/bannerlord/bl_5.jpg", 480)

    html = f"""<title>Bannerfall — build log</title>
<style>
:root {{
  --ground: #F2E3C1; --panel: #FFFFFF; --ink: #1E2A4A; --muted: #6B7085;
  --ochre: #EFA33B; --rose: #B8506A; --gold: #D98F1F; --teal: #2E9BB5;
  --good: #4CAF50; --warn: #EFA33B; --bad: #C23A2E; --line: #E0D4B4;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    --ground: #161D33; --panel: #1E2A4A; --ink: #F2E3C1; --muted: #9BA3BF;
    --gold: #FFD34D; --line: #2C3A63;
  }}
}}
:root[data-theme="dark"] {{
  --ground: #161D33; --panel: #1E2A4A; --ink: #F2E3C1; --muted: #9BA3BF;
  --gold: #FFD34D; --line: #2C3A63;
}}
body {{ background: var(--ground); color: var(--ink); font: 16px/1.6 system-ui, sans-serif; margin: 0; }}
.wrap {{ max-width: 880px; margin: 0 auto; padding: 0 20px 80px; }}
.masthead {{ padding: 42px 0 10px; }}
.masthead .flags {{ display:flex; gap:6px; margin-bottom: 14px; }}
.masthead .flags span {{ width: 26px; height: 16px; clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 70%, 0 100%); }}
h1 {{ font-size: clamp(34px, 6vw, 54px); font-weight: 900; letter-spacing: -0.02em; margin: 0; text-transform: uppercase; }}
.sub {{ color: var(--muted); margin: 6px 0 0; max-width: 62ch; }}
.goal {{ background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px 20px; margin: 26px 0; }}
.goal strong {{ text-transform: uppercase; letter-spacing: 0.06em; font-size: 13px; color: var(--gold); }}
.refs {{ display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 10px 0 0; }}
.refs figure {{ margin: 0; }}
.refs img, .shots img {{ width: 100%; border-radius: 8px; display: block; border: 1px solid var(--line); }}
figcaption {{ font-size: 12.5px; color: var(--muted); margin-top: 5px; }}
.round {{ background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 22px 24px; margin: 18px 0; }}
.round-head {{ display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }}
.round-no {{ font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; font-size: 13px; color: var(--rose); }}
.round-title {{ font-weight: 800; font-size: 19px; }}
.round-date {{ margin-left: auto; color: var(--muted); font-size: 13px; }}
.score {{ display: flex; align-items: center; gap: 10px; margin: 6px 0; }}
.score-label {{ flex: 0 0 240px; font-size: 13.5px; }}
.track {{ flex: 1; height: 10px; background: var(--ground); border-radius: 5px; overflow: hidden; }}
.fill {{ display: block; height: 100%; border-radius: 5px; }}
.fill.good {{ background: var(--good); }} .fill.warn {{ background: var(--warn); }} .fill.bad {{ background: var(--bad); }}
.score-num {{ flex: 0 0 44px; text-align: right; font-variant-numeric: tabular-nums; font-size: 13.5px; }}
.verdict {{ font-size: 15px; }}
.biggest {{ border-left: 3px solid var(--bad); padding-left: 12px; font-size: 15px; }}
h4 {{ margin: 16px 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }}
.list {{ margin: 0; padding-left: 20px; font-size: 14.5px; }}
.list li {{ margin: 3px 0; }}
.shots {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-top: 16px; }}
.shots figure {{ margin: 0; }}
.how {{ color: var(--muted); font-size: 13.5px; margin-top: 40px; border-top: 1px solid var(--line); padding-top: 16px; }}
.tabbar {{ display: flex; gap: 8px; margin: 26px 0 14px; }}
.tab {{ flex: 1; padding: 12px 16px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel);
  color: var(--muted); font: 800 14px system-ui, sans-serif; cursor: pointer; letter-spacing: 0.02em; }}
.tab:hover {{ color: var(--ink); }}
.tab:focus-visible {{ outline: 2px solid var(--gold); outline-offset: 2px; }}
.tab.active {{ background: var(--ink); color: var(--ground); border-color: var(--ink); }}
.phase-lede {{ color: var(--muted); font-size: 14px; margin: 4px 2px 14px; }}
.panel-section {{ border-color: var(--teal); }}
.panel-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-top: 14px; }}
.panel-card {{ background: var(--ground); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }}
.panel-head {{ display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }}
.panel-icon {{ font-size: 18px; }}
.panel-role {{ font-weight: 800; font-size: 14px; }}
.panel-scores {{ margin-left: auto; display: flex; gap: 8px; font-size: 12px; color: var(--muted); }}
.panel-scores b {{ color: var(--ink); }}
.panel-verdict {{ font-size: 13.5px; margin: 0 0 8px; }}
.panel-verdict.pending {{ color: var(--muted); font-style: italic; }}
.panel-list {{ font-size: 13px; }}
.p4wrap {{ margin: 10px 0; }}
.p4table {{ width: 100%; border-collapse: collapse; font-size: 13.5px; margin-top: 8px; }}
.p4table th, .p4table td {{ padding: 5px 10px; text-align: left; border-bottom: 1px solid var(--line); }}
.p4table th {{ font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }}
.p4table tr.p4ours td {{ font-weight: 800; }}
.p4badge {{ display: inline-block; font: 800 12px system-ui, sans-serif; letter-spacing: 0.08em; padding: 4px 10px; border-radius: 6px; }}
.p4badge.good-b {{ background: var(--good); color: #fff; }}
.p4badge.bad-b {{ background: var(--bad); color: #fff; }}
</style>
<div class="wrap">
  <header class="masthead">
    <div class="flags"><span style="background:var(--ochre)"></span><span style="background:var(--rose)"></span><span style="background:var(--teal)"></span><span style="background:#C23A2E"></span></div>
    <h1>Bannerfall</h1>
    <p class="sub">{esc(data["tagline"])}</p>
  </header>

  <div class="goal">
    <strong>The bars</strong>
    <p style="margin:8px 0 0; font-size:14.5px;">{esc(data["goal"])}</p>
    <div class="refs">
      <figure><img src="{ref_tf}" alt="Thronefall reference"><figcaption>Bar 1 — Thronefall: combat readability, palette discipline, simplicity (official screenshot)</figcaption></figure>
      <figure><img src="{ref_bl}" alt="Bannerlord reference"><figcaption>Bar 2 — Bannerlord: massed army command in a campaign world (official screenshot)</figcaption></figure>
    </div>
  </div>

  <div class="tabbar" role="tablist">
    <button class="tab" id="tab-p1" role="tab" aria-controls="phase1" onclick="showPhase(1)">Phase 1 · Solo critic loop</button>
    <button class="tab" id="tab-p2" role="tab" aria-controls="phase2" onclick="showPhase(2)">Phase 2 · Six-role panel</button>
    <button class="tab" id="tab-p3" role="tab" aria-controls="phase3" onclick="showPhase(3)">Phase 3 · Prototype → MVP</button>
    <button class="tab" id="tab-p4" role="tab" aria-controls="phase4" onclick="showPhase(4)">Phase 4 · Graphics vs references</button>
  </div>

  <div id="phase1" class="phase">
    <p class="phase-lede">One harsh critic per round, playing every build headlessly against official reference footage. Five rounds from 3/10 to both bars at 8/10.</p>
    {''.join(rounds_p1)}
  </div>

  <div id="phase2" class="phase">
    <p class="phase-lede">The rigor goes up: six independent role-based critics — designer, architect, two QA, two players — assess the finished build in parallel, and builder rounds answer the panel's consensus until every seat is satisfied.</p>
    {panel_html}
    {''.join(rounds_p2)}
  </div>

  <div id="phase3" class="phase">
    <p class="phase-lede">{esc(data.get("phase3_lede", "The coherence pass: every mechanic must have a reason in the world, every visual must have a rule behind it. A dedicated auditor hunts the illogical; builders make the fiction real."))}</p>
    {''.join(rounds_p3)}
  </div>

  <div id="phase4" class="phase">
    <p class="phase-lede">{esc(data.get("phase4_lede", "The graphics pass: three independent critics per round — a blind rater scoring Bannerfall against Thronefall and Wool at the Gates without knowing which is which, an informed rater scoring all three openly, and a harsh critic with a 9/10 ship bar. The phase ends when Bannerfall matches or beats both references on design, graphics, and UI for both raters, and the harsh critic signs off."))}</p>
    {''.join(rounds_p4)}
  </div>

  <p class="how">Loop: builder ships a round → separate harsh critics play the actual build headlessly, capture screenshots, compare against official reference footage, and file the biggest gap → builder fixes. A phase ends when the critics prefer Bannerfall for a five-minute session on both bars (≥8/10 each).</p>
</div>
<script>
function showPhase(n) {{
  for (const i of [1, 2, 3]) {{
    document.getElementById('phase' + i).style.display = i === n ? '' : 'none';
    const t = document.getElementById('tab-p' + i);
    t.classList.toggle('active', i === n);
    t.setAttribute('aria-selected', i === n);
  }}
}}
showPhase(3);
</script>
"""
    out = os.path.join(ROOT, "progress.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print("wrote", out, len(html))


if __name__ == "__main__":
    main()
