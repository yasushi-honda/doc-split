/**
 * 事業所マスター混入予防のための共通バリデーション (Issue #506)
 *
 * BE/FE/import-masters.js 全 write 経路で同等の collision-based 判定を実行できるよう
 * shared に集約。BE extractors.ts の computeCommonShortMasters はここから re-export
 * (drift 防止)。
 *
 * NOTE: normalizeForMatching は BE textNormalizer.ts と同等仕様。同等性は
 * `functions/test/sharedNormalize.test.ts` で assertion テストする (drift 検出)。
 */

/** 全角→半角変換 (BE convertFullWidthToHalfWidth と同等仕様) */
function convertFullWidthToHalfWidth(str: string): string {
  if (!str) return '';
  return str
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[Ａ-Ｚａ-ｚ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/／/g, '/')
    .replace(/．/g, '.')
    .replace(/－/g, '-')
    .replace(/（/g, '(')
    .replace(/）/g, ')');
}

/** マッチング用テキスト正規化 (BE normalizeForMatching と同等仕様) */
export function normalizeForMatching(text: string): string {
  if (!text) return '';
  let normalized = convertFullWidthToHalfWidth(text);
  normalized = normalized
    .replace(/[\s　]+/g, '')
    .replace(/[・．.。、，,]/g, '')
    .replace(/[-－ー]/g, '')
    .toLowerCase();
  return normalized;
}

/** 短マスターと判定する name 長 (正規化後)。length < N → 短マスター扱い */
export const COMMON_SHORT_LENGTH_THRESHOLD = 4;

/** 短マスターが「common」と判定される collision 数。他マスター N+ の substring に含まれる → common */
export const COMMON_SHORT_COLLISION_THRESHOLD = 2;

/** computeCommonShortMasters / validateOfficeMasterImport の入力型 */
export interface OfficeMasterLike {
  id: string;
  name: string;
}

/**
 * マスター name 同士の substring 衝突から「common short master」id 集合を返す。
 *
 * 短マスター (normalize 後 length < COMMON_SHORT_LENGTH_THRESHOLD) について、他マスター
 * name の substring として COMMON_SHORT_COLLISION_THRESHOLD 件以上出現するものを common
 * 扱いとする。CSV import 由来の汚染マスター (「ケア」「ニック」等) を動的に判定可能。
 *
 * @param masters 全 office マスター (現状 Firestore データ)
 * @returns common 扱いする master id の Set
 */
export function computeCommonShortMasters(masters: OfficeMasterLike[]): Set<string> {
  const commonIds = new Set<string>();
  const normalizedNames = masters.map((m) => ({
    id: m.id,
    name: m.name,
    normalized: normalizeForMatching(m.name),
  }));
  const shortMasters = normalizedNames.filter(
    (m) => m.normalized.length > 0 && m.normalized.length < COMMON_SHORT_LENGTH_THRESHOLD,
  );

  for (const candidate of shortMasters) {
    let collisions = 0;
    for (const other of normalizedNames) {
      if (other.id === candidate.id) continue;
      if (other.normalized.length <= candidate.normalized.length) continue;
      if (other.normalized.includes(candidate.normalized)) {
        collisions++;
        if (collisions >= COMMON_SHORT_COLLISION_THRESHOLD) {
          commonIds.add(candidate.id);
          break;
        }
      }
    }
  }
  return commonIds;
}

/** validateOfficeMasterImport の出力種別 */
export type ImportValidationVerdict =
  | { kind: 'ok' } // 通常マスター、登録可
  | { kind: 'warning-short-uncommon' } // 短マスターだが衝突なし、登録可だが操作者に警告
  | { kind: 'reject-short-common' }; // 短マスター + 衝突あり、登録拒否

/**
 * 1 件の新規 office マスターを既存マスター集合と照合して登録可否を判定する。
 *
 * 用途: import-masters.js / seedMasters.ts / useMasters.ts の write 経路で
 * 同等のロジックを使う single source of truth.
 *
 * @param newMaster 新規追加候補 (id は仮、または auto ID 化前)
 * @param existing 既存マスター全件
 * @returns 判定結果 (ok / warning-short-uncommon / reject-short-common)
 */
export function validateOfficeMasterImport(
  newMaster: OfficeMasterLike,
  existing: OfficeMasterLike[],
): ImportValidationVerdict {
  const normalized = normalizeForMatching(newMaster.name);
  if (normalized.length === 0) {
    return { kind: 'reject-short-common' }; // 空文字は明確に reject
  }
  if (normalized.length >= COMMON_SHORT_LENGTH_THRESHOLD) {
    return { kind: 'ok' };
  }
  // length < THRESHOLD: 既存マスターとの collision を計測
  let collisions = 0;
  for (const other of existing) {
    if (other.id === newMaster.id) continue;
    const otherNormalized = normalizeForMatching(other.name);
    if (otherNormalized.length <= normalized.length) continue;
    if (otherNormalized.includes(normalized)) {
      collisions++;
      if (collisions >= COMMON_SHORT_COLLISION_THRESHOLD) {
        return { kind: 'reject-short-common' };
      }
    }
  }
  return { kind: 'warning-short-uncommon' };
}
