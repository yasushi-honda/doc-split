#!/usr/bin/env ts-node
/**
 * Issue #432 PR-C3b: 固定 synthetic PDF fixture 生成スクリプト (deterministic)。
 *
 * 目的 (AC16 / AC20 反映):
 *   - pdf-lib ネイティブで生成困難な /Filter (CCITT/JBIG2/JPX) を含む image XObject を
 *     PDFRawStream の hand-craft で注入する
 *   - encrypted PDF (trailer /Encrypt 注入) も生成可能 (pdf-page-visual-v2 で
 *     unsupported.encryption に降格する経路の test fixture)
 *   - pdf-feature-survey の --expect-filter で実際に /CCITTFaxDecode 等が検出される
 *     ことを CI で assert (AC20 strict guard)
 *   - verify-pdf-determinism --paths でこれら fixture が cross-process invariant な
 *     fingerprint を持つことを実証 (AC17 拡張)
 *
 * 出力: scripts/fixtures/*.pdf (deterministic、git commit 対象)
 *
 * 決定論性の根拠:
 *   1. CreationDate / ModDate を固定値 2026-01-01T00:00:00Z に設定
 *   2. Producer / Creator を固定文字列に設定
 *   3. trailer /ID を固定 PDFHexString に設定 (pdf-lib は ID 未設定時 omit、明示設定で固定化)
 *   4. updateMetadata=false で save (timestamp 自動更新を防ぐ)
 *   5. PDFRawStream は hand-craft 済 bytes を保持、再エンコードしない
 *
 * 同一マシンで再実行すれば byte 単位で同一の PDF が生成される。CI でも `node scripts/fixtures/
 * generate-fixtures.ts --check` で commit 済 fixture との byte 一致を verify 可能 (後続 PR)。
 *
 * 使用方法:
 *   ts-node scripts/fixtures/generate-fixtures.ts        # 全 fixture を生成 (上書き)
 *   ts-node scripts/fixtures/generate-fixtures.ts --check # 既存 fixture と再生成結果の byte 一致 verify
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  PDFArray,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  degrees,
} from 'pdf-lib';

const FIXTURE_DIR = __dirname;

/** 2026-01-01T00:00:00Z を Unix epoch 経由で固定化 */
const FIXED_DATE = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

/** trailer /ID 固定 hex (16 bytes 2 個、PDF spec 推奨) */
const FIXED_ID_HEX = '00112233445566778899AABBCCDDEEFF';

/**
 * PDFDocument に固定 metadata を適用する。
 *
 * pdf-page-visual-v2 の METADATA_DENYLIST で除外される key だが、byte 単位の fixture
 * 安定性 (commit 用) のために固定化する。
 */
function applyDeterminism(pdf: PDFDocument): void {
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);
  pdf.setProducer('docsplit-fixtures');
  pdf.setCreator('docsplit-fixtures');
  pdf.setTitle('docsplit fixture');
  pdf.setAuthor('docsplit');
  pdf.setSubject('PR-C3b synthetic test fixture');
  pdf.setKeywords(['docsplit', 'fixture', 'test']);
  // trailer /ID 固定化 (pdf-lib は明示設定があれば PDFWriter 経由でそのまま使う)
  const idArray = PDFArray.withContext(pdf.context);
  idArray.push(PDFHexString.of(FIXED_ID_HEX));
  idArray.push(PDFHexString.of(FIXED_ID_HEX));
  pdf.context.trailerInfo.ID = idArray;
}

async function saveDeterministic(pdf: PDFDocument): Promise<Buffer> {
  // PDFDocument.save() は metadata 自動更新しない (確認済、pdf-lib 1.17.1)。
  // metadata 固定値は applyDeterminism() で設定済。
  return Buffer.from(await pdf.save());
}

/**
 * Hand-craft image XObject with arbitrary /Filter and dummy bytes。
 *
 * pdf-page-visual-v2 は decodePDFRawStream() を呼ばず .contents (encoded bytes) を
 * hash するため、`dummyBytes` が「正規な CCITT G4 stream」である必要はない。
 * pdf-feature-survey は dict の /Filter エントリを読み取るので、filter name が
 * survey 検出のみであれば OK。
 */
