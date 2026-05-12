#!/usr/bin/env ts-node
/**
 * Issue #432 PR-C3a: PDF feature survey (read-only).
 *
 * 目的 (Codex MCP セカンドオピニオン #2 Critical AC20 反映):
 *   - 本番 PDF の `/Resources/XObject/<name>/Filter` 分布を事前列挙し、classify 着手前に
 *     未対応 filter (CCITT/JBIG2/JPX/encrypted 等) の存在を検出する
 *   - fixture が実際にターゲット filter を含むかを assert する (AC20: 人工 fixture の
 *     feature assert + 生成不能 feature の synthetic 補完)
 *   - PR-C3c の classify gate (AC15: feature survey → classify の workflow guard) で
 *     必須入力として artifact 化する
 *
 * 副作用なし: PDF を download/read するのみで Firestore / Storage への書き込みは行わない。
 * Cloud Logging / GCS audit log にのみ read アクセスが記録される。
 *
 * 使用方法:
 *   # local fixture survey
 *   ts-node scripts/pdf-feature-survey.ts --source local --paths fixture-a.pdf,fixture-b.pdf --out survey.json
 *
 *   # GCS bucket scan (CI 経由、ADC は workflow で setup)
 *   FIREBASE_PROJECT_ID=doc-split-dev STORAGE_BUCKET=doc-split-dev.firebasestorage.app \
 *     ts-node scripts/pdf-feature-survey.ts --source gcs --prefix processed/ --limit 200 --out survey.json
 *
 * 出力 (JSON):
 *   {
 *     summary: {
 *       totalFiles, scannedFiles, errors,
 *       byCatalogFlag: { encrypted, acroform, optionalContent, ... },
 *       byPageFeature: { hasAnnotations, hasGroup, hasUserUnit, ... },
 *       byXObjectFilter: { '/DCTDecode': N, '/CCITTFaxDecode': N, ... },
 *       byContentFilter: { '/FlateDecode': N, ... },
 *       byUnknownFilter: { '/MyCustomFilter': N, ... }
 *     },
 *     files: [
 *       { path, sizeBytes, pageCount, catalogFlags, pages: [{ pageIndex, filters, hasAnnots, ... }], errors }
 *     ],
 *     expectations: {                          // PR-C3b (AC20 strict guard): --expect-* で渡された期待値
 *       filters: string[],                     // --expect-filter で指定された filter (例: ['/CCITTFaxDecode'])
 *       subtypes: string[],                    // --expect-subtype で指定された XObject subtype
 *       encrypted: boolean,                    // --expect-encrypted が指定されたか
 *       acroform: boolean,                     // --expect-acroform が指定されたか
 *       failures: string[]                     // 満たされなかった期待値の説明 (空 = 全 satisfy、exit 0)
 *     }
 *   }
 *
 * 期待値 (expectations.failures) が 1 件以上ある場合は exit 1。
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import {
  PDFArray,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFStream,
} from 'pdf-lib';

interface CliOptions {
  source: 'local' | 'gcs';
  paths: string[];
  bucket: string | null;
  prefix: string;
  limit: number;
  out: string | null;
  /** AC20 strict guard (PR-C3b): 指定 filter が survey 結果の byXObjectFilter or
   *  byContentFilter のいずれにも含まれない場合 exit 1。fixture が実際に該当 filter
   *  を持つことを CI で fail-fast assert する。空配列は guard 無効化。 */
  expectFilter: string[];
  /** AC20 strict guard: 指定 XObject subtype (例 /Image /Form) が byXObjectSubtype
   *  に含まれない場合 exit 1。fixture が image XObject 構造を持つことを assert。 */
  expectSubtype: string[];
  /** AC20 strict guard: encrypted catalog flag が 1 件以上検出されない場合 exit 1。 */
  expectEncrypted: boolean;
  /** AC20 strict guard: acroform catalog flag が 1 件以上検出されない場合 exit 1。 */
  expectAcroform: boolean;
}

interface CatalogFlags {
  encrypted: boolean;
  hasAcroForm: boolean;
  hasOpenAction: boolean;
  hasOCProperties: boolean;
  hasMetadata: boolean;
  hasOutlines: boolean;
}

