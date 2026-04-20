/**
 * テキスト長さ制限ユーティリティのテスト (Issue #205, #209, #215)
 *
 * 背景: Vertex AI Geminiのハルシネーション/暴走により異常に長い応答が
 * Firestoreの per-field 1 MiB 制限を超え INVALID_ARGUMENT を引き起こす問題への防御。
 */

import { expect } from 'chai';
import {
  capPageText,
  capPageResultsAggregate,
  MAX_PAGE_TEXT_LENGTH,
  MAX_AGGREGATE_PAGE_CHARS,
  MAX_SUMMARY_LENGTH,
} from '../src/utils/textCap';
import type { SummaryField } from '../../shared/types';
import { makeInvalidPage } from './helpers/textCapFixtures';
import { withNodeEnv } from './helpers/withNodeEnv';

// #255 Evaluator 指摘対応: discriminated union narrowing を `if (result.truncated)` で
// 行うと、実装バグで truncated=false が返った場合にアサート群がスキップされ、テスト全体が
// PASS する誤検知リスクがある。`asserts` 型述語で明示的に narrow し、不変条件を強制する。
// #258: CappedText を SummaryField に統合（structurally identical）。
function assertTruncated(
  result: SummaryField
): asserts result is { text: string; truncated: true; originalLength: number } {
  expect(result.truncated).to.be.true;
  if (!result.truncated) throw new Error('unreachable: expected truncated=true');
}

