/**
 * ADR-0025 PR4前提: PaddleOCR抽出/仲裁ロジック回帰テスト。
 *
 * 目的(重要、誤解を招く表現をしないこと): 本テストは「PaddleOCR/Cloud Runのドリフト検知」
 * ではない。CIは事前に記録した固定テキスト(Layer A)またはインラインの人工テキスト
 * (Layer B)しか読まず、PaddleOCR自体・モデル重み・Cloud Run実行環境の変化は検知しない。
 * 実態は「固定済みPaddleOCR出力に対する抽出/仲裁ロジック(本ファイル)の回帰テスト」。
 *
 * 本テストが完了しても、それは「PaddleOCRのCloud Run実用性を定量的に確認できたか」への
 * 回答にはならない。実用性の定量確認はPR4のCloud Run実機統合テスト+負荷試験ゲートの
 * 完了をもって初めて成立する(詳細: ~/.claude/plans/fuzzy-moseying-book.md v5、
 * ~/.claude/plans/shiny-knitting-flamingo.md PR4節)。
 *
 * Layer A: scripts/generate-paddle-ocr-golden-text.py が実際にPaddleOCR(PP-OCRv6 medium)
 * を1回実行して記録した固定テキスト(scripts/fixtures/paddle-ocr-golden/*.expected.txt /
 * *.pages.json)を、本番と同じ抽出/仲裁パイプラインに通す。Python/PaddleOCRには依存しない。
 *
 * Layer B: ADR-0025に記録された実際の誤読(「金額」→「金额」「櫻井」→「樱井」)、および
 * 事業所名の重複(isDuplicate)をハードコードしたOCRテキストで、Pass2無効時
 * (candidate=null固定)のベースライン抽出の安全性のみを検証する。実PaddleOCR出力とは
 * 主張しない。
 */

import { expect } from 'chai';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  extractDocumentTypeEnhanced,
  extractCustomerCandidates,
  extractOfficeCandidates,
  extractDateEnhanced,
  extractFilenameInfo,
  arbitrateDocumentType,
  arbitrateCustomerName,
  arbitrateOfficeName,
  arbitrateDate,
} from '../src/utils/extractors';
import {
  GOLDEN_FIXTURES,
  GOLDEN_DOCUMENT_MASTERS,
  GOLDEN_CUSTOMER_MASTERS,
  GOLDEN_OFFICE_MASTERS,
  type FieldExpectation,
  type GoldenFixtureDoc,
} from '../../scripts/fixtures/paddleOcrGoldenFixtures';

const FIXTURE_DIR = path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'paddle-ocr-golden');

/** 本番functions/src/ocr/ocrProcessor.tsと同じ呼出順(:381-434)で抽出/仲裁パイプラインを実行する。
 * candidateは全てnull固定(Pass2無効時のベースライン抽出、~/.claude/plans/fuzzy-moseying-book.md v5参照)。 */
function runArbitrationPipeline(ocrResult: string, firstPageText: string, fileName: string) {
  const documentTypeBase = extractDocumentTypeEnhanced(ocrResult, GOLDEN_DOCUMENT_MASTERS);
  const documentTypeResult = arbitrateDocumentType(documentTypeBase, null, GOLDEN_DOCUMENT_MASTERS, ocrResult);

  const customerBase = extractCustomerCandidates(ocrResult, GOLDEN_CUSTOMER_MASTERS);
  const customerResult = arbitrateCustomerName(customerBase, null, GOLDEN_CUSTOMER_MASTERS, ocrResult);

  const filenameInfo = extractFilenameInfo(fileName);
  const officeBase = extractOfficeCandidates(ocrResult, GOLDEN_OFFICE_MASTERS, { filenameInfo });
  const officeResult = arbitrateOfficeName(officeBase, null, GOLDEN_OFFICE_MASTERS, ocrResult, { filenameInfo });

  const matchedDoc = GOLDEN_DOCUMENT_MASTERS.find((d) => d.name === documentTypeResult.documentType);
  const dateMarker = matchedDoc?.dateMarker;
  const dateBase = extractDateEnhanced(ocrResult, dateMarker, firstPageText);
  const dateResult = arbitrateDate(dateBase, null, ocrResult);

  return { documentTypeResult, customerResult, officeResult, dateResult };
}

function assertRequired<T>(actual: T, expectation: FieldExpectation<T>, label: string): void {
  if (expectation.kind !== 'required') {
    throw new Error(`${label}: fixture定義が'required'ではなく'allowed'です`);
  }
  expect(actual, label).to.equal(expectation.value);
}

function assertAllowed<T>(actual: T | null, expectation: FieldExpectation<T>, label: string): void {
  if (expectation.kind !== 'allowed') {
    throw new Error(`${label}: fixture定義が'allowed'ではなく'required'です`);
  }
  expect(expectation.values, `${label}: actual=${JSON.stringify(actual)}`).to.include(actual);
  if (actual !== null) {
    expect(expectation.forbidden, `${label}: actual=${JSON.stringify(actual)}がforbiddenに含まれています`).to.not.include(
      actual
    );
  }
}