interface PageFeature {
  pageIndex: number;
  hasAnnots: boolean;
  annotsCount: number;
  hasGroup: boolean;
  hasUserUnit: boolean;
  contentFilters: string[];
  xobjectSummary: XObjectEntrySummary[];
  extGStateNames: string[];
  patternNames: string[];
  shadingNames: string[];
  fontNames: string[];
  colorSpaceNames: string[];
  errors: string[];
}

interface XObjectEntrySummary {
  name: string;
  subtype: string;
  filters: string[];
  decodeParmsKeys: string[];
  width: number | null;
  height: number | null;
  bitsPerComponent: number | null;
  colorSpaceKind: string | null;
  hasSMask: boolean;
  hasMask: boolean;
  hasMatte: boolean;
  hasSMaskInData: boolean;
  hasAlternates: boolean;
  hasOPI: boolean;
  hasInterpolate: boolean;
  hasIntent: boolean;
  resolvedVia: 'inline' | 'indirect';
}

interface FileResult {
  path: string;
  sizeBytes: number;
  pageCount: number | null;
  catalogFlags: CatalogFlags | null;
  pages: PageFeature[];
  errors: string[];
}

interface SurveySummary {
  totalFiles: number;
  scannedFiles: number;
  filesWithErrors: number;
  byCatalogFlag: Record<string, number>;
  byPageFeature: Record<string, number>;
  byXObjectFilter: Record<string, number>;
  byContentFilter: Record<string, number>;
  byUnknownFilter: Record<string, number>;
  byXObjectSubtype: Record<string, number>;
}

const KNOWN_FILTERS = new Set([
  '/ASCIIHexDecode',
  '/ASCII85Decode',
  '/LZWDecode',
  '/FlateDecode',
  '/RunLengthDecode',
  '/CCITTFaxDecode',
  '/JBIG2Decode',
  '/DCTDecode',
  '/JPXDecode',
  '/Crypt',
]);

function requireValue(arg: string, next: string | undefined): string {
  if (next === undefined) throw new Error(`${arg} requires a value`);
  return next;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    source: 'local',
    paths: [],
    bucket: null,
    prefix: '',
    limit: 0,
    out: null,
    expectFilter: [],
    expectSubtype: [],
    expectEncrypted: false,
    expectAcroform: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--source': {
        const v = requireValue(arg, next);
        if (v !== 'local' && v !== 'gcs') {
          throw new Error(`--source must be local or gcs, got ${v}`);
        }
        opts.source = v;
        i++;
        break;
      }
      case '--paths':
        opts.paths = requireValue(arg, next).split(',').map((s) => s.trim()).filter(Boolean);
        i++;
        break;
      case '--bucket':
        opts.bucket = requireValue(arg, next);
        i++;
        break;
      case '--prefix':
        opts.prefix = requireValue(arg, next);
        i++;
        break;
      case '--limit': {
        const n = Number.parseInt(requireValue(arg, next), 10);
        if (Number.isNaN(n) || n < 0) throw new Error(`--limit must be a non-negative integer, got ${next}`);
        opts.limit = n;
        i++;
        break;
      }
      case '--out':
        opts.out = requireValue(arg, next);
        i++;
        break;
      case '--expect-filter':
        opts.expectFilter = requireValue(arg, next).split(',').map((s) => s.trim()).filter(Boolean);
        i++;
        break;
      case '--expect-subtype':
        opts.expectSubtype = requireValue(arg, next).split(',').map((s) => s.trim()).filter(Boolean);
        i++;
        break;
      case '--expect-encrypted':
        opts.expectEncrypted = true;
        break;
      case '--expect-acroform':
        opts.expectAcroform = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  return opts;
}

