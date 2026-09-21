#!/usr/bin/env python3
"""Cloud Run 上の llama-server (OpenAI互換) に本番と同一の要約プロンプトを投げて計測する。
使い方: bench.py <service-name> [--runs N]
- 各書類×N回。全リクエストで cache_prompt=false (プロンプトキャッシュで入力処理時間が偽装されるのを防ぐ)。
- 最初にコールドスタート後の初回リクエスト(D1)を別枠で記録し、その後 warmup 1回を捨てて本計測。
"""
import json, subprocess, sys, time, os, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.environ.get("PR0_GCP_PROJECT", "doc-split-dev")
REGION = os.environ.get("PR0_GCP_REGION", "asia-northeast1")
ACCOUNT = os.environ.get("PR0_GCP_ACCOUNT")  # 実行者のgcloudアカウント。未設定ならgcloud既定アカウントを使う
if not ACCOUNT:
    raise SystemExit("PR0_GCP_ACCOUNT環境変数を設定してください(例: export PR0_GCP_ACCOUNT=you@example.com)")
MAX_INPUT = 8000  # summaryPromptBuilder.ts の MAX_SUMMARY_INPUT_LENGTH


def build_prompt(ocr: str, doc_type: str) -> str:
    # functions/src/ocr/summaryPromptBuilder.ts の buildSummaryPrompt と同一文面
    text = ocr[:MAX_INPUT] + "...(以下省略)" if len(ocr) > MAX_INPUT else ocr
    return f"""
以下は「{doc_type or '書類'}」のOCR結果です。この書類の内容を3〜5行で要約してください。

【要約のポイント】
- 書類の主な目的・内容
- 重要な日付や金額があれば含める
- 関係者（顧客名、事業所名など）の記載があれば含める
- 専門用語は平易に言い換える

【OCR結果】
{text}

【要約】
"""


def build_prompt_v2(ocr: str, doc_type: str) -> str:
    # Sarashina2.2-3B向けチューニング版(SLM検証専用、本番プロンプトは変更しない)。
    # v1(本番と同一)の不足点: 長文(D3)で事業所名/医療機関名が省略される、支払期限の日付が
    # 一部の回で抜ける。原因は要約行数の制約と目的の優先度が競合するため(3〜5行制約下で
    # 関係者名より内容説明を優先してしまう)。対策: (1) 抽出すべき項目を明示的に列挙し
    # 「無ければ省略」ではなく「読み取れる限り必ず含める」と明記 (2) 行数上限を5〜7行に緩和
    # (3) 出力形式を箇条書きに固定し、項目の脱落を構造的に減らす。
    text = ocr[:MAX_INPUT] + "...(以下省略)" if len(ocr) > MAX_INPUT else ocr
    return f"""あなたは介護関連書類の要約担当です。以下は「{doc_type or '書類'}」のOCR結果です。

【厳守事項】
次の5項目は、書類中に記載があれば必ず要約に含めてください（項目数が多くても省略しないこと）。
1. 書類の種類・目的
2. 関係者（利用者名、事業所名、医療機関名など記載されている全ての固有名詞）
3. 重要な日付（作成日・実施日・支払期限・次回予定日など、記載されている全て）
4. 金額（合計金額・自己負担額など）
5. 特筆すべき状態・変化（体調・ケア内容の変化など）

【出力形式】
5〜7行の箇条書き（「・」始まり）で出力してください。文章での要約ではなく箇条書きにしてください。
説明や前置きは不要です。箇条書きのみを出力してください。

【OCR結果】
{text}

【箇条書き要約】
"""


def sh(*args):
    return subprocess.check_output(args, stderr=subprocess.DEVNULL).decode().strip()


def service_url(name):
    return sh("gcloud", "run", "services", "describe", name, f"--project={PROJECT}", f"--region={REGION}",
              f"--account={ACCOUNT}", "--format=value(status.url)")


def token():
    return sh("gcloud", "auth", "print-identity-token", f"--account={ACCOUNT}")


