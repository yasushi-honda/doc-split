/**
 * Issue #432 PR-C2: PDF page visual fingerprint (cross-process deterministic).
 *
 * pdf-lib `PDFDocument.save()` は同一プロセス内 deterministic だがプロセス間で
 * 非決定 (PDF `/ID` random、internal metadata) のため、sha256(raw bytes) 比較は
 * MatchedByHash を成立させない (PR-C1 session59 で発覚)。本モジュールは PDF の
 * 「描画同一性」を以下の要素で表現する fingerprint hex を返す:
 *   1. 各ページの decoded Contents bytes (正規化禁止、Codex Critical 2 反映)
 *   2. 各ページの geometry (MediaBox / CropBox / Rotate)
 *   3. 各ページが参照する Resources (Font / XObject / ExtGState / ColorSpace
 *      / Pattern / Shading / ProcSet) の canonical digest
 *
 * Codex Critical (PR-C2 v2 計画):
 *   - PDFPage.node.normalizedEntries() は副作用 (push/pop graphics state stream
 *     追加 + Resources/Annots 補完) のため使用禁止 → page.node.Contents() 直接読み
 *     + PDFArray / PDFStream / PDFRawStream 明示処理
 *   - whitespace / operator 順 / 数値表記 を正規化しない (inline image data 破壊
 *     リスク + graphics state 順序依存 = 偽陽性増加)
 *   - PDFDict entries は name 文字列 sort で V8 iteration order 差を吸収
 *
 * Unsupported features (Ambiguous フォールバック):
 *   - /Encrypt → unsupported.encryption
 *   - /AcroForm → unsupported.acroform
 *   - /OCProperties → unsupported.optional-content
 *   - 復元不能 PDF load 例外 → unsupported.malformed
 *
 * Algorithm version: 'pdf-page-visual-v1'。precondition snapshot + execute 側
 * 固定値で照合し、mismatch なら gate reject (AC13)。
 *
 * Internal API lock (AC14): pdf-lib の以下を直接利用しているため、test で
 * 存在をアサートする:
 *   - decodePDFRawStream (named export)
 *   - PDFRawStream (named export, instanceof check 用)
 *   - PDFPageLeaf.Contents() / Resources() / MediaBox() / CropBox() / Rotate()
 *   - PDFDict.entries()
 *   - PDFContext.lookup()
 */