function printUsage(): void {
  console.log(
    [
      'Usage: ts-node scripts/pdf-feature-survey.ts [options]',
      '',
      'Options:',
      '  --source local|gcs        scan local files or GCS bucket (default: local)',
      '  --paths a.pdf,b.pdf       comma-separated local file paths (local mode)',
      '  --bucket NAME             GCS bucket (gcs mode, default: env STORAGE_BUCKET)',
      '  --prefix path/            GCS object prefix (gcs mode)',
      '  --limit N                 max files to scan (0 = unlimited)',
      '  --out PATH                write JSON output to PATH (default: stdout)',
      '',
      'Strict guard options (PR-C3b, AC20 fail-fast assert; exit 1 if any not met):',
      '  --expect-filter LIST      comma-separated /Filter names that MUST be detected',
      '                            (e.g. /CCITTFaxDecode,/JBIG2Decode); matched against',
      '                            byXObjectFilter ∪ byContentFilter',
      '  --expect-subtype LIST     comma-separated XObject /Subtype names (e.g. /Image)',
      '  --expect-encrypted        require at least 1 file with isEncrypted=true',
      '  --expect-acroform         require at least 1 file with /AcroForm present',
    ].join('\n')
  );
}

function makeErrorResult(p: string, msg: string): FileResult {
  return {
    path: p,
    sizeBytes: 0,
    pageCount: null,
    catalogFlags: null,
    pages: [],
    errors: [msg],
  };
}

/**
 * Survey local PDF paths. Files / directories と path 単位で混在可。
 *
 * ディレクトリは **直下のみ** scan する (非再帰)。nested 構造に PDF を置く場合は
 * caller が path を列挙して渡す。stat / readdir / readFile の error は abort せず
 * 個別 FileResult.errors に伝播するため、bad path が混じっても他の path は survey 継続。
 */
async function surveyLocalPaths(paths: string[]): Promise<FileResult[]> {
  const results: FileResult[] = [];
  const targets: string[] = [];
  for (const p of paths) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(p);
    } catch (err) {
      results.push(makeErrorResult(p, `stat failed: ${(err as Error).message}`));
      continue;
    }
    if (stat.isDirectory()) {
      let entries: string[];
      try {
        entries = fs.readdirSync(p);
      } catch (err) {
        results.push(makeErrorResult(p, `readdir failed: ${(err as Error).message}`));
        continue;
      }
      for (const entry of entries) {
        if (entry.toLowerCase().endsWith('.pdf')) targets.push(path.join(p, entry));
      }
    } else {
      targets.push(p);
    }
  }
  for (const t of targets) {
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(t);
    } catch (err) {
      results.push(makeErrorResult(t, `read failed: ${(err as Error).message}`));
      continue;
    }
    results.push(await surveyFile({ path: t, buffer }));
  }
  return results;
}

const GCS_PAGE_SIZE = 1000;
const GCS_DOWNLOAD_CONCURRENCY = 8;

/**
 * GCS 上の PDF を pagination + 並列 download で survey する。
 *
 * 設計 (simplify review 反映):
 *   - `autoPaginate: false` + pageToken loop で listing を明示制御 (既存
 *     classify-collision-docs.ts / audit-storage-mismatch.js の pattern と統一)
 *   - download を 8 並列にし、buffer を保持せず即 surveyFile → FileResult のみ蓄積
 *     (kanameone ~数千 PDF で OOM 防止、本番影響)
 *   - download/survey 失敗は FileResult.errors に伝播 (artifact JSON に残す)
 *   - server-side で limit を満たした時点で list を打ち切り、無駄な metadata fetch を回避
 */
async function surveyGcs(bucketName: string, prefix: string, limit: number): Promise<FileResult[]> {
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: bucketName,
    });
  }
  const bucket = admin.storage().bucket(bucketName);

  const targets: string[] = [];
  let pageToken: string | undefined;
  do {
    const [files, nextQuery] = await bucket.getFiles({
      prefix,
      maxResults: GCS_PAGE_SIZE,
      pageToken,
      autoPaginate: false,
    });
    for (const f of files) {
      if (!f.name.toLowerCase().endsWith('.pdf')) continue;
      targets.push(f.name);
      if (limit > 0 && targets.length >= limit) break;
    }
    if (limit > 0 && targets.length >= limit) break;
    pageToken = (nextQuery as { pageToken?: string } | undefined)?.pageToken;
  } while (pageToken);

  console.error(`scanning ${targets.length} PDF(s) from gs://${bucketName}/${prefix}...`);

  const results: FileResult[] = [];
  for (let i = 0; i < targets.length; i += GCS_DOWNLOAD_CONCURRENCY) {
    const batch = targets.slice(i, i + GCS_DOWNLOAD_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (name) => {
        const fullPath = `gs://${bucketName}/${name}`;
        try {
          const [buf] = await bucket.file(name).download();
          return await surveyFile({ path: fullPath, buffer: buf });
        } catch (err) {
          return {
            path: fullPath,
            sizeBytes: 0,
            pageCount: null,
            catalogFlags: null,
            pages: [],
            errors: [`gcs download failed: ${(err as Error).message}`],
          } as FileResult;
        }
      })
    );
    results.push(...batchResults);
  }
  return results;
}

