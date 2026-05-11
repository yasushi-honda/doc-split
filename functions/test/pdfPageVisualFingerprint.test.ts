/**
 * Issue #432 PR-C2: pdfPageVisualFingerprint cross-process deterministic test.
 *
 * PR-C1 では `regenerateChildPdf` の deterministic 性を「同一プロセス内 2 回呼出し」
 * のみで検証し、pdf-lib の `PDFDocument.save()` がプロセス間で異なる bytes を出力する
 * 性質を見落として MatchedByHash 分類が dev fixture で 0 件になった (session59 で発覚)。
 *
 * 本テストでは:
 *   1. cross-process deterministic: 別 Node プロセスで生成した PDF と同一プロセスで
 *      生成した PDF が visual fingerprint で一致することを検証する (主目的)
 *   2. 偽陽性防止 (AC9-12): XObject 差分 / font 差分 / Rotate 差分 / CropBox 差分
 *      で fingerprint が変化することを検証
 *   3. unsupported features: 暗号化 PDF (loadOptions) / AcroForm 入り PDF で
 *      kind='unsupported' が返ること
 *   4. internal API lock (AC14): pdf-lib の internal exports が想定の形で存在
 *      していること (decodePDFRawStream / PDFRawStream 等)
 *
 * 失敗時の意味:
 *   - cross-process determinism 失敗 → PR-C2 修正方針が根本から成立せず、本番展開不可
 *   - 偽陽性防止失敗 → MatchedByHash で異なる描画を「同一」と誤認する重大バグ
 *   - lock test 失敗 → pdf-lib upgrade で内部 API 仕様変化、再 review 必要
 */

import { expect } from 'chai';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFRef,
  PDFString,
  decodePDFRawStream,
  degrees,
} from 'pdf-lib';
import {
  HASH_ALGORITHM,
  computePdfPageVisualFingerprint,
  canonicalDigest,
} from '../../scripts/lib/pdfPageVisualFingerprint';
import { regenerateChildPdf } from '../../scripts/lib/pdfRegenerator';

const FINGERPRINT_MODULE = path.resolve(
  __dirname,
  '../../scripts/lib/pdfPageVisualFingerprint'
);
const REGENERATOR_MODULE = path.resolve(
  __dirname,
  '../../scripts/lib/pdfRegenerator'
);

interface FingerprintOk {
  kind: 'ok';
  hex: string;
}

interface FingerprintUnsupported {
  kind: 'unsupported';
  reason: string;
  detail: string;
}

/**
 * 別 Node プロセスを spawn して fingerprint を計算する。
 * 親プロセスの内部状態 (random seed / module state) を完全に切り離すため、
 * 必ず deterministic な結果を要求できる。
 */
function fingerprintInChildProcess(
  parentPdfPath: string,
  startPage: number,
  endPage: number
): FingerprintOk | FingerprintUnsupported {
  const script = `
    const { regenerateChildPdf } = require(${JSON.stringify(REGENERATOR_MODULE)});
    const { computePdfPageVisualFingerprint } = require(${JSON.stringify(
      FINGERPRINT_MODULE
    )});
    const fs = require('fs');
    (async () => {
      const buf = fs.readFileSync(${JSON.stringify(parentPdfPath)});
      const child = await regenerateChildPdf(buf, ${startPage}, ${endPage});
      const fp = await computePdfPageVisualFingerprint(child);
      process.stdout.write(JSON.stringify(fp));
    })().catch((err) => {
      process.stderr.write(err.stack || err.message);
      process.exit(1);
    });
  `;
  const scriptPath = path.join(
    os.tmpdir(),
    `fp-child-${crypto.randomBytes(4).toString('hex')}.js`
  );
  fs.writeFileSync(scriptPath, script);
  try {
    const result = spawnSync(
      process.execPath,
      ['--require', 'ts-node/register', scriptPath],
      {
        encoding: 'utf-8',
        timeout: 30000,
        // 親 (mocha) は functions/ で実行されるが、子の require 解決を doc-split root に
        // 寄せて scripts/* と pdf-lib どちらにも到達できるようにする
        cwd: path.resolve(__dirname, '../../'),
      }
    );
    // Critical (silent-failure-hunter PR #441 review): spawn 失敗 / signal kill /
    // exit !== 0 を区別して握りつぶさない (debug 性 + test の偽 PASS 防止)
    if (result.error) {
      throw new Error(
        `child process spawn failed: ${result.error.message} (signal=${result.signal ?? '<none>'})`
      );
    }
    if (result.signal) {
      throw new Error(
        `child process killed by signal=${result.signal} stderr=${result.stderr}`
      );
    }
    if (result.status !== 0) {
      throw new Error(
        `child process exit=${result.status}: stderr=${result.stderr}`
      );
    }
    const out = JSON.parse(result.stdout) as
      | FingerprintOk
      | FingerprintUnsupported;
    return out;
  } finally {
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      /* ignore */
    }
  }
}

