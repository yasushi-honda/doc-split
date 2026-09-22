import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { FABRICATION_SCAN_CONFIG_VERSION } from '../../shared/summaryFabricationScan';

/**
 * ADR-0027 PR2a: scripts/fixtures/sarashina-summary-golden/manifest.json が以下4方向で
 * ドリフトしていないことを保証する契約テスト。`scripts/lib/paddleOcrModelHashes.test.ts` と
 * 同じ場所・命名規則(`Contract`接尾辞は付けない)。
 *
 * (1) manifest.docs[*].sha256 が fixture 実ファイル(docs/*.txt, meta.json)と一致
 * (2) manifest.model が services/sarashina-summary/expected-model-hashes.json と一致
 * (3) manifest.promptV2Sha256 が prompt-v2.txt の実ハッシュと一致、かつ
 *     bench.py の build_prompt_v2 リテラルと同一文面であること(クロス言語ドリフト検知)
 * (4) manifest.maxInputChars が本番 summaryPromptBuilder.ts の MAX_SUMMARY_INPUT_LENGTH、
 *     manifest.fabricationScanConfigVersion が shared/summaryFabricationScan.ts の
 *     FABRICATION_SCAN_CONFIG_VERSION と一致
 */

const GOLDEN_DIR = path.join(__dirname, '..', 'fixtures', 'sarashina-summary-golden');
const DOCS_DIR = path.join(GOLDEN_DIR, 'docs');
const MANIFEST_PATH = path.join(GOLDEN_DIR, 'manifest.json');
const PROMPT_V2_PATH = path.join(GOLDEN_DIR, 'prompt-v2.txt');
const BENCH_PY_PATH = path.join(GOLDEN_DIR, 'pr0-verification', 'bench.py');
const EXPECTED_HASHES_PATH = path.join(
  __dirname,
  '..',
  '..',
  'services',
  'sarashina-summary',
  'expected-model-hashes.json'
);
const SUMMARY_PROMPT_BUILDER_PATH = path.join(
  __dirname,
  '..',
  '..',
  'functions',
  'src',
  'ocr',
  'summaryPromptBuilder.ts'
);

function loadJson(p: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function sha256File(p: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

interface ManifestDoc {
  sha256: string;
  bytes: number;
}

interface Manifest {
  promptV2Sha256: string;
  maxInputChars: number;
  fabricationScanConfigVersion: string;
  docs: Record<string, ManifestDoc>;
  model: {
    hfRepoId: string;
    hfRevision: string;
    fileName: string;
    sha256: string;
    baseImageDigest: string;
    baseImageBuildInfo: string;
  };
}

test('sarashinaSummaryGoldenDrift: manifest.docsの全ファイルのsha256がfixture実体と一致すること', () => {
  const manifest = loadJson(MANIFEST_PATH) as unknown as Manifest;
  const actualFiles = fs
    .readdirSync(DOCS_DIR)
    .filter((f) => f.endsWith('.txt') || f === 'meta.json')
    .sort();
  const manifestFiles = Object.keys(manifest.docs).sort();
  assert.deepEqual(
    manifestFiles,
    actualFiles,
    'manifest.docsのファイル一覧がdocs/ディレクトリの実体と一致しません(追加/削除の反映漏れ)'
  );
  for (const fname of actualFiles) {
    const actualSha256 = sha256File(path.join(DOCS_DIR, fname));
    assert.equal(
      manifest.docs[fname].sha256,
      actualSha256,
      `docs/${fname}: manifest.jsonとファイル実体のsha256が不一致です`
    );
  }
});

test('sarashinaSummaryGoldenDrift: manifest.modelがservices/sarashina-summary/expected-model-hashes.jsonと一致すること', () => {
  const manifest = loadJson(MANIFEST_PATH) as unknown as Manifest;
  const expected = loadJson(EXPECTED_HASHES_PATH) as {
    textGeneration: { hfRepoId: string; hfRevision: string; fileName: string; sha256: string };
    baseImage: { digest: string; buildInfo: string };
  };
  assert.equal(manifest.model.hfRepoId, expected.textGeneration.hfRepoId);
  assert.equal(manifest.model.hfRevision, expected.textGeneration.hfRevision);
  assert.equal(manifest.model.fileName, expected.textGeneration.fileName);
  assert.equal(manifest.model.sha256, expected.textGeneration.sha256);
  assert.equal(manifest.model.baseImageDigest, expected.baseImage.digest);
  assert.equal(manifest.model.baseImageBuildInfo, expected.baseImage.buildInfo);
});

test('sarashinaSummaryGoldenDrift: manifest.promptV2Sha256がprompt-v2.txtの実ハッシュと一致すること', () => {
  const manifest = loadJson(MANIFEST_PATH) as unknown as Manifest;
  const actualSha256 = sha256File(PROMPT_V2_PATH);
  assert.equal(
    manifest.promptV2Sha256,
    actualSha256,
    'manifest.jsonとprompt-v2.txt実体のsha256が不一致です'
  );
});

test('sarashinaSummaryGoldenDrift: prompt-v2.txtがbench.pyのbuild_prompt_v2リテラルと同一文面であること(クロス言語ドリフト検知)', () => {
  const benchPy = fs.readFileSync(BENCH_PY_PATH, 'utf-8');
  const match = benchPy.match(/def build_prompt_v2[\s\S]*?return f"""([\s\S]*?)"""/);
  assert.ok(match, 'bench.pyからbuild_prompt_v2のf-stringリテラルを抽出できませんでした(関数シグネチャ変更の可能性)');
  // f-string中の `{doc_type or '書類'}` / `{text}` を manifest 側のプレースホルダー記法へ
  // 変換してから比較する(Python f-string記法とテンプレートファイルの記法差異を吸収)。
  const pythonLiteral = match![1]
    .replace(/\{doc_type or '書類'\}/g, '{{documentType}}')
    .replace(/\{text\}/g, '{{ocrText}}');
  const templateFile = fs.readFileSync(PROMPT_V2_PATH, 'utf-8');
  assert.equal(
    templateFile.trim(),
    pythonLiteral.trim(),
    'prompt-v2.txtとbench.pyのbuild_prompt_v2の文面が乖離しています。' +
      'どちらかが意図せず変更された可能性があります(無検証での更新は禁止、README参照)'
  );
});

test('sarashinaSummaryGoldenDrift: manifest.maxInputCharsが本番summaryPromptBuilder.tsのMAX_SUMMARY_INPUT_LENGTHと一致すること', () => {
  const manifest = loadJson(MANIFEST_PATH) as unknown as Manifest;
  const source = fs.readFileSync(SUMMARY_PROMPT_BUILDER_PATH, 'utf-8');
  const match = source.match(/MAX_SUMMARY_INPUT_LENGTH\s*=\s*(\d+)/);
  assert.ok(match, 'summaryPromptBuilder.tsからMAX_SUMMARY_INPUT_LENGTHの値を抽出できませんでした');
  assert.equal(manifest.maxInputChars, Number(match![1]));
});

test('sarashinaSummaryGoldenDrift: manifest.fabricationScanConfigVersionがshared/summaryFabricationScan.tsの現行設定と一致すること', () => {
  const manifest = loadJson(MANIFEST_PATH) as unknown as Manifest;
  assert.equal(manifest.fabricationScanConfigVersion, FABRICATION_SCAN_CONFIG_VERSION);
});
