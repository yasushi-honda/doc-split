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
 * Firestore doc ID が name 文字列そのものになっている「id===name」signature を
 * 持つマスターの id 集合を返す (Issue #707)。
 *
 * CSV import 由来の contamination（kanameone環境の「かいと」「福の里」等、
 * Issue #704/#699/#698 参照）は通常の auto-ID (`1a0zN2OehohAdvFo7kdH` 等) ではなく
 * doc ID が name と一致する異常パターンを持つ。この signature は name の文字数に
 * 依存せず発生しうるため（例: 7文字の「訪問介護かいと」）、
 * computeCommonShortMasters の短マスター (length<4) 限定の collision 判定とは
 * 独立したチェックとして提供する。
 *
 * 注意 (#707 調査結果): id===name は contamination の必要十分条件ではない。
 * dev環境の scripts/samples/offices.csv 由来サンプルマスター等、legitimate な
 * データでも同じ signature が成立しうることを実データで確認済み。実際の
 * contamination 確定には #704 のように「同一/類似名の正規 auto-ID マスターが
 * 別途存在するか」の手動確認が必要なため、本関数の出力は自動 fail 判定ではなく
 * 手動調査の絞り込みに用いること。
 *
 * @param masters 全 office マスター (現状 Firestore データ)
 * @returns id===name パターンに該当する master id の Set
 */
export function computeIdEqualsNameMasters(masters: OfficeMasterLike[]): Set<string> {
  const ids = new Set<string>();
  for (const master of masters) {
    if (master.name.length > 0 && master.id === master.name) {
      ids.add(master.id);
    }
  }
  return ids;
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
