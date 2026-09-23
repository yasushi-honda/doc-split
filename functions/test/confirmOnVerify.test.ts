/**
 * confirmOnVerify テスト (Issue #1034)
 *
 * 「確認済み」操作に伴う顧客/事業所確定フラグの判定・更新データ生成の純粋関数テスト。
 * shared/customerIdentity.test.ts / functions/test/customerIdentity.test.ts と同じ規約
 * (emulator不要、chai + mocha)。
 */

import { expect } from 'chai';
import {
  decideCustomerConfirm,
  decideOfficeConfirm,
  planConfirmOnVerify,
  buildConfirmOnVerifyUpdate,
} from '../../shared/confirmOnVerify';

const noCollision = new Set<string>();

describe('decideCustomerConfirm', () => {
  it('有効な顧客名・同姓同名なしなら confirm', () => {
    const result = decideCustomerConfirm(
      { customerName: '田中太郎', customerId: 'c1' },
      { customerMasterName: '田中太郎', sameNameCollisionNames: noCollision }
    );
    expect(result).to.deep.equal({ action: 'confirm' });
  });

  it('既に customerConfirmed:true なら already-confirmed でskip', () => {
    const result = decideCustomerConfirm(
      { customerName: '田中太郎', customerConfirmed: true },
      { customerMasterName: '田中太郎', sameNameCollisionNames: noCollision }
    );
    expect(result).to.deep.equal({ action: 'skip', reason: 'already-confirmed' });
  });

  it('候補0件(不明顧客)は invalid-name でskip(Issue #895の空確定防止)', () => {
    const result = decideCustomerConfirm(
      { customerName: '不明顧客', customerId: null },
      { customerMasterName: null, sameNameCollisionNames: noCollision }
    );
    expect(result).to.deep.equal({ action: 'skip', reason: 'invalid-name' });
  });

  it('sentinel値(未判定)は invalid-name でskip', () => {
    const result = decideCustomerConfirm(
      { customerName: '未判定' },
      { customerMasterName: null, sameNameCollisionNames: noCollision }
    );
    expect(result).to.deep.equal({ action: 'skip', reason: 'invalid-name' });
  });

  it('空白のみの顧客名は invalid-name でskip', () => {
    const result = decideCustomerConfirm(
      { customerName: '   ' },
      { customerMasterName: null, sameNameCollisionNames: noCollision }
    );
    expect(result).to.deep.equal({ action: 'skip', reason: 'invalid-name' });
  });

  it('同姓同名マスターが存在する場合は same-name-collision でskip(ADR-0022)', () => {
    const result = decideCustomerConfirm(
      { customerName: '田中太郎', customerId: 'c1' },
      { customerMasterName: '田中太郎', sameNameCollisionNames: new Set(['田中太郎']) }
    );
    expect(result).to.deep.equal({ action: 'skip', reason: 'same-name-collision' });
  });

  it('customerIdとマスター名が食い違う場合は name-id-mismatch でskip', () => {
    const result = decideCustomerConfirm(
      { customerName: '田中太郎', customerId: 'c1' },
      { customerMasterName: '佐藤花子', sameNameCollisionNames: noCollision }
    );
    expect(result).to.deep.equal({ action: 'skip', reason: 'name-id-mismatch' });
  });

  it('customerIdはあるがマスターが見つからない場合は customer-master-missing でskip(name-id-mismatchと区別)', () => {
    const result = decideCustomerConfirm(
      { customerName: '田中太郎', customerId: 'deleted-customer-id' },
      { customerMasterName: null, sameNameCollisionNames: noCollision }
    );
    expect(result).to.deep.equal({ action: 'skip', reason: 'customer-master-missing' });
  });

  it('customerIdが無い場合はmasterName:nullでも許容する(name-id-mismatch/customer-master-missing扱いにしない)', () => {
    const result = decideCustomerConfirm(
      { customerName: '田中太郎', customerId: null },
      { customerMasterName: null, sameNameCollisionNames: noCollision }
    );
    expect(result).to.deep.equal({ action: 'confirm' });
  });

  it('前後空白付きの顧客名もtrim後に有効値として確定できる', () => {
    const result = decideCustomerConfirm(
      { customerName: ' 田中太郎 ', customerId: 'c1' },
      { customerMasterName: '田中太郎', sameNameCollisionNames: noCollision }
    );
    expect(result).to.deep.equal({ action: 'confirm' });
  });

  it('customerConfirmed:falseとneedsManualCustomerSelection:trueの組み合わせでも同姓同名なしなら確定できる', () => {
    const result = decideCustomerConfirm(
      { customerName: '田中太郎', customerConfirmed: false, needsManualCustomerSelection: true },
      { customerMasterName: '田中太郎', sameNameCollisionNames: noCollision }
    );
    expect(result).to.deep.equal({ action: 'confirm' });
  });
});

