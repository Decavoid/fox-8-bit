import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseScores, parsePlayers, parseRules, matchState, groupStandings, filterBlocks, renderMarkdown, inlineMarkdown, plural } from '../assets/tournament.js';

const source = file => readFile(new URL(file, import.meta.url), 'utf8');

test('completed fixture: preserve all rounds, matches, groups and official podium', async () => {
  const data = parseScores(await source('fixtures/scores-complete.txt'));
  assert.deepEqual(data.stages.map(stage => stage.title), ['Раунд 1', 'Полуфиналы', 'Финал']);
  assert.deepEqual(data.stages.map(stage => stage.blocks.length), [5, 3, 1]);
  assert.equal(data.stages.flatMap(stage => stage.blocks.flatMap(block => block.matches)).length, 13);
  assert.deepEqual(groupStandings(data.stages[0].blocks[4].matches).winners, ['dilat', 'arcade_user']);
  assert.deepEqual(groupStandings(data.stages[2].blocks[0].matches).winners, ['dilat', 'neradimo']);
  assert.deepEqual(data.winners, [{ place: 1, name: 'dilat' }, { place: 2, name: 'neradimo' }, { place: 3, name: 'Serxio' }]);
  assert.deepEqual(data.warnings, []);
});

test('unfinished fixture: blanks, zero scores, empty rounds and unannounced winners', async () => {
  const data = parseScores(await source('fixtures/scores-upcoming.txt'));
  assert.deepEqual(data.stages.map(stage => stage.blocks.length), [5, 0, 0]);
  const matches = data.stages[0].blocks.flatMap(block => block.matches);
  assert.deepEqual(matches.map(match => matchState(match).status), ['completed', 'completed', 'tied', 'pending', 'pending', 'pending', 'pending']);
  assert.deepEqual(matches[2].scores, [0, 0]);
  assert.deepEqual(matches[3].scores, [null, null]);
  assert.equal(data.stages[0].blocks[4].type, 'group');
  assert.deepEqual(groupStandings(data.stages[0].blocks[4].matches).winners, []);
  assert.deepEqual(data.winners, []);
  assert.deepEqual(data.warnings, []);
});

test('blank lines separate individual games even when the names form a trio', () => {
  const data = parseScores('## Раунд 1\nA | 1 | B | 0\n\nB | 1 | C | 0\n\nC | 0 | A | 1');
  assert.deepEqual(data.stages[0].blocks.map(block => block.type), ['single', 'single', 'single']);
});

test('cyclic three-way tie requires a replay and never advances arbitrary players', () => {
  const data = parseScores('## Раунд 1\nA | 2 | B | 1\nB | 2 | C | 0\nC | 2 | A | 0');
  const result = groupStandings(data.stages[0].blocks[0].matches);
  assert.equal(result.replay, true);
  assert.deepEqual(result.winners, []);
});

test('incomplete group and tied game cannot produce group winners', () => {
  const data = parseScores('## Раунд 1\nA | 2 | B | 0\nB | 2 | C | 2\nC | | A |');
  const result = groupStandings(data.stages[0].blocks[0].matches);
  assert.equal(result.complete, false);
  assert.deepEqual(result.winners, []);
});

test('BOM, CRLF, surrounding spaces and optional Markdown table pipes are supported', () => {
  const data = parseScores('\uFEFF## Раунд 1\r\n| Player 1 | Score | Player 2 | Score |\r\n| --- | --- | --- | --- |\r\n\r\n| A | 2 | B | 0 |\r\n\r\n| C | | D | |\r\n');
  assert.equal(data.stages[0].blocks.length, 2);
  assert.deepEqual(data.stages[0].blocks[1].matches[0].scores, [null, null]);
  assert.deepEqual(data.warnings, []);
});

test('bad scores, malformed rows and duplicate pairs are surfaced', () => {
  const data = parseScores('## Раунд 1\nA | x | B | 1\nA | 1 | B | 2\nC | 1 | B | 0\n\nbroken row');
  assert.equal(data.stages[0].blocks.length, 3);
  assert.equal(data.stages[0].blocks[0].matches[0].scores[0], null);
  assert.ok(data.warnings.length >= 3);
});