def wait_ready(url, tok, limit_s=1200):
    """llama-server はモデル読込前からポートを開き 503(Loading model) を返す。/health が 200 になるまで待ち、待ち時間を返す。"""
    t0 = time.time()
    while time.time() - t0 < limit_s:
        req = urllib.request.Request(url + "/health", headers={"Authorization": f"Bearer {tok}"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                if r.status == 200:
                    return round(time.time() - t0, 1)
        except Exception:
            pass
        time.sleep(3)
    return None


def call(url, tok, prompt, max_tokens=1024, temperature=0.2, timeout=900):
    body = {
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": temperature,
        "cache_prompt": False,
        "chat_template_kwargs": {"enable_thinking": False},  # Qwen3.5 は既定でthinking有効。無効化(他モデルでは無視される)
    }
    req = urllib.request.Request(url + "/v1/chat/completions", data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    t0 = time.time()
    try:
        r = json.load(urllib.request.urlopen(req, timeout=timeout))
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.read().decode()[:300]}", "wall_s": time.time() - t0}
    except Exception as e:  # noqa
        return {"error": repr(e)[:300], "wall_s": time.time() - t0}
    wall = time.time() - t0
    tm = r.get("timings", {})
    ch = r["choices"][0]
    return {
        "wall_s": round(wall, 2),
        "prompt_n": tm.get("prompt_n"), "prompt_ms": tm.get("prompt_ms"), "prompt_tps": tm.get("prompt_per_second"),
        "predicted_n": tm.get("predicted_n"), "predicted_ms": tm.get("predicted_ms"), "predicted_tps": tm.get("predicted_per_second"),
        "finish_reason": ch.get("finish_reason"),
        "text": ch["message"].get("content", ""),
    }


def main():
    svc = sys.argv[1]
    runs = int(sys.argv[sys.argv.index("--runs") + 1]) if "--runs" in sys.argv else 3
    prompt_version = sys.argv[sys.argv.index("--prompt") + 1] if "--prompt" in sys.argv else "v1"
    temperature = float(sys.argv[sys.argv.index("--temp") + 1]) if "--temp" in sys.argv else 0.2
    doc_ids = sys.argv[sys.argv.index("--docs") + 1].split(",") if "--docs" in sys.argv else ["D1", "D2", "D4", "D3"]
    out_suffix = sys.argv[sys.argv.index("--suffix") + 1] if "--suffix" in sys.argv else prompt_version
    builder = build_prompt_v2 if prompt_version == "v2" else build_prompt
    meta = json.load(open(os.path.join(HERE, "docs", "meta.json")))
    url = service_url(svc)
    tok = token()
    out = {"service": svc, "url": url, "started": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "cold_first": None, "runs": []}

    # 準備完了待ち(スケールゼロから起動していれば、コンテナ起動+モデル読込の時間が入る。既に温まっていれば ~0)
    out["ready_wait_s"] = wait_ready(url, tok)
    print(f"[{svc}] ready_wait_s={out['ready_wait_s']}", flush=True)
    if out["ready_wait_s"] is None:
        print("   準備完了せず。中断"); json.dump(out, open(os.path.join(HERE, f"result_{svc}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2); return
    tok = token()
    # 準備完了直後の初回リクエスト(モデルの page-in を含む)
    d1 = open(os.path.join(HERE, "docs", "D1.txt"), encoding="utf-8").read()
    print(f"[{svc}] cold-first request (D1) ...", flush=True)
    out["cold_first"] = call(url, tok, builder(d1, meta["D1"]["title"]))
    print("   ", {k: v for k, v in out["cold_first"].items() if k != "text"}, flush=True)

    # warmup(捨て)
    call(url, tok, builder(d1, meta["D1"]["title"]))

    for doc_id in doc_ids:
        text = open(os.path.join(HERE, "docs", f"{doc_id}.txt"), encoding="utf-8").read()
        prompt = builder(text, meta[doc_id]["title"])
        for i in range(runs):
            tok = token()
            r = call(url, tok, prompt, temperature=temperature)
            r.update({"doc": doc_id, "run": i + 1, "input_chars": min(len(text), MAX_INPUT)})
            out["runs"].append(r)
            print(f"[{svc}] {doc_id} run{i+1}: wall={r.get('wall_s')}s prompt_n={r.get('prompt_n')} prompt_ms={r.get('prompt_ms')} "
                  f"pred_n={r.get('predicted_n')} pred_tps={r.get('predicted_tps')} err={r.get('error')}", flush=True)

    out_name = f"result_matrix_{svc}_{out_suffix}.json"
    json.dump(out, open(os.path.join(HERE, out_name), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("saved", out_name)


if __name__ == "__main__":
    main()
