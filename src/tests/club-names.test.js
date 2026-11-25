// Run: npm run test-club-names
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClubMatcher, abbreviateClub, stringifyClubMappings, loadClubMatcher } from '../lib/club-names.js';
import { replaceClubNames } from '../tasks/calendar-processor.js';

const m = buildClubMatcher({
    clubs: { ALT: ['Altona'], KBH: ['KBH Brumbies'], ESS: ['Essendon'], MEL: ['Melton'] },
    overrides: { 'Melton/Werribee Hockey Club': 'MEL - WER' },
});

test('abbreviateClub derives team suffixes', () => {
    assert.equal(abbreviateClub('Altona Hockey Club', m), 'ALT');
    assert.equal(abbreviateClub('Altona 2', m), 'ALT 2');
    assert.equal(abbreviateClub('altona hockey club blue', m), 'ALT B');
    assert.equal(abbreviateClub('Essendon Hockey 1 - Black', m), 'ESS B');
    assert.equal(abbreviateClub('KBH Brumbies Hockey Club', m), 'KBH');
    assert.equal(abbreviateClub('Essendon Hockey 1 - Red Dragons', m), 'ESS RD');
    assert.equal(abbreviateClub('Melton/Werribee Hockey Club', m), 'MEL - WER');
    assert.equal(abbreviateClub('Altonamania', m), null);
    assert.equal(abbreviateClub('ALT 2', m), null);
});

test('replaceClubNames maps both teams in a summary', () => {
    assert.equal(
        replaceClubNames('2026 Junior Competition U14 Mixed - 2026 Round 8 - Altona 2 vs Essendon Hockey 1 - Black', m),
        '2026 Junior Competition U14 Mixed - 2026 Round 8 - ALT 2 vs ESS B',
    );
    assert.equal(
        replaceClubNames('Comp - Round 1 - Essendon Hockey 1 - Black vs Altona', m),
        'Comp - Round 1 - ESS B vs ALT',
    );
});

test('real mappings file round-trips and has no duplicate spellings', async () => {
    const real = await loadClubMatcher();
    const spellings = real.aliases.map(([alias]) => alias);
    assert.equal(new Set(spellings).size, spellings.length);
    const obj = { clubs: { B: ['b2', 'b1'], A: ['a'] }, overrides: { x: 'X' } };
    assert.deepEqual(JSON.parse(stringifyClubMappings(obj)), { clubs: { A: ['a'], B: ['b1', 'b2'] }, overrides: { x: 'X' } });
});