test('filtering preserves trios and combines player and status on the same match', () => {
  const stage = parseScores('## Раунд\nA | 2 | B | 0\nB | | C |\nC | | A |\n\nD | 0 | E | 0').stages[0];
  assert.equal(filterBlocks(stage, { search: ' a ', status: 'pending' })[0].matches.length, 3);
  assert.equal(filterBlocks(stage, { search: 'C', status: 'completed' }).length, 0);
  assert.equal(filterBlocks(stage, { search: 'D', status: 'pending' }).length, 1);
});

test('explicit podium is independent of score inference, empty podium rows are valid', () => {
  const data = parseScores('## Победители\nPlace | Player\n1 |\n2 |\n3 |');
  assert.deepEqual(data.winners, []);
  assert.deepEqual(data.warnings, []);
  const duplicate = parseScores('## Победители\n1 | A\n1 | B\n2 | A');
  assert.deepEqual(duplicate.winners, [{ place: 1, name: 'A' }]);
  assert.equal(duplicate.warnings.length, 2);
});

test('rules retain all sections and derive actual event dates and prizes', async () => {
  const rules = parseRules(await source('fixtures/rules.md'));
  assert.equal(rules.title, 'Турнир ВосьмиБитвы');
  assert.equal(rules.sections.length, 4);
  assert.equal(rules.sections[2].title, 'Порядок проведения раунда');
  assert.match(rules.sections[2].body, /3\.1 Начало раунда/);
  assert.equal(rules.dateLabel, '6–8 ноября');
  assert.equal(rules.dateNote, 'Если участников будет немного, то 7 и 8 ноября');
  assert.equal(rules.prizeTotal, 25000);
  assert.deepEqual(rules.payouts, { 1: 18000, 2: 6000, 3: 1000 });
  const changed = parseRules('## О турнире\nБудет проходить 7 и 8 ноября.\n## Призы\nПризовой фонд турнира составит 30 000 рублей. Первое место получает 20 000 рублей, второе 8 000 рублей, третье 2 000 рублей.');
  assert.equal(changed.dateLabel, '7–8 ноября');
  assert.equal(changed.prizeTotal, 30000);
  assert.deepEqual(changed.payouts, { 1: 20000, 2: 8000, 3: 2000 });
});

test('Markdown handles formatting but escapes HTML and rejects active URLs', () => {
  const html = renderMarkdown('### **3.1 Начало**\n\nТекст **жирный** и *курсив*.  \nСледующая строка.\n\n- Раз\n- Два\n\n<script>alert(1)</script>\n\n[опасно](javascript:evil)\n\n[ссылка](https://example.com)');
  assert.match(html, /<h3><strong>3.1 Начало<\/strong><\/h3>/);
  assert.match(html, /<br>/);
  assert.match(html, /<ul><li>Раз<\/li><li>Два<\/li><\/ul>/);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
  assert.match(html, /rel="noopener noreferrer"/);
  assert.equal(inlineMarkdown('1\\. Текст'), '1. Текст');
});

test('players are trimmed and deduplicated without changing nickname punctuation', () => {
  assert.deepEqual(parsePlayers('\uFEFFLux Ferre\r\n\nMr(A)ked\nLux Ferre\n Frank_Filter '), ['Lux Ferre', 'Mr(A)ked', 'Frank_Filter']);
});

test('published scores use a valid format; future content edits need no test changes', async () => {
  const data = parseScores(await source('../data/scores.txt'));
  assert.deepEqual(data.warnings, []);
});

test('Russian noun forms for counts', () => {
  const forms = ['матч', 'матча', 'матчей'];
  assert.deepEqual([0, 1, 2, 5, 11, 21, 22].map(number => plural(number, forms)), ['матчей', 'матч', 'матча', 'матчей', 'матчей', 'матч', 'матча']);
});
