# ADR-0008: Firestoreデータ保護ポリシー

## ステータス
Accepted

## 日付
2026-01-30

## コンテキスト
本番環境（kanameone）で `firebase firestore:delete --all-collections` を誤実行し、マスターデータを含む全データを削除してしまった。バックアップ・PITRが未設定だったため復元不可能となった。

## 問題点
1. 本番環境で全コレクション削除コマンドを実行してしまった
2. バックアップが設定されていなかった
3. PITR（Point-in-time Recovery）が無効だった
4. 削除操作に対するガードがなかった

## 決定事項

### 1. PITR（Point-in-time Recovery）の有効化【必須】
```bash
gcloud firestore databases update --project=<PROJECT_ID> \
  --enable-pitr
```
- 7日間の復元ポイントを保持
- 誤操作からの復旧が可能になる

### 2. 定期バックアップの設定【必須】
```bash
# 日次バックアップスケジュール作成
gcloud firestore backups schedules create \
  --project=<PROJECT_ID> \
  --database='(default)' \
  --recurrence=daily \
  --retention=7d
```

### 3. 削除操作の制限【必須】
**禁止コマンド（本番環境）**:
```bash
# 絶対に実行してはいけない
firebase firestore:delete --all-collections
firebase firestore:delete / --recursive
```

**許可される削除操作**:
```bash
# 特定コレクションのみ（documentsなど）
firebase firestore:delete documents --recursive -P <alias>

# 特定ドキュメントのみ
firebase firestore:delete documents/<docId> -P <alias>
```

### 4. 削除前チェックリスト【必須】
本番環境でデータ削除を行う前に必ず確認:
- [ ] 削除対象は正しいか（コレクション名を3回確認）
- [ ] 本番環境であることを認識しているか
- [ ] バックアップが取得済みか
- [ ] 削除範囲は最小限か（`--all-collections`は禁止）

### 5. 環境識別の強化
`.firebaserc`のエイリアス名で本番/開発を明確に区別:
- `dev`: 開発環境（削除操作可）
- `kanameone`, `client-*`: 本番環境（削除操作は慎重に）

## 影響
- 全クライアント環境に適用
- 新規テナントセットアップ時にPITR・バックアップを設定

## 実施状況
- [x] kanameone: PITR有効化（2026-01-30）
- [x] kanameone: バックアップスケジュール作成（日次、7日保持）
- [x] doc-split-dev: PITR有効化（2026-01-30）
- [x] doc-split-dev: バックアップスケジュール作成（日次、7日保持）
- [x] CLAUDE.mdに注意事項追記（2026-01-30）
