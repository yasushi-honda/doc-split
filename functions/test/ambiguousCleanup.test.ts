/**
 * Issue #492: ambiguousCleanup (重複 docs cleanup の純ロジック) の単体テスト
 *
 * 検証対象は all-or-nothing precondition 評価。destructive 操作の gate なので
 * 「reject すべきものを確実に reject する」側のケースを網羅する:
 *   - plan 構造エラー (docId 重複 / winner が loser に混入 / 件数不一致)
 *   - loser が verified=true / editedAt あり / rotatedAt あり (ユーザー操作済み)
 *   - fileUrl 不一致 (Storage path 共有が証明できない)
 *   - winner / loser 不在、fileName / parentDocumentId / status 不一致
 *   - 違反 1 件でも deletions が空になること (all-or-nothing)
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import {
  AMBIGUOUS_CLEANUP_SCHEMA_VERSION,
  CleanupPlan,
  DocState,
  validatePlanStructure,
  evaluatePreconditions,
} from '../../scripts/lib/ambiguousCleanup';

const FILE_URL = 'gs://bucket/processed/20260413_未判定_未判定_p1-4.pdf';

function makePlan(overrides: Partial<CleanupPlan> = {}): CleanupPlan {
  return {
    schemaVersion: AMBIGUOUS_CLEANUP_SCHEMA_VERSION,
    issue: 492,
    projectId: 'test-project',
    groups: [
      {
        fileName: '20260413_未判定_未判定_p1-4.pdf',
        parentDocumentId: 'parent-1',
        winnerDocId: 'winner-1',
        loserDocIds: ['loser-1a', 'loser-1b'],
      },
    ],
    expectedLoserCount: 2,
    ...overrides,
  };
}

function makeDoc(overrides: Record<string, unknown> = {}): DocState {
  return {
    exists: true,
    data: {
      fileName: '20260413_未判定_未判定_p1-4.pdf',
      parentDocumentId: 'parent-1',
      status: 'processed',
      fileUrl: FILE_URL,
      verified: false,
      ...overrides,
    },
  };
}

function makeDocs(entries: Record<string, DocState>): Map<string, DocState> {
  return new Map(Object.entries(entries));
}

function healthyDocs(): Map<string, DocState> {
  return makeDocs({
    'winner-1': makeDoc({ verified: true }),
    'loser-1a': makeDoc(),
    'loser-1b': makeDoc(),
  });
}

describe('ambiguousCleanup: validatePlanStructure', () => {
  it('妥当な plan はエラーなし', () => {
    expect(validatePlanStructure(makePlan())).to.deep.equal([]);
  });

  it('schemaVersion 不一致を reject', () => {
    const errors = validatePlanStructure(
      makePlan({ schemaVersion: 'v0' as CleanupPlan['schemaVersion'] })
    );
    expect(errors.some((e) => e.includes('schemaVersion'))).to.equal(true);
  });

  it('winner が loserDocIds に混入していたら reject', () => {
    const plan = makePlan();
    plan.groups[0].loserDocIds = ['winner-1', 'loser-1b'];
    const errors = validatePlanStructure(plan);
    // 専用チェックのメッセージ固有文字列で assert (「docId 重複」との overlap で
    // 専用チェック削除を検知できなくなるのを防ぐ — pr-test-analyzer 反映)
    expect(errors.some((e) => e.includes('loserDocIds に含まれる'))).to.equal(true);
  });

  it('グループ跨ぎの docId 重複を reject', () => {
    const plan = makePlan();
    plan.groups.push({
      fileName: 'other.pdf',
      parentDocumentId: 'parent-1',
      winnerDocId: 'winner-2',
      loserDocIds: ['loser-1a'], // group1 と重複
    });
    plan.expectedLoserCount = 3;
    const errors = validatePlanStructure(plan);
    expect(errors.some((e) => e.includes('重複'))).to.equal(true);
  });

  it('expectedLoserCount 不一致を reject (境界: ±1)', () => {
    expect(
      validatePlanStructure(makePlan({ expectedLoserCount: 1 })).some((e) =>
        e.includes('loser 合計不一致')
      )
    ).to.equal(true);
    expect(
      validatePlanStructure(makePlan({ expectedLoserCount: 3 })).some((e) =>
        e.includes('loser 合計不一致')
      )
    ).to.equal(true);
  });

  it('groups 空を reject', () => {
    const errors = validatePlanStructure(makePlan({ groups: [], expectedLoserCount: 0 }));
    expect(errors.some((e) => e.includes('groups が空'))).to.equal(true);
  });

  it('parentDocumentId / expectedParents の両方欠落を reject', () => {
    const plan = makePlan();
    delete plan.groups[0].parentDocumentId;
    const errors = validatePlanStructure(plan);
    expect(errors.some((e) => e.includes('いずれかが必要'))).to.equal(true);
  });

  it('parentDocumentId と expectedParents の同時指定を reject (排他)', () => {
    const plan = makePlan();
    plan.groups[0].expectedParents = {
      'winner-1': 'parent-1',
      'loser-1a': 'parent-1',
      'loser-1b': 'parent-1',
    };
    const errors = validatePlanStructure(plan);
    expect(errors.some((e) => e.includes('排他'))).to.equal(true);
  });

  it('expectedParents に loser のエントリが欠けていたら reject', () => {
    const plan = makePlan();
    delete plan.groups[0].parentDocumentId;
    plan.groups[0].expectedParents = {
      'winner-1': 'parent-a',
      'loser-1a': 'parent-b',
      // loser-1b が欠落
    };
    const errors = validatePlanStructure(plan);
    expect(errors.some((e) => e.includes('loser-1b のエントリがない'))).to.equal(true);
  });

  it('expectedParents 指定時に expectedFileUrls が無ければ reject', () => {
    const plan = makePlan();
    delete plan.groups[0].parentDocumentId;
    plan.groups[0].expectedParents = {
      'winner-1': 'parent-a',
      'loser-1a': 'parent-b',
      'loser-1b': 'parent-c',
    };
    const errors = validatePlanStructure(plan);
    expect(errors.some((e) => e.includes('expectedFileUrls が必須'))).to.equal(true);
  });

  it('expectedFileUrls を同一親グループ (parentDocumentId) に付けたら reject', () => {
    const plan = makePlan();
    plan.groups[0].expectedFileUrls = {
      'winner-1': 'gs://b/x.pdf',
      'loser-1a': 'gs://b/y.pdf',
      'loser-1b': 'gs://b/z.pdf',
    };
    const errors = validatePlanStructure(plan);
    expect(errors.some((e) => e.includes('指定時のみ使用可'))).to.equal(true);
  });

  it('expectedFileUrls に loser のエントリが欠けていたら reject', () => {
    const plan = makePlan();
    delete plan.groups[0].parentDocumentId;
    plan.groups[0].expectedParents = {
      'winner-1': 'parent-a',
      'loser-1a': 'parent-b',
      'loser-1b': 'parent-c',
    };
    plan.groups[0].expectedFileUrls = {
      'winner-1': 'gs://b/x.pdf',
      'loser-1a': 'gs://b/y.pdf',
      // loser-1b が欠落
    };
    const errors = validatePlanStructure(plan);
    expect(
      errors.some((e) => e.includes('expectedFileUrls に loser-1b のエントリがない'))
    ).to.equal(true);
  });

  it('expectedParents に group 外の docId が混入していたら reject', () => {
    const plan = makePlan();
    delete plan.groups[0].parentDocumentId;
    plan.groups[0].expectedParents = {
      'winner-1': 'parent-a',
      'loser-1a': 'parent-b',
      'loser-1b': 'parent-b',
      'stranger-doc': 'parent-c',
    };
    const errors = validatePlanStructure(plan);
    expect(errors.some((e) => e.includes('group 外の docId'))).to.equal(true);
  });
});

describe('ambiguousCleanup: evaluatePreconditions', () => {
  it('全条件充足なら loser 全件が deletions に載る (共有 object は不可侵フラグ)', () => {
    const { violations, deletions } = evaluatePreconditions(makePlan(), healthyDocs());
    expect(violations).to.deep.equal([]);
    expect(deletions.map((d) => d.docId)).to.deep.equal(['loser-1a', 'loser-1b']);
    expect(deletions[0].winnerDocId).to.equal('winner-1');
    // 同一親 (共有 object) グループの loser は object 削除対象にならない
    expect(deletions.every((d) => d.ownsStorageObject === false)).to.equal(true);
    expect(deletions[0].fileUrl).to.equal(FILE_URL);
  });

  it('loser が verified=true なら reject (ユーザー確認済み doc の削除禁止)', () => {
    const docs = healthyDocs();
    docs.set('loser-1a', makeDoc({ verified: true }));
    const { violations, deletions } = evaluatePreconditions(makePlan(), docs);
    expect(violations.some((v) => v.includes('verified=true'))).to.equal(true);
    expect(deletions).to.deep.equal([]); // all-or-nothing
  });

  it('loser に editedAt があれば reject (ユーザー編集済み doc の削除禁止)', () => {
    const docs = healthyDocs();
    docs.set('loser-1b', makeDoc({ editedAt: { _seconds: 1, _nanoseconds: 0 } }));
    const { violations, deletions } = evaluatePreconditions(makePlan(), docs);
    expect(violations.some((v) => v.includes('editedAt'))).to.equal(true);
    expect(deletions).to.deep.equal([]);
  });

  it('loser の editedAt=null は「未編集」扱いで通過', () => {
    const docs = healthyDocs();
    docs.set('loser-1a', makeDoc({ editedAt: null }));
    const { violations } = evaluatePreconditions(makePlan(), docs);
    expect(violations).to.deep.equal([]);
  });

  it('loser に rotatedAt があれば reject', () => {
    const docs = healthyDocs();
    docs.set('loser-1a', makeDoc({ rotatedAt: { _seconds: 1, _nanoseconds: 0 } }));
    const { violations, deletions } = evaluatePreconditions(makePlan(), docs);
    expect(violations.some((v) => v.includes('rotatedAt'))).to.equal(true);
    expect(deletions).to.deep.equal([]);
  });

  it('loser の fileUrl が winner と異なれば reject (path 共有が証明できない)', () => {
    const docs = healthyDocs();
    docs.set('loser-1a', makeDoc({ fileUrl: 'gs://bucket/processed/other.pdf' }));
    const { violations, deletions } = evaluatePreconditions(makePlan(), docs);
    expect(violations.some((v) => v.includes('fileUrl'))).to.equal(true);
    expect(deletions).to.deep.equal([]);
  });

  it('winner の fileUrl が空なら reject', () => {
    const docs = healthyDocs();
    docs.set('winner-1', makeDoc({ verified: true, fileUrl: undefined }));
    const { violations, deletions } = evaluatePreconditions(makePlan(), docs);
    expect(violations.some((v) => v.includes('winner') && v.includes('fileUrl'))).to.equal(true);
    expect(deletions).to.deep.equal([]);
  });

  it('winner 不在なら reject', () => {
    const docs = healthyDocs();
    docs.set('winner-1', { exists: false });
    const { violations, deletions } = evaluatePreconditions(makePlan(), docs);
    expect(violations.some((v) => v.includes('winner') && v.includes('存在しない'))).to.equal(true);
    expect(deletions).to.deep.equal([]);
  });

  it('loser 不在なら reject (既に消えている場合も再実行は abort)', () => {
    const docs = healthyDocs();
    docs.set('loser-1a', { exists: false });
    const { violations, deletions } = evaluatePreconditions(makePlan(), docs);
    expect(violations.some((v) => v.includes('loser-1a') && v.includes('存在しない'))).to.equal(true);
    expect(deletions).to.deep.equal([]);
  });

  it('loser の fileName 不一致なら reject', () => {
    const docs = healthyDocs();
    docs.set('loser-1a', makeDoc({ fileName: 'unexpected.pdf' }));
    const { violations, deletions } = evaluatePreconditions(makePlan(), docs);
    expect(violations.some((v) => v.includes('fileName 不一致'))).to.equal(true);
    expect(deletions).to.deep.equal([]);
  });

  it('loser の parentDocumentId 不一致なら reject', () => {
    const docs = healthyDocs();
    docs.set('loser-1b', makeDoc({ parentDocumentId: 'other-parent' }));
    const { violations, deletions } = evaluatePreconditions(makePlan(), docs);
    expect(violations.some((v) => v.includes('parentDocumentId 不一致'))).to.equal(true);
    expect(deletions).to.deep.equal([]);
  });

  it('loser の status が processed 以外なら reject', () => {
    const docs = healthyDocs();
    docs.set('loser-1a', makeDoc({ status: 'processing' }));
    const { violations, deletions } = evaluatePreconditions(makePlan(), docs);
    expect(violations.some((v) => v.includes('status'))).to.equal(true);
    expect(deletions).to.deep.equal([]);
  });

  it('winner は verified=false でも通過する (winner に操作履歴は要求しない)', () => {
    const docs = makeDocs({
      'winner-1': makeDoc(), // verified: false
      'loser-1a': makeDoc(),
      'loser-1b': makeDoc(),
    });
    const { violations, deletions } = evaluatePreconditions(makePlan(), docs);
    expect(violations).to.deep.equal([]);
    expect(deletions).to.have.length(2);
  });

  it('winner の fileName 不一致なら reject (stale plan の防波堤)', () => {
    const docs = healthyDocs();
    docs.set('winner-1', makeDoc({ verified: true, fileName: 'reassigned.pdf' }));
    const { violations, deletions } = evaluatePreconditions(makePlan(), docs);
    expect(violations.some((v) => v.includes('winner') && v.includes('fileName 不一致'))).to.equal(true);
    expect(deletions).to.deep.equal([]);
  });

  it('winner の parentDocumentId 不一致なら reject', () => {
    const docs = healthyDocs();
    docs.set('winner-1', makeDoc({ verified: true, parentDocumentId: 'other-parent' }));
    const { violations, deletions } = evaluatePreconditions(makePlan(), docs);
    expect(
      violations.some((v) => v.includes('winner') && v.includes('parentDocumentId 不一致'))
    ).to.equal(true);
    expect(deletions).to.deep.equal([]);
  });

  it('winner が loserDocIds に混入した plan は evaluatePreconditions 単独でも reject (defense-in-depth)', () => {
    // validatePlanStructure を経由しない呼び出し経路への防御。混入時は loser の
    // fileUrl 照合が「winner 自身との比較」になり全 precondition を素通りするため、
    // ここで止めないと winner 本体が削除対象に載る
    const plan = makePlan();
    plan.groups[0].loserDocIds = ['winner-1', 'loser-1b'];
    const { violations, deletions } = evaluatePreconditions(plan, healthyDocs());
    expect(violations.some((v) => v.includes('loserDocIds に含まれる'))).to.equal(true);
    expect(deletions).to.deep.equal([]);
  });

  // 別親グループ用の plan/docs (本番 Phase 2 と同構造: 各 doc が専用 object)
  function makeMultiParentPlan(): CleanupPlan {
    const plan = makePlan();
    delete plan.groups[0].parentDocumentId;
    plan.groups[0].expectedParents = {
      'winner-1': 'parent-a',
      'loser-1a': 'parent-b',
      'loser-1b': 'parent-c',
    };
    plan.groups[0].expectedFileUrls = {
      'winner-1': 'gs://bucket/processed/winner-1/x.pdf',
      'loser-1a': 'gs://bucket/processed/loser-1a/x.pdf',
      'loser-1b': 'gs://bucket/processed/loser-1b/x.pdf',
    };
    return plan;
  }
  function makeMultiParentDocs(): Map<string, DocState> {
    return makeDocs({
      'winner-1': makeDoc({
        verified: true,
        parentDocumentId: 'parent-a',
        fileUrl: 'gs://bucket/processed/winner-1/x.pdf',
      }),
      'loser-1a': makeDoc({
        parentDocumentId: 'parent-b',
        fileUrl: 'gs://bucket/processed/loser-1a/x.pdf',
      }),
      'loser-1b': makeDoc({
        parentDocumentId: 'parent-c',
        fileUrl: 'gs://bucket/processed/loser-1b/x.pdf',
      }),
    });
  }

  it('expectedParents (別親グループ): 期待親 + fileUrl pin 一致で通過し、専有 object フラグが立つ', () => {
    const { violations, deletions } = evaluatePreconditions(
      makeMultiParentPlan(),
      makeMultiParentDocs()
    );
    expect(violations).to.deep.equal([]);
    expect(deletions.map((d) => d.docId)).to.deep.equal(['loser-1a', 'loser-1b']);
    expect(deletions.every((d) => d.ownsStorageObject === true)).to.equal(true);
    expect(deletions[0].fileUrl).to.equal('gs://bucket/processed/loser-1a/x.pdf');
  });

  it('expectedParents (別親グループ): loser の fileUrl が pin と異なれば reject', () => {
    const docs = makeMultiParentDocs();
    docs.set(
      'loser-1a',
      makeDoc({ parentDocumentId: 'parent-b', fileUrl: 'gs://bucket/processed/DRIFTED.pdf' })
    );
    const { violations, deletions } = evaluatePreconditions(makeMultiParentPlan(), docs);
    expect(violations.some((v) => v.includes('loser-1a') && v.includes('pin と不一致'))).to.equal(true);
    expect(deletions).to.deep.equal([]);
  });

  it('expectedParents (別親グループ): winner の fileUrl が pin と異なれば reject', () => {
    const docs = makeMultiParentDocs();
    docs.set(
      'winner-1',
      makeDoc({
        verified: true,
        parentDocumentId: 'parent-a',
        fileUrl: 'gs://bucket/processed/DRIFTED.pdf',
      })
    );
    const { violations, deletions } = evaluatePreconditions(makeMultiParentPlan(), docs);
    expect(violations.some((v) => v.includes('winner') && v.includes('pin と不一致'))).to.equal(true);
    expect(deletions).to.deep.equal([]);
  });

  it('expectedParents で loser が winner と object を共有する場合は専有フラグが立たない', () => {
    const plan = makeMultiParentPlan();
    plan.groups[0].expectedFileUrls = {
      'winner-1': 'gs://bucket/processed/shared.pdf',
      'loser-1a': 'gs://bucket/processed/shared.pdf',
      'loser-1b': 'gs://bucket/processed/loser-1b/x.pdf',
    };
    const docs = makeDocs({
      'winner-1': makeDoc({
        verified: true,
        parentDocumentId: 'parent-a',
        fileUrl: 'gs://bucket/processed/shared.pdf',
      }),
      'loser-1a': makeDoc({
        parentDocumentId: 'parent-b',
        fileUrl: 'gs://bucket/processed/shared.pdf',
      }),
      'loser-1b': makeDoc({
        parentDocumentId: 'parent-c',
        fileUrl: 'gs://bucket/processed/loser-1b/x.pdf',
      }),
    });
    const { violations, deletions } = evaluatePreconditions(plan, docs);
    expect(violations).to.deep.equal([]);
    const byId = new Map(deletions.map((d) => [d.docId, d]));
    expect(byId.get('loser-1a')?.ownsStorageObject).to.equal(false); // winner と共有 = 不可侵
    expect(byId.get('loser-1b')?.ownsStorageObject).to.equal(true);
  });

  it('expectedParents (別親グループ): loser の実親が期待と異なれば reject', () => {
    const plan = makePlan();
    delete plan.groups[0].parentDocumentId;
    plan.groups[0].expectedParents = {
      'winner-1': 'parent-a',
      'loser-1a': 'parent-b',
      'loser-1b': 'parent-c',
    };
    const docs = makeDocs({
      'winner-1': makeDoc({ verified: true, parentDocumentId: 'parent-a' }),
      'loser-1a': makeDoc({ parentDocumentId: 'parent-WRONG' }),
      'loser-1b': makeDoc({ parentDocumentId: 'parent-c' }),
    });
    const { violations, deletions } = evaluatePreconditions(plan, docs);
    expect(
      violations.some((v) => v.includes('loser-1a') && v.includes('parentDocumentId 不一致'))
    ).to.equal(true);
    expect(deletions).to.deep.equal([]);
  });

  it('複数グループ: 1 グループの違反が健全な他グループの削除も止める (all-or-nothing)', () => {
    const plan = makePlan({
      groups: [
        {
          fileName: '20260413_未判定_未判定_p1-4.pdf',
          parentDocumentId: 'parent-1',
          winnerDocId: 'winner-1',
          loserDocIds: ['loser-1a', 'loser-1b'],
        },
        {
          fileName: '20260413_未判定_未判定_p13-14.pdf',
          parentDocumentId: 'parent-1',
          winnerDocId: 'winner-2',
          loserDocIds: ['loser-2a'],
        },
      ],
      expectedLoserCount: 3,
    });
    const fileUrl2 = 'gs://bucket/processed/20260413_未判定_未判定_p13-14.pdf';
    const docs = makeDocs({
      'winner-1': makeDoc({ verified: true }),
      'loser-1a': makeDoc(),
      'loser-1b': makeDoc(),
      'winner-2': makeDoc({ fileName: '20260413_未判定_未判定_p13-14.pdf', fileUrl: fileUrl2 }),
      // グループ 2 の loser がユーザー確認済み → グループ 1 も削除してはいけない
      'loser-2a': makeDoc({
        fileName: '20260413_未判定_未判定_p13-14.pdf',
        fileUrl: fileUrl2,
        verified: true,
      }),
    });
    const { violations, deletions } = evaluatePreconditions(plan, docs);
    expect(violations.some((v) => v.includes('loser-2a'))).to.equal(true);
    expect(deletions).to.deep.equal([]);
  });
});

describe('ambiguousCleanup: checked-in plan JSON の実物検証', () => {
  // 本番削除を駆動するデータそのものを regression gate にかける
  // (Phase 2 での plan 編集時の docId コピペ重複・件数更新漏れを検知する)
  const plansDir = path.join(__dirname, '..', '..', 'scripts', 'plans');

  function loadPlanFile(name: string): CleanupPlan {
    return JSON.parse(fs.readFileSync(path.join(plansDir, name), 'utf-8')) as CleanupPlan;
  }

  it('kanameone plan (Phase 2): 構造検証を通過し、想定値 (2 groups / 2 losers / projectId) と一致', () => {
    const plan = loadPlanFile('cleanup-ambiguous-492-kanameone.json');
    expect(validatePlanStructure(plan)).to.deep.equal([]);
    expect(plan.projectId).to.equal('docsplit-kanameone');
    expect(plan.groups).to.have.length(2);
    expect(plan.expectedLoserCount).to.equal(2);
    // ユーザー確認済み doc (U4Lf5ZPNA4IyH73SXE2P) が誤って loser に入っていないこと
    const allLosers = plan.groups.flatMap((g) => g.loserDocIds);
    expect(allLosers).to.not.include('U4Lf5ZPNA4IyH73SXE2P');
    expect(allLosers).to.not.include('Lso7jEXzWxBjU4Cj6zqR');
    expect(allLosers).to.not.include('0ZuExPFZjngfSpddy2HR');
  });

  it('dev fixture plan: 構造検証を通過し、想定値 (2 groups / 4 losers / projectId) と一致', () => {
    const plan = loadPlanFile('cleanup-ambiguous-492-dev-fixture.json');
    expect(validatePlanStructure(plan)).to.deep.equal([]);
    expect(plan.projectId).to.equal('doc-split-dev');
    expect(plan.groups).to.have.length(2);
    expect(plan.expectedLoserCount).to.equal(4);
  });
});