import {
  PDFArray,
  PDFBool,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';
import * as crypto from 'crypto';

export const HASH_ALGORITHM = 'pdf-page-visual-v1';

export type UnsupportedReason =
  | 'encryption'
  | 'acroform'
  | 'optional-content'
  | 'malformed'
  /** Codex Critical 反映: visible annotations は描画に影響するが Contents stream に
   *  乗らない (別 dict / appearance stream)。安全側で自動復旧対象外に倒す。 */
  | 'annotations'
  /** Codex Important 反映: DCTDecode/JPXDecode 等 pdf-lib decodePDFRawStream 未対応の
   *  filter で resources subtree が decode できない場合に降格させる reason。 */
  | 'unsupported-resource-filter';

export type Fingerprint =
  | {
      kind: 'ok';
      hex: string;
      pageCount: number;
      algorithm: typeof HASH_ALGORITHM;
    }
  | {
      kind: 'unsupported';
      reason: UnsupportedReason;
      detail: string;
      algorithm: typeof HASH_ALGORITHM;
    };

/**
 * 1 つの PDF buffer から visual fingerprint を計算する。
 *
 * 同一プロセス内で 2 回呼んでも、別プロセスで生成して比較しても、
 * 描画同一の PDF からは同じ hex を返す (cross-process deterministic)。
 *
 * 異なる描画 (XObject 入替 / font 差替 / Rotate 変化 / CropBox 変化 / 同 operator
 * 列でも inline image data 差分) では異なる hex を返す (AC9-12 偽陽性防止)。
 */
export async function computePdfPageVisualFingerprint(
  pdfBuffer: Buffer
): Promise<Fingerprint> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(pdfBuffer, {
      throwOnInvalidObject: false,
      ignoreEncryption: true,
    });
  } catch (err) {
    return {
      kind: 'unsupported',
      reason: 'malformed',
      detail: `PDFDocument.load failed: ${(err as Error).message}`,
      algorithm: HASH_ALGORITHM,
    };
  }

  if (pdf.isEncrypted) {
    return {
      kind: 'unsupported',
      reason: 'encryption',
      detail: '/Encrypt entry present in trailer',
      algorithm: HASH_ALGORITHM,
    };
  }

  if (pdf.catalog.AcroForm() !== undefined) {
    return {
      kind: 'unsupported',
      reason: 'acroform',
      detail: '/AcroForm present in catalog (interactive form, repair requires manual review)',
      algorithm: HASH_ALGORITHM,
    };
  }

  if (pdf.catalog.get(PDFName.of('OCProperties')) !== undefined) {
    return {
      kind: 'unsupported',
      reason: 'optional-content',
      detail: '/OCProperties present in catalog (optional content / layers)',
      algorithm: HASH_ALGORITHM,
    };
  }

  const pageCount = pdf.getPageCount();
  const top = crypto.createHash('sha256');
  top.update(`alg=${HASH_ALGORITHM}|pages=${pageCount}`);

  for (let i = 0; i < pageCount; i++) {
    const node = pdf.getPage(i).node;

    // Codex Critical 反映: visible annotations は描画に影響するが Contents stream に
    // 乗らない (separate /Annots 配列 + appearance stream)。同 Contents/Resources で
    // annotation のみ違う PDF が偽 MatchedByHash になるリスクを排除するため unsupported。
    const annots = node.Annots();
    if (annots !== undefined && annots.size() > 0) {
      return {
        kind: 'unsupported',
        reason: 'annotations',
        detail: `page ${i} has ${annots.size()} annotation(s); cannot prove visual equivalence via fingerprint`,
        algorithm: HASH_ALGORITHM,
      };
    }

    // 1. decoded Contents bytes (正規化禁止)
    let contentBytes: Uint8Array;
    try {
      contentBytes = collectDecodedContentBytes(node.Contents(), pdf.context);
    } catch (err) {
      // Codex Important 反映: 画像 stream の decode 失敗 (DCTDecode/JPXDecode 等
      // pdf-lib 1.17.1 未対応 filter) は malformed ではなく unsupported-resource-filter
      // に降格させる。catch-all で computation-error にすると transient と誤分類される。
      const msg = (err as Error).message;
      if (isUnsupportedFilterError(msg)) {
        return {
          kind: 'unsupported',
          reason: 'unsupported-resource-filter',
          detail: `page ${i} content stream uses unsupported filter: ${msg}`,
          algorithm: HASH_ALGORITHM,
        };
      }
      return {
        kind: 'unsupported',
        reason: 'malformed',
        detail: `page ${i} content stream: ${msg}`,
        algorithm: HASH_ALGORITHM,
      };
    }
    top.update(`|page=${i}|content_len=${contentBytes.length}|content=`);
    top.update(Buffer.from(contentBytes));

    // 2. geometry
    // Codex Suggestion 反映: CropBox absent は PDF spec 上 MediaBox にフォールバックする。
    // absent と「CropBox==MediaBox 明示」は表示同一なので、effective crop を hash する。
    top.update('|media=');
    top.update(encodeRect(node.MediaBox(), pdf.context));
    const cropBox = node.CropBox();
    const effectiveCrop = cropBox ?? node.MediaBox();
    top.update('|effectiveCrop=');
    top.update(encodeRect(effectiveCrop, pdf.context));
    const rotate = node.Rotate();
    const rotateValue = rotate === undefined ? 0 : rotate.asNumber();
    top.update(`|rotate=${rotateValue}`);

    // Codex Important 反映: page-level visual entries の追加 /UserUnit, /Group。
    // /UserUnit は page size の実寸 (1.0 default), /Group は transparency blending。
    const userUnit = node.lookup(PDFName.of('UserUnit'));
    if (userUnit === undefined) {
      top.update('|userUnit=<absent>');
    } else if (userUnit instanceof PDFNumber) {
      top.update(`|userUnit=${userUnit.asNumber()}`);
    } else {
      top.update(`|userUnit=<unexpected:${userUnit.constructor.name}>`);
    }
    top.update('|group=');
    const group = node.lookup(PDFName.of('Group'));
    if (group === undefined) {
      top.update('<absent>');
    } else {
      try {
        top.update(canonicalDigest(group, pdf.context));
      } catch (err) {
        // silent-failure-hunter I1 反映: canonical digest 失敗は構造解析失敗 = malformed
        // 等価で扱う (transient computation-error に流すと operator が retry し続ける)
        const msg = (err as Error).message;
        return {
          kind: 'unsupported',
          reason: isUnsupportedFilterError(msg) ? 'unsupported-resource-filter' : 'malformed',
          detail: `page ${i} /Group canonical digest failed: ${msg}`,
          algorithm: HASH_ALGORITHM,
        };
      }
    }

    // 3. Resources canonical digest
    top.update('|resources=');
    const resources = node.Resources();
    if (resources === undefined) {
      top.update('<absent>');
    } else {
      try {
        const resourcesDigest = canonicalDigest(resources, pdf.context);
        top.update(resourcesDigest);
      } catch (err) {
        // silent-failure-hunter I1 + Codex Important 反映: resources subtree の decode
        // 失敗 (image XObject の DCTDecode 等) は unsupported-resource-filter、その他の
        // 構造解析失敗は malformed として returning unsupported (catch-all 不発防止)。
        const msg = (err as Error).message;
        return {
          kind: 'unsupported',
          reason: isUnsupportedFilterError(msg) ? 'unsupported-resource-filter' : 'malformed',
          detail: `page ${i} resources canonical digest failed: ${msg}`,
          algorithm: HASH_ALGORITHM,
        };
      }
    }
  }

  return {
    kind: 'ok',
    hex: top.digest('hex'),
    pageCount,
    algorithm: HASH_ALGORITHM,
  };
}