describe('textCap', () => {
  describe('capPageText (per-page cap)', () => {
    it('短いテキストはそのまま返される', () => {
      const input = 'これはテストです。';
      const result = capPageText(input);

      expect(result.text).to.equal(input);
      expect(result.truncated).to.be.false;
    });

    it('境界値: text.length === MAX_PAGE_TEXT_LENGTH は切り詰めない', () => {
      const input = 'a'.repeat(MAX_PAGE_TEXT_LENGTH);
      const result = capPageText(input);

      expect(result.text.length).to.equal(MAX_PAGE_TEXT_LENGTH);
      expect(result.truncated).to.be.false;
    });

    it('境界値: text.length === MAX_PAGE_TEXT_LENGTH + 1 は切り詰める', () => {
      const input = 'a'.repeat(MAX_PAGE_TEXT_LENGTH + 1);
      const result = capPageText(input);

      assertTruncated(result);
      expect(result.originalLength).to.equal(MAX_PAGE_TEXT_LENGTH + 1);
      expect(result.text.length).to.be.at.most(MAX_PAGE_TEXT_LENGTH);
    });

    it('巨大テキスト (1.1M chars) でも text.length が cap を超えない', () => {
      const input = 'x'.repeat(1_102_788);
      const result = capPageText(input);

      assertTruncated(result);
      expect(result.originalLength).to.equal(1_102_788);
      expect(result.text.length).to.be.at.most(MAX_PAGE_TEXT_LENGTH);
    });

    it('切り詰めマーカー [TRUNCATED] が末尾に付与される', () => {
      const input = 'a'.repeat(MAX_PAGE_TEXT_LENGTH * 2);
      const result = capPageText(input);

      expect(result.text).to.match(/\[TRUNCATED\]$/);
    });

    it('カスタム maxLength が反映される', () => {
      const input = 'a'.repeat(100);
      const result = capPageText(input, 50);

      assertTruncated(result);
      expect(result.text.length).to.be.at.most(50);
      expect(result.originalLength).to.equal(100);
    });

    it('日本語マルチバイト文字でも文字数ベースで動作する', () => {
      const input = 'あ'.repeat(MAX_PAGE_TEXT_LENGTH + 100);
      const result = capPageText(input);

      assertTruncated(result);
      expect(result.originalLength).to.equal(MAX_PAGE_TEXT_LENGTH + 100);
      expect(result.text.length).to.be.at.most(MAX_PAGE_TEXT_LENGTH);
    });

    it('空文字列は切り詰められない', () => {
      const result = capPageText('');

      expect(result.text).to.equal('');
      expect(result.truncated).to.be.false;
    });

    it('maxLength=0 でも安全に動作する（text空、truncated=true）', () => {
      const result = capPageText('hello', 0);

      assertTruncated(result);
      expect(result.text.length).to.be.at.most(0);
      expect(result.originalLength).to.equal(5);
    });

    // #255: discriminated union の型絞り込み。truncated=false 分岐で originalLength
    // プロパティが型システム上存在しないことをランタイムでも確認 (silent failure 防止)。
    it('discriminated union: truncated=false では originalLength プロパティが存在しない', () => {
      const result = capPageText('short');

      expect(result.truncated).to.be.false;
      expect(Object.prototype.hasOwnProperty.call(result, 'originalLength')).to.be.false;
    });

    // #258 dev-assert: capPageText 通常呼出からは違反不可能な invariant (originalLength > cappedText.length)。
    // 将来の内部実装変更 (再cap 経路追加等) で違反したら即時検知。production では no-op (パフォーマンス担保)。
    describe('dev-assert (#258)', () => {
      it('通常の切り詰めでは fire しない (originalLength > cappedText.length が常時成立)', () => {
        expect(() => capPageText('a'.repeat(MAX_PAGE_TEXT_LENGTH + 1))).to.not.throw();
      });
    });
  });

  describe('capPageResultsAggregate (aggregate cap)', () => {
    it('合計が閾値以下なら全ページそのまま返される', () => {
      const pages: SummaryField[] = [
        { text: 'page1', truncated: false },
        { text: 'page2', truncated: false },
      ];
      const result = capPageResultsAggregate(pages);

      expect(result).to.have.length(2);
      expect(result[0]?.text).to.equal('page1');
      expect(result[1]?.text).to.equal('page2');
    });

    it('合計が閾値を超える場合は後続ページが切り詰められる', () => {
      const pageSize = MAX_PAGE_TEXT_LENGTH;
      const pages = Array.from({ length: 10 }, (_, i) => ({
        text: 'a'.repeat(pageSize),
        truncated: false as const,
        pageNumber: i + 1,
      }));

      const result = capPageResultsAggregate(pages);
      const totalChars = result.reduce((sum: number, p) => sum + p.text.length, 0);

      expect(totalChars).to.be.at.most(MAX_AGGREGATE_PAGE_CHARS);
    });

    it('aggregate超過時、超過したページは truncated=true でメタデータ保持', () => {
      const pageSize = MAX_PAGE_TEXT_LENGTH;
      // SummaryField[] 明示注釈: 戻り値 narrowing が truncated:false only に固定されないように union で保持
      const pages: SummaryField[] = Array.from({ length: 10 }, () => ({
        text: 'a'.repeat(pageSize),
        truncated: false,
      }));

      const result = capPageResultsAggregate(pages);
      const truncatedPages = result.filter((p) => p.truncated);

      expect(truncatedPages.length).to.be.at.least(1);
      truncatedPages.forEach((p) => {
        // assertTruncated で narrow (silent skip 回避: if ブロックでスキップされて PASS する誤検知を排除)
        assertTruncated(p);
        expect(p.originalLength).to.equal(pageSize);
      });
    });

    it('1ページ目で既に閾値超過の場合は1ページ目内で切り詰め', () => {
      const pages: SummaryField[] = [
        {
          text: 'a'.repeat(MAX_AGGREGATE_PAGE_CHARS + 100),
          truncated: false,
        },
      ];
      const result = capPageResultsAggregate(pages);

      expect(result[0]?.text.length).to.be.at.most(MAX_AGGREGATE_PAGE_CHARS);
      expect(result[0]?.truncated).to.be.true;
    });

    it('per-page cap と合計 cap の両方が適用される', () => {
      // 各ページ MAX_PAGE_TEXT_LENGTH 超 + 合計 MAX_AGGREGATE_PAGE_CHARS 超
      const pages: SummaryField[] = [
        { text: 'a'.repeat(60_000), truncated: false },
        { text: 'b'.repeat(60_000), truncated: false },
        { text: 'c'.repeat(60_000), truncated: false },
        { text: 'd'.repeat(60_000), truncated: false },
      ];
      const result = capPageResultsAggregate(pages);

      // 各ページ per-page cap 内
      result.forEach((p) => {
        expect(p.text.length).to.be.at.most(MAX_PAGE_TEXT_LENGTH);
      });
      // 合計が aggregate cap 内
      const totalChars = result.reduce((sum: number, p) => sum + p.text.length, 0);
      expect(totalChars).to.be.at.most(MAX_AGGREGATE_PAGE_CHARS);
    });

    it('空配列は空配列を返す', () => {
      expect(capPageResultsAggregate([])).to.deep.equal([]);
    });

    // #283: aggregate cap 発動時の可視性を per-page 粒度で確保する契約。
    // Issue #209 型実害 (Vertex AI 暴走で 1.1M chars 応答) が aggregate cap で切り詰められた
    // 場合、ocrProcessor.ts 側は aggregate サマリを safeLogError で errors collection に記録する
    // (本 PR Option B) が、per-page 粒度の原因追跡には不足。本契約はアラート信号として
    // console.warn 発動を lock-in する (Option A)。
    describe('aggregate cap truncation log (#283)', () => {
      /** console.warn を一時的に差し替えて呼出を捕捉するヘルパ */
      function withWarnSpy<T>(fn: () => T): { calls: unknown[][]; result: T } {
        const original = console.warn;
        const calls: unknown[][] = [];
        console.warn = (...args: unknown[]) => {
          calls.push(args);
        };
        try {
          const result = fn();
          return { calls, result };
        } finally {
          console.warn = original;
        }
      }

      it('per-page cap 新規発動時 (input truncated=false → output truncated=true) に warn が呼ばれる', () => {
        const pages: SummaryField[] = [
          { text: 'a'.repeat(MAX_PAGE_TEXT_LENGTH + 10), truncated: false },
        ];
        const { calls } = withWarnSpy(() => capPageResultsAggregate(pages));

        expect(calls.length).to.be.at.least(1);
        const firstMessage = String(calls[0]?.[0] ?? '');
        expect(firstMessage).to.match(/textCap|aggregate|truncat/i);
        // #283 Codex review Suggestion: observability 強化のため runningTotal を message に残す契約。
        expect(firstMessage).to.match(/runningTotal=\d+/);
      });

      it('複数ページ cap 発動で発動ページ数と同じ回数の warn が呼ばれる', () => {
        const pages: SummaryField[] = Array.from({ length: 10 }, () => ({
          text: 'a'.repeat(MAX_PAGE_TEXT_LENGTH),
          truncated: false,
        }));
        const { calls, result } = withWarnSpy(() => capPageResultsAggregate(pages));

        const truncatedCount = result.filter((p) => p.truncated).length;
        expect(truncatedCount).to.be.at.least(1);
        expect(calls.length).to.equal(truncatedCount);
      });

      it('cap 非発動 (全ページ budget 内) の場合は warn が呼ばれない', () => {
        const pages: SummaryField[] = [
          { text: 'short1', truncated: false },
          { text: 'short2', truncated: false },
        ];
        const { calls } = withWarnSpy(() => capPageResultsAggregate(pages));
        expect(calls.length).to.equal(0);
      });

      it('既に truncated=true の入力 idempotent 再 cap (text.length 不変) では warn が呼ばれない', () => {
        // 前回実行で既に truncated=true に変換済みかつ budget 内 (text.length 不変) のケース。
        // 新規データロスはないため重複アラートを抑制すべき (運用側で重複通知を避ける)。
        const pages: SummaryField[] = [
          {
            text: 'a'.repeat(MAX_PAGE_TEXT_LENGTH),
            truncated: true,
            originalLength: 1_000_000,
          },
        ];
        const { calls } = withWarnSpy(() => capPageResultsAggregate(pages));
        expect(calls.length).to.equal(0);
      });

      // #288 item 2: どのページが truncated されたか特定できるよう pageNumber を warn に含める契約。
      // pageNumber を持つ型 T (例: RawPageOcrResult) が渡された場合は page=<N> を出力する。
      it('pageNumber を持つ入力では warn message に page=<N> が含まれる', () => {
        const pages = [
          { text: 'a'.repeat(MAX_PAGE_TEXT_LENGTH + 10), truncated: false as const, pageNumber: 7 },
        ];
        const { calls } = withWarnSpy(() => capPageResultsAggregate(pages));
        expect(calls.length).to.be.at.least(1);
        const firstMessage = String(calls[0]?.[0] ?? '');
        expect(firstMessage).to.match(/page=7\b/);
      });

      // #288 item 2: pageNumber を持たない型 T (plain SummaryField 等) では page=unknown fallback。
      it('pageNumber を持たない入力では warn message に page=unknown が含まれる', () => {
        const pages: SummaryField[] = [
          { text: 'a'.repeat(MAX_PAGE_TEXT_LENGTH + 10), truncated: false },
        ];
        const { calls } = withWarnSpy(() => capPageResultsAggregate(pages));
        expect(calls.length).to.be.at.least(1);
        const firstMessage = String(calls[0]?.[0] ?? '');
        expect(firstMessage).to.match(/page=unknown\b/);
      });

      // #288 item 2 境界値: pageNumber=0 (falsy だが number) で page=0 が出る契約。
      // `typeof === 'number'` gate を `pageNumber > 0` に mutate する regression を捕捉する。
      it('pageNumber=0 でも page=0 が出る (falsy 扱い禁止)', () => {
        const pages = [
          { text: 'a'.repeat(MAX_PAGE_TEXT_LENGTH + 10), truncated: false as const, pageNumber: 0 },
        ];
        const { calls } = withWarnSpy(() => capPageResultsAggregate(pages));
        expect(calls.length).to.be.at.least(1);
        const firstMessage = String(calls[0]?.[0] ?? '');
        expect(firstMessage).to.match(/page=0\b/);
      });

      // #288 item 2 異常系: non-number pageNumber (string 等の silent 型逸脱) で unknown fallback。
      // `typeof === 'number'` gate を `pageNumber != null` に mutate する regression を捕捉する。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      it('non-number pageNumber (string 等) では page=unknown に fallback', () => {
        const pages = [
          {
            text: 'a'.repeat(MAX_PAGE_TEXT_LENGTH + 10),
            truncated: false as const,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            pageNumber: '7' as any,
          },
        ];
        const { calls } = withWarnSpy(() => capPageResultsAggregate(pages));
        expect(calls.length).to.be.at.least(1);
        const firstMessage = String(calls[0]?.[0] ?? '');
        expect(firstMessage).to.match(/page=unknown\b/);
      });

      // #283 Codex / silent-failure-hunter 指摘対応: truncated=true + budget でさらに短縮される
      // 追加データロスケースを warn で検知する契約。旧実装 `!page.truncated` gate では silent に通過していた。
      it('既 truncated=true でも aggregate budget でさらに短縮される場合は warn が呼ばれる', () => {
        // 4 pages 50k each fill 200k aggregate budget → 5th page (既 truncated=true) の budget 残 0
        // → capped.text.length=0 < page.text.length=50k で真の追加データロス発生
        const pages: SummaryField[] = [
          { text: 'a'.repeat(MAX_PAGE_TEXT_LENGTH), truncated: false },
          { text: 'b'.repeat(MAX_PAGE_TEXT_LENGTH), truncated: false },
          { text: 'c'.repeat(MAX_PAGE_TEXT_LENGTH), truncated: false },
          { text: 'd'.repeat(MAX_PAGE_TEXT_LENGTH), truncated: false },
          {
            text: 'e'.repeat(MAX_PAGE_TEXT_LENGTH),
            truncated: true,
            originalLength: 1_000_000,
          },
        ];
        const { calls, result } = withWarnSpy(() => capPageResultsAggregate(pages));

        const lastPage = result[4];
        expect(lastPage?.text.length).to.equal(0);
        // 5 ページ目の追加短縮で warn が呼ばれる (加えて他 page の cap があれば + その数)
        expect(calls.length).to.be.at.least(1);
        const messages = calls.map((c) => String(c[0] ?? '')).join('\n');
        expect(messages).to.match(/50000 → 0/);
      });
    });

    // #264: discriminated union 不変条件の runtime lock-in。
    // 型レベルでは `<T extends SummaryField>` で truncated=false ⟹ originalLength 不在を保証するが、
    // 実装バグで false path に originalLength を付与しないことを runtime でも明示検証する。
    describe('discriminated union 不変条件 (#264)', () => {
      it('truncated=false 経路の戻り値に originalLength キーが存在しない', () => {
        const pages: SummaryField[] = [
          { text: 'short', truncated: false },
          { text: 'also-short', truncated: false },
        ];
        const result = capPageResultsAggregate(pages);

        result.forEach((p) => {
          expect(p.truncated).to.be.false;
          expect(Object.prototype.hasOwnProperty.call(p, 'originalLength')).to.be.false;
        });
      });

      it('truncated=true 経路の戻り値に originalLength が存在し number 型である', () => {
        const pageSize = MAX_PAGE_TEXT_LENGTH;
        const pages: SummaryField[] = Array.from({ length: 10 }, () => ({
          text: 'a'.repeat(pageSize),
          truncated: false,
        }));

        const result = capPageResultsAggregate(pages);
        const truncatedPages = result.filter((p) => p.truncated);

        expect(truncatedPages.length).to.be.at.least(1);
        truncatedPages.forEach((p) => {
          expect(Object.prototype.hasOwnProperty.call(p, 'originalLength')).to.be.true;
          // assertTruncated で narrow (silent skip 回避)
          assertTruncated(p);
          expect(p.originalLength).to.be.a('number');
          expect(p.originalLength).to.be.at.least(p.text.length);
        });
      });

      it('入力 truncated=true + originalLength 付きの再 cap で元の originalLength が保持される', () => {
        // 前回実行で既に truncated=true + originalLength=1,000,000 だったページを再 cap する想定。
        // Math.max(originalFromPage, capped.originalLength) で過去情報が保存されることを lock-in。
        const pages: SummaryField[] = [
          { text: 'a'.repeat(MAX_PAGE_TEXT_LENGTH), truncated: true, originalLength: 1_000_000 },
          { text: 'b'.repeat(MAX_PAGE_TEXT_LENGTH), truncated: false },
          { text: 'c'.repeat(MAX_PAGE_TEXT_LENGTH), truncated: false },
          { text: 'd'.repeat(MAX_PAGE_TEXT_LENGTH), truncated: false },
          { text: 'e'.repeat(MAX_PAGE_TEXT_LENGTH), truncated: false },
        ];
        const result = capPageResultsAggregate(pages);
        const first = result[0];
        expect(first).to.exist;
        assertTruncated(first!);
        expect(first!.originalLength).to.equal(1_000_000);
      });

      it('meta フィールド (pageNumber/inputTokens/outputTokens) が全経路で保持される', () => {
        // short path と cap path が混在するサイズで検証
        const pages = [
          // page 1: short path (budget 内)
          { text: 'p1', truncated: false as const, pageNumber: 1, inputTokens: 100, outputTokens: 50 },
          // page 2: cap path (per-page cap 超過)
          {
            text: 'b'.repeat(MAX_PAGE_TEXT_LENGTH + 10),
            truncated: false as const,
            pageNumber: 2,
            inputTokens: 200,
            outputTokens: 60,
          },
        ];
        const result = capPageResultsAggregate(pages);

        expect(result[0]?.pageNumber).to.equal(1);
        expect(result[0]?.inputTokens).to.equal(100);
        expect(result[0]?.outputTokens).to.equal(50);
        expect(result[1]?.pageNumber).to.equal(2);
        expect(result[1]?.inputTokens).to.equal(200);
        expect(result[1]?.outputTokens).to.equal(60);
      });
    });

    // #284: aggregate cap path でも capPageText L39 と同等の dev-assert を設置。
    // production は no-op (process.env.NODE_ENV === 'production' で early return)。
    // 型契約 (SummaryField discriminated union) を破った入力を dev 環境で早期検知する。
    describe('dev-assert (#284)', () => {
      it('正常な short-path 入力では throw しない', () => {
        const pages: SummaryField[] = [
          { text: 'short', truncated: false },
          { text: 'also-short', truncated: false },
        ];
        expect(() => capPageResultsAggregate(pages)).to.not.throw();
      });

      it('short-path で originalLength が混入した不正入力は dev 環境で throw する (evaluator LOW 指摘対応)', () => {
        const invalidPage = makeInvalidPage(999_999, 'short');
        expect(() => capPageResultsAggregate([invalidPage])).to.throw(/invariant violation/);
      });

      // #288 item 6: prod は throw せず safeLogError emit。実呼出検証は
      // textCapProdInvariantContract.test.ts (grep) + Phase 3 (動的) で二段 lock-in。
      it('production では invalid 入力でも throw しない (safeLogError 経由で emit)', () => {
        withNodeEnv('production', () => {
          const invalidPage = makeInvalidPage(999_999, 'short');
          expect(() => capPageResultsAggregate([invalidPage])).to.not.throw();
        });
      });

      // #288 item 6 silent-failure-hunter S2 + Codex MED: context.documentId 伝搬 signature 拡張。
      it('context.documentId を受け取り throw しない (signature 互換)', () => {
        const pages: SummaryField[] = [{ text: 'short', truncated: false }];
        expect(() => capPageResultsAggregate(pages, { documentId: 'doc-123' })).to.not.throw();
      });

      // #297 Codex HIGH + #293: context.drainSink 渡し signature 拡張。fire-and-forget 廃止対応。
      // prod 分岐で handleAggregateInvariantViolation が drainSink array に Promise を push する
      // 経路と、caller が await drain 可能になる後方互換 signature を lock-in する。
      // push 本体の動的検証は environment/require 依存が大きいため #299 + grep contract に委譲し、
      // 本ブロックは signature/throw 挙動の最小 runtime 契約のみ保持する。
      // #304 naming: context field `pendingLogs` → `drainSink` にリネーム済。
      it('context.drainSink を受け取り throw しない (signature 互換)', () => {
        const pages: SummaryField[] = [{ text: 'short', truncated: false }];
        const drainSink: Promise<void>[] = [];
        expect(() =>
          capPageResultsAggregate(pages, { documentId: 'doc-456', drainSink }),
        ).to.not.throw();
      });

      it('prod 環境 + invalid 入力 + drainSink 渡しで throw しない (#297 drain 経路)', () => {
        withNodeEnv('production', () => {
          const invalidPage = makeInvalidPage(999_999, 'short');
          const drainSink: Promise<void>[] = [];
          expect(() =>
            capPageResultsAggregate([invalidPage], {
              documentId: 'doc-789',
              drainSink,
            }),
          ).to.not.throw();
        });
      });

      it('dev 環境 + invalid 入力 + drainSink 渡しでも従来通り throw する (#284 契約維持)', () => {
        const invalidPage = makeInvalidPage(999_999, 'short');
        const drainSink: Promise<void>[] = [];
        expect(() =>
          capPageResultsAggregate([invalidPage], {
            documentId: 'doc-dev',
            drainSink,
          }),
        ).to.throw(/invariant violation/);
        // dev 分岐は throw のみで push せず (prod 分岐専用) — drainSink は空のまま。
        expect(drainSink.length).to.equal(0);
      });
    });

    // #294: mixed-input ([valid, invalid, valid]) で assert が正しい位置で fire することを検証。
    // silent failure (invalid 要素が prod で silent に通過する regression) と
    // 継続保証 (prod では全要素 return、caller 側 pass-through が成立) の二段 lock-in。
    describe('mixed-input invariant 挙動 (#294)', () => {
      it('mixed-input [valid, invalid, valid] で dev 環境は invariant violation で throw する', () => {
        const pages: SummaryField[] = [
          { text: 'valid1', truncated: false },
          makeInvalidPage(999, 'invalid'),
          { text: 'valid2', truncated: false },
        ];
        expect(() => capPageResultsAggregate(pages)).to.throw(/invariant violation/);
      });

      it('mixed-input prod 環境では全ページを return し invalid 要素は pass-through (AC-5 継続保証)', () => {
        withNodeEnv('production', () => {
          const pages: SummaryField[] = [
            { text: 'valid1', truncated: false },
            makeInvalidPage(999, 'invalid'),
            { text: 'valid2', truncated: false },
          ];
          const result = capPageResultsAggregate(pages);
          expect(result).to.have.length(3);
          expect(result[0]?.text).to.equal('valid1');
          expect(result[2]?.text).to.equal('valid2');
        });
      });

      it('mixed-input prod で errorLogger require 失敗時は push 0 件 + console.error fallback (unit test 環境)', () => {
        // 本 unit test 環境 (mocha + ts-node、admin 未初期化) では errorLogger の top-level
        // `admin.firestore()` が FirebaseAppError を throw → `require('./errorLogger')` が
        // textCap.ts の catch (loadErr) に落ちて console.error fallback する。
        // push 経路は走らないため drainSink.length === 0 が決定論的。
        // 実運用 (admin 初期化済み) での push 2 件動作検証は Issue #299 で担保予定。
        withNodeEnv('production', () => {
          const pages: SummaryField[] = [
            { text: 'valid1', truncated: false },
            makeInvalidPage(111, 'invalid1'),
            { text: 'valid2', truncated: false },
            makeInvalidPage(222, 'invalid2'),
          ];
          const drainSink: Promise<void>[] = [];
          const result = capPageResultsAggregate(pages, {
            documentId: 'mixed-doc',
            drainSink,
          });
          expect(result).to.have.length(4);
          expect(drainSink.length).to.equal(0);
        });
      });
    });
  });

  describe('MAX_SUMMARY_LENGTH (Issue #209)', () => {
    it('サマリー上限定数が想定値である', () => {
      expect(MAX_SUMMARY_LENGTH).to.equal(30_000);
    });

    it('境界値: text.length === MAX_SUMMARY_LENGTH は切り詰めない', () => {
      const input = 'a'.repeat(MAX_SUMMARY_LENGTH);
      const result = capPageText(input, MAX_SUMMARY_LENGTH);

      expect(result.text.length).to.equal(MAX_SUMMARY_LENGTH);
      expect(result.truncated).to.be.false;
    });

    it('境界値: text.length === MAX_SUMMARY_LENGTH + 1 は切り詰める', () => {
      const input = 'a'.repeat(MAX_SUMMARY_LENGTH + 1);
      const result = capPageText(input, MAX_SUMMARY_LENGTH);

      assertTruncated(result);
      expect(result.originalLength).to.equal(MAX_SUMMARY_LENGTH + 1);
      expect(result.text.length).to.be.at.most(MAX_SUMMARY_LENGTH);
    });

    it('巨大サマリー (1.1M chars 暴走相当) でも cap 内に収まる', () => {
      const input = 'x'.repeat(1_100_000);
      const result = capPageText(input, MAX_SUMMARY_LENGTH);

      assertTruncated(result);
      expect(result.originalLength).to.equal(1_100_000);
      expect(result.text.length).to.be.at.most(MAX_SUMMARY_LENGTH);
    });

    it('cap適用後のsummary は Firestore 1 MiB 制限内に余裕で収まる', () => {
      const input = 'あ'.repeat(MAX_SUMMARY_LENGTH * 2);
      const result = capPageText(input, MAX_SUMMARY_LENGTH);
      const bytesSize = Buffer.byteLength(result.text, 'utf8');

      expect(bytesSize).to.be.at.most(1_048_576);
    });
  });

  describe('Firestore書き込みサイズの実害確認', () => {
    it('cap適用後のpageResults配列はFirestore 1MiB制限内に収まる', () => {
      const pages = Array.from({ length: 30 }, (_, i) => ({
        text: 'あ'.repeat(MAX_PAGE_TEXT_LENGTH * 2), // 各ページ大きすぎ
        truncated: false as const,
        pageNumber: i + 1,
        inputTokens: 100,
        outputTokens: 50000,
      }));

      const capped = capPageResultsAggregate(pages);
      const serialized = JSON.stringify(capped);
      const bytesSize = Buffer.byteLength(serialized, 'utf8');

      // 1 MiB = 1,048,576 bytes
      expect(bytesSize).to.be.at.most(1_048_576);
    });
  });
});
