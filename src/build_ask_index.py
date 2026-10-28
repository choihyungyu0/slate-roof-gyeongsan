"""질의 도우미(/api/ask)용 압축 색인. 점수가 있는 명부 4,644동만, 도구 계산에 필요한 열만 담는다 (지번·주소 없음).

입력: web/public/data/buildings.part*.json, admin_extra.json, data/processed/roof_strings_all.csv(표기별 걸린 규칙)
출력: web/public/data/ask_index.json
  {"cols":[...], "rows":[[...], ...]}  한 행 = 한 건물
"""
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web" / "public" / "data"
ex = json.loads((WEB / "admin_extra.json").read_text(encoding="utf-8"))
s = pd.read_csv(ROOT / "data" / "processed" / "roof_strings_all.csv", dtype=str).fillna("")
hits = {}
for r in s.itertuples():
    if r.etcRoof and r.rules_hit and r.etcRoof not in hits:
        hits[r.etcRoof] = r.rules_hit

COLS = ["id", "emd", "ri", "ps", "pr", "rc", "roof", "etc", "year", "area", "ds", "dd", "de", "ca", "cr", "cs", "cd", "ce", "cc", "pm", "rules"]
rows = []
for k in range(json.loads((WEB / "buildings.manifest.json").read_text(encoding="utf-8"))["parts"]):
    for f in json.loads((WEB / f"buildings.part{k}.json").read_text(encoding="utf-8"))["features"]:
        p = f["properties"]
        if p.get("ps") is None:
            continue
        bid = f"B{f['id']:06d}"
        rows.append([bid, p["emd"], (ex.get(bid) or {}).get("ri"), p["ps"], p["pr"], p.get("rc"), p.get("roof") or "", p.get("etc") or "", p.get("year"), p.get("area"),
                     p.get("ds"), p.get("dd"), p.get("de"), p.get("ca"), p.get("cr"), p.get("cs"), p.get("cd"), p.get("ce"), p.get("cc"), p.get("pm"),
                     hits.get(p.get("etc") or "", "")])
rows.sort(key=lambda r: r[4])
assert len(rows) == 4644, len(rows)
(WEB / "ask_index.json").write_text(json.dumps({"cols": COLS, "rows": rows}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(len(rows), "rows,", sum(1 for r in rows if r[-1]), "with rules", (WEB / "ask_index.json").stat().st_size // 1024, "KB")
