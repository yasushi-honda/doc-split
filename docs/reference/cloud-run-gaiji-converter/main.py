# main.py

import functions_framework
import base64
import csv
import codecs
import io
import json

# --- 外字マッピングテーブル (g_gaiji_map_cp932_bytes_to_pua) ---
# 現状、手動での具体的なマッピング定義なしでローカルで問題なかったため、
# この辞書は空または最小限のサンプルにしておきます。
# 将来、特定のCP932バイト列を特定のUnicode PUA文字に変換したい場合に、
# ここに {b'\xXX\xYY': '\uEZZZ', ...} のように追加します。
g_gaiji_map_cp932_bytes_to_pua = {
    # {} # 空の辞書で開始する場合
    # または、ローカルテスト時にあったサンプルをそのまま残しても良いです。
    # この辞書にないCP932シーケンスは、エラーハンドラによってU+FFFD(�)に置換されます。
    # b'\xf0\x40': '\uE000', # 例: Shift_JIS F040 -> PUA U+E000 (テスト用に残しても良い)
}
# --- ここまで外字マッピングテーブル ---

# リクエストごとの警告を収集するためのリスト（ハンドラがグローバルアクセスする）
# 注意: Cloud Functionsのインスタンスが並行処理する場合、このアプローチはスレッドセーフではない。
# より堅牢な方法としては、リクエストコンテキストに紐づけるか、ログ出力に専念する。
# ここでは簡潔さのためにモジュールレベル変数を使用し、関数開始時にクリアする。
_warnings_for_current_cf_request = []

def cp932_gaiji_translator_handler(err):
    """
    codecs.register_error に渡すためのハンドラ。
    g_gaiji_map_cp932_bytes_to_pua を参照し、マッピングできない場合はログに警告を出し、
    U+FFFD (�) に置換する。警告は _warnings_for_current_cf_request にも追加する。
    """
    global _warnings_for_current_cf_request

    if not isinstance(err, UnicodeDecodeError):
        raise err

    bad_bytes = err.object[err.start:err.end]

    if len(bad_bytes) >= 2:
        potential_gaiji_seq_2bytes = bad_bytes[:2]
        if potential_gaiji_seq_2bytes in g_gaiji_map_cp932_bytes_to_pua:
            return (g_gaiji_map_cp932_bytes_to_pua[potential_gaiji_seq_2bytes], err.start + 2)

    warning_message = f"CF_GAIJI_HANDLER: マッピングできないCP932バイトシーケンス: 0x{bad_bytes.hex()} (入力データの位置: {err.start})"
    _warnings_for_current_cf_request.append(warning_message)
    print(f"警告 (Cloud Function): {warning_message}")
    return ('\uFFFD', err.end)

try:
    codecs.register_error('cp932_gaiji_translator', cp932_gaiji_translator_handler)
    print("CP932外字変換ハンドラ 'cp932_gaiji_translator' が正常に登録されました。 (Cloud Function)")
except ValueError:
    print("CP932外字変換ハンドラ 'cp932_gaiji_translator' は既に登録済みです。 (Cloud Function)")


@functions_framework.http
def convert_csv_gaiji_http(request):
    """
    HTTPリクエストからCSVデータ(Base64)を受け取り、外字変換(CP932->UTF-8 PUA)を行い、
    変換後のUTF-8 CSV文字列をJSONレスポンスで返すCloud Function。
    """
    global _warnings_for_current_cf_request
    _warnings_for_current_cf_request = [] # リクエスト処理開始時に警告リストをリセット

    cors_headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }
    if request.method == 'OPTIONS':
        return ('', 204, cors_headers)
    if request.method != 'POST':
        return (json.dumps({"success": False, "error": "POSTリクエストのみサポートされています。"}), 405, cors_headers)

    try:
        if not request.is_json:
            print("エラー (CF): リクエストボディがJSONではありません。")
            return (json.dumps({"success": False, "error": "リクエストボディはJSON形式である必要があります。"}), 400, cors_headers)

        request_json = request.get_json(silent=True)
        if request_json is None:
            print("エラー (CF): リクエストJSONの取得/パースに失敗。")
            return (json.dumps({"success": False, "error": "リクエストJSONの取得またはパースに失敗しました。"}), 400, cors_headers)

        original_filename = request_json.get("filename", "untitled.csv")
        csv_data_base64 = request_json.get("csv_data_base64")

        if not csv_data_base64:
            print("エラー (CF): 'csv_data_base64' がリクエストJSONにありません。")
            return (json.dumps({"success": False, "error": "必須パラメータ 'csv_data_base64' がリクエストJSONに含まれていません。"}), 400, cors_headers)

        try:
            csv_file_bytes = base64.b64decode(csv_data_base64)
            print(f"情報 (CF): ファイル '{original_filename}' ({len(csv_file_bytes)} bytes) Base64デコード成功。")
        except Exception as e_b64:
            print(f"エラー (CF): Base64デコード失敗 - {e_b64}")
            return (json.dumps({"success": False, "error": f"Base64デコードエラー: {e_b64}"}), 400, cors_headers)

        processed_rows = []
        try:
            source_csv_text_stream = io.TextIOWrapper(
                io.BytesIO(csv_file_bytes),
                encoding='cp932',
                errors='cp932_gaiji_translator',
                newline=''
            )
            csv_reader = csv.reader(source_csv_text_stream)
            for row in csv_reader:
                processed_rows.append(row)
            source_csv_text_stream.close()
            print(f"情報 (CF): {len(processed_rows)}行のCSVデータをCP932から内部Unicodeへ変換完了。")
        except UnicodeDecodeError as e_decode_fatal: # ハンドラで処理しきれなかった場合など（通常は起こりにくい）
            print(f"致命的エラー (CF): CSVデコード中に未処理のUnicodeDecodeError - {e_decode_fatal}")
            _warnings_for_current_cf_request.append(f"致命的なデコードエラー発生: {e_decode_fatal.reason} at pos {e_decode_fatal.start}")
            return (json.dumps({"success": False, "error": f"CSVデコードエラー: {e_decode_fatal.reason}", "warnings": _warnings_for_current_cf_request}), 500, cors_headers)
        except Exception as e_csv:
            print(f"エラー (CF): CSV処理中 - {e_csv}")
            return (json.dumps({"success": False, "error": f"CSV処理エラー: {e_csv}", "warnings": _warnings_for_current_cf_request}), 500, cors_headers)

        output_utf8_string_io = io.StringIO(newline='')
        csv_writer = csv.writer(output_utf8_string_io)
        csv_writer.writerows(processed_rows)
        utf8_csv_output_string = output_utf8_string_io.getvalue()
        output_utf8_string_io.close()
        print(f"情報 (CF): UTF-8 CSV文字列生成完了 (長: {len(utf8_csv_output_string)} chars).")

        response_data = {
            "success": True,
            "utf8_csv_data": utf8_csv_output_string,
            "warnings": _warnings_for_current_cf_request,
            "original_filename": original_filename
        }
        return (json.dumps(response_data, ensure_ascii=False), 200, cors_headers)

    except Exception as e_global:
        print(f"致命的エラー (CF - 全体): {e_global}")
        import traceback
        print(traceback.format_exc())
        return (json.dumps({"success": False, "error": f"サーバー内部エラー: {type(e_global).__name__}", "warnings": _warnings_for_current_cf_request}), 500, cors_headers)