function assertField<T>(actual: T | null, expectation: FieldExpectation<T>, label: string): void {
  if (expectation.kind === 'required') {
    assertRequired(actual as T, expectation, label);
  } else {
    assertAllowed(actual, expectation, label);
  }
}

interface LoadedArtifacts {
  ocrResult: string;
  firstPageText: string;
}

let manifestCache: Record<string, unknown> | undefined;
function loadManifest(): Record<string, unknown> {
  manifestCache ??= JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manifest.json'), 'utf-8'));
  return manifestCache as Record<string, unknown>;
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function pdfFileNamesForFixture(fixture: GoldenFixtureDoc): string[] {
  if (fixture.pages.length === 1) return [`${fixture.fixtureBase}.pdf`];
  return fixture.pages.map((_, i) => `${fixture.fixtureBase}-p${i + 1}.pdf`);
}

/**
 * コミット済みPDFの実ハッシュがmanifest.jsonの記録値と一致するか検証する。
 *
 * 2026-09-12実測でのインシデント反映: PDF再生成(npx ts-node ... --generate-pdfs)後に
 * golden text再生成(generate-paddle-ocr-golden-text.py)を実行し忘れ、コミット済みPDFと
 * .expected.txt/.pages.jsonが別世代のまま混在した状態でcodex reviewに検出された。
 * pages.json/expected.txtの内部整合性チェックだけではこの種の不整合(PDFとテキストの
 * ソース不一致)を検知できないため、実ファイルのSHA-256をmanifest記録値と直接突合する。
 */
function verifyPdfProvenance(fixture: GoldenFixtureDoc): void {
  const manifest = loadManifest() as { fixtures?: Record<string, { sourcePdfSha256?: Record<string, string> }> };
  const recorded = manifest.fixtures?.[fixture.id]?.sourcePdfSha256;
  if (!recorded) {
    throw new Error(`${fixture.id}: manifest.jsonにsourcePdfSha256の記録がありません`);
  }
  for (const fname of pdfFileNamesForFixture(fixture)) {
    const actualHash = sha256File(path.join(FIXTURE_DIR, fname));
    expect(recorded[fname], `${fixture.id}: manifest.jsonに${fname}のハッシュ記録がありません`).to.exist;
    expect(
      actualHash,
      `${fixture.id}: ${fname}の実ハッシュがmanifest.json記録値と不一致です。` +
        'PDF再生成後にgolden text再生成(python3 scripts/generate-paddle-ocr-golden-text.py)を' +
        '忘れていないか確認してください。'
    ).to.equal(recorded[fname]);
  }
}

/** golden text生成物(.expected.txt / .pages.json)を読み込み、内部整合性を確認する。 */
function loadFixtureArtifacts(fixture: GoldenFixtureDoc): LoadedArtifacts {
  const fixtureId = fixture.id;
  const expectedPath = path.join(FIXTURE_DIR, `${fixtureId}.expected.txt`);
  const pagesPath = path.join(FIXTURE_DIR, `${fixtureId}.pages.json`);

  if (!fs.existsSync(expectedPath) || !fs.existsSync(pagesPath)) {
    throw new Error(
      `golden fixtureの生成物が見つかりません: ${expectedPath}\n` +
        '`npx ts-node scripts/fixtures/paddleOcrGoldenFixtures.ts --generate-pdfs` でPDFを生成後、' +
        '`python3 scripts/generate-paddle-ocr-golden-text.py` を実行してコミットしてください。'
    );
  }

  verifyPdfProvenance(fixture);

  const expectedTxt = fs.readFileSync(expectedPath, 'utf-8');
  const pages: string[] = JSON.parse(fs.readFileSync(pagesPath, 'utf-8'));

  // codex指摘反映(~/.claude/plans/fuzzy-moseying-book.md v5): 別世代の成果物が
  // 混在したままテストが成立することを防ぐため、2つの生成物の内部整合性を確認する。
  const reconstructed = pages.map((text, i) => `--- Page ${i + 1} ---\n${text}`).join('\n\n');
  expect(reconstructed, `${fixtureId}: pages.jsonとexpected.txtが整合していません(別世代の成果物混在の疑い)`).to.equal(
    expectedTxt
  );

  return { ocrResult: expectedTxt, firstPageText: pages[0] };
}

describe('PaddleOCR抽出/仲裁ロジック回帰テスト (ADR-0025 PR4前提)', () => {
  describe('Layer A: 固定済みPaddleOCR出力に対する抽出/仲裁回帰', () => {
    GOLDEN_FIXTURES.forEach((fixture: GoldenFixtureDoc) => {
      it(`${fixture.id}: 4フィールドとも期待通りに解決すること`, () => {
        const { ocrResult, firstPageText } = loadFixtureArtifacts(fixture);
        const { documentTypeResult, customerResult, officeResult, dateResult } = runArbitrationPipeline(
          ocrResult,
          firstPageText,
          fixture.fileName
        );

        assertField(documentTypeResult.documentType, fixture.docType, `${fixture.id}.docType`);
        assertField(customerResult.bestMatch?.id ?? null, fixture.customer, `${fixture.id}.customer`);
        assertField(officeResult.bestMatch?.id ?? null, fixture.office, `${fixture.id}.office`);
        assertField(dateResult.formattedDate, fixture.date, `${fixture.id}.date`);
      });
    });
  });

  describe('Layer B: Pass2無効時のベースライン抽出安全性テスト(人工的なOCR誤読テキスト、PaddleOCR実行不要)', () => {
    interface RiskCase {
      id: string;
      fileName: string;
      ocrResult: string;
      docType: FieldExpectation<string>;
      customer: FieldExpectation<string>;
      office: FieldExpectation<string>;
      date: FieldExpectation<string>;
      /** risk-confusable-office-01用の追加アサート */
      extraAssert?: (officeResult: ReturnType<typeof runArbitrationPipeline>['officeResult']) => void;
    }

    const RISK_CASES: RiskCase[] = [
      {
        // ADR-0025記載の実際の誤読「額田花子」→「额田花子」(額→额、簡体字置換)を
        // 顧客名フィールドの文脈で再現する。
        id: 'risk-simplified-01',
        fileName: 'risk_simplified_01_ケアプラン.pdf',
        ocrResult:
          '--- Page 1 ---\nケアプラン\n利用者: 额田花子 様\n事業所: あおぞらデイサービスセンター\n作成日: 2026年8月15日',
        docType: { kind: 'required', value: 'ケアプラン' },
        customer: { kind: 'allowed', values: ['gcust5', null], forbidden: ['gcust1', 'gcust2', 'gcust3', 'gcust4', 'gcust6'] },
        office: { kind: 'required', value: 'goff1' },
        date: { kind: 'required', value: '2026/08/15' },
      },
      {
        // ADR-0025記載の実際の誤読「櫻井正夫」→「樱井正夫」(櫻→樱、簡体字置換)。
        id: 'risk-simplified-02',
        fileName: 'risk_simplified_02_ケアプラン.pdf',
        ocrResult:
          '--- Page 1 ---\nケアプラン\n利用者: 樱井正夫 様\n事業所: ひまわり訪問介護ステーション\n作成日: 2026年8月17日',
        docType: { kind: 'required', value: 'ケアプラン' },
        customer: { kind: 'allowed', values: ['gcust6', null], forbidden: ['gcust1', 'gcust2', 'gcust3', 'gcust4', 'gcust5'] },
        office: { kind: 'required', value: 'goff2' },
        date: { kind: 'required', value: '2026/08/17' },
      },
      {
        // 紛らわしい事業所名(同名の重複マスターgoff3/goff4、isDuplicate:true)。
        // OCR自体は劣化していないが、マスター側の曖昧性により同点候補が発生する
        // (extractors.ts:1001、同点候補時は先頭IDがbestMatchになり得る実装)。
        id: 'risk-confusable-office-01',
        fileName: 'risk_confusable_office_01_ケアプラン.pdf',
        ocrResult:
          '--- Page 1 ---\nケアプラン\n利用者: 山田太郎 様\n事業所: 訪問介護センター中央\n作成日: 2026年8月22日',
        docType: { kind: 'required', value: 'ケアプラン' },
        customer: { kind: 'required', value: 'gcust4' },
        office: { kind: 'allowed', values: ['goff3', 'goff4', null], forbidden: ['goff1', 'goff2'] },
        date: { kind: 'required', value: '2026/08/22' },
        extraAssert: (officeResult) => {
          expect(officeResult.needsManualSelection, 'risk-confusable-office-01: needsManualSelectionがtrueであること').to.be
            .true;
          expect(
            officeResult.candidates.length,
            'risk-confusable-office-01: 重複事業所の両方が候補に含まれること'
          ).to.be.greaterThanOrEqual(2);
        },
      },
    ];

    RISK_CASES.forEach((riskCase) => {
      it(`${riskCase.id}: 誤読/曖昧性があっても危険な誤確定が起きないこと`, () => {
        // 単一ページの人工テキストのため、ocrResultとfirstPageTextは同一テキストから導出する
        // (先頭の`--- Page 1 ---\n`を取り除いたものがfirstPageText相当)。
        const firstPageText = riskCase.ocrResult.replace(/^--- Page 1 ---\n/, '');
        const { documentTypeResult, customerResult, officeResult, dateResult } = runArbitrationPipeline(
          riskCase.ocrResult,
          firstPageText,
          riskCase.fileName
        );

        assertField(documentTypeResult.documentType, riskCase.docType, `${riskCase.id}.docType`);
        assertField(customerResult.bestMatch?.id ?? null, riskCase.customer, `${riskCase.id}.customer`);
        assertField(officeResult.bestMatch?.id ?? null, riskCase.office, `${riskCase.id}.office`);
        assertField(dateResult.formattedDate, riskCase.date, `${riskCase.id}.date`);
        riskCase.extraAssert?.(officeResult);
      });
    });
  });
});
