/**
 * Bug master pattern fixture (Issue #506)
 *
 * kanameone / cocoro 本番で発見された短マスター汚染パターンの集約。BE classifier
 * (PR #502 v2 collision-based 抑制) + shared validation (Issue #506) の意図しない
 * rollback を回帰テストで検出するための knowledge accumulation。
 *
 * 新規 bug pattern を発見したらここに追加すること。fixture は extractors.test.ts /
 * sharedValidation.test.ts 等の複数テストから参照される。
 */

import type { OfficeMaster } from '../../src/utils/extractors';

/**
 * 既知の汚染 office マスター pattern。
 *
 * 各エントリは「過去の本番事案」から抽出された短文字列マスター。
 * length と collision の組み合わせで classifier / validation が drift していないか
 * 検証するために利用する。
 */
export const BUG_OFFICE_MASTER_PATTERNS: Array<{
  /** 識別ラベル (テスト名に使う) */
  label: string;
  /** 検出環境 */
  source: 'kanameone' | 'cocoro';
  /** 汚染 master データ */
  master: OfficeMaster;
  /** 他マスター name の substring に頻出する想定の長マスター集 (回帰テストで衝突起こす) */
  collidingLongMasters: OfficeMaster[];
}> = [
  {
    label: 'ケア (kanameone, 2 文字, 765 件 officeId 影響)',
    source: 'kanameone',
    master: { id: 'bug-care', name: 'ケア', isDuplicate: false },
    collidingLongMasters: [
      { id: 'long-nichii', name: 'ニチイケアセンター岩倉', isDuplicate: false },
      { id: 'long-eskea', name: 'エスケアステーション開明', isDuplicate: false },
      { id: 'long-pana', name: 'パナソニックエイジフリーケアセンター名古屋上小田井', isDuplicate: false },
    ],
  },
  {
    label: 'ニック (kanameone, 3 文字, 124 件 officeId 影響)',
    source: 'kanameone',
    master: { id: 'bug-nick', name: 'ニック', isDuplicate: false },
    collidingLongMasters: [
      { id: 'long-seisho', name: '正翔会クリニック小牧', isDuplicate: false },
      { id: 'long-kinoka', name: '木の香往診クリニック', isDuplicate: false },
      { id: 'long-inoue', name: '井上内科クリニック', isDuplicate: false },
    ],
  },
  {
    label: 'ゆい (cocoro, 2 文字)',
    source: 'cocoro',
    master: { id: 'bug-yui', name: 'ゆい', isDuplicate: false },
    collidingLongMasters: [
      // ゆい は collision が低い汚染パターン (id が日本語で混入痕跡)。
      // 衝突生成のための実例代替を 2 件追加。
      { id: 'long-yuihaya', name: 'ゆいまーる事業所', isDuplicate: false },
      { id: 'long-yuibo', name: 'ゆいの里デイサービス', isDuplicate: false },
    ],
  },
  {
    label: '港北区 (cocoro, 3 文字, 地域名)',
    source: 'cocoro',
    master: { id: 'bug-kohoku', name: '港北区', isDuplicate: false },
    collidingLongMasters: [
      { id: 'long-kohoku-a', name: '港北区社会福祉協議会本部', isDuplicate: false },
      { id: 'long-kohoku-b', name: '港北区高田支援事業所', isDuplicate: false },
    ],
  },
];

/**
 * Legitimate な短マスター pattern (collision なし、PR #502 v1 巻き込み事案の対象)。
 *
 * これらが共通短マスター抑制で誤検出されないことを境界値テストで保証する。
 * 本番の Firestore auto ID 由来 (kanameone「ピース」「わかば」「ニコット」 / cocoro「てらす」)
 * に近い文字種で構成。
 */
export const LEGITIMATE_SHORT_OFFICE_MASTERS: OfficeMaster[] = [
  { id: 'legit-piece', name: 'ピース', isDuplicate: false },
  { id: 'legit-wakaba', name: 'わかば', isDuplicate: false },
  { id: 'legit-terasu', name: 'てらす', isDuplicate: false },
  { id: 'legit-nicotto', name: 'ニコット', isDuplicate: false }, // 4 文字、length 境界
];
