/**
 * customerIdentity テスト (ADR-0022 顧客未確定ゲート再設計、2026-07-25)
 *
 * isValidCustomerSelection/findSameNameCollisionNamesはFirestore/Admin SDK非依存の
 * 純粋関数のため、displayFileName.test.ts等と同じ規約でユニットテストする(emulator不要)。
 * frontend/functions双方から参照される契約をここで固定する。
 *
 * precheckCustomerIdentity/resolveCustomerUnconfirmedReasonは「同姓同名」プロアクティブ
 * 通知UI追加(2026-07-26)で新設。判定順序はfunctions/src/drive/customerAmbiguityGate.tsの
 * isCustomerUnconfirmed()から移設したもので、既存のexportDocumentIntegration.test.ts
 * (顧客未確定ゲート13ケース)と挙動が一致することがAC1(証明コマンド)で担保される。
 */

import { expect } from 'chai';
import {
  isValidCustomerSelection,
  findSameNameCollisionNames,
  precheckCustomerIdentity,
  resolveCustomerUnconfirmedReason,
} from '../../shared/customerIdentity';

describe('isValidCustomerSelection', () => {
  it('有効な顧客名はtrueを返す', () => {
    expect(isValidCustomerSelection('田中太郎')).to.equal(true);
  });

  it('前後空白付きの有効な顧客名もtrueを返す(trim後に判定)', () => {
    expect(isValidCustomerSelection(' 田中太郎 ')).to.equal(true);
  });

  it('null/undefinedはfalseを返す', () => {
    expect(isValidCustomerSelection(null)).to.equal(false);
    expect(isValidCustomerSelection(undefined)).to.equal(false);
  });

  it('空文字・空白のみはfalseを返す', () => {
    expect(isValidCustomerSelection('')).to.equal(false);
    expect(isValidCustomerSelection('   ')).to.equal(false);
  });

  it('sentinel値(「未判定」「不明顧客」)はfalseを返す', () => {
    expect(isValidCustomerSelection('未判定')).to.equal(false);
    expect(isValidCustomerSelection('不明顧客')).to.equal(false);
  });

  it('前後空白付きのsentinel値もfalseを返す', () => {
    expect(isValidCustomerSelection(' 不明顧客 ')).to.equal(false);
  });
});

describe('findSameNameCollisionNames', () => {
  it('同名が2件以上のグループのみを集合として返す', () => {
    const result = findSameNameCollisionNames([
      { name: '田中太郎' },
      { name: '田中太郎' },
      { name: '佐藤花子' },
    ]);
    expect([...result]).to.deep.equal(['田中太郎']);
  });

  it('同名が1件のみの名前は含まれない', () => {
    const result = findSameNameCollisionNames([{ name: '佐藤花子' }]);
    expect(result.size).to.equal(0);
  });

  it('空配列は空の集合を返す', () => {
    const result = findSameNameCollisionNames([]);
    expect(result.size).to.equal(0);
  });

  it('3件以上の同名グループも1件の衝突名として集合に含まれる', () => {
    const result = findSameNameCollisionNames([
      { name: '田中太郎' },
      { name: '田中太郎' },
      { name: '田中太郎' },
    ]);
    expect([...result]).to.deep.equal(['田中太郎']);
  });

  it('複数の衝突グループをすべて検出する', () => {
    const result = findSameNameCollisionNames([
      { name: '田中太郎' },
      { name: '田中太郎' },
      { name: '鈴木一郎' },
      { name: '鈴木一郎' },
      { name: '佐藤花子' },
    ]);
    expect([...result].sort()).to.deep.equal(['田中太郎', '鈴木一郎']);
  });

  it('前後空白付きの名前もtrim後に同名として集約する(2026-07-26追加)', () => {
    const result = findSameNameCollisionNames([
      { name: ' 田中太郎 ' },
      { name: '田中太郎' },
    ]);
    expect([...result]).to.deep.equal(['田中太郎']);
  });
});

