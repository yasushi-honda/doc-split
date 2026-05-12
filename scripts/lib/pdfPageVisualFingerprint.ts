/**
 * Issue #432 PR-C3b: PDF page visual fingerprint v2 (cross-process deterministic).
 *
 * pdf-lib `PDFDocument.save()` は同一プロセス内 deterministic だがプロセス間で
 * 非決定 (PDF `/ID` random、internal metadata) のため、sha256(raw bytes) 比較は
 * MatchedByHash を成立させない (PR-C1 session59 で発覚)。本モジュールは PDF の
 * 「描画同一性」を以下の要素で表現する fingerprint hex を返す:
 *   1. 各ページの decoded Contents bytes (正規化禁止、Codex Critical 2 反映)
 *   2. 各ページの geometry (MediaBox / CropBox / Rotate / UserUnit / Group)
 *   3. 各ページが参照する Resources (Font / XObject / ExtGState / ColorSpace
 *      / Pattern / Shading / ProcSet) の canonical digest
 *
 * v2 変更点 (PR-C3b、AC21 反映):
 *   - Image XObject (Subtype /Image) で unsupported filter (CCITT/JBIG2/JPX/DCT/Crypt)
 *     を含む stream は **encoded bytes** で hash (decode 不要、kanameone CCITT scan
 *     書類 unblock)。他 stream は v1 同様 decoded canonical
 *   - 各 stream に mode='encoded'|'decoded' タグを hash に含め、両者を区別
 *   - Catalog/Info metadata + Trailer /ID の denylist (常時除外)
 *   - 内部参照 scope 限定 denylist:
 *     - /Parent: PDFDict /Type=/Page or /Type=/Pages のみ除外
 *     - /First /Last /Prev /Next: PDFDict /Type=/Outlines or /Type=/Outline のみ除外
 *   - 未知 key は denylist 対象外として hash に含める (描画影響あり前提の安全側)
 *
 * Codex Critical (PR-C2 v2 計画、v1 から継承):
 *   - PDFPage.node.normalizedEntries() は副作用 (push/pop graphics state stream
 *     追加 + Resources/Annots 補完) のため使用禁止 → page.node.Contents() 直接読み
 *     + PDFArray / PDFStream / PDFRawStream 明示処理
 *   - whitespace / operator 順 / 数値表記 を正規化しない (inline image data 破壊
 *     リスク + graphics state 順序依存 = 偽陽性増加)
 *   - PDFDict entries は name 文字列 byte-order sort で V8 iteration order 差 +
 *     locale 依存性 (ja_JP vs C) を吸収
 *
 * Unsupported features (Ambiguous フォールバック):
 *   - /Encrypt → unsupported.encryption
 *   - /AcroForm → unsupported.acroform
 *   - /OCProperties → unsupported.optional-content
 *   - 復元不能 PDF load 例外 → unsupported.malformed
 *   - visible annotations → unsupported.annotations (appearance stream は別途 PR-C3c で検討)
 *
 * Algorithm version: 'pdf-page-visual-v2'。precondition snapshot + execute 側
 * 固定値で照合し、mismatch なら gate reject (AC13)。
 *
 * Internal API lock (AC14): pdf-lib の以下を直接利用しているため、test で
 * 存在をアサートする:
 *   - decodePDFRawStream (named export)
 *   - PDFRawStream (named export, instanceof check + .contents access 用)
 *   - PDFPageLeaf.Contents() / Resources() / MediaBox() / CropBox() / Rotate()
 *   - PDFDict.entries() / PDFDict.get()
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
  UnsupportedEncodingError,
  decodePDFRawStream,
} from 'pdf-lib';
import * as crypto from 'crypto';

export const HASH_ALGORITHM = 'pdf-page-visual-v2';

/**
 * Catalog/Info dict / Metadata stream の metadata + Trailer /ID。
 *
 * これらは PDF 生成時の timestamp / 製作者識別 / random ID であり、描画同一性に
 * 寄与しない。**dict の /Type が /Catalog or /Metadata に限定して** 除外する
 * (Codex review #019e1e54 Important 4 反映: 全 dict に適用すると Resources 配下
 * の `/Title` 等が誤って落ちる、AC21「未知 key 包含」と衝突)。`PDFName.asString()`
 * は先頭 `/` 付きで返るため、key も `/` 付きで保持する。
 *
 * 注: 本 fingerprint の walk は Resources subtree を root にしており、Info /
 * Catalog dict / Metadata stream には到達しない構造。よって scope 限定の denylist
 * 適用は実質 no-op だが、将来 walk scope を拡張した際の cross-process determinism
 * 保護として残す (defensive)。
 */