function listFilters(stream: PDFStream): string[] {
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

function listDecodeParmsKeys(stream: PDFStream, context: PDFContext): string[] {
  const dp = stream.dict.get(PDFName.of('DecodeParms'));
  if (dp === undefined) return [];
  const out: string[] = [];
  const collect = (obj: PDFObject | undefined): void => {
    if (obj === undefined) return;
    const resolved = obj instanceof PDFRef ? context.lookup(obj) : obj;
    if (resolved instanceof PDFDict) {
      for (const [k] of resolved.entries()) out.push(k.asString());
    } else if (resolved instanceof PDFArray) {
      for (let i = 0; i < resolved.size(); i++) collect(resolved.get(i));
    }
  };
  collect(dp);
  return Array.from(new Set(out));
}

function resolveStream(obj: PDFObject | undefined, context: PDFContext): PDFStream | null {
  if (obj === undefined) return null;
  const resolved = obj instanceof PDFRef ? context.lookup(obj) : obj;
  return resolved instanceof PDFStream ? resolved : null;
}

function resolveDict(obj: PDFObject | undefined, context: PDFContext): PDFDict | null {
  if (obj === undefined) return null;
  const resolved = obj instanceof PDFRef ? context.lookup(obj) : obj;
  return resolved instanceof PDFDict ? resolved : null;
}

function colorSpaceKind(cs: PDFObject | undefined, context: PDFContext): string | null {
  if (cs === undefined) return null;
  const resolved = cs instanceof PDFRef ? context.lookup(cs) : cs;
  if (resolved instanceof PDFName) return resolved.asString();
  if (resolved instanceof PDFArray && resolved.size() > 0) {
    const first = resolved.get(0);
    if (first instanceof PDFName) return `array:${first.asString()}`;
  }
  return `<${resolved?.constructor.name ?? 'undefined'}>`;
}

function asNumber(obj: PDFObject | undefined): number | null {
  if (obj === undefined) return null;
  return obj instanceof PDFNumber ? obj.asNumber() : null;
}

function summarizeXObject(
  name: string,
  entry: PDFObject,
  context: PDFContext
): XObjectEntrySummary {
  const resolvedVia: 'inline' | 'indirect' = entry instanceof PDFRef ? 'indirect' : 'inline';
  const stream = resolveStream(entry, context);
  if (stream === null) {
    return {
      name,
      subtype: '<not-a-stream>',
      filters: [],
      decodeParmsKeys: [],
      width: null,
      height: null,
      bitsPerComponent: null,
      colorSpaceKind: null,
      hasSMask: false,
      hasMask: false,
      hasMatte: false,
      hasSMaskInData: false,
      hasAlternates: false,
      hasOPI: false,
      hasInterpolate: false,
      hasIntent: false,
      resolvedVia,
    };
  }
  const dict = stream.dict;
  const subtypeRaw = dict.get(PDFName.of('Subtype'));
  const subtype = subtypeRaw instanceof PDFName ? subtypeRaw.asString() : '<missing>';
  return {
    name,
    subtype,
    filters: listFilters(stream),
    decodeParmsKeys: listDecodeParmsKeys(stream, context),
    width: asNumber(dict.get(PDFName.of('Width'))),
    height: asNumber(dict.get(PDFName.of('Height'))),
    bitsPerComponent: asNumber(dict.get(PDFName.of('BitsPerComponent'))),
    colorSpaceKind: colorSpaceKind(dict.get(PDFName.of('ColorSpace')), context),
    hasSMask: dict.get(PDFName.of('SMask')) !== undefined,
    hasMask: dict.get(PDFName.of('Mask')) !== undefined,
    hasMatte: dict.get(PDFName.of('Matte')) !== undefined,
    hasSMaskInData: dict.get(PDFName.of('SMaskInData')) !== undefined,
    hasAlternates: dict.get(PDFName.of('Alternates')) !== undefined,
    hasOPI: dict.get(PDFName.of('OPI')) !== undefined,
    hasInterpolate: dict.get(PDFName.of('Interpolate')) !== undefined,
    hasIntent: dict.get(PDFName.of('Intent')) !== undefined,
    resolvedVia,
  };
}

function listResourceNames(
  resources: PDFDict | null,
  context: PDFContext,
  key: string
): string[] {
  if (resources === null) return [];
  const sub = resolveDict(resources.get(PDFName.of(key)), context);
  if (sub === null) return [];
  return [...sub.entries()].map(([k]) => k.asString());
}

function collectContentFilters(
  contents: PDFStream | PDFArray | undefined,
  context: PDFContext
): string[] {
  if (contents === undefined) return [];
  if (contents instanceof PDFStream) return listFilters(contents);
  if (contents instanceof PDFArray) {
    const out: string[] = [];
    for (let i = 0; i < contents.size(); i++) {
      const stream = resolveStream(contents.get(i), context);
      if (stream !== null) out.push(...listFilters(stream));
    }
    return out;
  }
  return [];
}

async function surveyFile(file: { path: string; buffer: Buffer }): Promise<FileResult> {
  const errors: string[] = [];
  if (file.buffer.length === 0) {
    return {
      path: file.path,
      sizeBytes: 0,
      pageCount: null,
      catalogFlags: null,
      pages: [],
      errors: ['empty buffer'],
    };
  }
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(file.buffer, {
      throwOnInvalidObject: false,
      ignoreEncryption: true,
    });
  } catch (err) {
    return {
      path: file.path,
      sizeBytes: file.buffer.length,
      pageCount: null,
      catalogFlags: null,
      pages: [],
      errors: [`load failed: ${(err as Error).message}`],
    };
  }

  const catalog = pdf.catalog;
  const catalogFlags: CatalogFlags = {
    encrypted: pdf.isEncrypted,
    hasAcroForm: catalog.AcroForm() !== undefined,
    hasOpenAction: catalog.get(PDFName.of('OpenAction')) !== undefined,
    hasOCProperties: catalog.get(PDFName.of('OCProperties')) !== undefined,
    hasMetadata: catalog.get(PDFName.of('Metadata')) !== undefined,
    hasOutlines: catalog.get(PDFName.of('Outlines')) !== undefined,
  };

  const pages: PageFeature[] = [];
  const pageCount = pdf.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    const node = pdf.getPage(i).node;
    const pageErrors: string[] = [];
    const annots = node.Annots();
    const annotsCount = annots !== undefined ? annots.size() : 0;
    let contentFilters: string[] = [];
    try {
      contentFilters = collectContentFilters(node.Contents(), pdf.context);
    } catch (err) {
      pageErrors.push(`content filters: ${(err as Error).message}`);
    }
    const resources = node.Resources() ?? null;
    const xobjectDict = resolveDict(resources?.get(PDFName.of('XObject')), pdf.context);
    const xobjectSummary: XObjectEntrySummary[] = [];
    if (xobjectDict !== null) {
      for (const [k, v] of xobjectDict.entries()) {
        try {
          xobjectSummary.push(summarizeXObject(k.asString(), v, pdf.context));
        } catch (err) {
          pageErrors.push(`xobject ${k.asString()}: ${(err as Error).message}`);
        }
      }
    }
    pages.push({
      pageIndex: i,
      hasAnnots: annotsCount > 0,
      annotsCount,
      hasGroup: node.lookup(PDFName.of('Group')) !== undefined,
      hasUserUnit: node.lookup(PDFName.of('UserUnit')) !== undefined,
      contentFilters,
      xobjectSummary,
      extGStateNames: listResourceNames(resources, pdf.context, 'ExtGState'),
      patternNames: listResourceNames(resources, pdf.context, 'Pattern'),
      shadingNames: listResourceNames(resources, pdf.context, 'Shading'),
      fontNames: listResourceNames(resources, pdf.context, 'Font'),
      colorSpaceNames: listResourceNames(resources, pdf.context, 'ColorSpace'),
      errors: pageErrors,
    });
  }

  return {
    path: file.path,
    sizeBytes: file.buffer.length,
    pageCount,
    catalogFlags,
    pages,
    errors,
  };
}