/**
 * pdf-lib `decodePDFRawStream` が UnsupportedEncodingError を投げるパターンを判定する。
 * DCTDecode / JPXDecode / CCITTFaxDecode / JBIG2Decode 等の画像 filter のほか、不明
 * filter も含む。本判定は pdf-lib 内部メッセージに依存するため lock test で固定する。
 */
function isUnsupportedFilterError(message: string): boolean {
  return (
    message.includes('UnsupportedEncoding') ||
    message.includes('DCTDecode') ||
    message.includes('JPXDecode') ||
    message.includes('CCITTFaxDecode') ||
    message.includes('JBIG2Decode') ||
    message.includes('Crypt') ||
    message.includes('unknown filter') ||
    message.includes('Unknown filter')
  );
}

/**
 * page.node.Contents() の戻り (PDFStream | PDFArray | undefined) を decoded bytes
 * の連結に変換する。PDFArray の場合は各要素を 0x0a で区切る (PDF spec の content
 * stream concat と等価)。
 */
function collectDecodedContentBytes(
  contents: PDFStream | PDFArray | undefined,
  context: PDFContext
): Uint8Array {
  if (contents === undefined) return new Uint8Array(0);
  if (contents instanceof PDFArray) {
    const parts: Buffer[] = [];
    const size = contents.size();
    for (let i = 0; i < size; i++) {
      const elem = contents.get(i);
      const resolved = resolveStream(elem, context);
      parts.push(Buffer.from(decodeStreamBytes(resolved)));
      if (i + 1 < size) parts.push(Buffer.from([0x0a]));
    }
    return Buffer.concat(parts);
  }
  if (contents instanceof PDFStream) {
    return decodeStreamBytes(contents);
  }
  throw new Error(
    `unexpected Contents type: ${(contents as PDFObject).constructor.name}`
  );
}

function resolveStream(obj: PDFObject, context: PDFContext): PDFStream {
  const resolved = obj instanceof PDFRef ? context.lookup(obj) : obj;
  if (!(resolved instanceof PDFStream)) {
    throw new Error(
      `expected PDFStream, got ${resolved?.constructor.name ?? 'undefined'}`
    );
  }
  return resolved;
}

function decodeStreamBytes(stream: PDFStream): Uint8Array {
  if (stream instanceof PDFRawStream) {
    // decodePDFRawStream は StreamType を返す。decode() で filter 解除後の bytes を取り出す。
    return decodePDFRawStream(stream).decode();
  }
  // PDFFlateStream 等 (新規生成側) は内部で encoded bytes を保持しており getContents() は
  // filter 適用後の raw bytes を返す。decoded 表現で比較したいので無変換のまま使う
  // (生成側の content stream は uncompressed のため filter 解除は同値).
  return stream.getContents();
}

/**
 * MediaBox / CropBox 等の rectangle PDFArray を bytes に変換する。
 * indirect ref を含む可能性に備えて resolve しつつ、数値の文字列化は元の
 * decimal 表現を尊重 (PDFNumber.asNumber() は number、文字列化は toString)。
 */
