#!/usr/bin/env python3
"""全結果ファイルを対象に、出典に無い「組織名らしき固有名詞」の捏造を検出する。
数値の捏造チェックでは見つけられない種類の捏造(D9で発見: 事業所名の完全な創作)を横断的に洗う。"""
import json, re, glob, os
HERE = os.path.dirname(os.path.abspath(__file__))
meta = json.load(open(os.path.join(HERE, "docs", "meta.json"), encoding="utf-8"))
MAX_INPUT = 8000

# 事業所・施設・医療機関らしき固有名詞パターン(カタカナ/漢字+末尾語)
ORG_SUFFIX = r"(?:株式会社|有限会社|事業所|ステーション|センター|クリニック|医院|病院|診療所|居宅介護支援|訪問介護|訪問看護|デイサービス|通所介護|通所リハビリ)"
ORG_PAT = re.compile(rf"[一-龠ぁ-んァ-ヶー・]{{2,12}}{ORG_SUFFIX}")


def source_text(doc_id):
    return open(os.path.join(HERE, "docs", f"{doc_id}.txt"), encoding="utf-8").read()[:MAX_INPUT]


rows = []
for path in sorted(glob.glob(os.path.join(HERE, "result_matrix_*.json")) + glob.glob(os.path.join(HERE, "result_slm-bench-*.json"))):
    d = json.load(open(path, encoding="utf-8"))
    label = os.path.basename(path)
    for r in d.get("runs", []):
        doc_id, text = r.get("doc"), r.get("text")
        if not doc_id or not text or doc_id not in meta:
            continue
        src = source_text(doc_id)
        found = set(ORG_PAT.findall(text))
        fabricated = sorted(o for o in found if o not in src)
        if fabricated:
            rows.append((label, doc_id, r.get("run"), fabricated))

print(f"総チェック run 数(組織名パターンに該当した result_*.json 全run対象): 検出された捏造事例 {len(rows)} 件\n")
for label, doc_id, run, fab in rows:
    print(f"  {label} {doc_id} run{run}: 捏造疑いの組織名 = {fab}")
