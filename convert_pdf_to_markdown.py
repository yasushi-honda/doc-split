#!/usr/bin/env python3
"""
PDF to Markdown Converter for AI-Driven Development

大規模PDFをAIが読み取りやすいMarkdown形式に変換するスクリプト。
pymupdf4llmを使用して構造を保持しながら変換を行う。
"""

import logging
import sys
from pathlib import Path
from datetime import datetime

import pymupdf4llm

# ログ設定
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# 設定
INPUT_PDF = Path("/Users/yyyhhh/Downloads/Application Documentation.pdf")
OUTPUT_DIR = Path(__file__).parent / "docs"
OUTPUT_FILE = OUTPUT_DIR / "Application_Documentation.md"

# YAML Frontmatter テンプレート
FRONTMATTER_TEMPLATE = """---
title: "Application Documentation"
description: "TODO: このドキュメントの概要を記述してください"
source_file: "{source_file}"
converted_at: "{converted_at}"
page_count: {page_count}
tags:
  - documentation
  - ai-context
  - TODO:適切なタグを追加
status: draft
---

"""


def create_frontmatter(source_file: str, page_count: int) -> str:
    """YAML Frontmatterを生成する"""
    return FRONTMATTER_TEMPLATE.format(
        source_file=source_file,
        converted_at=datetime.now().isoformat(),
        page_count=page_count,
    )


def convert_pdf_to_markdown(input_path: Path, output_path: Path) -> None:
    """PDFをMarkdownに変換する"""

    # 入力ファイル確認
    if not input_path.exists():
        logger.error(f"入力ファイルが見つかりません: {input_path}")
        sys.exit(1)

    logger.info(f"入力ファイル: {input_path}")
    logger.info(f"ファイルサイズ: {input_path.stat().st_size / 1024 / 1024:.2f} MB")

    # 出力ディレクトリ作成
    output_path.parent.mkdir(parents=True, exist_ok=True)
    logger.info(f"出力ディレクトリ: {output_path.parent}")

    # PDF変換
    logger.info("PDF変換を開始します...")
    logger.info("大規模ファイルの場合、数分かかることがあります...")

    try:
        # pymupdf4llmで変換（LLM向けに最適化された出力）
        markdown_content = pymupdf4llm.to_markdown(
            str(input_path),
            show_progress=True,  # 進捗表示
        )

        # ページ数取得
        import pymupdf
        doc = pymupdf.open(str(input_path))
        page_count = len(doc)
        doc.close()

        logger.info(f"変換完了: {page_count}ページ")

    except Exception as e:
        logger.error(f"PDF変換中にエラーが発生しました: {e}")
        sys.exit(1)

    # Frontmatter付きで保存
    logger.info(f"Markdownファイルを保存中: {output_path}")

    frontmatter = create_frontmatter(
        source_file=input_path.name,
        page_count=page_count,
    )

    full_content = frontmatter + markdown_content

    output_path.write_text(full_content, encoding="utf-8")

    output_size = output_path.stat().st_size / 1024
    logger.info(f"保存完了: {output_size:.2f} KB")
    logger.info("=" * 50)
    logger.info("変換が正常に完了しました")
    logger.info(f"出力ファイル: {output_path}")


def main() -> None:
    """メイン処理"""
    logger.info("=" * 50)
    logger.info("PDF to Markdown Converter")
    logger.info("=" * 50)

    convert_pdf_to_markdown(INPUT_PDF, OUTPUT_FILE)


if __name__ == "__main__":
    main()
