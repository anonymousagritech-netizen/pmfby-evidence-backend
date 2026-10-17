const {
  computePriority,
  assignVillagesToSurveyors,
  orderSurveyorCaseList,
  findFallbackVillages,
  runAutoAssignPure,
} = require('../../src/services/autoAssignService');

describe('autoAssignService.computePriority', () => {
  test('P1 when days_remaining <= p1CutoffDays', () => {
    const { priority, daysRemaining } = computePriority(new Date('2026-01-01'), 10, new Date('2026-01-06'), 5, 7);
    // deadline = Jan 11, reportDate = Jan 6 -> daysRemaining = 5
    expect(daysRemaining).toBe(5);
    expect(priority).toBe('P1');
  });

  test('P2 when between p1 and p2 cutoff', () => {
    const { priority } = computePriority(new Date('2026-01-01'), 10, new Date('2026-01-04'), 5, 7);
    // deadline Jan 11, report Jan 4 -> daysRemaining=7
    expect(priority).toBe('P2');
  });

  test('P3 when beyond p2 cutoff', () => {
    const { priority } = computePriority(new Date('2026-01-01'), 10, new Date('2026-01-01'), 5, 7);
    // deadline Jan 11, report Jan 1 -> daysRemaining=10
    expect(priority).toBe('P3');
  });
});

describe('autoAssignService.assignVillagesToSurveyors', () => {
  function makeCases(spec) {
    // spec: [{ districtId, villageId, count }]
    const cases = [];
    let i = 0;
    for (const s of spec) {
      for (let c = 0; c < s.count; c++) {
        cases.push({ id: `case-${i++}`, districtId: s.districtId, villageId: s.villageId, villageName: s.villageId });
      }
    }
    return cases;
  }

  test('never splits a village across two surveyors', () => {
    const cases = makeCases([
      { districtId: 'D1', villageId: 'V1', count: 10 },
      { districtId: 'D1', villageId: 'V2', count: 7 },
      { districtId: 'D1', villageId: 'V3', count: 3 },
    ]);
    const surveyorsByDistrict = new Map([['D1', ['S1', 'S2']]]);
    const { placements } = assignVillagesToSurveyors(cases, surveyorsByDistrict);

    for (const villageId of ['V1', 'V2', 'V3']) {
      const surveyorsForVillage = new Set(
        cases.filter((c) => c.villageId === villageId).map((c) => placements.get(c.id))
      );
      expect(surveyorsForVillage.size).toBe(1);
    }
  });

  test('balances caseloads roughly evenly across surveyors in a district', () => {
    const spec = [];
    for (let v = 0; v < 10; v++) spec.push({ districtId: 'D1', villageId: `V${v}`, count: 5 });
    const cases = makeCases(spec);
    const surveyorsByDistrict = new Map([['D1', ['S1', 'S2']]]);
    const { perSurveyor } = assignVillagesToSurveyors(cases, surveyorsByDistrict);
    const counts = [...perSurveyor.values()].map((s) => s.cases.length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(5); // within one village's worth
    expect(counts.reduce((a, b) => a + b, 0)).toBe(50);
  });

  test('respects manual overrides — those cases stay put, are not redistributed', () => {
    const cases = makeCases([{ districtId: 'D1', villageId: 'V1', count: 4 }]);
    cases[0].manualOverride = true;
    cases[0].manualSurveyorId = 'S_MANUAL';
    const surveyorsByDistrict = new Map([['D1', ['S1', 'S2']]]);
    const { placements } = assignVillagesToSurveyors(cases, surveyorsByDistrict);
    expect(placements.get(cases[0].id)).toBe('S_MANUAL');
    // The rest of V1 still goes to one of the algorithmic surveyors, as a single unit.
    const rest = new Set(cases.slice(1).map((c) => placements.get(c.id)));
    expect(rest.size).toBe(1);
  });

  test('cases in a district with no eligible surveyors are reported unassigned', () => {
    const cases = makeCases([{ districtId: 'D2', villageId: 'V1', count: 3 }]);
    const surveyorsByDistrict = new Map([['D1', ['S1']]]);
    const { unassignedCases } = assignVillagesToSurveyors(cases, surveyorsByDistrict);
    expect(unassignedCases).toHaveLength(3);
  });
});

describe('autoAssignService.orderSurveyorCaseList', () => {
  test('orders P1 before P2 before P3, nearest deadline first within bucket', () => {
    const list = [
      { id: 'a', priority: 'P3', daysRemaining: 20 },
      { id: 'b', priority: 'P1', daysRemaining: 3 },
      { id: 'c', priority: 'P1', daysRemaining: 1 },
      { id: 'd', priority: 'P2', daysRemaining: 6 },
    ];
    const ordered = orderSurveyorCaseList(list).map((c) => c.id);
    expect(ordered).toEqual(['c', 'b', 'd', 'a']);
  });
});

describe('autoAssignService.findFallbackVillages', () => {
  test('picks nearest villages outside the excluded district until need is met', () => {
    const pool_ = [
      { villageId: 'A', districtId: 'D1', lat: 13.0, lon: 79.0, caseCount: 10 },
      { villageId: 'B', districtId: 'D2', lat: 13.01, lon: 79.01, caseCount: 5 },
      { villageId: 'C', districtId: 'D2', lat: 20.0, lon: 85.0, caseCount: 50 },
    ];
    const picked = findFallbackVillages(13.0, 79.0, pool_, 5, 'D1');
    expect(picked.map((p) => p.villageId)).toEqual(['B']);
  });
});

describe('autoAssignService.runAutoAssignPure (end to end with synthetic data)', () => {
  test('flags surveyors under the minimum caseload', () => {
    const cases = [];
    for (let i = 0; i < 5; i++) {
      cases.push({ id: `c${i}`, districtId: 'D1', villageId: 'V1', villageName: 'V1', intimationDate: '2026-01-01' });
    }
    const surveyorsByDistrict = new Map([['D1', ['S1']]]);
    const result = runAutoAssignPure({
      cases, surveyorsByDistrict, reportDate: '2026-01-02', tatDays: 10, minCases: 40,
    });
    expect(result.totalAssigned).toBe(5);
    expect(result.underMinimumSurveyors).toContain('S1');
  });

  test('computes P1/P2/P3 split per surveyor', () => {
    const cases = [
      { id: 'c1', districtId: 'D1', villageId: 'V1', villageName: 'V1', intimationDate: '2026-01-01' }, // deadline Jan11, report Jan10 -> 1 day -> P1
      { id: 'c2', districtId: 'D1', villageId: 'V1', villageName: 'V1', intimationDate: '2026-01-01' },
      { id: 'c3', districtId: 'D1', villageId: 'V2', villageName: 'V2', intimationDate: '2025-12-01' }, // far future-passed deadline -> P3
    ];
    const surveyorsByDistrict = new Map([['D1', ['S1']]]);
    const result = runAutoAssignPure({
      cases, surveyorsByDistrict, reportDate: '2026-01-10', tatDays: 10, minCases: 1, p1CutoffDays: 5, p2CutoffDays: 7,
    });
    const s1 = result.perSurveyor.find((s) => s.surveyorId === 'S1');
    expect(s1.totalCases).toBe(3);
    expect(s1.p1 + s1.p2 + s1.p3).toBe(3);
  });
});