const CATALOG_INFO_METADATA_DENYLIST = new Set([
  '/Author',
  '/CreationDate',
  '/ModDate',
  '/Creator',
  '/Producer',
  '/Title',
  '/Subject',
  '/Keywords',
  '/Trapped',
  '/ID',
]);

/** Page tree 構造的内部参照。/Type=/Page or /Type=/Pages の dict 内のみ除外。 */
const PAGE_TREE_SCOPED_DENYLIST = new Set(['/Parent']);

/** Outline tree 構造的内部参照。/Type=/Outlines or /Type=/Outline の dict 内のみ除外。 */
const OUTLINE_SCOPED_DENYLIST = new Set(['/First', '/Last', '/Prev', '/Next']);

/**
 * decodePDFRawStream() で UnsupportedEncodingError が出る filter 群。
 *
 * 画像系 (CCITT/JBIG2/JPX/DCT) と /Crypt は pdf-lib 1.17.1 が decode 未対応。
 * v2 では「decode せず encoded bytes を hash」して降格を避ける。
 */
const UNSUPPORTED_DECODE_FILTERS = new Set([
  '/CCITTFaxDecode',
  '/JBIG2Decode',
  '/JPXDecode',
  '/DCTDecode',
  '/Crypt',
]);

export type UnsupportedReason =
  | 'encryption'
  | 'acroform'
  | 'optional-content'
  | 'malformed'
  /** Codex Critical 反映: visible annotations は描画に影響するが Contents stream に
   *  乗らない (別 dict / appearance stream)。安全側で自動復旧対象外に倒す。 */
  | 'annotations';

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
 *
 * v2: image XObject の CCITT/JBIG2/JPX/DCT filter も encoded bytes で hash 可能。
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
    // v2 で appearance stream hashing 追加検討は PR-C3c 以降 (本 PR では v1 挙動維持)。
    const annots = node.Annots();
    if (annots !== undefined && annots.size() > 0) {
      return {
        kind: 'unsupported',
        reason: 'annotations',
        detail: `page ${i} has ${annots.size()} annotation(s); cannot prove visual equivalence via fingerprint`,
        algorithm: HASH_ALGORITHM,
      };
    }

    // 1. Contents bytes (page-level content stream は decoded canonical; FlateDecode のみ)
    let contentBytes: Uint8Array;
    try {
      contentBytes = collectDecodedContentBytes(node.Contents(), pdf.context);
    } catch (err) {
      // content stream は通常 FlateDecode (pdf-lib 標準) のため、decode 失敗 = malformed
      // と等価で扱う (CCITT 等 image filter は content stream ではなく XObject 配下なので
      // ここには来ない)。
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
      // canonical digest 失敗は構造解析失敗 = malformed (v2 は image filter は encoded bytes
      // で吸収するため canonical digest 失敗は本物の構造異常のみ)
      try {
        top.update(canonicalDigest(group, pdf.context));
      } catch (err) {
        return {
          kind: 'unsupported',
          reason: 'malformed',
          detail: `page ${i} /Group canonical digest failed: ${(err as Error).message}`,
          algorithm: HASH_ALGORITHM,
        };
      }
    }

    // 3. Resources canonical digest (v2: image filter は encoded bytes で吸収)
    top.update('|resources=');
    const resources = node.Resources();
    if (resources === undefined) {
      top.update('<absent>');
    } else {
      try {
        const resourcesDigest = canonicalDigest(resources, pdf.context);
        top.update(resourcesDigest);
      } catch (err) {
        return {
          kind: 'unsupported',
          reason: 'malformed',
          detail: `page ${i} resources canonical digest failed: ${(err as Error).message}`,
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
 * page.node.Contents() の戻り (PDFStream | PDFArray | undefined) を decoded bytes
 * の連結に変換する。PDFArray の場合は各要素を 0x0a で区切る (PDF spec の content
 * stream concat と等価)。
 *
 * page-level content stream は通常 FlateDecode (pdf-lib 標準) または filter なし。
 * CCITT/JBIG2/JPX 等 image filter は image XObject 配下にあり content stream には来ないため、
 * ここでは強制 decode する (失敗 = malformed)。
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
      parts.push(Buffer.from(decodeContentStream(resolved)));
      if (i + 1 < size) parts.push(Buffer.from([0x0a]));
    }
    return Buffer.concat(parts);
  }
  if (contents instanceof PDFStream) {
    return decodeContentStream(contents);
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

/**
 * content stream 専用 decode (FlateDecode 前提)。decode 失敗は throw → caller で malformed。
 */
function decodeContentStream(stream: PDFStream): Uint8Array {
  if (stream instanceof PDFRawStream) {
    return decodePDFRawStream(stream).decode();
  }
  return stream.getContents();
}

/**
 * 任意 PDFStream の hash 用 bytes を取得。v2 の核心 fallback:
 *
 *   1. PDFRawStream かつ stream.dict /Subtype === /Image かつ filter に unsupported
 *      (CCITT/JBIG2/JPX/DCT) を含む → encoded bytes (.contents) を返す (decode 不要)
 *   2. PDFRawStream で supported filter のみ → decode して decoded bytes を返す
 *   3. 非 PDFRawStream (pdf-lib 生成側) → stream.getContents() (filter 不適用後の bytes)
 *   4. decode 例外:
 *      a. UnsupportedEncodingError かつ stream.dict /Subtype === /Image
 *         → encoded bytes fallback (filter list に出ない future image encoding 吸収)
 *      b. UnsupportedEncodingError かつ /Subtype が /Image 以外
 *         → throw (例: /Crypt は stream 単位の暗号化レイヤーで「visual equivalence」
 *           とは別概念。encoded bytes で「偽 PASS」させると暗号化 stream が同 hex の
 *           可能性が出る。Codex review #019e1e54 Critical 2 反映)
 *      c. それ以外 (Flate 壊れ / OOM / internal API 仕様変更 等の本物の構造異常)
 *         → throw して caller (canonicalDigest の呼出元) で malformed 降格させる
 *         (silent-failure-hunter CRITICAL-1 反映: bare catch だと
 *         本物の構造異常を encoded bytes で「偽 PASS」させ MatchedByHash 誤判定の
 *         リスクが残るため、UnsupportedEncodingError specific の捕捉に限定する)
 *
 * 返り値 mode はそのまま hash に組み込み、 encoded と decoded を区別する。
 */
function getStreamBytesForHash(
  stream: PDFStream
): { mode: 'encoded' | 'decoded'; bytes: Uint8Array } {
  if (!(stream instanceof PDFRawStream)) {
    return { mode: 'decoded', bytes: stream.getContents() };
  }
  const filters = listStreamFilters(stream);
  const isImageXObject = isImageXObjectStream(stream);
  const hasUnsupportedDecode = filters.some((f) => UNSUPPORTED_DECODE_FILTERS.has(f));
  if (hasUnsupportedDecode) {
    if (!isImageXObject) {
      // Codex review Critical 2 反映: /Crypt 等 non-image unsupported filter の stream
      // は「visual equivalence」枠で encoded fallback してはならない (暗号化 stream
      // を可視 image stream と同列で hash すると偽 MatchedByHash の余地が出る)。
      // caller で malformed 降格させる。
      throw new Error(
        `getStreamBytesForHash: unsupported filter ${filters.join(',')} on non-image stream ` +
          `(subtype=${getStreamSubtype(stream) ?? '<missing>'}); refusing encoded fallback`
      );
    }
    return { mode: 'encoded', bytes: stream.contents };
  }
  try {
    return { mode: 'decoded', bytes: decodePDFRawStream(stream).decode() };
  } catch (err) {
    if (err instanceof UnsupportedEncodingError) {
      if (!isImageXObject) {
        // /Subtype が /Image 以外で未知 encoding 検出 → image visual equivalence の
        // 経路から外す (Codex Critical 2 反映、image XObject 以外は decode 不能 = 構造異常)
        throw new Error(
          `getStreamBytesForHash: pdf-lib UnsupportedEncodingError on non-image stream ` +
            `(subtype=${getStreamSubtype(stream) ?? '<missing>'}): ${err.message}`
        );
      }
      // image XObject に限定して、filter list から漏れた future encoding を吸収。
      return { mode: 'encoded', bytes: stream.contents };
    }
    // 本物の構造異常 (Flate 壊れ / RangeError / TypeError / pdf-lib upgrade 仕様変更等)
    // は throw して caller で unsupported.malformed に降格させる。
    throw new Error(
      `getStreamBytesForHash: unexpected decode error (filters=${filters.join(
        ','
      )}): ${(err as Error).message}`
    );
  }
}

function getStreamSubtype(stream: PDFStream): string | null {
  const entry = stream.dict.get(PDFName.of('Subtype'));
  return entry instanceof PDFName ? entry.asString() : null;
}

function isImageXObjectStream(stream: PDFStream): boolean {
  const subtype = getStreamSubtype(stream);
  if (subtype !== '/Image') return false;
  const type = stream.dict.get(PDFName.of('Type'));
  // /Type=/XObject 明示 or /Type 省略 (PDF spec 上 /Subtype /Image があれば /XObject
  // とみなせる慣用) のいずれかを許容
  if (type === undefined) return true;
  return type instanceof PDFName && type.asString() === '/XObject';
}

function listStreamFilters(stream: PDFStream): string[] {
  const filterEntry = stream.dict.get(PDFName.of('Filter'));
  if (filterEntry === undefined) return [];
  if (filterEntry instanceof PDFName) return [filterEntry.asString()];
  if (filterEntry instanceof PDFArray) {
    const out: string[] = [];
    for (let i = 0; i < filterEntry.size(); i++) {
      const elem = filterEntry.get(i);
      if (elem instanceof PDFName) out.push(elem.asString());
      else out.push(`<unexpected:${elem?.constructor.name ?? 'undefined'}>`);
    }
    return out;
  }
  return [`<unexpected:${(filterEntry as PDFObject).constructor.name}>`];
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
 *   - METADATA_DENYLIST に含まれる key は常時除外 (cross-process determinism + 描画
 *     非寄与)
 *   - dict の /Type が /Page or /Pages なら PAGE_TREE_SCOPED_DENYLIST 適用
 *   - dict の /Type が /Outlines or /Outline なら OUTLINE_SCOPED_DENYLIST 適用
 *   - 未知 key は denylist 対象外 (描画影響あり前提の安全側)
 * - PDFArray: 順序保持して recurse (PDF semantically order-sensitive)
 * - PDFRef: recursion stack 上の循環のみ cycle marker、stack 外の共有参照は通常 recurse
 *   (Codex Important 反映: 旧版は traversal 全体共有 Set だったため、sibling 経由の共有参照
 *    で object number が hash に混入 → cross-process determinism が弱くなっていた)
 * - PDFStream: dict subtree + (encoded|decoded) bytes (v2 image filter 吸収)
 * - その他 scalar: 型 prefix + 値 string
 */
export function canonicalDigest(obj: PDFObject, context: PDFContext): Buffer {
  const sha = crypto.createHash('sha256');
  walk(sha, obj, context, new Set<PDFRef>());
  return sha.digest();
}

function getScopedDenylists(dict: PDFDict): ReadonlyArray<Set<string>> {
  const type = dict.get(PDFName.of('Type'));
  if (!(type instanceof PDFName)) return [];
  const typeName = type.asString();
  const out: Array<Set<string>> = [];
  if (typeName === '/Page' || typeName === '/Pages') out.push(PAGE_TREE_SCOPED_DENYLIST);
  if (typeName === '/Outlines' || typeName === '/Outline') out.push(OUTLINE_SCOPED_DENYLIST);
  if (typeName === '/Catalog' || typeName === '/Metadata') {
    out.push(CATALOG_INFO_METADATA_DENYLIST);
  }
  return out;
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
    const scopedDenylists = getScopedDenylists(obj);
    const filteredEntries: Array<[PDFName, PDFObject]> = [];
    for (const [k, v] of obj.entries()) {
      const key = k.asString();
      if (scopedDenylists.some((dl) => dl.has(key))) continue;
      filteredEntries.push([k, v]);
    }
    // Critical (code-reviewer PR #441 review): localeCompare は OS locale / ICU データ版
    // 依存で cross-machine non-deterministic。byte-order 比較に置換して classify
    // (e.g. ja_JP な開発機) と execute (e.g. C な GitHub Actions) で同 hex を保証。
    filteredEntries.sort((a, b) => {
      const sa = a[0].asString();
      const sb = b[0].asString();
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
    sha.update(`dict|size=${filteredEntries.length}`);
    for (const [k, v] of filteredEntries) {
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
    const { mode, bytes } = getStreamBytesForHash(obj);
    sha.update(`|mode=${mode}|bytes_len=${bytes.length}|bytes=`);
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