function buildImageXObject(
  ctx: PDFContext,
  filter: string,
  width: number,
  height: number,
  bitsPerComponent: number,
  colorSpace: string,
  decodeParms: Record<string, number | string> | null,
  dummyBytes: Uint8Array
): PDFRef {
  // PDFDict を直接構築 (ctx.obj() の LiteralObject 制約を回避)
  const imgDict = PDFDict.withContext(ctx);
  imgDict.set(PDFName.of('Type'), PDFName.of('XObject'));
  imgDict.set(PDFName.of('Subtype'), PDFName.of('Image'));
  imgDict.set(PDFName.of('Width'), PDFNumber.of(width));
  imgDict.set(PDFName.of('Height'), PDFNumber.of(height));
  imgDict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(bitsPerComponent));
  imgDict.set(PDFName.of('ColorSpace'), PDFName.of(colorSpace));
  imgDict.set(PDFName.of('Filter'), PDFName.of(filter));
  imgDict.set(PDFName.of('Length'), PDFNumber.of(dummyBytes.length));
  if (decodeParms !== null) {
    const parmsDict = PDFDict.withContext(ctx);
    for (const [k, v] of Object.entries(decodeParms)) {
      if (typeof v === 'number') parmsDict.set(PDFName.of(k), PDFNumber.of(v));
      else parmsDict.set(PDFName.of(k), PDFName.of(v));
    }
    imgDict.set(PDFName.of('DecodeParms'), parmsDict);
  }
  const stream = PDFRawStream.of(imgDict, dummyBytes);
  return ctx.register(stream);
}

/**
 * 既存 page の /Resources/XObject に image ref を追加。
 *
 * pdf-lib の page.drawImage() を使わず、Resources を直接 mutate する。drawImage()
 * は実 PDFImage を必要とするが、本 fixture では survey/fingerprint 経路で dict 構造を
 * 検出できれば十分 (実描画は不要)。
 */
function attachImageToPageResources(
  pdf: PDFDocument,
  pageIndex: number,
  imageName: string,
  imageRef: PDFRef
): void {
  const ctx = pdf.context;
  const node = pdf.getPage(pageIndex).node;
  let resources = node.Resources();
  if (resources === undefined) {
    resources = PDFDict.withContext(ctx);
    node.set(PDFName.of('Resources'), resources);
  }
  const xobjectsRaw = resources.get(PDFName.of('XObject'));
  const xobjectsResolved =
    xobjectsRaw instanceof PDFRef ? ctx.lookup(xobjectsRaw) : xobjectsRaw;
  let xobjects: PDFDict;
  if (xobjectsResolved instanceof PDFDict) {
    xobjects = xobjectsResolved;
  } else {
    xobjects = PDFDict.withContext(ctx);
    resources.set(PDFName.of('XObject'), xobjects);
  }
  xobjects.set(PDFName.of(imageName), imageRef);
}

/** 1. simple.pdf: baseline、特殊 filter なし (regression check 用) */
async function genSimple(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  applyDeterminism(pdf);
  const page = pdf.addPage([200, 300]);
  page.drawRectangle({ x: 10, y: 10, width: 100, height: 50 });
  page.drawText('synthetic-A simple baseline', { x: 20, y: 80, size: 10 });
  return saveDeterministic(pdf);
}

/**
 * 2. with-dctdecode.pdf: /Filter /DCTDecode を hand-craft 注入。
 *
 * 実 JPEG 埋め込み (pdf-lib embedJpg) ではなく、CCITT/JBIG2/JPX と同様に hand-craft
 * する。pdf-page-visual-v2 は encoded bytes hash のみで、survey も dict /Filter を
 * 読むのみのため、bytes が valid JPEG である必要はない。生成決定論性も hand-craft
 * の方が確実 (embedJpg は内部で metadata 抽出を行い、入力依存の dict が混入する)。
 */
async function genDct(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  applyDeterminism(pdf);
  const ctx = pdf.context;
  const page = pdf.addPage([100, 100]);
  page.drawText('dct fixture', { x: 5, y: 50, size: 10 });
  // JPEG SOI/EOI 風 dummy bytes (実 decode 不可、survey 用 /Filter 検出のみ)
  const dummyBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
  const ref = buildImageXObject(
    ctx,
    'DCTDecode',
    8,
    8,
    8,
    'DeviceRGB',
    null,
    dummyBytes
  );
  attachImageToPageResources(pdf, 0, 'ImDct', ref);
  return saveDeterministic(pdf);
}

/** 3. with-ccittfaxdecode.pdf: /Filter /CCITTFaxDecode を hand-craft 注入 */
async function genCcitt(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  applyDeterminism(pdf);
  const ctx = pdf.context;
  const page = pdf.addPage([100, 100]);
  page.drawText('ccitt fixture', { x: 5, y: 50, size: 10 });
  // 8x8 1bpp 仮想 stream (CCITT G4 風の dummy bytes、decode 不可だが survey 検出のみ用)
  const dummyBytes = new Uint8Array([0xff, 0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02]);
  const ref = buildImageXObject(
    ctx,
    'CCITTFaxDecode',
    8,
    8,
    1,
    'DeviceGray',
    { K: -1, Columns: 8, Rows: 8 },
    dummyBytes
  );
  attachImageToPageResources(pdf, 0, 'ImCcitt', ref);
  return saveDeterministic(pdf);
}

