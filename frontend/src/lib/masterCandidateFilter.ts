/**
 * マスター選択コンボボックス(MasterSelectField)の候補フィルタ・並び順ロジック(Issue #1030)
 *
 * cmdk既定のfuzzy matchスコア(`command-score`)は、区切り文字(空白・記号)を挟まない
 * 文字列の途中でのマッチに強いペナルティを課す設計になっている。日本語の複合書類種別名
 * (例:「訪問看護報告書」「モニタリング報告書」)は単語間に区切り文字がないため、
 * 「報告書」で検索した際にどれも同程度の低スコアになり、単体の完全一致マスタが
 * 存在しない場合は事実上タイブレークが元のFirestore取得順(ドキュメントID順、
 * 利用頻度やシンプルさとは無関係)に委ねられてしまう(kaname報告③)。
 *
 * 前方一致/部分一致の2段階ティアに単純化し、同ティア内は候補文字列が短い
 * (よりシンプルな)ものほど上位に来るよう明示的にスコアリングする。
 */
export function masterCandidateFilter(value: string, search: string): number {
  if (!search) return 1;

  const normalizedValue = value.toLowerCase();
  const normalizedSearch = search.toLowerCase();

  if (normalizedValue === normalizedSearch) return 1;
  if (!normalizedValue.includes(normalizedSearch)) return 0;

  const tierScore = normalizedValue.startsWith(normalizedSearch) ? 0.9 : 0.7;
  // 同ティア内のタイブレーク: 候補が長いほどわずかに減点し、短い(シンプルな)候補を優先する。
  // 60文字で頭打ちにし、極端に長い候補でもティア間の順位が逆転しないようにする
  // (前方一致ティアの最小値0.85 > 部分一致ティアの最大値0.7を常に維持)。
  const lengthPenalty = Math.min(normalizedValue.length, 60) / 1200;
  return tierScore - lengthPenalty;
}
