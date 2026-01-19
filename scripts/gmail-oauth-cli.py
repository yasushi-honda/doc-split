#!/usr/bin/env python3
"""
Gmail OAuth認証 CLIツール
ブラウザ認証後、リフレッシュトークンを自動取得しSecret Managerに保存
"""

import json
import subprocess
import sys
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PROJECT_ID = "doc-split-dev"

class OAuthCallbackHandler(BaseHTTPRequestHandler):
    """OAuth コールバック処理"""
    auth_code = None
    
    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        if 'code' in query:
            OAuthCallbackHandler.auth_code = query['code'][0]
            self.send_response(200)
            self.send_header('Content-type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'<html><body><h1>OK</h1><p>Close this window.</p></body></html>')
        else:
            self.send_response(400)
            self.end_headers()
    
    def log_message(self, format, *args):
        pass  # ログ抑制

def get_secret(name):
    """Secret Managerから値を取得"""
    try:
        result = subprocess.run(
            ['gcloud', 'secrets', 'versions', 'access', 'latest', 
             '--secret', name, '--project', PROJECT_ID],
            capture_output=True, text=True
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except:
        return None

def set_secret(name, value):
    """Secret Managerに値を保存"""
    # 既存シークレットがあれば新バージョン追加、なければ作成
    check = subprocess.run(
        ['gcloud', 'secrets', 'describe', name, '--project', PROJECT_ID],
        capture_output=True
    )
    
    if check.returncode == 0:
        # 新バージョン追加
        subprocess.run(
            ['gcloud', 'secrets', 'versions', 'add', name, 
             '--data-file=-', '--project', PROJECT_ID],
            input=value, text=True, check=True
        )
    else:
        # 新規作成
        subprocess.run(
            ['gcloud', 'secrets', 'create', name,
             '--data-file=-', '--project', PROJECT_ID],
            input=value, text=True, check=True
        )
    print(f"  ✓ {name}")

def grant_access(secret_name, service_account):
    """サービスアカウントにSecret Accessorロールを付与"""
    subprocess.run(
        ['gcloud', 'secrets', 'add-iam-policy-binding', secret_name,
         '--member', f'serviceAccount:{service_account}',
         '--role', 'roles/secretmanager.secretAccessor',
         '--project', PROJECT_ID],
        capture_output=True
    )

def main():
    print("\n=== DocSplit Gmail OAuth CLI ===\n")
    
    # 1. クライアントID/シークレットの入力または取得
    client_id = get_secret('gmail-oauth-client-id')
    client_secret = get_secret('gmail-oauth-client-secret')
    
    if client_id and client_secret:
        print(f"既存のOAuth設定を検出: {client_id[:20]}...")
        use_existing = input("既存設定を使用しますか? [Y/n]: ").strip().lower()
        if use_existing == 'n':
            client_id = None
            client_secret = None
    
    if not client_id or not client_secret:
        print("\nOAuthクライアント情報を入力してください")
        print("(GCP Console > APIs > Credentials で作成)")
        print(f"URL: https://console.cloud.google.com/apis/credentials?project={PROJECT_ID}\n")
        client_id = input("Client ID: ").strip()
        client_secret = input("Client Secret: ").strip()
        
        if not client_id or not client_secret:
            print("エラー: Client ID/Secretが必要です")
            sys.exit(1)
    
    # 2. OAuth認証フロー
    redirect_uri = "http://localhost:8888"
    scope = "https://www.googleapis.com/auth/gmail.readonly"
    
    auth_url = (
        f"https://accounts.google.com/o/oauth2/auth?"
        f"client_id={client_id}&"
        f"redirect_uri={redirect_uri}&"
        f"scope={scope}&"
        f"response_type=code&"
        f"access_type=offline&"
        f"prompt=consent"
    )
    
    print("\nブラウザで認証ページを開きます...")
    webbrowser.open(auth_url)
    
    # ローカルサーバーでコールバック待機
    print("認証完了を待機中... (localhost:8888)")
    server = HTTPServer(('localhost', 8888), OAuthCallbackHandler)
    server.handle_request()
    
    auth_code = OAuthCallbackHandler.auth_code
    if not auth_code:
        print("エラー: 認証コードを取得できませんでした")
        sys.exit(1)
    
    print("✓ 認証コード取得完了")
    
    # 3. トークン取得
    print("\nトークンを取得中...")
    import urllib.request
    import urllib.parse
    
    token_data = urllib.parse.urlencode({
        'client_id': client_id,
        'client_secret': client_secret,
        'code': auth_code,
        'grant_type': 'authorization_code',
        'redirect_uri': redirect_uri
    }).encode()
    
    req = urllib.request.Request('https://oauth2.googleapis.com/token', data=token_data)
    with urllib.request.urlopen(req) as response:
        tokens = json.loads(response.read())
    
    refresh_token = tokens.get('refresh_token')
    if not refresh_token:
        print("エラー: リフレッシュトークンを取得できませんでした")
        print(tokens)
        sys.exit(1)
    
    print("✓ リフレッシュトークン取得完了")
    
    # 4. Secret Managerに保存
    print("\nSecret Managerに保存中...")
    set_secret('gmail-oauth-client-id', client_id)
    set_secret('gmail-oauth-client-secret', client_secret)
    set_secret('gmail-oauth-refresh-token', refresh_token)
    
    # 5. Cloud Functionsサービスアカウントに権限付与
    print("\n権限を設定中...")
    result = subprocess.run(
        ['gcloud', 'projects', 'describe', PROJECT_ID, '--format=value(projectNumber)'],
        capture_output=True, text=True
    )
    project_number = result.stdout.strip()
    functions_sa = f"{project_number}-compute@developer.gserviceaccount.com"
    
    for secret in ['gmail-oauth-client-id', 'gmail-oauth-client-secret', 'gmail-oauth-refresh-token']:
        grant_access(secret, functions_sa)
    print(f"✓ {functions_sa} に権限付与完了")
    
    # 完了
    print("\n=== 設定完了 ===")
    print("\n次のステップ:")
    print("  firebase deploy --only functions")
    print("\nGmail監視をテスト:")
    print("  gcloud functions call checkGmailAttachments --project doc-split-dev")

if __name__ == '__main__':
    main()
