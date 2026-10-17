jest.mock('../../src/db/pool', () => ({ pool: {}, withTransaction: jest.fn() }));
const { normalizeFarmerMobile } = require('../../src/services/importService');

describe('normalizeFarmerMobile', () => {
  test.each([
    [8587870501, '8587870501'],
    ['8587870501', '8587870501'],
    ['8587870501.0', '8587870501'],
    ['+91 85878 70501', '8587870501'],
    ['91-7986284087', '7986284087'],
    ['07986284087', '7986284087'],
  ])('%p -> %p', (input, expected) => expect(normalizeFarmerMobile(input)).toBe(expected));

  test.each([[null], [''], ['12345'], ['abc'], ['1234567890']])('%p -> null', (input) =>
    expect(normalizeFarmerMobile(input)).toBeNull());
});