function encodeRect(arr: PDFArray, context: PDFContext): Buffer {
  const parts: string[] = [];
  const size = arr.size();
  for (let i = 0; i < size; i++) {
    const elem = arr.get(i);
    const resolved = elem instanceof PDFRef ? context.lookup(elem) : elem;
    if (resolved instanceof PDFNumber) {
      parts.push(String(resolved.asNumber()));
    } else {
      parts.push(`<${resolved?.constructor.name ?? 'undefined'}>`);
    }
  }
  return Buffer.from(parts.join(','));
}

/**
 * PDFObject の canonical digest を返す。Resources subtree 等を再帰的に hash 化。
 *
 * - PDFDict: entries を name 文字列 sort してから recurse (V8 iteration order 差吸収)
 * - PDFArray: 順序保持して recurse (PDF semantically order-sensitive)
 * - PDFRef: recursion stack 上の循環のみ cycle marker、stack 外の共有参照は通常 recurse
 *   (Codex Important 反映: 旧版は traversal 全体共有 Set だったため、sibling 経由の共有参照
 *    で object number が hash に混入 → cross-process determinism が弱くなっていた)
 * - PDFStream: dict subtree + decoded bytes (filter 不可なら caller に throw、上位で
 *   unsupported-resource-filter に降格)
 * - その他 scalar: 型 prefix + 値 string
 */
export function canonicalDigest(obj: PDFObject, context: PDFContext): Buffer {
  const sha = crypto.createHash('sha256');
  walk(sha, obj, context, new Set<PDFRef>());
  return sha.digest();
}

function walk(
  sha: crypto.Hash,
  obj: PDFObject,
  context: PDFContext,
  recursionStack: Set<PDFRef>
): void {
  if (obj instanceof PDFRef) {
    if (recursionStack.has(obj)) {
      // 真の循環参照のみ stable cycle marker (object number は意図的に含めない =
      // cross-process determinism のため)
      sha.update('ref-cycle');
      return;
    }
    recursionStack.add(obj);
    try {
      const resolved = context.lookup(obj);
      sha.update('ref|');
      if (resolved === undefined) {
        sha.update('<undefined>');
      } else {
        walk(sha, resolved, context, recursionStack);
      }
    } finally {
      // recursion stack から外し、sibling 経由で同 ref が再出現したら通常 recurse
      recursionStack.delete(obj);
    }
    return;
  }
  if (obj instanceof PDFDict) {
    const entries = [...obj.entries()];
    // Critical (code-reviewer PR #441 review): localeCompare は OS locale / ICU データ版
    // 依存で cross-machine non-deterministic。byte-order 比較に置換して classify
    // (e.g. ja_JP な開発機) と execute (e.g. C な GitHub Actions) で同 hex を保証。
    entries.sort((a, b) => {
      const sa = a[0].asString();
      const sb = b[0].asString();
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
    sha.update(`dict|size=${entries.length}`);
    for (const [k, v] of entries) {
      sha.update('|key=');
      sha.update(k.asString());
      sha.update('|val=');
      walk(sha, v, context, recursionStack);
    }
    return;
  }
  if (obj instanceof PDFArray) {
    const size = obj.size();
    sha.update(`array|size=${size}`);
    for (let i = 0; i < size; i++) {
      sha.update('|');
      walk(sha, obj.get(i), context, recursionStack);
    }
    return;
  }
  if (obj instanceof PDFStream) {
    sha.update('stream|dict=');
    walk(sha, obj.dict, context, recursionStack);
    const bytes = decodeStreamBytes(obj);
    sha.update(`|bytes_len=${bytes.length}|bytes=`);
    sha.update(Buffer.from(bytes));
    return;
  }
  if (obj instanceof PDFName) {
    sha.update('name|');
    sha.update(obj.asString());
    return;
  }
  if (obj instanceof PDFNumber) {
    sha.update('num|');
    sha.update(String(obj.asNumber()));
    return;
  }
  if (obj instanceof PDFString) {
    sha.update('str|');
    sha.update(obj.asString());
    return;
  }
  if (obj instanceof PDFHexString) {
    sha.update('hex|');
    sha.update(Buffer.from(obj.asBytes()));
    return;
  }
  if (obj instanceof PDFBool) {
    sha.update('bool|');
    sha.update(obj.asBoolean() ? '1' : '0');
    return;
  }
  if ((obj as unknown) === (PDFNull as unknown)) {
    sha.update('null');
    return;
  }
  sha.update('unknown|');
  sha.update(obj.constructor.name);
}
