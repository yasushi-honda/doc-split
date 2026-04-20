/**
 * grep-based contract test で使う brace / paren nesting 抽出 helper
 * (Issue #302, PR #301 /simplify HIGH + codex Low 1 follow-up, Issue #312 API 改善)
 *
 * 5 ファイルで同一実装が重複していた contract test の関数本体/ブロック抽出ロジックを
 * 共通化する。anchor (RegExp | string) と nesting 種別 (brace / paren) のみが差分。
 * #302 で helper 化し、#312 PR-2 で caller 側の local alias wrapper (extractFunctionBody 等) を
 * 撤去して extractBraceBlock(source, ANCHOR) 直接呼出に統一した。
 *
 * 詳細な位置づけは docs/context/test-strategy.md (#308) を参照。
 *
 * #312 API 改善:
 * - `startAfterAnchor: boolean` → `anchorMode: 'from-start' | 'after-match'` (boolean-blindness 解消)
 * - 戻り値 `string` → `string | null` (anchor/開き文字不在を型で表現、caller の silent PASS 防御)
 * - `ExtractOptions` は外部参照ゼロのためインライン型に降格
 */

/**
 * anchor マッチから開き文字 (`{` / `(`) を探索する起点の指定方法。
 *
 * - `'from-start'` (デフォルト): anchor マッチ**先頭** (match.index) から最初の開き文字を探す。
 * - `'after-match'`: anchor マッチ**末尾** (match.index + match[0].length) から最初の開き文字を探す。
 *   anchor 自体が「開始位置の目印となるテキスト」を末尾に含み、anchor 直後の block のみを狭く
 *   抽出したいケース (例: `try {...} catch (e) ` の先で catch 本体のみを抽出) に使う。
 *
 * #312 type-design-analyzer 推奨 #2: 外部 caller が mode 値を型安全に使うため export する。
 */
export type AnchorMode = 'from-start' | 'after-match';

/**
 * source 内で anchor にマッチした位置以降の最初の `{` から、対応する `}` までを抽出する。
 *
 * 波括弧のネストカウントで範囲を特定するシンプル実装。対象ソースが文字列/正規表現/
 * テンプレートリテラル内に裸の `{` `}` を含む場合は誤判定する可能性があるため、
 * 将来そのケースに遭遇したら AST ベース抽出への移行を検討する。
 *
 * @param source - 対象ソース全体。直前の extract 呼出結果を chain する用途で `null` も受け取り、
 *                 その場合は `null` を透過する (caller で都度 null ガードする boilerplate を回避)。
 * @param anchor - RegExp または string。string の場合は substring 検索 (`indexOf`、最初の出現位置)。
 *                 RegExp の場合は `match.index` からブロック開始位置を決める。
 * @param options.anchorMode - 起点指定 (`'from-start'` (default) / `'after-match'`)
 * @returns 抽出したブロック文字列 (`{` から `}` を両端に含む)、source が `null` もしくは
 *          anchor/開き文字/対応する閉じ文字/balance 不成立のいずれかで `null`。caller は
 *          `expect(block).to.not.be.null` で failure を明示化すること (silent PASS 防御、
 *          #311 C1/C2 教訓)。とくに `.to.not.match(re)` は chai で `null` に対し silent PASS
 *          するため、同一 `it` 内で先行 null ガードが必須 (#312 silent-failure-hunter I1)。
 */
export function extractBraceBlock(
  source: string | null,
  anchor: RegExp | string,
  options: { anchorMode?: AnchorMode } = {},
): string | null {
  return extractBalancedBlock(source, anchor, '{', '}', options);
}

/**
 * source 内で anchor にマッチした位置以降の最初の `(` から、対応する `)` までを抽出する。
 *
 * `safeLogError(...)` 等の呼出引数ブロックに scope を絞り、関数本体全体を対象にした
 * 正規表現での偽陽性 (同名ローカル変数・他 logger 呼出・文字列リテラル等) を防ぐ。
 *
 * @param source - 対象ソース (関数本体等)。`null` 入力は透過して `null` を返す (chain 用途)。
 * @param anchor - RegExp または string。RegExp 推奨 (例: `/\bsafeLogError\s*\(/`)
 * @param options.anchorMode - 起点指定 (`'from-start'` (default) / `'after-match'`)
 * @returns 抽出したブロック文字列 (`(` から `)` を両端に含む)、source が `null` もしくは
 *          anchor/開き文字/対応する閉じ文字/balance 不成立のいずれかで `null`。caller は
 *          `expect(args).to.not.be.null` で failure を明示化すること (silent PASS 防御、
 *          #311 C1/C2 / #312 Evaluator AC7 教訓)。`.to.not.match(re)` の null silent PASS
 *          経路は extractBraceBlock と同様 (#312 silent-failure-hunter I1)。
 */
export function extractParenBlock(
  source: string | null,
  anchor: RegExp | string,
  options: { anchorMode?: AnchorMode } = {},
): string | null {
  return extractBalancedBlock(source, anchor, '(', ')', options);
}

function extractBalancedBlock(
  source: string | null,
  anchor: RegExp | string,
  openCh: string,
  closeCh: string,
  options: { anchorMode?: AnchorMode },
): string | null {
  if (source === null) return null;
  const mode = options.anchorMode ?? 'from-start';
  const startIdx = resolveAnchorIndex(source, anchor, mode);
  if (startIdx === -1) return null;

  const openIdx = source.indexOf(openCh, startIdx);
  if (openIdx === -1) return null;

  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) {
        return source.slice(openIdx, i + 1);
      }
    }
  }
  return null;
}

function resolveAnchorIndex(
  source: string,
  anchor: RegExp | string,
  mode: AnchorMode,
): number {
  let baseIdx: number;
  let matchLen: number;
  if (typeof anchor === 'string') {
    baseIdx = source.indexOf(anchor);
    if (baseIdx === -1) return -1;
    matchLen = anchor.length;
  } else {
    // #312 CodeRabbit Minor: global flag (/g) 付き RegExp は String.prototype.match が index を
    // 含まない配列を返し、silent に「anchor 不在」扱い (return -1) に退化する。現状 caller は
    // /g を使っていないが、本 helper の silent PASS 防御精神 (#311 C1/C2, #312 AC2) と整合する
    // よう明示的に reject して early throw で regression を可視化する。
    if (anchor.flags.includes('g')) {
      throw new Error(
        `[extractBalancedBlock] global flag (/g) 付き RegExp anchor は非対応 — ` +
          `match.index が undefined になり silent に anchor 不在扱いになる。` +
          `anchor.source: ${anchor.source}, flags: ${anchor.flags}`,
      );
    }
    const match = source.match(anchor);
    if (!match || match.index === undefined) return -1;
    baseIdx = match.index;
    matchLen = match[0].length;
  }
  // #312 type-design-analyzer 推奨 #3: 新しい AnchorMode 追加時に silent に 'from-start' 扱いに
  // 回帰しないよう exhaustive check で lock-in する。
  switch (mode) {
    case 'from-start':
      return baseIdx;
    case 'after-match':
      return baseIdx + matchLen;
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}
