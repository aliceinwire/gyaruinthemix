import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  STREET_ROLES,
  ROUTINE_HAZARDS,
} from '../public/game/src/street-culture.js';

const workplace =
  /会社|企業|会議|残業|締切|承認待ち|監査官|ノルマ|肩書き|コピペ|サラリーマン|通勤|未読メール|無限コピー機|会社の許可/;
test('street encounters use welcoming music and festival themes', () => {
  for (const role of STREET_ROLES) {
    assert.doesNotMatch(role.name + role.welcome, workplace);
    assert.ok(role.behavior && role.fan);
  }
  for (const hazard of ROUTINE_HAZARDS) {
    assert.doesNotMatch(hazard.name + hazard.advice, workplace);
    assert.ok(hazard.hp > 0);
  }
});
test('runtime story and every public catalog omit corporate satire including stale entries', async () => {
  const base = new URL('../public/game/', import.meta.url);
  const paths = [
    'src/tour-story.js',
    'src/crew-dialogue.js',
    'src/simulation.js',
  ];
  for (const name of await readdir(new URL('locales/', base))) {
    if (name.endsWith('.json')) paths.push(`locales/${name}`);
  }
  for (const path of paths)
    assert.doesNotMatch(
      await readFile(new URL(path, base), 'utf8'),
      workplace,
      path,
    );
  const art = await readFile(
    new URL('src/street-culture-art.js', base),
    'utf8',
  );
  assert.doesNotMatch(
    art,
    /label\(ctx,'(?:CORP|BUY MORE|DUE|MEETING|COPY|WAIT)'/,
  );
});
