#!/usr/bin/env ts-node
/**
 * Issue #794 Phase 0-3: Type3フォントPDFがGemini OCRで読めるかの検証(read-only)
 *
 * kanameone本番PDFで確認された「Type3フォントで描画された記入文字だけが消える」不具合が
 * OCR側(Vertex AI Gemini)にも波及するかを、個人情報を一切含まない合成フィクスチャで判定する。
 * functions/src/ocr/ocrProcessor.ts の ocrWithGemini() と同一パラメータ
 * (モデル/thinkingConfig/プロンプト)で呼び出す。
 *
 * 判定基準は「抽出テキストに既知トークン(TESTCASE4821)が含まれるか」のbooleanのみ。
 * Firestore/Storageへの書込は一切行わない。
 *
 * 3群 × 3回:
 *   A: 合成Type3 PDF(scripts/fixtures/with-type3-font.pdf)
 *   B: 対照PDF(標準フォント、with-standard-font.pdf) — harness自体の健全性確認
 *   C: 合成Type3 PDFをラスタライズしたPNG(with-type3-font-rasterized.png)
 *      — サーバー側ラスタライズ導入(Phase 2)の有効性を事前に確認する
 *
 * 使用方法:
 *   推奨: GitHub Actions "Run Operations Script" → environment: dev / script: verify-type3-ocr
 *   ローカル実行（フォールバック、doc-split-dev向けADCが必要）:
 *     GOOGLE_CLOUD_PROJECT=doc-split-dev npx ts-node scripts/verify-type3-ocr.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { withRetry, RETRY_CONFIGS } from '../functions/src/utils/retry';
import { GEMINI_CONFIG } from '../functions/src/utils/config';

/** scripts/compare-gemini-ocr-models.ts と同じ意図のガード(誤って他環境で実行し課金する事故を防ぐ) */
const ALLOWED_PROJECT_ID = 'doc-split-dev';

const PROJECT_ID =
  process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || '';
const LOCATION = 'asia-northeast1';

if (!PROJECT_ID) {
  console.error('GOOGLE_CLOUD_PROJECT (または FIREBASE_PROJECT_ID) を設定してください');
  process.exit(1);
}
if (PROJECT_ID !== ALLOWED_PROJECT_ID) {
  console.error(
    `❌ このスクリプトは ${ALLOWED_PROJECT_ID} 専用です (指定されたプロジェクト: ${PROJECT_ID})。` +
      '合成フィクスチャのみを扱うため他環境で実行する意味がなく、誤課金防止のため拒否する。'
  );
  process.exit(1);
}

const TOKEN = 'TESTCASE4821';
const REPEATS = 3;

interface GroupDef {
  key: string;
  label: string;
  file: string;
  mimeType: string;
}

const GROUPS: GroupDef[] = [
  { key: 'A', label: '合成Type3 PDF', file: 'with-type3-font.pdf', mimeType: 'application/pdf' },
  { key: 'B', label: '対照PDF(標準フォント)', file: 'with-standard-font.pdf', mimeType: 'application/pdf' },
  {
    key: 'C',
    label: '合成Type3 PDFのラスタライズPNG',
    file: 'with-type3-font-rasterized.png',
    mimeType: 'image/png',
  },
];

/** functions/src/ocr/ocrProcessor.ts の prompt 変数と同一(pageNumberなし呼出のケース) */
function buildOcrPrompt(): string {
  return `
この画像/PDFの内容をOCRしてください。

【指示】
- テキストをそのまま正確に抽出してください
- 表がある場合は、構造を保ってテキスト化してください
- 手書き文字も可能な限り読み取ってください
- 読み取れない部分は[判読不能]と記載してください
- 余計な説明は不要です。抽出したテキストのみを出力してください
`;
}

async function ocrOnce(
  ai: InstanceType<typeof GoogleGenAI>,
  buffer: Buffer,
  mimeType: string
): Promise<{ text: string; tokenFound: boolean }> {
  const base64Data = buffer.toString('base64');

  const response = await withRetry(
    () =>
      ai.models.generateContent({
        model: GEMINI_CONFIG.modelId,
        contents: [
          {
            role: 'user',
            parts: [{ inlineData: { mimeType, data: base64Data } }, { text: buildOcrPrompt() }],
          },
        ],
        config: {
          maxOutputTokens: GEMINI_CONFIG.maxOutputTokens,
          // functions/src/ocr/ocrProcessor.ts:1015-1017 と同一(gemini-3.5-flash運用)
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        },
      }),
    RETRY_CONFIGS.gemini
  );

  const text = response.text || '';
  return { text, tokenFound: text.includes(TOKEN) };
}

async function main() {
  console.log(`project=${PROJECT_ID} location=${LOCATION} model=${GEMINI_CONFIG.modelId}`);
  console.log(`既知トークン: ${TOKEN} / 各群 ${REPEATS} 回試行\n`);

  const ai = new GoogleGenAI({ vertexai: true, project: PROJECT_ID, location: LOCATION });
  const fixturesDir = path.join(__dirname, 'fixtures');

  const summary: Record<string, { found: number; total: number }> = {};

  for (const group of GROUPS) {
    const filePath = path.join(fixturesDir, group.file);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ フィクスチャが見つかりません: ${filePath}`);
      process.exit(1);
    }
    const buffer = fs.readFileSync(filePath);

    summary[group.key] = { found: 0, total: REPEATS };
    for (let i = 1; i <= REPEATS; i++) {
      const { tokenFound, text } = await ocrOnce(ai, buffer, group.mimeType);
      if (tokenFound) summary[group.key].found++;
      console.log(
        `[群${group.key}: ${group.label}] 試行${i}/${REPEATS}: トークン検出=${tokenFound ? 'YES' : 'NO'} (応答${text.length}文字)`
      );
    }
  }

  console.log('\n=== 結果サマリ ===');
  for (const group of GROUPS) {
    const { found, total } = summary[group.key];
    console.log(`群${group.key}(${group.label}): ${found}/${total}`);
  }

  const groupA = summary['A'];
  console.log('\n=== Phase 2 要否判定 ===');
  if (groupA.found === 0) {
    console.log('群A(Type3 PDF)が全滅 → OCRもType3で失敗することが確定。Phase 2(サーバー側ラスタライズ)が必要。');
  } else if (groupA.found < groupA.total) {
    console.log('群A(Type3 PDF)が一部失敗 → 不安定。追加調査が必要。');
  } else {
    console.log('群A(Type3 PDF)が全て成功 → OCR側は無改修でよい可能性が高い。Phase 1のみで完結を検討。');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
