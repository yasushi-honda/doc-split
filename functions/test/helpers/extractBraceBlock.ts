/**
 * grep-based contract test で使う brace / paren nesting 抽出 helper
 * (Issue #302, PR #301 /simplify HIGH + codex Low 1 follow-up)
 *
 * 5 ファイルで同一実装が重複していた extractFunctionBody / extractAggregateCapBlock /
 * extractAssertFunctionBody / extractHelperFunctionBody / extractProdBranch を
 * 共通化する。anchor (RegExp | string) と nesting 種別 (brace / paren) のみが差分。
 *
 * 詳細な位置づけは docs/context/test-strategy.md (#308) を参照。
 */

export interface ExtractOptions {
  /**
   * true の場合、anchor マッチの**末尾** (match.index + match[0].length) から
   * 最初の開き文字を探す。anchor 自体が「開始位置の目印となるテキスト」を末尾に含む
   * ケース (例: `try {...} catch (e) ` の先で catch 本体のみを抽出したいケース) に使う。
   * デフォルト false: anchor マッチ**先頭** (match.index) から最初の開き文字を探す。
   */
  startAfterAnchor?: boolean;
}

/**
 * source 内で anchor にマッチした位置以降の最初の `{` から、対応する `}` までを抽出する。
 *
 * 波括弧のネストカウントで範囲を特定するシンプル実装。対象ソースが文字列/正規表現/
 * テンプレートリテラル内に裸の `{` `}` を含む場合は誤判定する可能性があるため、
 * 将来そのケースに遭遇したら AST ベース抽出への移行を検討する。
 *
 * @param source - 対象ソース全体
 * @param anchor - RegExp または string。string の場合は完全一致 (`indexOf`) で検索する。
 *                 RegExp の場合は `match.index` からブロック開始位置を決める。
 * @param options.startAfterAnchor - anchor マッチ末尾から探索する (制御フロー近接性の lock-in 用)
 * @returns 抽出したブロック文字列 (`{` から `}` を両端に含む)、anchor 不在時は空文字
 */
export function extractBraceBlock(
  source: string,
  anchor: RegExp | string,
  options: ExtractOptions = {},
): string {
  return extractBalancedBlock(source, anchor, '{', '}', options);
}

/**
 * source 内で anchor にマッチした位置以降の最初の `(` から、対応する `)` までを抽出する。
 *
 * `safeLogError(...)` 等の呼出引数ブロックに scope を絞り、関数本体全体を対象にした
 * 正規表現での偽陽性 (同名ローカル変数・他 logger 呼出・文字列リテラル等) を防ぐ。
 *
 * @param source - 対象ソース (関数本体等)
 * @param anchor - RegExp または string。RegExp 推奨 (例: `/\bsafeLogError\s*\(/`)
 * @param options.startAfterAnchor - anchor マッチ末尾から探索する
 * @returns 抽出したブロック文字列 (`(` から `)` を両端に含む)、anchor 不在時は空文字
 */
export function extractParenBlock(
  source: string,
  anchor: RegExp | string,
  options: ExtractOptions = {},
): string {
  return extractBalancedBlock(source, anchor, '(', ')', options);
}

function extractBalancedBlock(
  source: string,
  anchor: RegExp | string,
  openCh: string,
  closeCh: string,
  options: ExtractOptions,
): string {
  const startIdx = resolveAnchorIndex(source, anchor, options.startAfterAnchor ?? false);
  if (startIdx === -1) return '';

  const openIdx = source.indexOf(openCh, startIdx);
  if (openIdx === -1) return '';

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
  return '';
}

function resolveAnchorIndex(
  source: string,
  anchor: RegExp | string,
  startAfterAnchor: boolean,
): number {
  if (typeof anchor === 'string') {
    const idx = source.indexOf(anchor);
    if (idx === -1) return -1;
    return startAfterAnchor ? idx + anchor.length : idx;
  }
  const match = source.match(anchor);
  if (!match || match.index === undefined) return -1;
  return startAfterAnchor ? match.index + match[0].length : match.index;
}
