/**
 * shared/officeMasterValidation のテスト (Issue #506)
 *
 * - validateOfficeMasterImport の 3 verdict (ok / warning-short-uncommon / reject-short-common)
 * - shared 版 normalizeForMatching と BE 版 (textNormalizer.ts) の同等性
 *   → drift 発生時に CI 失敗で検出 (single source of truth 保証)
 */

import { expect } from 'chai';
import {
  validateOfficeMasterImport,
  computeCommonShortMasters,
  normalizeForMatching as sharedNormalize,
  COMMON_SHORT_LENGTH_THRESHOLD,
  COMMON_SHORT_COLLISION_THRESHOLD,
} from '../../shared/officeMasterValidation';
import { normalizeForMatching as beNormalize } from '../src/utils/textNormalizer';
import {
  BUG_OFFICE_MASTER_PATTERNS,
  LEGITIMATE_SHORT_OFFICE_MASTERS,
} from './fixtures/bug-masters';

describe('#506 shared/officeMasterValidation', () => {
  describe('validateOfficeMasterImport', () => {
    it('長マスター (length>=4) は ok', () => {
      const result = validateOfficeMasterImport(
        { id: 'new', name: 'デイサービスさくら' },
        [],
      );
      expect(result.kind).to.equal('ok');
    });

    it('短マスター (length<4) + collision >= 2 → reject-short-common', () => {
      const existing = [
        { id: 'a', name: 'デイケアセンター' },
        { id: 'b', name: 'ニチイケアセンター岩倉' },
      ];
      const result = validateOfficeMasterImport({ id: 'new', name: 'ケア' }, existing);
      expect(result.kind).to.equal('reject-short-common');
    });

    it('短マスター + collision < 2 → warning-short-uncommon (legitimate 短マスター)', () => {
      const existing = [
        { id: 'a', name: 'デイサービスさくら' },
        { id: 'b', name: '訪問看護ステーション桜' },
      ];
      const result = validateOfficeMasterImport({ id: 'new', name: 'ピース' }, existing);
      expect(result.kind).to.equal('warning-short-uncommon');
    });

    it('空文字 → reject-short-common (明確 reject)', () => {
      const result = validateOfficeMasterImport({ id: 'new', name: '' }, []);
      expect(result.kind).to.equal('reject-short-common');
    });

    it('境界値: 正規化後 length=3 + collision=2 → reject', () => {
      const existing = [
        { id: 'a', name: '正翔会クリニック小牧' },
        { id: 'b', name: '木の香往診クリニック' },
      ];
      const result = validateOfficeMasterImport({ id: 'new', name: 'ニック' }, existing);
      expect(result.kind).to.equal('reject-short-common');
    });

    it('境界値: 正規化後 length=4 は collision に関わらず ok', () => {
      const existing = [
        { id: 'a', name: 'ニコットの里デイサービス' },
        { id: 'b', name: 'ニコット訪問看護' },
      ];
      const result = validateOfficeMasterImport({ id: 'new', name: 'ニコット' }, existing);
      expect(result.kind).to.equal('ok');
    });
  });

  describe('shared と BE 版 normalizeForMatching の同等性 (drift 検出)', () => {
    const SAMPLE_INPUTS = [
      '',
      'ケア',
      'デイサービスさくら',
      'パナソニックエイジフリーケアセンター',
      'Ａｂｃ１２３',
      '株式会社／テスト・ケア（株）',
      '訪問-看護－ステーションーひまわり',
      '半角 と　全角空白 と　U+3000',
      '株式会社　ABC・テスト123',
      'カタカナ ひらがな 漢字',
    ];

    for (const input of SAMPLE_INPUTS) {
      it(`同等: "${input}" → 同一結果`, () => {
        expect(sharedNormalize(input)).to.equal(beNormalize(input));
      });
    }
  });

  describe('閾値定数の整合性', () => {
    it('COMMON_SHORT_LENGTH_THRESHOLD = 4', () => {
      expect(COMMON_SHORT_LENGTH_THRESHOLD).to.equal(4);
    });
    it('COMMON_SHORT_COLLISION_THRESHOLD = 2', () => {
      expect(COMMON_SHORT_COLLISION_THRESHOLD).to.equal(2);
    });
  });

  describe('本番 bug pattern fixture との連携', () => {
    for (const pattern of BUG_OFFICE_MASTER_PATTERNS) {
      it(`${pattern.label}: validateOfficeMasterImport が reject-short-common を返す`, () => {
        const result = validateOfficeMasterImport(
          { id: pattern.master.id, name: pattern.master.name },
          pattern.collidingLongMasters.map((m) => ({ id: m.id, name: m.name })),
        );
        expect(result.kind).to.equal('reject-short-common');
      });
    }

    for (const legit of LEGITIMATE_SHORT_OFFICE_MASTERS) {
      it(`legitimate "${legit.name}": collision なしで warning または ok`, () => {
        const result = validateOfficeMasterImport(
          { id: legit.id, name: legit.name },
          [
            { id: 'unrelated-1', name: 'デイサービスさくら' },
            { id: 'unrelated-2', name: '訪問看護ステーション桜' },
          ],
        );
        expect(result.kind).to.be.oneOf(['warning-short-uncommon', 'ok']);
      });
    }
  });

  describe('computeCommonShortMasters integration', () => {
    it('shared 版が PR #502 v2 と同じ挙動を返す (固定 fixture)', () => {
      const masters = [
        { id: 'bug-care', name: 'ケア' },
        { id: 'long-1', name: 'デイケアセンター' },
        { id: 'long-2', name: 'ニチイケアセンター' },
        { id: 'legit', name: 'ピース' },
      ];
      const common = computeCommonShortMasters(masters);
      expect(common.has('bug-care')).to.be.true;
      expect(common.has('legit')).to.be.false;
      expect(common.has('long-1')).to.be.false;
    });
  });
});
