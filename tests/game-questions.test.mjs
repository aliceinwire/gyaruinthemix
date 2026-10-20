import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTIONS,
  questionForStage,
} from '../public/game-test/src/questions.js';

test('question bank has unique, sourced questions in the requested themes', () => {
  assert.ok(QUESTIONS.length >= 24);
  assert.equal(new Set(QUESTIONS.map((q) => q.id)).size, QUESTIONS.length);
  assert.ok(
    QUESTIONS.filter((q) => q.category === 'ギャルインザミックス').length /
      QUESTIONS.length >=
      0.85,
  );
  for (const q of QUESTIONS) {
    assert.ok(['ギャルインザミックス', '平成ギャル'].includes(q.category));
    assert.equal(q.choices.length, 3);
    assert.equal(new Set(q.choices).size, 3);
    assert.ok(q.answer >= 0 && q.answer < 3);
    assert.ok(q.explanation && new URL(q.source).protocol === 'https:');
  }
});
test('random tour decks do not repeat and retries preserve each question and answer', () => {
  for (const seed of [0, 1, 175, 9999, 0xffffffff]) {
    const deck = Array.from({ length: QUESTIONS.length }, (_, stage) =>
      questionForStage(stage, 'scenic', seed),
    );
    assert.equal(new Set(deck.map((q) => q.id)).size, QUESTIONS.length);
    assert.equal(
      deck.slice(0, 12).filter((q) => q.category === 'ギャルインザミックス')
        .length,
      11,
    );
    for (const [stage, q] of deck.entries()) {
      assert.deepEqual(q, questionForStage(stage, 'event-road', seed));
      const original = QUESTIONS.find((item) => item.id === q.id);
      assert.equal(q.choices[q.answer], original.choices[original.answer]);
    }
  }
});
test('new tour seeds vary question order and answer positions', () => {
  const starts = new Set(),
    positions = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const q = questionForStage(0, 'scenic', seed);
    starts.add(q.id);
    positions.add(q.answer);
  }
  assert.ok(starts.size > 20);
  assert.equal(positions.size, 3);
});
