/**
 * グループキー正規化ユーティリティ
 *
 * documentGroups.groupKey と同等の正規化を frontend 側で再現する。
 * backend 実装: functions/src/utils/groupAggregation.ts の normalizeGroupKey
 *
 * 書類マスター名から groupKey と同形式のキーを生成し、
 * documentGroups の groupKey と照合して category 情報を join するために使用する。
 *
 * 仕様:
 * - 全角英数字 → 半角
 * - 英大文字 → 小文字
 * - 半角・全角空白・タブ・改行を除去
 * - 注: カタカナ/ひらがなの相互変換は行わない（backend 仕様準拠）
 *
 * ⚠ backend の normalizeGroupKey を変更する際は、本ファイルとテストデータも同期更新すること。
 */

export function normalizeGroupKey(value: string | undefined | null): string {
  if (!value) return '';

  return value
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) =>
      String.fromCharCode(s.charCodeAt(0) - 0xfee0),
    )
    .toLowerCase()
    .replace(/[\s\u3000]/g, '')
    .trim();
}
