---
title: "書類管理アプリ GCP移行プロジェクト"
description: "AI駆動開発に最適化されたドキュメント構成"
---

# 書類管理アプリ GCP移行プロジェクト

AppSheetで構築された書類管理アプリをGCPでリプレイス開発するプロジェクト。

## クイックスタート（AI向け）

**コンテキスト読込順序:**
1. `context/project-background.md` - プロジェクト背景
2. `context/data-model.md` - データモデル（ERD図）
3. `context/business-logic.md` - ビジネスロジック（ワークフロー図）
4. `context/gcp-migration-scope.md` - 移行スコープ

## ドキュメント構成

```
docs/
├── README.md                    # このファイル
├── context/                     # AI向け要約（優先読込）
│   ├── project-background.md    # プロジェクト背景
│   ├── data-model.md            # ERD + テーブル関係
│   ├── business-logic.md        # ワークフロー要約
│   └── gcp-migration-scope.md   # 移行スコープ・要件
├── adr/                         # アーキテクチャ決定記録
│   ├── 0001-tech-stack-selection.md   # 技術スタック選定
│   ├── 0002-security-design.md        # セキュリティ設計
│   └── 0003-authentication-design.md  # 認証設計
└── reference/                   # 詳細参照用
    ├── appsheet-full-spec.md    # 完全版仕様書（595KB）
    └── sections/                # セクション別
        ├── 00_overview.md
        ├── 01_data.md           # テーブル・カラム詳細
        ├── 02_ux.md             # ビュー詳細
        └── 03_behavior.md       # アクション詳細
```

## 用途別ガイド

### 設計議論時
```
読込: context/data-model.md + context/business-logic.md
```

### 技術選定時
```
読込: context/gcp-migration-scope.md
作成: adr/0001-tech-stack-selection.md
```

### 詳細仕様確認時
```
読込: reference/sections/01_data.md (特定テーブル)
```

## 元システム概要

| 項目 | 値 |
|------|-----|
| プラットフォーム | AppSheet |
| テーブル数 | 30 |
| カラム数 | 593 |
| ビュー数 | 26 |
| アクション数 | 30 |
| 主要機能 | OCR書類分類、顧客紐付け |