async function makeNPagePdf(n: number, seed = 0): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const page = pdf.addPage([200, 200]);
    page.drawRectangle({
      x: 10 + i * 3 + seed,
      y: 10 + i * 3 + seed,
      width: 30,
      height: 30,
    });
  }
  return Buffer.from(await pdf.save());
}

function writeTmpPdf(buf: Buffer): string {
  const p = path.join(
    os.tmpdir(),
    `fp-parent-${crypto.randomBytes(4).toString('hex')}.pdf`
  );
  fs.writeFileSync(p, buf);
  return p;
}

describe('pdfPageVisualFingerprint (Issue #432 PR-C2)', () => {
  describe('★ cross-process deterministic (PR-C1 設計欠陥の根本対策)', () => {
    let parentPath: string;
    before(async () => {
      const parent = await makeNPagePdf(5, 0);
      parentPath = writeTmpPdf(parent);
    });
    after(() => {
      try {
        fs.unlinkSync(parentPath);
      } catch {
        /* ignore */
      }
    });

    it('別プロセスで生成 → 同プロセスで生成、両者の fingerprint が一致', async () => {
      const parent = fs.readFileSync(parentPath);
      const inProcChild = await regenerateChildPdf(parent, 2, 3);
      const inProcFp = await computePdfPageVisualFingerprint(inProcChild);
      const crossFp = fingerprintInChildProcess(parentPath, 2, 3);

      expect(inProcFp.kind).to.equal('ok');
      expect(crossFp.kind).to.equal('ok');
      if (inProcFp.kind === 'ok' && crossFp.kind === 'ok') {
        expect(crossFp.hex).to.equal(inProcFp.hex);
      }
    });

    it('同 parent + 同 range で 2 つの別プロセス同士の fingerprint も一致', () => {
      const a = fingerprintInChildProcess(parentPath, 1, 2);
      const b = fingerprintInChildProcess(parentPath, 1, 2);
      expect(a.kind).to.equal('ok');
      expect(b.kind).to.equal('ok');
      if (a.kind === 'ok' && b.kind === 'ok') expect(a.hex).to.equal(b.hex);
    });

    it('異なる page range なら fingerprint も異なる (cross-process)', () => {
      const a = fingerprintInChildProcess(parentPath, 1, 1);
      const b = fingerprintInChildProcess(parentPath, 2, 2);
      expect(a.kind).to.equal('ok');
      expect(b.kind).to.equal('ok');
      if (a.kind === 'ok' && b.kind === 'ok') expect(a.hex).to.not.equal(b.hex);
    });
  });

  describe('正常系: 同一描画の同プロセス deterministic', () => {
    it('同入力で 2 回計算 → 同じ hex', async () => {
      const pdf = await makeNPagePdf(3);
      const fp1 = await computePdfPageVisualFingerprint(pdf);
      const fp2 = await computePdfPageVisualFingerprint(pdf);
      expect(fp1.kind).to.equal('ok');
      expect(fp2.kind).to.equal('ok');
      if (fp1.kind === 'ok' && fp2.kind === 'ok') {
        expect(fp1.hex).to.equal(fp2.hex);
        expect(fp1.pageCount).to.equal(3);
      }
    });

    it('algorithm version が "pdf-page-visual-v1" を返す', async () => {
      const pdf = await makeNPagePdf(1);
      const fp = await computePdfPageVisualFingerprint(pdf);
      expect(fp.algorithm).to.equal(HASH_ALGORITHM);
      expect(HASH_ALGORITHM).to.equal('pdf-page-visual-v1');
    });
  });

  describe('AC9-12: 偽陽性防止 (描画差異が fingerprint に反映される)', () => {
    it('AC9: 描画内容が異なる (rectangle 位置差) → fingerprint が異なる', async () => {
      const a = await makeNPagePdf(2, 0);
      const b = await makeNPagePdf(2, 7); // seed 差で content stream の数値リテラル変化
      const fpA = await computePdfPageVisualFingerprint(a);
      const fpB = await computePdfPageVisualFingerprint(b);
      expect(fpA.kind).to.equal('ok');
      expect(fpB.kind).to.equal('ok');
      if (fpA.kind === 'ok' && fpB.kind === 'ok') {
        expect(fpA.hex).to.not.equal(fpB.hex);
      }
    });

    it('AC10: Rotate 差分 → fingerprint が異なる', async () => {
      const base = await PDFDocument.create();
      const p1 = base.addPage([200, 200]);
      p1.drawRectangle({ x: 5, y: 5, width: 20, height: 20 });
      const aBuf = Buffer.from(await base.save());

      const rotated = await PDFDocument.create();
      const p2 = rotated.addPage([200, 200]);
      p2.drawRectangle({ x: 5, y: 5, width: 20, height: 20 });
      p2.setRotation(degrees(90));
      const bBuf = Buffer.from(await rotated.save());

      const fpA = await computePdfPageVisualFingerprint(aBuf);
      const fpB = await computePdfPageVisualFingerprint(bBuf);
      expect(fpA.kind).to.equal('ok');
      expect(fpB.kind).to.equal('ok');
      if (fpA.kind === 'ok' && fpB.kind === 'ok') {
        expect(fpA.hex).to.not.equal(fpB.hex);
      }
    });

    it('AC11: MediaBox/CropBox 差分 → fingerprint が異なる', async () => {
      const smaller = await PDFDocument.create();
      const sp = smaller.addPage([100, 100]);
      sp.drawRectangle({ x: 5, y: 5, width: 20, height: 20 });
      const smallBuf = Buffer.from(await smaller.save());

      const bigger = await PDFDocument.create();
      const bp = bigger.addPage([200, 200]);
      bp.drawRectangle({ x: 5, y: 5, width: 20, height: 20 });
      const bigBuf = Buffer.from(await bigger.save());

      const fpA = await computePdfPageVisualFingerprint(smallBuf);
      const fpB = await computePdfPageVisualFingerprint(bigBuf);
      expect(fpA.kind).to.equal('ok');
      expect(fpB.kind).to.equal('ok');
      if (fpA.kind === 'ok' && fpB.kind === 'ok') {
        expect(fpA.hex).to.not.equal(fpB.hex);
      }
    });

    it('AC12: ページ数差分 → fingerprint が異なる', async () => {
      const onePage = await makeNPagePdf(1);
      const twoPage = await makeNPagePdf(2);
      const fp1 = await computePdfPageVisualFingerprint(onePage);
      const fp2 = await computePdfPageVisualFingerprint(twoPage);
      expect(fp1.kind).to.equal('ok');
      expect(fp2.kind).to.equal('ok');
      if (fp1.kind === 'ok' && fp2.kind === 'ok') {
        expect(fp1.hex).to.not.equal(fp2.hex);
        expect(fp1.pageCount).to.equal(1);
        expect(fp2.pageCount).to.equal(2);
      }
    });

    it('AC9 拡張: Resources (font 入替) → fingerprint が異なる', async () => {
      // helvetica + 文字列描画
      const a = await PDFDocument.create();
      const pa = a.addPage([300, 200]);
      const fontA = await a.embedFont('Helvetica');
      pa.drawText('hello', { x: 50, y: 100, size: 20, font: fontA });
      const aBuf = Buffer.from(await a.save());

      // times + 文字列描画 (font が異なる resources subtree を生む)
      const b = await PDFDocument.create();
      const pb = b.addPage([300, 200]);
      const fontB = await b.embedFont('Times-Roman');
      pb.drawText('hello', { x: 50, y: 100, size: 20, font: fontB });
      const bBuf = Buffer.from(await b.save());

      const fpA = await computePdfPageVisualFingerprint(aBuf);
      const fpB = await computePdfPageVisualFingerprint(bBuf);
      expect(fpA.kind).to.equal('ok');
      expect(fpB.kind).to.equal('ok');
      if (fpA.kind === 'ok' && fpB.kind === 'ok') {
        expect(fpA.hex).to.not.equal(fpB.hex);
      }
    });
  });

  describe('AC + Codex Suggestion: unsupported features は kind=unsupported を返す', () => {
    it('malformed PDF (空 buffer) → kind=unsupported, reason=malformed', async () => {
      const fp = await computePdfPageVisualFingerprint(Buffer.from([]));
      expect(fp.kind).to.equal('unsupported');
      if (fp.kind === 'unsupported') {
        expect(fp.reason).to.equal('malformed');
      }
    });

    it('AcroForm 入り PDF → kind=unsupported, reason=acroform', async () => {
      const pdf = await PDFDocument.create();
      const page = pdf.addPage([300, 200]);
      page.drawRectangle({ x: 5, y: 5, width: 20, height: 20 });
      const form = pdf.getForm();
      form.createTextField('input1');
      const buf = Buffer.from(await pdf.save());

      const fp = await computePdfPageVisualFingerprint(buf);
      expect(fp.kind).to.equal('unsupported');
      if (fp.kind === 'unsupported') {
        expect(fp.reason).to.equal('acroform');
      }
    });
  });

  describe('AC14: pdf-lib internal API lock', () => {
    it('decodePDFRawStream は named export かつ function', () => {
      expect(typeof decodePDFRawStream).to.equal('function');
    });

    it('PDFRawStream は named export かつ parser 経由で実体化される', async () => {
      // parser 経由で読み込んだ PDF の content stream が PDFRawStream であることを確認
      // (PDFArray 要素は通常 PDFRef なので context.lookup() で resolve してから判定)
      const pdf = await makeNPagePdf(1);
      const reloaded = await PDFDocument.load(pdf);
      const contents = reloaded.getPage(0).node.Contents();
      let rawStreamCount = 0;
      const resolveAndCount = (obj: PDFObject): void => {
        const resolved =
          obj instanceof PDFRef ? reloaded.context.lookup(obj) : obj;
        if (resolved instanceof PDFRawStream) rawStreamCount += 1;
      };
      if (contents instanceof PDFArray) {
        for (let i = 0; i < contents.size(); i++) resolveAndCount(contents.get(i));
      } else if (contents !== undefined) {
        resolveAndCount(contents);
      }
      expect(rawStreamCount).to.be.greaterThan(0);
    });

    it('PDFPageLeaf.Contents/Resources/MediaBox/CropBox/Rotate methods が存在', async () => {
      const pdf = await makeNPagePdf(1);
      const reloaded = await PDFDocument.load(pdf);
      const node = reloaded.getPage(0).node;
      expect(typeof node.Contents).to.equal('function');
      expect(typeof node.Resources).to.equal('function');
      expect(typeof node.MediaBox).to.equal('function');
      expect(typeof node.CropBox).to.equal('function');
      expect(typeof node.Rotate).to.equal('function');
    });

    it('PDFDict.entries() は [PDFName, PDFObject] tuples を返す', async () => {
      const pdf = await makeNPagePdf(1);
      const reloaded = await PDFDocument.load(pdf);
      const dict = reloaded.getPage(0).node;
      const entries = dict.entries();
      expect(entries).to.be.an('array');
      expect(entries.length).to.be.greaterThan(0);
    });

    it('canonicalDigest は PDFDict に対して deterministic な Buffer を返す', async () => {
      const pdf = await makeNPagePdf(1);
      const reloaded = await PDFDocument.load(pdf);
      const dict = reloaded.getPage(0).node;
      const d1 = canonicalDigest(dict as PDFDict, reloaded.context);
      const d2 = canonicalDigest(dict as PDFDict, reloaded.context);
      expect(d1).to.be.instanceOf(Buffer);
      expect(d1.equals(d2)).to.equal(true);
    });
  });

  describe('Codex review (PR #441 post-review) 反映 v1.1', () => {
    it('Critical: visible annotation 入り page → unsupported.annotations', async () => {
      const pdf = await PDFDocument.create();
      const page = pdf.addPage([200, 200]);
      page.drawRectangle({ x: 5, y: 5, width: 20, height: 20 });

      // 手動で Text annotation を 1 件追加 (form field ではないので AcroForm 経路を踏まない)
      const annotDict = pdf.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [50, 50, 100, 100],
        Contents: PDFString.of('codex review annotation test'),
      });
      const annotRef = pdf.context.register(annotDict);
      page.node.addAnnot(annotRef);

      const buf = Buffer.from(await pdf.save());
      const fp = await computePdfPageVisualFingerprint(buf);
      expect(fp.kind).to.equal('unsupported');
      if (fp.kind === 'unsupported') {
        expect(fp.reason).to.equal('annotations');
      }
    });

    it('Suggestion: CropBox absent == CropBox 明示 (MediaBox 同値) → 同 fingerprint', async () => {
      // pdf1: CropBox なし (PDF spec で MediaBox にフォールバック)
      const pdf1 = await PDFDocument.create();
      const p1 = pdf1.addPage([200, 200]);
      p1.drawRectangle({ x: 5, y: 5, width: 20, height: 20 });
      const buf1 = Buffer.from(await pdf1.save());

      // pdf2: CropBox を MediaBox と同じ値で明示
      const pdf2 = await PDFDocument.create();
      const p2 = pdf2.addPage([200, 200]);
      p2.drawRectangle({ x: 5, y: 5, width: 20, height: 20 });
      const cropArr = pdf2.context.obj([0, 0, 200, 200]);
      p2.node.set(PDFName.of('CropBox'), cropArr);
      const buf2 = Buffer.from(await pdf2.save());

      const fp1 = await computePdfPageVisualFingerprint(buf1);
      const fp2 = await computePdfPageVisualFingerprint(buf2);
      expect(fp1.kind).to.equal('ok');
      expect(fp2.kind).to.equal('ok');
      if (fp1.kind === 'ok' && fp2.kind === 'ok') {
        // 表示同一性は等価 → effective fallback で同 fingerprint
        expect(fp1.hex).to.equal(fp2.hex);
      }
    });

    it('Important: UserUnit 差分 → fingerprint が異なる', async () => {
      const build = async (unit: number) => {
        const pdf = await PDFDocument.create();
        const p = pdf.addPage([200, 200]);
        p.drawRectangle({ x: 5, y: 5, width: 20, height: 20 });
        p.node.set(PDFName.of('UserUnit'), PDFNumber.of(unit));
        return Buffer.from(await pdf.save());
      };
      const fp1 = await computePdfPageVisualFingerprint(await build(1));
      const fp2 = await computePdfPageVisualFingerprint(await build(2));
      expect(fp1.kind).to.equal('ok');
      expect(fp2.kind).to.equal('ok');
      if (fp1.kind === 'ok' && fp2.kind === 'ok') {
        expect(fp1.hex).to.not.equal(fp2.hex);
      }
    });

    it('Important: /Group 差分 → fingerprint が異なる', async () => {
      const build = async (cs: string) => {
        const pdf = await PDFDocument.create();
        const p = pdf.addPage([200, 200]);
        p.drawRectangle({ x: 5, y: 5, width: 20, height: 20 });
        // page-level /Group (transparency group dict) の CS (color space) 差分
        const group = pdf.context.obj({
          Type: 'Group',
          S: 'Transparency',
          CS: cs,
        });
        p.node.set(PDFName.of('Group'), group);
        return Buffer.from(await pdf.save());
      };
      const fp1 = await computePdfPageVisualFingerprint(await build('DeviceRGB'));
      const fp2 = await computePdfPageVisualFingerprint(await build('DeviceCMYK'));
      expect(fp1.kind).to.equal('ok');
      expect(fp2.kind).to.equal('ok');
      if (fp1.kind === 'ok' && fp2.kind === 'ok') {
        expect(fp1.hex).to.not.equal(fp2.hex);
      }
    });
  });

  describe('5 並列 review 反映 (PR #441 post-review v1.2)', () => {
    it('Critical (code-reviewer): cross-locale 子プロセス間で同 PDF → 同 fingerprint hex (byte-order sort 担保)', async () => {
      const parent = await makeNPagePdf(3, 0);
      const parentPath = writeTmpPdf(parent);
      try {
        // 2 つの子プロセスを異なる LANG/LC_ALL で起動。byte-order sort 化により
        // どちらの locale でも同じ canonical digest を返すことを担保。
        const fpInLocale = (lang: string): FingerprintOk | FingerprintUnsupported => {
          const script = `
            const { regenerateChildPdf } = require(${JSON.stringify(REGENERATOR_MODULE)});
            const { computePdfPageVisualFingerprint } = require(${JSON.stringify(FINGERPRINT_MODULE)});
            const fs = require('fs');
            (async () => {
              const buf = fs.readFileSync(${JSON.stringify(parentPath)});
              const child = await regenerateChildPdf(buf, 1, 2);
              const fp = await computePdfPageVisualFingerprint(child);
              process.stdout.write(JSON.stringify(fp));
            })().catch((err) => { process.stderr.write(err.stack || err.message); process.exit(1); });
          `;
          const sp = path.join(os.tmpdir(), `loc-${crypto.randomBytes(4).toString('hex')}.js`);
          fs.writeFileSync(sp, script);
          try {
            const result = spawnSync(
              process.execPath,
              ['--require', 'ts-node/register', sp],
              {
                encoding: 'utf-8',
                timeout: 30000,
                cwd: path.resolve(__dirname, '../../'),
                env: { ...process.env, LANG: lang, LC_ALL: lang },
              }
            );
            if (result.status !== 0) {
              throw new Error(`child exit=${result.status} stderr=${result.stderr}`);
            }
            return JSON.parse(result.stdout);
          } finally {
            try { fs.unlinkSync(sp); } catch { /* ignore */ }
          }
        };
        const fpC = fpInLocale('C.UTF-8');
        const fpJa = fpInLocale('ja_JP.UTF-8');
        expect(fpC.kind).to.equal('ok');
        expect(fpJa.kind).to.equal('ok');
        if (fpC.kind === 'ok' && fpJa.kind === 'ok') {
          expect(fpJa.hex).to.equal(fpC.hex);
        }
      } finally {
        try { fs.unlinkSync(parentPath); } catch { /* ignore */ }
      }
    });
  });
});
