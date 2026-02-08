---
title: "プロジェクト背景"
description: "DocSplitプロジェクトの背景と元システム概要"
status: completed
updated: "2026-02-08"
created_at: "2026-01-17"
---

# プロジェクト背景

## 元システム概要

| 項目 | 内容 |
|------|------|
| フロントエンド | AppSheet |
| 用途 | 書類管理アプリケーション |
| 規模 | 30テーブル、593カラム、26ビュー、30アクション |

## 主要機能（元システム）

1. **OCR処理による書類自動分類**
   - PDFファイルをOCRで読み取り
   - 書類名・顧客名・事業所名を自動判定

2. **顧客紐付け**
   - OCR結果から顧客マスタと照合
   - 同姓同名フラグによる手動選択サポート

3. **エラーハンドリング**
   - エラーログテーブルで処理失敗を管理
   - システム監視テーブルで稼働状況を把握

## 参考ドキュメント

- 完全仕様: `docs/reference/appsheet-full-spec.md`
- セクション別:
  - `docs/reference/sections/00_overview.md` - 概要
  - `docs/reference/sections/01_data.md` - データモデル
  - `docs/reference/sections/02_ux.md` - UI/UX
  - `docs/reference/sections/03_behavior.md` - ビジネスロジック

## 開発方針（確定）

### 技術スタック
- **バックエンド**: Cloud Functions (2nd gen) + Firestore + Cloud Storage
- **フロントエンド**: Firebase Hosting + React + Vite + TypeScript
- **認証**: Firebase Authentication (Googleログイン + ホワイトリスト)
- **OCR**: Vertex AI Gemini 2.5 Flash

### 納品形態
- GCPプロジェクト移譲（シングルテナント）
- マスタープロジェクトをコピー → 顧客固有設定変更 → 移譲

### 開発完了状況
全5フェーズ完了（2026-01-18）
- 本番URL: https://doc-split-dev.web.app