describe('precheckCustomerIdentity', () => {
  it('空文字はinvalid-nameで未確定', () => {
    const result = precheckCustomerIdentity({ customerName: '' }, { customerMasterName: null });
    expect(result).to.deep.equal({ outcome: 'unconfirmed', reason: 'invalid-name' });
  });

  it('空白のみはinvalid-nameで未確定', () => {
    const result = precheckCustomerIdentity({ customerName: '   ' }, { customerMasterName: null });
    expect(result).to.deep.equal({ outcome: 'unconfirmed', reason: 'invalid-name' });
  });

  it('null customerNameはinvalid-nameで未確定', () => {
    const result = precheckCustomerIdentity({ customerName: null }, { customerMasterName: null });
    expect(result).to.deep.equal({ outcome: 'unconfirmed', reason: 'invalid-name' });
  });

  it('sentinel値(「未判定」「不明顧客」)はinvalid-nameで未確定', () => {
    expect(precheckCustomerIdentity({ customerName: '未判定' }, { customerMasterName: null }))
      .to.deep.equal({ outcome: 'unconfirmed', reason: 'invalid-name' });
    expect(precheckCustomerIdentity({ customerName: '不明顧客' }, { customerMasterName: null }))
      .to.deep.equal({ outcome: 'unconfirmed', reason: 'invalid-name' });
  });

  it('前後空白付きsentinel値もinvalid-nameで未確定', () => {
    const result = precheckCustomerIdentity({ customerName: ' 不明顧客 ' }, { customerMasterName: null });
    expect(result).to.deep.equal({ outcome: 'unconfirmed', reason: 'invalid-name' });
  });

  it('customerMasterNameが別名の場合、customerConfirmed:trueでも乖離が優先されname-id-mismatchで未確定', () => {
    const result = precheckCustomerIdentity(
      { customerName: '田中太郎', customerConfirmed: true },
      { customerMasterName: '田中次郎' }
    );
    expect(result).to.deep.equal({ outcome: 'unconfirmed', reason: 'name-id-mismatch' });
  });

  it('customerMasterName:nullの場合は乖離チェックをスキップする', () => {
    const result = precheckCustomerIdentity(
      { customerName: '田中太郎', customerConfirmed: true },
      { customerMasterName: null }
    );
    expect(result).to.deep.equal({ outcome: 'confirmed' });
  });

  it('customerConfirmed:trueは確定済み扱い', () => {
    const result = precheckCustomerIdentity(
      { customerName: '田中太郎', customerConfirmed: true },
      { customerMasterName: '田中太郎' }
    );
    expect(result).to.deep.equal({ outcome: 'confirmed' });
  });

  it('customerConfirmed:trueはneedsManualCustomerSelection:trueより優先される(customerConfirmed優先のdual-read)', () => {
    const result = precheckCustomerIdentity(
      { customerName: '田中太郎', customerConfirmed: true, needsManualCustomerSelection: true },
      { customerMasterName: '田中太郎' }
    );
    expect(result).to.deep.equal({ outcome: 'confirmed' });
  });

  it('customerConfirmed未設定・needsManualCustomerSelection:trueは未確定として衝突チェックへ進む', () => {
    const result = precheckCustomerIdentity(
      { customerName: '田中太郎', needsManualCustomerSelection: true },
      { customerMasterName: '田中太郎' }
    );
    expect(result).to.deep.equal({ outcome: 'needs-collision-check', trimmedName: '田中太郎' });
  });

  it('両方未設定(レガシーdoc)は未確定として衝突チェックへ進む(本件の中核)', () => {
    const result = precheckCustomerIdentity(
      { customerName: '田中太郎' },
      { customerMasterName: '田中太郎' }
    );
    expect(result).to.deep.equal({ outcome: 'needs-collision-check', trimmedName: '田中太郎' });
  });

  it('needs-collision-checkのtrimmedNameは前後空白を除去した値になる', () => {
    const result = precheckCustomerIdentity(
      { customerName: ' 松本 実 ' },
      { customerMasterName: null }
    );
    expect(result).to.deep.equal({ outcome: 'needs-collision-check', trimmedName: '松本 実' });
  });
});

describe('resolveCustomerUnconfirmedReason', () => {
  it('両方未設定(レガシーdoc) + 同名衝突ありはsame-name-collisionを返す(本件の中核)', () => {
    const reason = resolveCustomerUnconfirmedReason(
      { customerName: '松本 実' },
      { customerMasterName: null, sameNameCollisionNames: new Set(['松本 実']) }
    );
    expect(reason).to.equal('same-name-collision');
  });

  it('両方未設定 + 同名衝突なし(同名1件)はnullを返す(後方互換の砦)', () => {
    const reason = resolveCustomerUnconfirmedReason(
      { customerName: '松本 実' },
      { customerMasterName: null, sameNameCollisionNames: new Set() }
    );
    expect(reason).to.be.null;
  });

  it('customerConfirmed:true + 同名衝突ありはnullを返す(人間確定優先)', () => {
    const reason = resolveCustomerUnconfirmedReason(
      { customerName: '松本 実', customerConfirmed: true },
      { customerMasterName: '松本 実', sameNameCollisionNames: new Set(['松本 実']) }
    );
    expect(reason).to.be.null;
  });

  it('customerConfirmed:true + needsManualCustomerSelection:true + 同名衝突ありはnullを返す(customerConfirmed優先)', () => {
    const reason = resolveCustomerUnconfirmedReason(
      { customerName: '松本 実', customerConfirmed: true, needsManualCustomerSelection: true },
      { customerMasterName: '松本 実', sameNameCollisionNames: new Set(['松本 実']) }
    );
    expect(reason).to.be.null;
  });

  it('同名3件でもsame-name-collisionを返す', () => {
    const reason = resolveCustomerUnconfirmedReason(
      { customerName: '田中太郎' },
      { customerMasterName: null, sameNameCollisionNames: new Set(['田中太郎']) }
    );
    expect(reason).to.equal('same-name-collision');
  });

  it('前後空白付きcustomerNameでもtrim後に衝突集合と一致すればsame-name-collisionを返す(trim整合)', () => {
    const reason = resolveCustomerUnconfirmedReason(
      { customerName: ' 松本 実 ' },
      { customerMasterName: null, sameNameCollisionNames: new Set(['松本 実']) }
    );
    expect(reason).to.equal('same-name-collision');
  });

  it('sentinel値はinvalid-nameを返す(same-name-collisionではない)', () => {
    const reason = resolveCustomerUnconfirmedReason(
      { customerName: '未判定' },
      { customerMasterName: null, sameNameCollisionNames: new Set() }
    );
    expect(reason).to.equal('invalid-name');
  });

  it('customerId↔name乖離はname-id-mismatchを返す', () => {
    const reason = resolveCustomerUnconfirmedReason(
      { customerName: '田中太郎' },
      { customerMasterName: '田中次郎', sameNameCollisionNames: new Set(['田中太郎']) }
    );
    expect(reason).to.equal('name-id-mismatch');
  });
});
