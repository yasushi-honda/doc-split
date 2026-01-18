#!/usr/bin/env python3
"""
Documentation Splitter for AI-Driven Development

大規模なMarkdownドキュメントを主要セクション別に分割し、
AI駆動開発に最適化されたファイル構成を作成する。
"""

import logging
import re
from pathlib import Path
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

DOCS_DIR = Path(__file__).parent / "docs"
INPUT_FILE = DOCS_DIR / "Application_Documentation.md"
OUTPUT_DIR = DOCS_DIR / "sections"

# セクション定義（行番号はおおよその目安、実際はパターンで検出）
SECTION_PATTERNS = [
    ("00_overview", r"^# 書類管理 App", "概要・サマリー"),
    ("01_data", r"^## Data$", "テーブル・カラム定義"),
    ("02_ux", r"^## UX$", "ビュー定義"),
    ("03_behavior", r"^## Behavior$", "アクション・ワークフロー"),
]


def create_frontmatter(title: str, description: str, section: str) -> str:
    """セクション用のFrontmatterを生成"""
    return f"""---
title: "{title}"
description: "{description}"
parent: "書類管理 App 仕様書"
section: "{section}"
generated_at: "{datetime.now().isoformat()}"
tags:
  - appsheet
  - 書類管理
  - {section.lower().replace(" ", "-")}
---

"""


def find_section_boundaries(lines: list[str]) -> dict[str, tuple[int, int]]:
    """セクションの開始・終了行を検出"""
    boundaries = {}
    section_starts = []

    # 各セクションの開始行を検出
    for i, line in enumerate(lines):
        if re.match(r"^## Data$", line.strip()):
            section_starts.append(("01_data", i))
        elif re.match(r"^## UX$", line.strip()):
            section_starts.append(("02_ux", i))
        elif re.match(r"^## Behavior$", line.strip()):
            section_starts.append(("03_behavior", i))

    # 概要セクションは最初から Data セクションの前まで
    if section_starts:
        data_start = section_starts[0][1]
        boundaries["00_overview"] = (0, data_start)

    # 各セクションの境界を設定
    for i, (name, start) in enumerate(section_starts):
        if i + 1 < len(section_starts):
            end = section_starts[i + 1][1]
        else:
            end = len(lines)
        boundaries[name] = (start, end)

    return boundaries


def split_document() -> None:
    """ドキュメントを分割"""
    logger.info("ドキュメント分割を開始します")

    # 入力ファイル読み込み
    content = INPUT_FILE.read_text(encoding="utf-8")

    # 既存のFrontmatterをスキップ
    if content.startswith("---"):
        # 2つ目の --- を見つける
        second_delimiter = content.find("---", 3)
        if second_delimiter != -1:
            content = content[second_delimiter + 3:].lstrip()

    lines = content.split("\n")
    logger.info(f"総行数: {len(lines)}")

    # セクション境界を検出
    boundaries = find_section_boundaries(lines)
    logger.info(f"検出されたセクション: {list(boundaries.keys())}")

    # 出力ディレクトリ作成
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # セクション情報
    section_info = {
        "00_overview": ("概要・サマリー", "アプリの基本情報、テーブル数、ビュー数などの概要"),
        "01_data": ("Data - テーブル・カラム定義", "30テーブル、593カラムの詳細定義"),
        "02_ux": ("UX - ビュー定義", "26ビューのUI/UX設定"),
        "03_behavior": ("Behavior - アクション・ワークフロー", "30アクション、フォーマットルールの定義"),
    }

    # 各セクションを保存
    for section_name, (start, end) in boundaries.items():
        title, description = section_info.get(section_name, (section_name, ""))
        section_content = "\n".join(lines[start:end])

        # Frontmatter追加
        frontmatter = create_frontmatter(title, description, section_name)
        full_content = frontmatter + section_content

        output_file = OUTPUT_DIR / f"{section_name}.md"
        output_file.write_text(full_content, encoding="utf-8")

        size_kb = output_file.stat().st_size / 1024
        line_count = end - start
        logger.info(f"  {section_name}.md: {line_count}行, {size_kb:.1f}KB")

    # インデックスファイル作成
    create_index_file(boundaries)

    logger.info("=" * 50)
    logger.info("分割完了")
    logger.info(f"出力ディレクトリ: {OUTPUT_DIR}")


def create_index_file(boundaries: dict) -> None:
    """セクションインデックスファイルを作成"""
    index_content = """---
title: "書類管理 App 仕様書 - インデックス"
description: "AI駆動開発用に分割されたドキュメントの目次"
---

# 書類管理 App 仕様書

AppSheetで構築された書類管理アプリケーションの完全仕様書です。

## ドキュメント構成

| ファイル | 内容 | 用途 |
|---------|------|------|
| [00_overview.md](sections/00_overview.md) | 概要・サマリー | アプリ全体像の把握 |
| [01_data.md](sections/01_data.md) | テーブル・カラム定義 | データモデル理解、スキーマ確認 |
| [02_ux.md](sections/02_ux.md) | ビュー定義 | UI/UX仕様確認 |
| [03_behavior.md](sections/03_behavior.md) | アクション・ワークフロー | ビジネスロジック理解 |

## AI活用時の参照ガイド

### 設計議論時
- `00_overview.md` でアプリ全体像を把握
- 関連する `01_data.md` のテーブル定義を参照

### 機能拡張時
- `01_data.md` で既存データモデルを確認
- `03_behavior.md` で既存アクションとの整合性を確認

### UI変更時
- `02_ux.md` で既存ビュー構成を確認

## 元ファイル
- 完全版: [Application_Documentation.md](Application_Documentation.md)
"""

    index_file = DOCS_DIR / "README.md"
    index_file.write_text(index_content, encoding="utf-8")
    logger.info(f"インデックスファイル作成: {index_file}")


if __name__ == "__main__":
    split_document()
