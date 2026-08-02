#!/usr/bin/env ts-node
/**
 * extractOfficeCandidates 性能ベンチマーク (Issue #787)
 *
 * ファジーマッチ(ステップ5)最適化(bestFuzzyWindowScore、bag distance branch-and-bound)の
 * 効果を、本番相当スケールの合成データで計測する。本番データ・ネットワーク・認証には
 * 一切依存しない(シード固定PRNGで決定的に生成)。npm testには組み込まない
 * (壁時計時間のassertはCIでflakyになるため、実行と数値確認は手動)。
 *
 * 使用方法:
 *   npx ts-node scripts/bench-office-matching.ts
 */

import { extractOfficeCandidates, OfficeMaster } from '../functions/src/utils/extractors';

function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const PREFECTURES = ['東京', '大阪', '名古屋', '横浜', '福岡', '札幌', '仙台', '広島', '京都', '神戸'];
const FACILITY_TYPES = [
  '介護老人保健施設',
  '特別養護老人ホーム',
  '訪問看護ステーション',
  '居宅介護支援事業所',
  'デイサービスセンター',
];
const BRANDS = ['サンライズ', 'ひまわり', 'すみれ', 'グリーンヒル', 'ノーブル', 'フォレスト', 'メイプル', 'ローズ', 'ラベンダー', 'オアシス'];

// kanameone実測値(2026-08-02時点): 事業所マスター981件、71ページ文書のOCR全文174,690文字相当
function buildOfficeMasters(count: number): OfficeMaster[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `office-${i}`,
    name: `${PREFECTURES[i % PREFECTURES.length]}${BRANDS[i % BRANDS.length]}${FACILITY_TYPES[i % FACILITY_TYPES.length]}第${i}`,
  }));
}

function buildSyntheticOcrText(rand: () => number, chunkCount: number): string {
  const chunks: string[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const pref = PREFECTURES[Math.floor(rand() * PREFECTURES.length)];
    const type = FACILITY_TYPES[Math.floor(rand() * FACILITY_TYPES.length)];
    const brand = BRANDS[Math.floor(rand() * BRANDS.length)];
    chunks.push(`${pref}${brand}${type}のサービス利用に関する記録その${i}。利用者氏名、生年月日、要介護度等の情報を含む。`);
  }
  return chunks.join('');
}

function main(): void {
  const rand = makeLcg(20260802);
  const officeMasters = buildOfficeMasters(981);
  const ocrText = buildSyntheticOcrText(rand, 3000);

  console.log(`OCR text length: ${ocrText.length} chars, officeMasters: ${officeMasters.length}`);

  const iterations = 5;
  const durations: number[] = [];
  let lastCandidateCount = -1;
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    const result = extractOfficeCandidates(ocrText, officeMasters);
    const end = process.hrtime.bigint();
    const ms = Number(end - start) / 1e6;
    durations.push(ms);
    lastCandidateCount = result.candidates.length;
    console.log(`run ${i + 1}: ${ms.toFixed(1)}ms, candidates=${result.candidates.length}`);
  }
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  console.log(`avg: ${avg.toFixed(1)}ms (candidates=${lastCandidateCount})`);
}

main();
