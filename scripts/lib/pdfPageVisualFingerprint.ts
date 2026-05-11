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
  | 'malformed';

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

    // 1. decoded Contents bytes (正規化禁止)
    let contentBytes: Uint8Array;
    try {
      contentBytes = collectDecodedContentBytes(node.Contents(), pdf.context);
    } catch (err) {
      return {
        kind: 'unsupported',
        reason: 'malformed',
        detail: `page ${i} content stream: ${(err as Error).message}`,
        algorithm: HASH_ALGORITHM,
      };
    }
    top.update(`|page=${i}|content_len=${contentBytes.length}|content=`);
    top.update(Buffer.from(contentBytes));

    // 2. geometry
    top.update('|media=');
    top.update(encodeRect(node.MediaBox(), pdf.context));
    const cropBox = node.CropBox();
    top.update('|crop=');
    top.update(cropBox === undefined ? '<absent>' : encodeRect(cropBox, pdf.context));
    const rotate = node.Rotate();
    const rotateValue = rotate === undefined ? 0 : rotate.asNumber();
    top.update(`|rotate=${rotateValue}`);

    // 3. Resources canonical digest
    top.update('|resources=');
    const resources = node.Resources();
    if (resources === undefined) {
      top.update('<absent>');
    } else {
      const resourcesDigest = canonicalDigest(resources, pdf.context);
      top.update(resourcesDigest);
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
 * - PDFRef: 循環防止 + lookup して resolve した先を recurse
 * - PDFStream: dict subtree + decoded bytes
 * - その他 scalar: 型 prefix + 値 string
 *
 * 循環 ref を visited で検出 (PDFRef は pdf-lib 側で同一識別子を共有 instance に
 * 解決される設計のため Set<PDFRef> で識別可能)。
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
  visited: Set<PDFRef>
): void {
  if (obj instanceof PDFRef) {
    if (visited.has(obj)) {
      sha.update(`ref-cycle|${obj.objectNumber}|${obj.generationNumber}`);
      return;
    }
    visited.add(obj);
    const resolved = context.lookup(obj);
    sha.update('ref|');
    if (resolved === undefined) {
      sha.update('<undefined>');
    } else {
      walk(sha, resolved, context, visited);
    }
    return;
  }
  if (obj instanceof PDFDict) {
    const entries = [...obj.entries()];
    entries.sort((a, b) => a[0].asString().localeCompare(b[0].asString()));
    sha.update(`dict|size=${entries.length}`);
    for (const [k, v] of entries) {
      sha.update('|key=');
      sha.update(k.asString());
      sha.update('|val=');
      walk(sha, v, context, visited);
    }
    return;
  }
  if (obj instanceof PDFArray) {
    const size = obj.size();
    sha.update(`array|size=${size}`);
    for (let i = 0; i < size; i++) {
      sha.update('|');
      walk(sha, obj.get(i), context, visited);
    }
    return;
  }
  if (obj instanceof PDFStream) {
    sha.update('stream|dict=');
    walk(sha, obj.dict, context, visited);
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
