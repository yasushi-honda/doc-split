/**
 * デプロイ経路のGemini拒否の契約 (ADR-0029)
 *
 * 目的: 宣言値 `OCR_PROVIDER=gemini` が、overrideの選択に関わらずデプロイ前に止まることを固定する。
 * 順序を入れ替える編集(拒否をoverride解決の後ろへ移す等)は、`ocr_provider_override=paddle` を選んだ
 * デプロイが禁止された宣言を黙って素通りさせる(codex review P2の回帰点)。シェル自体は実行せず、
 * ワークフロー・スクリプトの文面を検査する。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..');
const read = (rel: string): string => readFileSync(resolve(repoRoot, rel), 'utf-8');

test('deploy-functions.yml: 宣言値geminiの拒否は、override解決(OCR_PROVIDER_EFFECTIVE=)より前にある', () => {
  const yml = read('.github/workflows/deploy-functions.yml');
  const rejectIdx = yml.indexOf('if [ "$DECLARED_OCR_PROVIDER" == "gemini" ]');
  const effectiveIdx = yml.indexOf('OCR_PROVIDER_EFFECTIVE="${{ github.event.inputs.ocr_provider_override }}"');
  assert.ok(rejectIdx > 0, '宣言値geminiの拒否ブロックが無い');
  assert.ok(effectiveIdx > 0, 'override解決の行が見つからない(文面が変わった場合は本テストも更新する)');
  assert.ok(rejectIdx < effectiveIdx, '宣言値geminiの拒否がoverride解決より後ろにある(overrideで素通りする)');
});

test('deploy-functions.yml: 拒否ブロックはexit 1で止まり、geminiをoverride選択肢・入力に持たない', () => {
  const yml = read('.github/workflows/deploy-functions.yml');
  const block = yml.slice(yml.indexOf('if [ "$DECLARED_OCR_PROVIDER" == "gemini" ]'));
  assert.match(block.slice(0, 600), /exit 1/, '拒否ブロックがexit 1で止まっていない');
  const optionsSection = yml.slice(yml.indexOf('ocr_provider_override:'), yml.indexOf('ocr_provider_override:') + 400);
  assert.doesNotMatch(optionsSection, /-\s*gemini\b/, 'ocr_provider_overrideの選択肢にgeminiが残っている');
  assert.doesNotMatch(yml, /gemini_model_id_override/, 'gemini_model_id_override入力が残っている');
  assert.doesNotMatch(yml, /echo\s+"GEMINI_MODEL_ID=/, 'GEMINI_MODEL_IDの書き込みが残っている');
});

test('deploy-to-project.sh: 宣言値・実効値のgeminiをエラーで止め、古いGEMINI_*設定を除去する', () => {
  const sh = read('scripts/deploy-to-project.sh');
  assert.match(sh, /gemini\)\s*log_error[^\n]*exit 1/, '宣言値geminiの拒否が無い');
  assert.match(sh, /\[ "\$EFFECTIVE_OCR_PROVIDER" = "gemini" \]/, '実効値geminiの検査が無い');
  assert.match(sh, /GEMINI_MODEL_ID\|GEMINI_OCR_THINKING_BUDGET/, '古いGEMINI_*設定の除去が無い');
});

test('setup-tenant.sh: aiplatform APIの有効化とroles/aiplatform.userの付与がない', () => {
  // 廃止の理由を書いたコメント行は対象外(コマンドとしての有効化・付与だけを禁止する)
  const code = read('scripts/setup-tenant.sh')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  assert.doesNotMatch(code, /aiplatform\.googleapis\.com/, 'aiplatform APIの有効化が残っている');
  assert.doesNotMatch(code, /roles\/aiplatform\.user/, 'roles/aiplatform.userの付与が残っている');
});
