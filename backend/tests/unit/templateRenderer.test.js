const { renderTemplate } = require('../../src/utils/templateRenderer');

describe('templateRenderer', () => {
  test('substitutes known variables', () => {
    const { rendered, missing } = renderTemplate('Hello {Name}, attempt {Attempt_No}', {
      Name: 'Ram', Attempt_No: 3,
    });
    expect(rendered).toBe('Hello Ram, attempt 3');
    expect(missing).toEqual([]);
  });

  test('reports missing variables and renders them as empty string', () => {
    const { rendered, missing } = renderTemplate('Hello {Name}, phone {Phone}', { Name: 'Ram' });
    expect(rendered).toBe('Hello Ram, phone ');
    expect(missing).toEqual(['Phone']);
  });

  test('renders the real Format 1 (Denied) template verbatim with substitutions', () => {
    // Same literal spec text as seeds/seed.js FORMAT_1_DENIED (not re-imported here since
    // seed.js is a run-to-completion script, not a module export).
    const format1 = `किसान सर्वे की सूचना: किसान ने मना किया\nकिसान का नाम: {Farmer_Name}\nप्रयास संख्या (Attempt No.): {Attempt_No}`;
    const { rendered, missing } = renderTemplate(format1, { Farmer_Name: 'राम लाल', Attempt_No: 2 });
    expect(rendered).toContain('राम लाल');
    expect(rendered).toContain('2');
    expect(missing).toEqual([]);
  });
});
