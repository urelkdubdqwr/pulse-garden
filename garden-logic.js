// garden-logic.js — pure, side-effect-free logic shared by the renderer and
// the offline self-check (test_logic.cjs). No DOM, no SDK, no I/O.
'use strict';

// ExpressionType enum values from the SmartSpectra protobuf.
const EXPRESSION = {
    UNSPECIFIED: 0, ANGRY: 1, CONTEMPT: 2, DISGUST: 3, FEAR: 4,
    HAPPY: 5, NEUTRAL: 6, SAD: 7, SURPRISE: 8,
};

const EXPRESSION_NAME = {
    0: 'unspecified', 1: 'angry', 2: 'contempt', 3: 'disgust', 4: 'fear',
    5: 'happy', 6: 'neutral', 7: 'sad', 8: 'surprise',
};

// Each mood drives the garden palette: [petal, aura, glow].
const PALETTE = {
    happy:    { petal: '#ffd36e', aura: '#6ee7a8', glow: 1.15 },
    surprise: { petal: '#b98bff', aura: '#8ad4ff', glow: 1.10 },
    neutral:  { petal: '#7fe3c0', aura: '#5aa9ff', glow: 1.00 },
    sad:      { petal: '#7f9ce0', aura: '#4a6bb0', glow: 0.85 },
    angry:    { petal: '#ff7a6e', aura: '#ff4d6d', glow: 1.05 },
    fear:     { petal: '#9aa7c8', aura: '#6a7bb8', glow: 0.9 },
    disgust:  { petal: '#a8c47a', aura: '#7a9c5a', glow: 0.9 },
    contempt: { petal: '#c8b48a', aura: '#a08a5a', glow: 0.9 },
    unspecified: { petal: '#7fe3c0', aura: '#5aa9ff', glow: 1.0 },
};

// Pick the dominant expression from a decoded Expression message's scores.
// `scores` = [{ type, confidence }]. Returns { name, confidence }.
function dominantExpression(scores) {
    if (!Array.isArray(scores) || scores.length === 0) return { name: 'neutral', confidence: 0 };
    let best = scores[0];
    for (const s of scores) if (s && s.confidence > best.confidence) best = s;
    return { name: EXPRESSION_NAME[best.type] || 'neutral', confidence: best.confidence || 0 };
}

function paletteFor(name) { return PALETTE[name] || PALETTE.neutral; }

// Calm score 0..100. Rewards slow, steady breathing near a relaxed target
// (~6 BR/min) and a lower resting pulse. Deliberately forgiving — a wellness
// toy, not a clinical readout.
const CALM_BREATH_TARGET = 6;   // BR/min
function calmScore({ breath, pulse }) {
    let score = 0;
    if (breath != null && breath > 0) {
        // 100 when at/below target, tapering to 0 by 24 BR/min.
        const b = Math.max(0, Math.min(1, (24 - breath) / (24 - CALM_BREATH_TARGET)));
        score += 60 * b;
    } else {
        score += 30; // no data yet — stay mid, don't punish an empty session
    }
    if (pulse != null && pulse > 0) {
        // 55..110 BPM band → 1..0.
        const p = Math.max(0, Math.min(1, (110 - pulse) / (110 - 55)));
        score += 40 * p;
    } else {
        score += 20;
    }
    return Math.max(0, Math.min(100, Math.round(score)));
}

// How many petals are open for a given calm score (0..8).
function bloomFor(calm) { return Math.round((calm / 100) * 8); }

module.exports = { EXPRESSION, EXPRESSION_NAME, PALETTE, dominantExpression, paletteFor, calmScore, bloomFor, CALM_BREATH_TARGET };
