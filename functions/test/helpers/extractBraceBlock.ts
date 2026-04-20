/**
 * grep-based contract test で使う brace / paren nesting 抽出 helper
 * (Issue #302, PR #301 /simplify HIGH + codex Low 1 follow-up, Issue #312 API 改善)
 *
 * 5 ファイルで同一実装が重複していた extractFunctionBody / extractAggregateCapBlock /
 * extractAssertFunctionBody / extractHelperFunctionBody / extractProdBranch を
 * 共通化する。anchor (RegExp | string) と nesting 種別 (brace / paren) のみが差分。
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
 */
type AnchorMode = 'from-start' | 'after-match';

/**
 * source 内で anchor にマッチした位置以降の最初の `{` から、対応する `}` までを抽出する。
 *
 * 波括弧のネストカウントで範囲を特定するシンプル実装。対象ソースが文字列/正規表現/
 * テンプレートリテラル内に裸の `{` `}` を含む場合は誤判定する可能性があるため、
 * 将来そのケースに遭遇したら AST ベース抽出への移行を検討する。
 *
 * @param source - 対象ソース全体。直前の extract 呼出結果を chain する用途で `null` も受け取り、
 *                 その場合は `null` を透過する (caller で都度 null ガードする boilerplate を回避)。
 * @param anchor - RegExp または string。string の場合は完全一致 (`indexOf`) で検索する。
 *                 RegExp の場合は `match.index` からブロック開始位置を決める。
 * @param options.anchorMode - 起点指定 (`'from-start'` (default) / `'after-match'`)
 * @returns 抽出したブロック文字列 (`{` から `}` を両端に含む)、source が `null` もしくは
 *          anchor/開き文字/対応する閉じ文字が見つからない場合は `null`。caller は
 *          `expect(block).to.not.be.null` で failure を明示化すること (silent PASS 防御、
 *          #311 C1/C2 教訓)。
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
 *          anchor/開き文字/対応する閉じ文字が見つからない場合は `null`。caller は
 *          `expect(args).to.not.be.null` で failure を明示化すること (silent PASS 防御、
 *          #311 C1/C2 / #312 Evaluator AC7 教訓)。
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
  if (typeof anchor === 'string') {
    const idx = source.indexOf(anchor);
    if (idx === -1) return -1;
    return mode === 'after-match' ? idx + anchor.length : idx;
  }
  const match = source.match(anchor);
  if (!match || match.index === undefined) return -1;
  return mode === 'after-match' ? match.index + match[0].length : match.index;
}