/** 4. with-jbig2decode.pdf: /Filter /JBIG2Decode を hand-craft 注入 */
async function genJbig2(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  applyDeterminism(pdf);
  const ctx = pdf.context;
  const page = pdf.addPage([100, 100]);
  page.drawText('jbig2 fixture', { x: 5, y: 50, size: 10 });
  const dummyBytes = new Uint8Array([0x97, 0x4a, 0x42, 0x32, 0x0d, 0x0a, 0x1a, 0x0a]); // JBIG2 magic 風
  const ref = buildImageXObject(
    ctx,
    'JBIG2Decode',
    8,
    8,
    1,
    'DeviceGray',
    null,
    dummyBytes
  );
  attachImageToPageResources(pdf, 0, 'ImJbig2', ref);
  return saveDeterministic(pdf);
}

/** 5. with-jpxdecode.pdf: /Filter /JPXDecode を hand-craft 注入 */
async function genJpx(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  applyDeterminism(pdf);
  const ctx = pdf.context;
  const page = pdf.addPage([100, 100]);
  page.drawText('jpx fixture', { x: 5, y: 50, size: 10 });
  // JPEG 2000 signature 風 dummy bytes (実描画不可)
  const dummyBytes = new Uint8Array([
    0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
  ]);
  const ref = buildImageXObject(
    ctx,
    'JPXDecode',
    8,
    8,
    8,
    'DeviceRGB',
    null,
    dummyBytes
  );
  attachImageToPageResources(pdf, 0, 'ImJpx', ref);
  return saveDeterministic(pdf);
}

/**
 * 6. encrypted.pdf: trailer に /Encrypt 注入。
 *
 * pdf-lib `PDFDocument.create()` で生成した PDF の trailerInfo.Encrypt に dummy
 * encryption dict を設定。実際の暗号化は施さず (内容は plain)、isEncrypted=true 検出と
 * unsupported.encryption フォールバックの test fixture 用途。
 */
async function genEncrypted(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  applyDeterminism(pdf);
  const ctx = pdf.context;
  const page = pdf.addPage([100, 100]);
  page.drawText('encrypted fixture (plain content, /Encrypt in trailer)', {
    x: 5,
    y: 50,
    size: 8,
  });
  // Dummy encryption dict (PDF 1.7 spec table 21 minimal)
  const encryptDict = PDFDict.withContext(ctx);
  encryptDict.set(PDFName.of('Filter'), PDFName.of('Standard'));
  encryptDict.set(PDFName.of('V'), PDFNumber.of(1));
  encryptDict.set(PDFName.of('R'), PDFNumber.of(2));
  encryptDict.set(PDFName.of('Length'), PDFNumber.of(40));
  encryptDict.set(PDFName.of('P'), PDFNumber.of(-4));
  encryptDict.set(PDFName.of('O'), PDFHexString.of('00'.repeat(32)));
  encryptDict.set(PDFName.of('U'), PDFHexString.of('00'.repeat(32)));
  ctx.trailerInfo.Encrypt = ctx.register(encryptDict);
  return saveDeterministic(pdf);
}

interface FixtureSpec {
  name: string;
  generator: () => Promise<Buffer>;
}

const FIXTURES: FixtureSpec[] = [
  { name: 'simple.pdf', generator: genSimple },
  { name: 'with-dctdecode.pdf', generator: genDct },
  { name: 'with-ccittfaxdecode.pdf', generator: genCcitt },
  { name: 'with-jbig2decode.pdf', generator: genJbig2 },
  { name: 'with-jpxdecode.pdf', generator: genJpx },
  { name: 'encrypted.pdf', generator: genEncrypted },
];

async function generateAll(checkOnly: boolean): Promise<void> {
  let mismatches = 0;
  for (const spec of FIXTURES) {
    const buf = await spec.generator();
    const outPath = path.join(FIXTURE_DIR, spec.name);
    if (checkOnly) {
      if (!fs.existsSync(outPath)) {
        console.error(`MISSING: ${outPath}`);
        mismatches++;
        continue;
      }
      const existing = fs.readFileSync(outPath);
      if (Buffer.compare(existing, buf) !== 0) {
        console.error(
          `MISMATCH: ${spec.name} (existing=${existing.length} bytes, regenerated=${buf.length} bytes)`
        );
        mismatches++;
      } else {
        console.error(`OK:       ${spec.name} (${buf.length} bytes)`);
      }
    } else {
      fs.writeFileSync(outPath, buf);
      console.error(`WROTE:    ${outPath} (${buf.length} bytes)`);
    }
  }
  if (checkOnly && mismatches > 0) {
    console.error(`FAIL: ${mismatches} fixture(s) out of sync`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes('--check');
  await generateAll(checkOnly);
}

main().catch((err) => {
  console.error(`ERROR: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
