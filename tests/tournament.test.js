import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseScores, parsePlayers, parseGamesWon, parseRules, matchState, groupStandings, filterBlocks, renderMarkdown, inlineMarkdown, plural } from '../assets/tournament.js';

const source = file => readFile(new URL(file, import.meta.url), 'utf8');

test('completed fixture: preserve all stages, matches, groups and official podium', async () => {
  const data = parseScores(await source('fixtures/scores-complete.txt'));
  assert.deepEqual(data.stages.map(stage => stage.title), ['Этап 1', 'Полуфиналы', 'Финал']);
  assert.deepEqual(data.stages.map(stage => stage.blocks.length), [5, 3, 1]);
  assert.equal(data.stages.flatMap(stage => stage.blocks.flatMap(block => block.matches)).length, 13);
  assert.deepEqual(groupStandings(data.stages[0].blocks[4].matches).winners, ['dilat', 'arcade_user']);
  assert.deepEqual(groupStandings(data.stages[2].blocks[0].matches).winners, ['dilat', 'neradimo']);
  assert.deepEqual(data.winners, [{ place: 1, name: 'dilat' }, { place: 2, name: 'neradimo' }, { place: 3, name: 'Serxio' }]);
  assert.deepEqual(data.warnings, []);
});

test('unfinished fixture: blanks, zero scores, empty stages and unannounced winners', async () => {
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

test('blank lines separate individual matches even when the names form a trio', () => {
  const data = parseScores('## Этап 1\nA | 1 | B | 0\n\nB | 1 | C | 0\n\nC | 0 | A | 1');
  assert.deepEqual(data.stages[0].blocks.map(block => block.type), ['single', 'single', 'single']);
});

test('cyclic three-way tie requires a replay and never advances arbitrary players', () => {
  const data = parseScores('## Этап 1\nA | 2 | B | 1\nB | 2 | C | 0\nC | 2 | A | 0');
  const result = groupStandings(data.stages[0].blocks[0].matches);
  assert.equal(result.replay, true);
  assert.deepEqual(result.winners, []);
});

test('incomplete group and tied match cannot produce group winners', () => {
  const data = parseScores('## Этап 1\nA | 2 | B | 0\nB | 2 | C | 2\nC | | A |');
  const result = groupStandings(data.stages[0].blocks[0].matches);
  assert.equal(result.complete, false);
  assert.deepEqual(result.winners, []);
});

test('BOM, CRLF, surrounding spaces and optional Markdown table pipes are supported', () => {
  const data = parseScores('\uFEFF## Этап 1\r\n| Player 1 | Score | Player 2 | Score |\r\n| --- | --- | --- | --- |\r\n\r\n| A | 2 | B | 0 |\r\n\r\n| C | | D | |\r\n');
  assert.equal(data.stages[0].blocks.length, 2);
  assert.deepEqual(data.stages[0].blocks[1].matches[0].scores, [null, null]);
  assert.deepEqual(data.warnings, []);
});

test('explicit match IDs preserve match numbering, group detection and Markdown tables', () => {
  const data = parseScores('\uFEFF## Этап 1\r\n| MatchId | Player 1 | Score | Player 2 | Score |\r\n| --- | --- | --- | --- | --- |\r\n\r\n| A1 | A | 2 | B | 0 |\r\n| A2 | B | 2 | C | 0 |\r\n| A3 | C | 2 | A | 1 |\r\n\r\n| B-1.2_test | A | | D | |');
  const matches = data.stages[0].blocks.flatMap(block => block.matches);
  assert.deepEqual(data.stages[0].blocks.map(block => block.type), ['group', 'single']);
  assert.deepEqual(matches.map(match => [match.id, match.number, match.matchId]), [
    ['match-1', 1, 'A1'], ['match-2', 2, 'A2'], ['match-3', 3, 'A3'], ['match-4', 4, 'B-1.2_test'],
  ]);
  assert.deepEqual(matches[0].players, ['A', 'B']);
  assert.deepEqual(matches[0].scores, [2, 0]);
  assert.deepEqual(matches[3].scores, [null, null]);
  assert.deepEqual(data.warnings, []);
});

test('legacy scores never infer source IDs from display match numbers', () => {
  const data = parseScores('A | 2 | B | 1\n\nA2 | A | 0 | C | 1');
  const matches = data.stages[0].blocks.flatMap(block => block.matches);
  assert.deepEqual(matches.map(match => match.matchId), [null, 'A2']);
  assert.deepEqual(matches.map(match => match.scores), [[2, 1], [0, 1]]);
  assert.deepEqual(data.warnings, []);
});

test('duplicate and invalid source IDs cannot associate game wins to the wrong match', () => {
  const data = parseScores('## Этап 1\nA1 | A | 2 | B | 1\n\nA 2 | C | 0 | D | 2\n\n## Этап 2\nA1 | A | 1 | C | 0\n\nA1 | B | 0 | D | 1\n\nA2 | B | 1 | C | 0');
  const matches = data.stages.flatMap(stage => stage.blocks.flatMap(block => block.matches));
  assert.deepEqual(matches.map(match => match.matchId), [null, null, null, null, 'A2']);
  assert.deepEqual(matches.map(match => match.scores), [[2, 1], [0, 2], [1, 0], [0, 1], [1, 0]]);
  assert.equal(data.warnings.length, 3);
  assert.match(data.warnings[0], /некорректный MatchId/);
  assert.match(data.warnings[1], /повторный MatchId/);
});

test('game wins link by exact match ID and player, including different matches for one player', () => {
  const scores = parseScores('A1 | A | 2 | B | 0\n\nA2 | A | 1 | C | 1');
  const wins = parseGamesWon('\uFEFF# MatchId | Player\r\n\r\n A1 | A \r\n Batman \r\n# This comment does not end the section.\r\nBattle City\r\n\r\nA1 | B\r\n\r\nA2 | A\r\nDuck Tales\r\n\r\nA2 | C\r\nMega Man\r\n');
  const matches = scores.stages[0].blocks.flatMap(block => block.matches);
  assert.deepEqual(matches.map(match => match.players.map(player => wins.matches.get(match.matchId)?.get(player))), [
    [['Batman', 'Battle City'], []], [['Duck Tales'], ['Mega Man']],
  ]);
  assert.equal(wins.matches.get('a1'), undefined);
  assert.equal(wins.matches.get('A1').get('a'), undefined);
  assert.deepEqual(wins.warnings, []);
});

test('repeated game-win sections merge and preserve intentional repeated titles', () => {
  const data = parseGamesWon('A1 | A\nBatman\n\nA1 | B\nBattle City\nA1 | A\nBatman\nDuck Tales\n\nA1 | A\n');
  assert.deepEqual([...data.matches.get('A1')], [
    ['A', ['Batman', 'Batman', 'Duck Tales']], ['B', ['Battle City']],
  ]);
  assert.deepEqual(data.warnings, []);
});

test('blank lines and malformed game-win headers isolate subsequent game names', () => {
  const data = parseGamesWon('Orphan title\nA1 | A\nBatman\n\nAfter blank\nA2 | B\nDuck Tales\nA3 |\nAfter empty player\nA 4 | C\nAfter invalid ID\nA5 | D | Extra\nAfter extra column\nA6 | E\nMega Man');
  assert.deepEqual([...data.matches.keys()], ['A1', 'A2', 'A6']);
  assert.deepEqual(data.matches.get('A1').get('A'), ['Batman']);
  assert.deepEqual(data.matches.get('A2').get('B'), ['Duck Tales']);
  assert.deepEqual(data.matches.get('A6').get('E'), ['Mega Man']);
  assert.equal(data.warnings.length, 8);
});

test('empty game-win data and empty player sections are valid', () => {
  for (const text of ['', '\uFEFF\r\n # comment\r\n', 'MatchId | Player\n']) {
    assert.deepEqual(parseGamesWon(text), { matches: new Map(), warnings: [] });
  }
  const data = parseGamesWon('A1 | A\n\nA1 | B\n');
  assert.deepEqual([...data.matches.get('A1')], [['A', []], ['B', []]]);
  assert.deepEqual(data.warnings, []);
});

test('bad scores, malformed rows and duplicate pairs are surfaced', () => {
  const data = parseScores('## Этап 1\nA | x | B | 1\nA | 1 | B | 2\nC | 1 | B | 0\n\nbroken row');
  assert.equal(data.stages[0].blocks.length, 3);
  assert.equal(data.stages[0].blocks[0].matches[0].scores[0], null);
  assert.ok(data.warnings.length >= 3);
});

test('filtering preserves trios and combines player and status on the same match', () => {
  const stage = parseScores('## Этап\nA | 2 | B | 0\nB | | C |\nC | | A |\n\nD | 0 | E | 0').stages[0];
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

test('rules headings omit subsection numbers only when rendering for display', async () => {
  const rules = parseRules(await source('fixtures/rules.md'));
  const body = rules.sections[2].body;
  const html = renderMarkdown(body, { stripHeadingNumbers: true });
  assert.match(html, /<h3><strong>Начало раунда<\/strong><\/h3>/);
  assert.match(html, /<h3><strong>Игра<\/strong><\/h3>/);
  assert.match(body, /### \*\*3\.1 Начало раунда\*\*/);
  assert.match(renderMarkdown(body), /<strong>3\.1 Начало раунда<\/strong>/);
  const mixed = renderMarkdown('### 3.1 Начало\n\n#### __3.2.1 Игра__\n\n### 8 бит\n\nСм. 3.1 и **3.2**.\n\n1. Первый пункт', { stripHeadingNumbers: true });
  assert.match(mixed, /<h3>Начало<\/h3>/);
  assert.match(mixed, /<h4><strong>Игра<\/strong><\/h4>/);
  assert.match(mixed, /<h3>8 бит<\/h3>/);
  assert.match(mixed, /<p>См. 3\.1 и <strong>3\.2<\/strong>.<\/p>/);
  assert.match(mixed, /<ol><li>Первый пункт<\/li><\/ol>/);
});

test('players are trimmed and deduplicated without changing nickname punctuation', () => {
  assert.deepEqual(parsePlayers('\uFEFFLux Ferre\r\n\nMr(A)ked\nLux Ferre\n Frank_Filter '), ['Lux Ferre', 'Mr(A)ked', 'Frank_Filter']);
});

test('published scores use a valid format; future content edits need no test changes', async () => {
  const data = parseScores(await source('../data/scores.txt'));
  assert.deepEqual(data.warnings, []);
});

test('published game wins identify actual matches and their participants', async () => {
  const scores = parseScores(await source('../data/scores.txt'));
  const wins = parseGamesWon(await source('../data/nes-games-won-by-player.txt'));
  const matches = new Map(scores.stages.flatMap(stage => stage.blocks.flatMap(block => block.matches)).filter(match => match.matchId !== null).map(match => [match.matchId, match]));
  assert.deepEqual(wins.warnings, []);
  for (const [matchId, players] of wins.matches) {
    assert.ok(matches.has(matchId), `Unknown match ${matchId}`);
    for (const player of players.keys()) assert.ok(matches.get(matchId).players.includes(player), `Player ${player} is not in match ${matchId}`);
  }
});

test('Russian noun forms for counts', () => {
  const forms = ['матч', 'матча', 'матчей'];
  assert.deepEqual([0, 1, 2, 5, 11, 21, 22].map(number => plural(number, forms)), ['матчей', 'матч', 'матча', 'матчей', 'матчей', 'матч', 'матча']);
});
