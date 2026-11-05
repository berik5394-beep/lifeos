import {
  groupDeals,
  STAGE_LABEL,
  OPEN_STAGES,
  neighborStages,
  fmtMoney,
  fmtMoneyExact,
  civilOf,
  isOpenStage,
  type Deal,
} from '@/services/deals';

const d = (id: string, stage: Deal['stage'], amount: number | null): Deal => ({
  id,
  personEntityId: null,
  personName: 'Ахмет',
  title: 't',
  amount,
  currency: '₸',
  stage,
  nextStepAt: null,
  nextStepText: null,
  stageChangedAt: '2026-11-01T00:00:00.000Z',
  lastActivityAt: '2026-11-01T00:00:00.000Z',
  closedAt: null,
  lostReason: null,
  wonIncomeId: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
});

describe('сделки — чистое', () => {
  it('группы по открытым стадиям (в порядке воронки) с суммами; пустые стадии не показываем', () => {
    const g = groupDeals([d('1', 'proposal', 2_000_000), d('2', 'proposal', null), d('3', 'new', 500_000)]);
    expect(g.map((x) => x.stage)).toEqual(OPEN_STAGES.filter((s) => s === 'new' || s === 'proposal'));
    expect(g.find((x) => x.stage === 'proposal')?.sum).toBe(2_000_000);
    expect(g.find((x) => x.stage === 'proposal')?.deals).toHaveLength(2);
  });
  it('закрытые сделки в группы открытых не попадают', () => {
    expect(groupDeals([d('1', 'won', 1_000), d('2', 'lost', 2_000)])).toEqual([]);
  });
  it('соседние стадии для кнопок', () => {
    expect(neighborStages('new')).toEqual({ prev: null, next: 'talks' });
    expect(neighborStages('proposal')).toEqual({ prev: 'talks', next: 'contract' });
    expect(neighborStages('contract')).toEqual({ prev: 'proposal', next: null });
  });
  it('isOpenStage', () => {
    expect(isOpenStage('talks')).toBe(true);
    expect(isOpenStage('won')).toBe(false);
  });
  it('подписи стадий = сервер', () => {
    expect(STAGE_LABEL.proposal).toBe('КП отправлено');
    expect(STAGE_LABEL.contract).toBe('Договор/оплата');
  });
  it('деньги: коротко для списка, точно для подтверждения дохода', () => {
    expect(fmtMoney(2_000_000)).toBe('2 млн ₸');
    expect(fmtMoney(2_500_000)).toBe('2,5 млн ₸');
    expect(fmtMoney(350_000)).toBe('350 000 ₸');
    expect(fmtMoneyExact(2_345_678)).toBe('2 345 678 ₸');
  });
  it('дата шага с сервера (DateTime @db.Date) → civil YYYY-MM-DD', () => {
    expect(civilOf('2026-11-08T00:00:00.000Z')).toBe('2026-11-08');
    expect(civilOf('2026-11-08')).toBe('2026-11-08');
    expect(civilOf(null)).toBeNull();
  });
});