describe('decideOfficeConfirm', () => {
  it('有効な事業所名なら confirm', () => {
    expect(decideOfficeConfirm({ officeName: '事業所A' })).to.deep.equal({ action: 'confirm' });
  });

  it('既に officeConfirmed:true なら already-confirmed でskip', () => {
    expect(decideOfficeConfirm({ officeName: '事業所A', officeConfirmed: true })).to.deep.equal({
      action: 'skip',
      reason: 'already-confirmed',
    });
  });

  it('候補0件(未判定/不明事業所)は invalid-name でskip', () => {
    expect(decideOfficeConfirm({ officeName: '未判定' })).to.deep.equal({
      action: 'skip',
      reason: 'invalid-name',
    });
    expect(decideOfficeConfirm({ officeName: '不明事業所' })).to.deep.equal({
      action: 'skip',
      reason: 'invalid-name',
    });
  });

  it('空文字・null・undefinedは invalid-name でskip', () => {
    expect(decideOfficeConfirm({ officeName: '' })).to.deep.equal({ action: 'skip', reason: 'invalid-name' });
    expect(decideOfficeConfirm({ officeName: null })).to.deep.equal({ action: 'skip', reason: 'invalid-name' });
    expect(decideOfficeConfirm({ officeName: undefined })).to.deep.equal({
      action: 'skip',
      reason: 'invalid-name',
    });
  });

  it('事業所には同姓同名相当のガードが無い(既存shouldSetOfficeConfirmedと同じ非対称性)', () => {
    // 顧客と異なり、候補が複数あっても現在の officeName が有効なら confirm する。
    expect(decideOfficeConfirm({ officeName: '重複事業所名' })).to.deep.equal({ action: 'confirm' });
  });
});

describe('planConfirmOnVerify', () => {
  it('顧客のみ確定可能な場合、customerだけconfirmになる', () => {
    const result = planConfirmOnVerify(
      { customerName: '田中太郎', customerId: 'c1', officeName: '未判定' },
      { customerMasterName: '田中太郎', sameNameCollisionNames: noCollision }
    );
    expect(result.customer).to.deep.equal({ action: 'confirm' });
    expect(result.office).to.deep.equal({ action: 'skip', reason: 'invalid-name' });
  });

  it('事業所のみ確定可能な場合、officeだけconfirmになる', () => {
    const result = planConfirmOnVerify(
      { customerName: '不明顧客', officeName: '事業所A' },
      { customerMasterName: null, sameNameCollisionNames: noCollision }
    );
    expect(result.customer).to.deep.equal({ action: 'skip', reason: 'invalid-name' });
    expect(result.office).to.deep.equal({ action: 'confirm' });
  });

  it('両方確定可能な場合、両方confirmになる', () => {
    const result = planConfirmOnVerify(
      { customerName: '田中太郎', customerId: 'c1', officeName: '事業所A' },
      { customerMasterName: '田中太郎', sameNameCollisionNames: noCollision }
    );
    expect(result.customer).to.deep.equal({ action: 'confirm' });
    expect(result.office).to.deep.equal({ action: 'confirm' });
  });
});

