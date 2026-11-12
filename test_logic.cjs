// test_logic.cjs — offline self-check for the pure garden logic.
// Run: node test_logic.cjs   (no SDK, no camera, no network)
'use strict';
const assert = require('assert');
const L = require('./garden-logic.js');

// dominantExpression picks the highest-confidence score.
assert.strictEqual(L.dominantExpression([{ type: 5, confidence: 80 }, { type: 6, confidence: 10 }]).name, 'happy');
assert.strictEqual(L.dominantExpression([{ type: 7, confidence: 55 }, { type: 5, confidence: 60 }]).name, 'happy');
assert.strictEqual(L.dominantExpression([]).name, 'neutral');
assert.strictEqual(L.dominantExpression(null).name, 'neutral');

// palette falls back to neutral for unknown moods.
assert.deepStrictEqual(L.paletteFor('nonsense'), L.PALETTE.neutral);
assert.strictEqual(L.paletteFor('happy').petal, '#ffd36e');

// calmScore: slow breath + low pulse → high; fast + high → low.
assert.ok(L.calmScore({ breath: 6, pulse: 55 }) >= 95, 'calm at target should be ~100');
assert.ok(L.calmScore({ breath: 24, pulse: 110 }) <= 5, 'stressed should be ~0');
assert.ok(L.calmScore({ breath: 6, pulse: 55 }) > L.calmScore({ breath: 18, pulse: 90 }), 'calmer wins');
assert.ok(L.calmScore({ breath: null, pulse: null }) === 50, 'no data → mid');
assert.ok(L.calmScore({ breath: 100, pulse: 200 }) === 0, 'clamped low');
assert.ok(L.calmScore({ breath: 0, pulse: 0 }) <= 100, 'clamped high');

// bloom maps 0..100 → 0..8 petals.
assert.strictEqual(L.bloomFor(0), 0);
assert.strictEqual(L.bloomFor(100), 8);
assert.strictEqual(L.bloomFor(50), 4);

console.log('✓ garden-logic: all assertions passed');
