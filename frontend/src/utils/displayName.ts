/**
 * 表示名ヘルパー関数
 * 同姓同名・同名事業所の区別表示に使用
 */

/**
 * マスターの表示名を生成
 * notesがある場合は「名前（notes）」形式で返す
 *
 * @param name マスター名
 * @param notes 区別用補足情報
 * @returns 表示用の名前
 *
 * @example
 * getDisplayName("田中太郎", "北名古屋在住") // "田中太郎（北名古屋在住）"
 * getDisplayName("田中太郎", undefined) // "田中太郎"
 * getDisplayName("田中太郎", "") // "田中太郎"
 */
export function getDisplayName(name: string, notes?: string | null): string {
  if (notes && notes.trim()) {
    return `${name}（${notes.trim()}）`;
  }
  return name;
}

/**
 * 表示名から元の名前を抽出
 * 「名前（notes）」形式から名前部分のみを取得
 *
 * @param displayName 表示名
 * @returns 元の名前
 *
 * @example
 * extractNameFromDisplay("田中太郎（北名古屋在住）") // "田中太郎"
 * extractNameFromDisplay("田中太郎") // "田中太郎"
 */
export function extractNameFromDisplay(displayName: string): string {
  const match = displayName.match(/^(.+?)（.+）$/);
  return match?.[1] ?? displayName;
}
