#!/usr/bin/env ts-node
/**
 * Issue #432 PR-C3a/b: cross-process PDF fingerprint determinism verifier (read-only).
 *
 * 目的 (Codex MCP セカンドオピニオン #1 Critical, AC17 反映):
 *   - `pdf-page-visual-v2` fingerprint が **別プロセス間** で同一 hex を返すことを実証
 *   - pdf-lib `PDFDocument.save()` は同一プロセス内 deterministic だがプロセス間で
 *     非決定 (PDF `/ID` random、internal metadata) のため、classify と execute が
 *     別プロセスで走る以上、fingerprint 側の cross-process invariance は precondition
 *   - PR-C3b の `pdf-page-visual-v2` 着手前 (AC17) に main merge 必須 + dev で実証必須
 *   - PR-C3b で AC17 拡張: scripts/fixtures/ の CCITT/JBIG2/JPX/DCT/encrypted 等
 *     hand-craft fixture を --paths 経由で cross-process invariance 実証
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
 *   # 既存 PDF fixture (scripts/fixtures/* 等) で検証
 *   ts-node scripts/verify-pdf-determinism.ts --paths fixture-a.pdf,fixture-b.pdf --out determinism.json
 *
 * 出力 (JSON):
 *   {
 *     verdict: 'PASS' | 'FAIL',
 *     algorithm: 'pdf-page-visual-v2',
 *     totals: { files, pass, ok, unsupportedPass, nonDeterministic, fail },
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
  // 'ok': fingerprint 計算成功 + same-process / cross-process invariance 成立
  // 'unsupported': fingerprint 計算は完了したが unsupported 分類 (encrypted / acroform 等)、
  //   parent と child で同 reason なら invariance 成立として扱う
  // 'non-deterministic': **same-process** で fingerprint が一致しない (precondition 違反、
  //   AC17 失敗)。pdf-page-visual-v2 の deterministic 仕様自体が壊れている重大事象
  // 'failed': fingerprint 計算が parent で例外、または child process 異常終了
  kind: 'ok' | 'unsupported' | 'non-deterministic' | 'failed';
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

function requireValue(arg: string, next: string | undefined): string {
  if (next === undefined) throw new Error(`${arg} requires a value`);
  return next;
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
        opts.paths = requireValue(arg, next).split(',').map((s) => s.trim()).filter(Boolean);
        i++;
        break;
      case '--synthetic':
        opts.synthetic = true;
        break;
      case '--out':
        opts.out = requireValue(arg, next);
        i++;
        break;
      case '--child-mode':
        opts.childMode = true;
        break;
      case '--child-buffer-path':
        opts.childBufferPath = requireValue(arg, next);
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
  // pdf-lib で生成可能な features に絞った最小 fixture を 3 種作る:
  //   A: 単純 page (geometry + raw operators)
  //   B: transparency (opacity + 円) — image XObject は pdf-lib 単独で生成困難な
  //      ため AC20 の synthetic 補完は別途用意 (本 verifier の scope 外)
  //   C: 複数ページ + rotation
  // 本 verifier の目的は cross-process invariance の実証 (AC17) なので、CCITT/JBIG2/
  // JPX/encrypted 等 pdf-lib 不能 feature の生成は不要 (それらは PR-C3b で fixture 用意)。
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
  let tmpDir: string;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-c3a-det-'));
  } catch (err) {
    return {
      hex: null,
      stderr: '',
      exitCode: null,
      kind: 'failed',
      reason: `mkdtemp failed: ${(err as Error).message}`,
    };
  }
  try {
    const bufPath = path.join(tmpDir, 'in.pdf');
    try {
      fs.writeFileSync(bufPath, buffer);
    } catch (err) {
      return {
        hex: null,
        stderr: '',
        exitCode: null,
        kind: 'failed',
        reason: `tmp write failed: ${(err as Error).message}`,
      };
    }
    const scriptPath = __filename;
    // ts-node 経由で同 script を child mode で再起動。--child-mode で run 経路を分岐。
    // ts-node の起動コストはあるが、ts-node 内蔵で本 script が回る環境を前提とする
    // (PR-C2 既存 ts script と同様、scripts/package.json に ts-node 依存あり).
    // child の CWD + TS_NODE_PROJECT を scripts/ 配下の tsconfig.json に固定。
    //
    // 解消する問題: parent CWD が doc-split root の場合、子 ts-node は
    // tsconfig.json を root から上方向に探索するが root には存在せず、
    // ambient default で module=NodeNext を採用する一方 moduleResolution は
    // 未指定となり TS5109 "moduleResolution must be set to NodeNext when module
    // is NodeNext" で child が異常終了する (local dev で再現)。
    // CI では `cd scripts` 後実行のため偶然 scripts/tsconfig.json が解決されて
    // 動いていたが、CWD 暗黙依存は環境差で壊れる。
    //
    // 対策: cwd と TS_NODE_PROJECT を明示固定し、parent 実行位置と無関係に
    // 子が同じ tsconfig を読むよう保証する。
    const scriptsDir = path.dirname(scriptPath);
    const tsconfigPath = path.join(scriptsDir, 'tsconfig.json');
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
        cwd: scriptsDir,
        env: {
          ...process.env,
          // child でも同じ ts-node 設定が回るよう TS_NODE_TRANSPILE_ONLY を有効化
          // (型エラーは parent で既に検出済)
          TS_NODE_TRANSPILE_ONLY: '1',
          // scripts/tsconfig.json を明示指定 (module/moduleResolution 等の解決を
          // 親 CWD 依存にしない)
          TS_NODE_PROJECT: tsconfigPath,
        },
      }
    );
    // silent-failure-hunter HIGH-2 反映: spawn 失敗 (ENOENT/EACCES 等) と
    // signal kill (SIGKILL/SIGTERM 等 OOM killer) と exit !== 0 を区別する。
    // テスト側 (functions/test/pdfPageVisualFingerprint.test.ts:115-129) には
    // 既に同 pattern が入っているが production スクリプト側に反映漏れていた。
    if (proc.error) {
      return {
        hex: null,
        stderr: '',
        exitCode: null,
        kind: 'failed',
        reason: `child spawn failed: ${proc.error.message}`,
      };
    }
    if (proc.signal) {
      return {
        hex: null,
        stderr: proc.stderr || '',
        exitCode: null,
        kind: 'failed',
        reason: `child killed by signal=${proc.signal}`,
      };
    }
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
      // silent-failure-hunter CRITICAL-3 反映: child stdout の整合性を検証する。
      // partial JSON / 想定外 kind / 不正 hex を「kind=failed」として顕在化させ、
      // verifyOne 側で cross-process mismatch と取り違えない経路に流す。
      if (parsed.kind !== 'ok' && parsed.kind !== 'unsupported') {
        return {
          hex: null,
          stderr: `${proc.stderr || ''}\nunexpected child kind=${parsed.kind}`,
          exitCode: proc.status,
          kind: 'failed',
          reason: `child returned unexpected kind=${parsed.kind}`,
        };
      }
      if (parsed.kind === 'ok' && (typeof parsed.hex !== 'string' || parsed.hex.length !== 64)) {
        return {
          hex: null,
          stderr: `${proc.stderr || ''}\nchild ok but hex invalid: ${JSON.stringify(parsed.hex)}`,
          exitCode: proc.status,
          kind: 'failed',
          reason: 'child ok but hex not 64-char sha256 hex',
        };
      }
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
  const parentHex = fingerprintHex(fpA);
  const child = runChildFingerprint(file.buffer);

  let crossMatch = false;
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

  // same-process mismatch は pdf-page-visual-v2 の deterministic 仕様違反 = precondition
  // 違反として独立 kind に分離する (review #3 反映)。cross-process FAIL と区別することで
  // operator がアルゴリズム再設計が必要か単に child spawn 環境差かを切り分け可能。
  let kind: VerifyResult['kind'];
  if (!sameMatch) {
    kind = 'non-deterministic';
    notes.unshift('same-process mismatch — pdf-page-visual-v2 deterministic precondition violated');
  } else if (fpA.kind === 'ok') {
    kind = 'ok';
  } else {
    kind = 'unsupported';
  }

  return {
    path: file.path,
    kind,
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
  // ok / unsupported (両方 same-process + cross-process match) を pass、それ以外を fail に分類。
  // unsupportedPass は内訳として別出し (review #4 反映: operator が「PASS だが分類不可」を
  // 識別できるよう、totals.unsupportedPass を分けて報告)。
  const okCount = results.filter((r) => r.kind === 'ok' && r.sameProcess.match && r.crossProcess.match).length;
  const unsupportedPassCount = results.filter(
    (r) => r.kind === 'unsupported' && r.sameProcess.match && r.crossProcess.match
  ).length;
  const passCount = okCount + unsupportedPassCount;
  const nonDeterministicCount = results.filter((r) => r.kind === 'non-deterministic').length;
  const failCount = results.length - passCount;
  const verdict: 'PASS' | 'FAIL' = failCount === 0 ? 'PASS' : 'FAIL';
  const payload = {
    verdict,
    algorithm: HASH_ALGORITHM,
    totals: {
      files: results.length,
      pass: passCount,
      ok: okCount,
      unsupportedPass: unsupportedPassCount,
      nonDeterministic: nonDeterministicCount,
      fail: failCount,
    },
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
