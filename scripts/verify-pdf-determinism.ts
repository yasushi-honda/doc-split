#!/usr/bin/env ts-node
/**
 * Issue #432 PR-C3a: cross-process PDF fingerprint determinism verifier (read-only).
 *
 * 目的 (Codex MCP セカンドオピニオン #1 Critical, AC17 反映):
 *   - `pdf-page-visual-v1` fingerprint が **別プロセス間** で同一 hex を返すことを実証
 *   - pdf-lib `PDFDocument.save()` は同一プロセス内 deterministic だがプロセス間で
 *     非決定 (PDF `/ID` random、internal metadata) のため、classify と execute が
 *     別プロセスで走る以上、fingerprint 側の cross-process invariance は precondition
 *   - PR-C3b の `pdf-page-visual-v2` 着手前 (AC17) に main merge 必須 + dev で実証必須
 *
 * 副作用なし: PDF を read するのみ。Firestore / Storage への書き込みなし。
 *
 * 動作:
 *   1. 入力 PDF 各々について:
 *      a. **same-process**: 同一プロセス内で 2 回 fingerprint 計算 → hex 一致を確認
 *      b. **cross-process**: 子プロセスを spawn して同 lib で fingerprint 計算、親と比較
 *   2. 各 PDF について PASS / FAIL を判定、最後に overall verdict を出力
 *   3. 1 件でも FAIL があれば exit code 1
 *
 * 使用方法:
 *   # 内蔵 synthetic fixture (pdf-lib generated) で smoke test
 *   ts-node scripts/verify-pdf-determinism.ts --synthetic --out determinism.json
 *
 *   # 既存 PDF fixture で検証
 *   ts-node scripts/verify-pdf-determinism.ts --paths fixture-a.pdf,fixture-b.pdf --out determinism.json
 *
 * 出力 (JSON):
 *   {
 *     verdict: 'PASS' | 'FAIL',
 *     algorithm: 'pdf-page-visual-v1',
 *     totals: { files, pass, fail },
 *     results: [{ path, kind, sameProcess: {...}, crossProcess: {...} }]
 *   }
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { PDFDocument, degrees } from 'pdf-lib';
import {
  computePdfPageVisualFingerprint,
  Fingerprint,
  HASH_ALGORITHM,
} from './lib/pdfPageVisualFingerprint';

interface CliOptions {
  paths: string[];
  synthetic: boolean;
  out: string | null;
  childMode: boolean;
  childBufferPath: string | null;
}

interface VerifyResult {
  path: string;
  kind: 'ok' | 'unsupported' | 'failed';
  pageCount: number | null;
  unsupportedReason: string | null;
  sameProcess: {
    match: boolean;
    hexA: string | null;
    hexB: string | null;
  };
  crossProcess: {
    match: boolean;
    parentHex: string | null;
    childHex: string | null;
    childStderr: string | null;
    childExitCode: number | null;
  };
  notes: string[];
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    paths: [],
    synthetic: false,
    out: null,
    childMode: false,
    childBufferPath: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--paths':
        opts.paths = next.split(',').map((s) => s.trim()).filter(Boolean);
        i++;
        break;
      case '--synthetic':
        opts.synthetic = true;
        break;
      case '--out':
        opts.out = next;
        i++;
        break;
      case '--child-mode':
        opts.childMode = true;
        break;
      case '--child-buffer-path':
        opts.childBufferPath = next;
        i++;
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
      'Usage: ts-node scripts/verify-pdf-determinism.ts [options]',
      '',
      'Options:',
      '  --synthetic               use built-in synthetic fixture (pdf-lib generated)',
      '  --paths a.pdf,b.pdf       comma-separated local PDF paths',
      '  --out PATH                write JSON output to PATH (default: stdout)',
      '',
      'Exit code 1 if any file fails determinism check.',
    ].join('\n')
  );
}

async function generateSyntheticFixtures(): Promise<Array<{ path: string; buffer: Buffer }>> {
  // pdf-lib で生成可能な features を網羅した最小 fixture を 3 種作る:
  //   A: 単純 page (geometry + raw operators)
  //   B: image XObject (JPEG-likeなどはpdf-libで直接embed出来ない為、minimal stream)
  //   C: 複数ページ + rotation + cropbox
  // 各 fixture は same-process / cross-process 検証用の正解 PDF
  const fixtures: Array<{ path: string; buffer: Buffer }> = [];

  const fixA = await PDFDocument.create();
  const pageA = fixA.addPage([200, 300]);
  pageA.drawRectangle({ x: 10, y: 10, width: 100, height: 50 });
  pageA.drawText('synthetic-A', { x: 20, y: 80, size: 12 });
  fixtures.push({ path: 'synthetic://simple.pdf', buffer: Buffer.from(await fixA.save()) });

  const fixB = await PDFDocument.create();
  const pageB = fixB.addPage([400, 400]);
  pageB.drawRectangle({ x: 50, y: 50, width: 200, height: 200, opacity: 0.5 });
  pageB.drawCircle({ x: 150, y: 150, size: 30 });
  fixtures.push({ path: 'synthetic://transparency.pdf', buffer: Buffer.from(await fixB.save()) });

  const fixC = await PDFDocument.create();
  for (let i = 0; i < 3; i++) {
    const page = fixC.addPage([200, 200]);
    page.setRotation(degrees(i * 90));
    page.drawRectangle({ x: 10 + i * 5, y: 10 + i * 5, width: 30, height: 30 });
  }
  fixtures.push({ path: 'synthetic://multipage.pdf', buffer: Buffer.from(await fixC.save()) });

  return fixtures;
}

async function loadFixtures(opts: CliOptions): Promise<Array<{ path: string; buffer: Buffer }>> {
  const out: Array<{ path: string; buffer: Buffer }> = [];
  if (opts.synthetic) {
    out.push(...(await generateSyntheticFixtures()));
  }
  for (const p of opts.paths) {
    if (!fs.existsSync(p)) throw new Error(`path not found: ${p}`);
    out.push({ path: p, buffer: fs.readFileSync(p) });
  }
  if (out.length === 0) {
    throw new Error('no fixtures supplied; use --synthetic or --paths');
  }
  return out;
}

function fingerprintEqual(a: Fingerprint, b: Fingerprint): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'ok' && b.kind === 'ok') return a.hex === b.hex && a.pageCount === b.pageCount;
  if (a.kind === 'unsupported' && b.kind === 'unsupported') {
    return a.reason === b.reason;
  }
  return false;
}

function fingerprintHex(fp: Fingerprint): string | null {
  return fp.kind === 'ok' ? fp.hex : null;
}

function runChildFingerprint(
  buffer: Buffer
): { hex: string | null; stderr: string; exitCode: number | null; kind: string; reason: string | null } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-c3a-det-'));
  const bufPath = path.join(tmpDir, 'in.pdf');
  fs.writeFileSync(bufPath, buffer);
  try {
    const scriptPath = __filename;
    // ts-node 経由で同 script を child mode で再起動。--child-mode で run 経路を分岐。
    // ts-node の起動コストはあるが、ts-node 内蔵で本 script が回る環境を前提とする
    // (PR-C2 既存 ts script と同様、scripts/package.json に ts-node 依存あり).
    const proc = spawnSync(
      process.execPath,
      [
        '-r',
        'ts-node/register',
        scriptPath,
        '--child-mode',
        '--child-buffer-path',
        bufPath,
      ],
      {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
        env: {
          ...process.env,
          // child でも同じ ts-node 設定が回るよう TS_NODE_TRANSPILE_ONLY を有効化
          // (型エラーは parent で既に検出済)
          TS_NODE_TRANSPILE_ONLY: '1',
        },
      }
    );
    if (proc.status !== 0) {
      return {
        hex: null,
        stderr: proc.stderr || '',
        exitCode: proc.status,
        kind: 'failed',
        reason: `child exit ${proc.status}`,
      };
    }
    try {
      const parsed = JSON.parse(proc.stdout) as {
        kind: string;
        hex?: string;
        reason?: string;
      };
      return {
        hex: parsed.hex ?? null,
        stderr: proc.stderr || '',
        exitCode: proc.status,
        kind: parsed.kind,
        reason: parsed.reason ?? null,
      };
    } catch (err) {
      return {
        hex: null,
        stderr: `${proc.stderr || ''}\nparse error: ${(err as Error).message}\nraw: ${proc.stdout.slice(0, 500)}`,
        exitCode: proc.status,
        kind: 'failed',
        reason: 'child stdout parse error',
      };
    }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

async function runChildMode(opts: CliOptions): Promise<void> {
  if (!opts.childBufferPath) {
    console.error('--child-buffer-path required in child mode');
    process.exit(2);
  }
  const buffer = fs.readFileSync(opts.childBufferPath);
  const fp = await computePdfPageVisualFingerprint(buffer);
  const out =
    fp.kind === 'ok'
      ? { kind: 'ok', hex: fp.hex, pageCount: fp.pageCount, algorithm: fp.algorithm }
      : { kind: 'unsupported', reason: fp.reason, detail: fp.detail, algorithm: fp.algorithm };
  process.stdout.write(JSON.stringify(out));
}

async function verifyOne(
  file: { path: string; buffer: Buffer }
): Promise<VerifyResult> {
  const notes: string[] = [];
  let fpA: Fingerprint;
  let fpB: Fingerprint;
  try {
    fpA = await computePdfPageVisualFingerprint(file.buffer);
    fpB = await computePdfPageVisualFingerprint(file.buffer);
  } catch (err) {
    return {
      path: file.path,
      kind: 'failed',
      pageCount: null,
      unsupportedReason: null,
      sameProcess: { match: false, hexA: null, hexB: null },
      crossProcess: { match: false, parentHex: null, childHex: null, childStderr: null, childExitCode: null },
      notes: [`parent fingerprint failed: ${(err as Error).message}`],
    };
  }
  const sameMatch = fingerprintEqual(fpA, fpB);
  if (!sameMatch) notes.push('same-process mismatch (fingerprint is non-deterministic in process)');

  const child = runChildFingerprint(file.buffer);
  let crossMatch = false;
  const parentHex = fingerprintHex(fpA);
  if (fpA.kind === 'ok' && child.kind === 'ok') {
    crossMatch = parentHex === child.hex && parentHex !== null;
  } else if (fpA.kind === 'unsupported' && child.kind === 'unsupported') {
    // 同 reason なら cross-process invariance あり (unsupported 降格が安定)
    crossMatch = child.reason === fpA.reason;
    notes.push(`unsupported (reason=${fpA.reason}); cross-process reason match=${crossMatch}`);
  } else {
    notes.push(`kind mismatch parent=${fpA.kind} child=${child.kind}`);
  }
  if (!crossMatch) notes.push('cross-process mismatch (parent vs child differ)');

  return {
    path: file.path,
    kind: fpA.kind === 'ok' ? 'ok' : 'unsupported',
    pageCount: fpA.kind === 'ok' ? fpA.pageCount : null,
    unsupportedReason: fpA.kind === 'unsupported' ? fpA.reason : null,
    sameProcess: { match: sameMatch, hexA: parentHex, hexB: fingerprintHex(fpB) },
    crossProcess: {
      match: crossMatch,
      parentHex,
      childHex: child.hex,
      childStderr: child.stderr.trim() || null,
      childExitCode: child.exitCode,
    },
    notes,
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  if (opts.childMode) {
    await runChildMode(opts);
    return;
  }
  const fixtures = await loadFixtures(opts);
  console.error(`verifying ${fixtures.length} fixture(s)...`);
  const results: VerifyResult[] = [];
  for (const f of fixtures) {
    const r = await verifyOne(f);
    results.push(r);
    const pass = r.sameProcess.match && r.crossProcess.match;
    console.error(
      `  [${pass ? 'PASS' : 'FAIL'}] ${r.path} (kind=${r.kind}${r.unsupportedReason ? `:${r.unsupportedReason}` : ''})`
    );
  }
  const passCount = results.filter((r) => r.sameProcess.match && r.crossProcess.match).length;
  const failCount = results.length - passCount;
  const verdict: 'PASS' | 'FAIL' = failCount === 0 ? 'PASS' : 'FAIL';
  const payload = {
    verdict,
    algorithm: HASH_ALGORITHM,
    totals: { files: results.length, pass: passCount, fail: failCount },
    results,
  };
  const jsonStr = JSON.stringify(payload, null, 2);
  if (opts.out) {
    fs.writeFileSync(opts.out, jsonStr);
    console.error(`wrote ${opts.out} (${jsonStr.length} bytes)`);
  } else {
    process.stdout.write(jsonStr);
    process.stdout.write('\n');
  }
  console.error(`verdict: ${verdict} (pass=${passCount} fail=${failCount})`);
  if (verdict === 'FAIL') process.exit(1);
}

main().catch((err) => {
  console.error(`ERROR: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
