import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * ADR-0025 PR4a: services/paddle-ocr/expected-model-hashes.json の重み本体ハッシュ(fileHashes)が
 * scripts/fixtures/paddle-ocr-golden/manifest.json の実測値(24文書PoCで94/96正解を出した重みそのもの)
 * と一致し続けることを保証するドリフト検知テスト。
 *
 * 不一致は「Dockerビルドで取得するモデルが、精度検証済みのモデルと異なる」ことを意味する重大な
 * サイレント劣化リスクのため、両ファイルの手動更新が同期して行われることをCIで強制する。
 */

const MANIFEST_PATH = path.join(
  __dirname,
  '..',
  'fixtures',
  'paddle-ocr-golden',
  'manifest.json'
);
const EXPECTED_HASHES_PATH = path.join(
  __dirname,
  '..',
  '..',
  'services',
  'paddle-ocr',
  'expected-model-hashes.json'
);

function loadJson(p: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

test('paddleOcrModelHashes: expected-model-hashes.jsonのtextDetection.fileHashesがmanifest.jsonと完全一致すること', () => {
  const manifest = loadJson(MANIFEST_PATH) as { textDetectionModelFileHashes: Record<string, string> };
  const expected = loadJson(EXPECTED_HASHES_PATH) as {
    textDetection: { fileHashes: Record<string, string> };
  };

  for (const [fname, hash] of Object.entries(expected.textDetection.fileHashes)) {
    assert.equal(
      manifest.textDetectionModelFileHashes[fname],
      hash,
      `textDetection/${fname}: expected-model-hashes.jsonとmanifest.jsonのハッシュが不一致です`
    );
  }
});

test('paddleOcrModelHashes: expected-model-hashes.jsonのtextRecognition.fileHashesがmanifest.jsonと完全一致すること', () => {
  const manifest = loadJson(MANIFEST_PATH) as { textRecognitionModelFileHashes: Record<string, string> };
  const expected = loadJson(EXPECTED_HASHES_PATH) as {
    textRecognition: { fileHashes: Record<string, string> };
  };

  for (const [fname, hash] of Object.entries(expected.textRecognition.fileHashes)) {
    assert.equal(
      manifest.textRecognitionModelFileHashes[fname],
      hash,
      `textRecognition/${fname}: expected-model-hashes.jsonとmanifest.jsonのハッシュが不一致です`
    );
  }
});

test('paddleOcrModelHashes: hfRepoId/hfRevisionが両モデルとも設定されていること', () => {
  const expected = loadJson(EXPECTED_HASHES_PATH) as {
    textDetection: { hfRepoId: string; hfRevision: string };
    textRecognition: { hfRepoId: string; hfRevision: string };
  };
  assert.ok(expected.textDetection.hfRepoId.length > 0);
  assert.ok(expected.textDetection.hfRevision.length > 0);
  assert.ok(expected.textRecognition.hfRepoId.length > 0);
  assert.ok(expected.textRecognition.hfRevision.length > 0);
});
