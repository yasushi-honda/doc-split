#!/usr/bin/env python3
"""要約の客観採点: 事実カバー率 / 数値の捏造 / 行数 / thinking漏れ・異常出力 と、速度の集計。
採点は機械的(文字列一致)なので、品質の最終判断は出力の目視(--show)と併用する。"""
import json, os, re, statistics as st, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
meta = json.load(open(os.path.join(HERE, "docs", "meta.json"), encoding="utf-8"))
MAX_INPUT = 8000


def norm(s):
    s = s.replace(",", "").replace("，", "").replace("、", "")
    s = re.sub(r"\s+", "", s)
    s = s.replace("令和8年", "").replace("Ｒ8", "")
    # 「要介護3」⇔「要介護度3」等、実質同義の言い換えを同一視する(厳密一致の過剰採点を防ぐ)
    s = s.replace("要介護度", "要介護")
    return s


def source_text(doc_id):
    t = open(os.path.join(HERE, "docs", f"{doc_id}.txt"), encoding="utf-8").read()
    return t[:MAX_INPUT]


def score(doc_id, text):
    facts = meta[doc_id]["facts"]
    n = norm(text)
    hit = [f for f in facts if norm(f) in n]
    src = norm(source_text(doc_id))
    nums = set(re.findall(r"\d{2,}", norm(text)))  # 2桁以上の数字列
    fabricated = sorted(x for x in nums if x not in src)
    lines = [l for l in text.strip().split("\n") if l.strip()]
    flags = []
    if "<think>" in text or "</think>" in text or "Thinking Process" in text:
        flags.append("thinking漏れ")
    if len(text.strip()) < 30:
        flags.append("極端に短い")
    if len(text.strip()) > 900:
        flags.append("長すぎ")
    return {"coverage": len(hit) / len(facts), "missed": [f for f in facts if f not in hit], "fabricated": fabricated,
            "lines": len(lines), "chars": len(text.strip()), "flags": flags}


def load_runs():
    out = {}
    for path in sorted(glob.glob(os.path.join(HERE, "result_slm-bench-*.json"))):
        d = json.load(open(path, encoding="utf-8"))
        out[d["service"].replace("slm-bench-", "")] = d
    g = os.path.join(HERE, "result_gemini.json")
    if os.path.exists(g):
        gd = json.load(open(g, encoding="utf-8"))
        runs = []
        for doc_id, rs in gd.items():
            for i, r in enumerate(rs, 1):
                if "text" in r:
                    runs.append({"doc": doc_id, "run": i, "wall_s": r["wall_s"], "text": r["text"], "prompt_n": r.get("prompt_n"), "predicted_n": r.get("predicted_n")})
        out["gemini-3.5-flash(基準)"] = {"runs": runs, "ready_wait_s": None, "cold_first": None}
    return out


def main():
    show = "--show" in sys.argv
    data = load_runs()
    print("## 速度(warm、各書類3回の中央値) と 事実カバー率")
    print("| モデル | 書類(入力トークン) | 総所要 中央値(秒) | 入力処理(秒) | 生成(tok/s) | 事実カバー率 | 数値の捏造 | 行数 | 注意 |")
    print("|---|---|---|---|---|---|---|---|---|")
    for name, d in data.items():
        for doc_id in ["D1", "D2", "D4", "D3"]:
            rs = [r for r in d["runs"] if r["doc"] == doc_id and "text" in r]
            if not rs:
                print(f"| {name} | {doc_id} | (データなし) | | | | | | |"); continue
            walls = [r["wall_s"] for r in rs]
            pn = rs[0].get("prompt_n")
            pms = [r["prompt_ms"] / 1000 for r in rs if r.get("prompt_ms")]
            tps = [r["predicted_tps"] for r in rs if r.get("predicted_tps")]
            sc = [score(doc_id, r["text"]) for r in rs]
            cov = st.mean(s["coverage"] for s in sc)
            fab = sum(len(s["fabricated"]) for s in sc)
            lines = st.median(s["lines"] for s in sc)
            flags = sorted({f for s in sc for f in s["flags"]})
            print(f"| {name} | {doc_id}({pn}) | {st.median(walls):.0f} | {(st.median(pms) if pms else float('nan')):.0f} | "
                  f"{(st.median(tps) if tps else float('nan')):.1f} | {cov*100:.0f}% | {fab} | {lines:.0f} | {','.join(flags) or '-'} |")
    print()
    print("## コールドスタート(準備完了待ち)")
    for name, d in data.items():
        if d.get("ready_wait_s") is not None:
            print(f"- {name}: ready_wait_s={d['ready_wait_s']}, 準備直後の初回リクエスト wall={d['cold_first'].get('wall_s') if d.get('cold_first') else None}")
    if show:
        print()
        print("## 出力例(D2 run1)")
        for name, d in data.items():
            rs = [r for r in d["runs"] if r["doc"] == "D2" and "text" in r]
            if rs:
                print(f"### {name}\n{rs[0]['text'].strip()}\n")


if __name__ == "__main__":
    main()