function aggregate(results: FileResult[]): SurveySummary {
  const summary: SurveySummary = {
    totalFiles: results.length,
    scannedFiles: 0,
    filesWithErrors: 0,
    byCatalogFlag: {},
    byPageFeature: {},
    byXObjectFilter: {},
    byContentFilter: {},
    byUnknownFilter: {},
    byXObjectSubtype: {},
  };
  const inc = (bucket: Record<string, number>, key: string): void => {
    bucket[key] = (bucket[key] ?? 0) + 1;
  };
  for (const r of results) {
    if (r.errors.length > 0 || r.catalogFlags === null) summary.filesWithErrors++;
    if (r.catalogFlags === null) continue;
    summary.scannedFiles++;
    if (r.catalogFlags.encrypted) inc(summary.byCatalogFlag, 'encrypted');
    if (r.catalogFlags.hasAcroForm) inc(summary.byCatalogFlag, 'acroform');
    if (r.catalogFlags.hasOpenAction) inc(summary.byCatalogFlag, 'openAction');
    if (r.catalogFlags.hasOCProperties) inc(summary.byCatalogFlag, 'optionalContent');
    if (r.catalogFlags.hasMetadata) inc(summary.byCatalogFlag, 'metadata');
    if (r.catalogFlags.hasOutlines) inc(summary.byCatalogFlag, 'outlines');
    const fileFilterSeen = new Set<string>();
    for (const page of r.pages) {
      if (page.hasAnnots) inc(summary.byPageFeature, 'hasAnnotations');
      if (page.hasGroup) inc(summary.byPageFeature, 'hasGroup');
      if (page.hasUserUnit) inc(summary.byPageFeature, 'hasUserUnit');
      for (const f of page.contentFilters) inc(summary.byContentFilter, f);
      for (const xo of page.xobjectSummary) {
        inc(summary.byXObjectSubtype, xo.subtype);
        for (const f of xo.filters) {
          if (!KNOWN_FILTERS.has(f)) inc(summary.byUnknownFilter, f);
          // per-file dedup: 同一ファイル内で複数 page/XObject に同 filter があっても 1 とカウント
          // (filter 存在の有無を見たいので、ページ数バイアスを排除)
          if (!fileFilterSeen.has(f)) {
            inc(summary.byXObjectFilter, f);
            fileFilterSeen.add(f);
          }
        }
        if (xo.hasSMask) inc(summary.byPageFeature, 'hasSMask');
        if (xo.hasMask) inc(summary.byPageFeature, 'hasMask');
        if (xo.hasMatte) inc(summary.byPageFeature, 'hasMatte');
        if (xo.hasSMaskInData) inc(summary.byPageFeature, 'hasSMaskInData');
        if (xo.hasAlternates) inc(summary.byPageFeature, 'hasAlternates');
        if (xo.hasOPI) inc(summary.byPageFeature, 'hasOPI');
      }
    }
  }
  return summary;
}