describe('buildConfirmOnVerifyUpdate', () => {
  it('人間操作(actor.uidあり)は confirmedBy/confirmedAt を書く', () => {
    const { update, logs } = buildConfirmOnVerifyUpdate(
      { customer: { action: 'confirm' }, office: { action: 'confirm' } },
      { customerConfirmed: false, officeConfirmed: false },
      { uid: 'user-1', now: 'TIMESTAMP_SENTINEL' }
    );
    expect(update).to.deep.equal({
      customerConfirmed: true,
      confirmedBy: 'user-1',
      confirmedAt: 'TIMESTAMP_SENTINEL',
      officeConfirmed: true,
      officeConfirmedBy: 'user-1',
      officeConfirmedAt: 'TIMESTAMP_SENTINEL',
    });
    expect(logs).to.deep.equal([
      { field: 'customerConfirmed', oldValue: 'false', newValue: 'true' },
      { field: 'officeConfirmed', oldValue: 'false', newValue: 'true' },
    ]);
  });

  it('backfill(actor.uid:null)は confirmedBy/confirmedAt/officeConfirmedBy/officeConfirmedAt をupdateに含めない', () => {
    const { update } = buildConfirmOnVerifyUpdate(
      { customer: { action: 'confirm' }, office: { action: 'confirm' } },
      { customerConfirmed: false, officeConfirmed: false },
      { uid: null }
    );
    expect(update).to.deep.equal({ customerConfirmed: true, officeConfirmed: true });
    expect(update).to.not.have.property('confirmedBy');
    expect(update).to.not.have.property('confirmedAt');
    expect(update).to.not.have.property('officeConfirmedBy');
    expect(update).to.not.have.property('officeConfirmedAt');
  });

  it('customerId・customerName・officeId・officeNameを一切含まない', () => {
    const { update } = buildConfirmOnVerifyUpdate(
      { customer: { action: 'confirm' }, office: { action: 'confirm' } },
      { customerConfirmed: false, officeConfirmed: false },
      { uid: 'user-1', now: 'T' }
    );
    for (const key of ['customerId', 'customerName', 'officeId', 'officeName']) {
      expect(update).to.not.have.property(key);
    }
  });

  it('事業所が対象外(skip)なら officeConfirmed 関連キーを一切含まない', () => {
    const { update, logs } = buildConfirmOnVerifyUpdate(
      { customer: { action: 'confirm' }, office: { action: 'skip', reason: 'invalid-name' } },
      { customerConfirmed: false, officeConfirmed: false },
      { uid: 'user-1', now: 'T' }
    );
    expect(update).to.not.have.property('officeConfirmed');
    expect(update).to.not.have.property('officeConfirmedBy');
    expect(update).to.not.have.property('officeConfirmedAt');
    expect(logs.map((l) => l.field)).to.deep.equal(['customerConfirmed']);
  });

  it('顧客・事業所とも対象外なら空の更新データになる', () => {
    const { update, logs } = buildConfirmOnVerifyUpdate(
      {
        customer: { action: 'skip', reason: 'already-confirmed' },
        office: { action: 'skip', reason: 'already-confirmed' },
      },
      { customerConfirmed: true, officeConfirmed: true },
      { uid: 'user-1', now: 'T' }
    );
    expect(update).to.deep.equal({});
    expect(logs).to.deep.equal([]);
  });

  it('needsManualCustomerSelection:trueの場合、確定と同時にfalseへ書き戻す', () => {
    const { update, logs } = buildConfirmOnVerifyUpdate(
      { customer: { action: 'confirm' }, office: { action: 'skip', reason: 'already-confirmed' } },
      { customerConfirmed: false, needsManualCustomerSelection: true },
      { uid: 'user-1', now: 'T' }
    );
    expect(update.needsManualCustomerSelection).to.equal(false);
    expect(logs).to.deep.include({
      field: 'needsManualCustomerSelection',
      oldValue: 'true',
      newValue: 'false',
    });
  });

  it('needsManualCustomerSelectionが元々undefinedなら書き戻さない', () => {
    const { update } = buildConfirmOnVerifyUpdate(
      { customer: { action: 'confirm' }, office: { action: 'skip', reason: 'already-confirmed' } },
      { customerConfirmed: false },
      { uid: 'user-1', now: 'T' }
    );
    expect(update).to.not.have.property('needsManualCustomerSelection');
  });

  it('customerConfirmedが元々undefinedならログのoldValueはnull', () => {
    const { logs } = buildConfirmOnVerifyUpdate(
      { customer: { action: 'confirm' }, office: { action: 'skip', reason: 'already-confirmed' } },
      {},
      { uid: 'user-1', now: 'T' }
    );
    expect(logs).to.deep.equal([{ field: 'customerConfirmed', oldValue: null, newValue: 'true' }]);
  });
});