/**
 * --expect-* strict guard 評価 (PR-C3b, AC20 反映)。
 *
 * 期待値が満たされない場合は exit 1 (CI fail-fast)。fixture が実際に該当 feature を
 * 含むことを classify 前段の必須 gate として強制し、PR-C2/PR-C3a で再演された
 * 「dev fixture に kanameone 実 PDF の feature が含まれず本番欠陥を隠蔽する」
 * アンチパターンを構造的に防止する。
 */
function evaluateExpectations(opts: CliOptions, summary: SurveySummary): string[] {
  const failures: string[] = [];
  const allFilters = new Set<string>([
    ...Object.keys(summary.byXObjectFilter),
    ...Object.keys(summary.byContentFilter),
  ]);
  for (const expected of opts.expectFilter) {
    if (!allFilters.has(expected)) {
      failures.push(
        `--expect-filter ${expected} not found (detected filters: ${[...allFilters].sort().join(', ') || '<none>'})`
      );
    }
  }
  const allSubtypes = new Set<string>(Object.keys(summary.byXObjectSubtype));
  for (const expected of opts.expectSubtype) {
    if (!allSubtypes.has(expected)) {
      failures.push(
        `--expect-subtype ${expected} not found (detected subtypes: ${[...allSubtypes].sort().join(', ') || '<none>'})`
      );
    }
  }
  if (opts.expectEncrypted && (summary.byCatalogFlag.encrypted ?? 0) === 0) {
    failures.push(`--expect-encrypted but no file has isEncrypted=true`);
  }
  if (opts.expectAcroform && (summary.byCatalogFlag.acroform ?? 0) === 0) {
    failures.push(`--expect-acroform but no file has /AcroForm in catalog`);
  }
  // Codex review #019e1e54 Important 2 反映: --expect-* 指定時は survey parse error
  // (filesWithErrors) も failure 条件に含める。部分 parse 失敗 (1 file の load 例外
  // 等) が起きた状態で「期待 filter が別 file で検出された」結果が exit 0 になり、
  // partial result を全成功と誤認するアンチパターンを防ぐ。
  // --expect-* が 1 つも指定されていない場合は survey only mode なので filesWithErrors
  // による exit code 強制は行わない (caller が summary を見て判断)。
  const expectModeActive =
    opts.expectFilter.length +
      opts.expectSubtype.length +
      (opts.expectEncrypted ? 1 : 0) +
      (opts.expectAcroform ? 1 : 0) >
    0;
  if (expectModeActive && summary.filesWithErrors > 0) {
    failures.push(
      `expect mode: ${summary.filesWithErrors}/${summary.totalFiles} file(s) had parse errors; ` +
        `partial scan cannot satisfy strict --expect-* assertions safely`
    );
  }
  return failures;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  let results: FileResult[];
  if (opts.source === 'local') {
    if (opts.paths.length === 0) {
      throw new Error('--paths is required for --source local');
    }
    results = await surveyLocalPaths(opts.paths);
  } else {
    const bucketName = opts.bucket ?? process.env.STORAGE_BUCKET;
    if (!bucketName) {
      throw new Error('--bucket or STORAGE_BUCKET env required for --source gcs');
    }
    if (!process.env.FIREBASE_PROJECT_ID) {
      throw new Error('FIREBASE_PROJECT_ID env required for --source gcs');
    }
    results = await surveyGcs(bucketName, opts.prefix, opts.limit);
  }
  const summary = aggregate(results);
  const expectationFailures = evaluateExpectations(opts, summary);
  const payload = {
    summary,
    files: results,
    expectations: {
      filters: opts.expectFilter,
      subtypes: opts.expectSubtype,
      encrypted: opts.expectEncrypted,
      acroform: opts.expectAcroform,
      failures: expectationFailures,
    },
  };
  const jsonStr = JSON.stringify(payload, null, 2);
  if (opts.out) {
    fs.writeFileSync(opts.out, jsonStr);
    console.error(`wrote ${opts.out} (${jsonStr.length} bytes)`);
  } else {
    process.stdout.write(jsonStr);
    process.stdout.write('\n');
  }
  console.error(
    `done: scanned=${summary.scannedFiles}/${summary.totalFiles} errors=${summary.filesWithErrors}`
  );
  if (expectationFailures.length > 0) {
    console.error(`FAIL: ${expectationFailures.length} expectation(s) not met:`);
    for (const f of expectationFailures) console.error(`  - ${f}`);
    process.exit(1);
  }
  if (
    opts.expectFilter.length +
      opts.expectSubtype.length +
      (opts.expectEncrypted ? 1 : 0) +
      (opts.expectAcroform ? 1 : 0) >
    0
  ) {
    console.error(`expects: all satisfied`);
  }
}

main().catch((err) => {
  console.error(`ERROR: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
