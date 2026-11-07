/** Pure data helpers, shared by the browser and the Node test suite. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export function plural(number, forms) {
  const n = Math.abs(number) % 100;
  const last = n % 10;
  return forms[n > 10 && n < 20 ? 2 : last === 1 ? 0 : last > 1 && last < 5 ? 1 : 2];
}

function parseLineList(text) {
  return [...new Set(text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
}

export function parsePlayers(text) {
  return parseLineList(text);
}

export function parseGames(text) {
  return parseLineList(text);
}

function isMatchId(value) {
  return /^[a-z\d][a-z\d._-]*$/i.test(value);
}

/** Per-match game wins; a blank line closes the current player's section. */
export function parseGamesWon(text) {
  const matches = new Map();
  const warnings = [];
  let games = null;

  text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) { games = null; return; }
    if (line.startsWith('#')) return;
    if (line.includes('|')) {
      games = null;
      const cells = line.split('|').map(cell => cell.trim());
      if (cells.length === 2 && /^MatchId$/i.test(cells[0]) && /^Player$/i.test(cells[1])) return;
      if (cells.length !== 2 || !isMatchId(cells[0]) || !cells[1]) {
        warnings.push(`Строка ${index + 1}: не удалось прочитать заголовок списка выигранных игр (MatchId | Player).`);
        return;
      }
      const [matchId, player] = cells;
      if (!matches.has(matchId)) matches.set(matchId, new Map());
      const players = matches.get(matchId);
      if (!players.has(player)) players.set(player, []);
      games = players.get(player);
      return;
    }
    if (!games) {
      warnings.push(`Строка ${index + 1}: игра «${line}» указана без заголовка MatchId | Player.`);
      return;
    }
    games.push(line);
  });
  return { matches, warnings };
}

export function matchState(match) {
  const [first, second] = match.scores;
  const { winScore } = match;
  if (!Number.isSafeInteger(winScore) || winScore < 1) return { status: 'pending', winner: null };
  if (first === null || second === null) return { status: 'pending', winner: null };
  if (first >= winScore && second < winScore) return { status: 'completed', winner: 0 };
  if (second >= winScore && first < winScore) return { status: 'completed', winner: 1 };
  return { status: 'pending', winner: null };
}

export function groupStandings(matches) {
  const players = [...new Set(matches.flatMap(match => match.players))];
  const standings = players.map(name => ({ name, wins: 0, roundWins: 0 }));
  for (const match of matches) {
    const state = matchState(match);
    match.players.forEach((name, index) => {
      const player = standings.find(player => player.name === name);
      if (state.winner === index) player.wins++;
      player.roundWins += match.scores[index] ?? 0;
    });
  }
  standings.sort((a, b) => b.wins - a.wins || b.roundWins - a.roundWins);
  const complete = matches.length === 3 && matches.every(match => matchState(match).status === 'completed');
  const lowestPoints = Math.min(...standings.map(player => player.roundWins));
  const pointsWinners = complete && standings.length === 3
    ? standings.filter(player => player.roundWins > lowestPoints).map(player => player.name)
    : [];
  const cyclic = complete && standings.length === 3 && standings.every(player => player.wins === 1);
  const replay = cyclic && standings.every(player => player.roundWins === standings[0].roundWins);
  // The written rules do not resolve a two-player tie for the lowest round total.
  const needsDecision = cyclic && !replay && standings[1].roundWins === standings[2].roundWins;
  return { standings, complete, pointsWinners, replay, needsDecision, winners: complete && !replay && !needsDecision ? standings.slice(0, 2).map(player => player.name) : [] };
}

export function parseScores(text) {
  const stages = [];
  const winners = [];
  const warnings = [];
  let stage = null;
  let block = [];
  let winnersSection = false;
  let matchNumber = 0;
  const matchIds = new Map();

  function startStage(title, options, line) {
    const settings = { win: [], column: [] };
    for (const option of options) {
      const setting = option.match(/^(win|column)\s*=\s*(.*)$/i);
      if (setting) settings[setting[1].toLowerCase()].push(setting[2].trim());
      else warnings.push(`Строка ${line}: в этапе «${title}» неизвестный или некорректный параметр «${option}». Используйте win=2 или column=middle.`);
    }
    const target = settings.win.length === 1 && /^\d+$/.test(settings.win[0]) ? Number(settings.win[0]) : null;
    const winScore = Number.isSafeInteger(target) && target > 0 ? target : null;
    const column = settings.column.length === 1 && /^[a-z\d][a-z\d._-]*$/i.test(settings.column[0]) ? settings.column[0] : null;
    stage = { id: `stage-${stages.length + 1}`, title, winScore, column, blocks: [] };
    stages.push(stage);
    if (winScore === null) {
      warnings.push(`Строка ${line}: в этапе «${title}» не задан корректный порог победы. Укажите положительное целое число в заголовке, например [${title} | win=2]. Победители матчей пока не определены.`);
    }
    if (settings.column.length && column === null) {
      warnings.push(`Строка ${line}: в этапе «${title}» некорректный или повторный параметр column. Укажите один ключ из латинских букв, цифр, точек, дефисов и подчёркиваний, начиная с буквы или цифры, например column=middle. Этап показан в отдельной колонке.`);
    }
  }

  function flush() {
    if (!block.length) return;
    const names = new Set(block.flatMap(match => match.players));
    const pairs = new Set(block.map(match => JSON.stringify([...match.players].sort())));
    const isGroup = block.length === 3 && names.size === 3 && pairs.size === 3;
    if (isGroup) {
      stage.blocks.push({ type: 'group', id: `group-${block[0].id}`, matches: block });
    } else {
      if (block.length > 1) warnings.push(`В этапе «${stage.title}» соседние строки не образуют группу из трёх игроков. Они показаны отдельными матчами.`);
      stage.blocks.push(...block.map(match => ({ type: 'single', id: match.id, matches: [match] })));
    }
    block = [];
  }

  const scoreValue = (value, line) => {
    if (/^(?:[-—–?])?$/.test(value)) return null;
    if (/^\d+$/.test(value) && Number.isSafeInteger(Number(value))) return Number(value);
    warnings.push(`Строка ${line}: некорректный счёт «${value}». Исход матча пока не определён.`);
    return null;
  };

  text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) { flush(); return; }
    if (line.startsWith('#')) return;
    const heading = line.match(/^\[([^\[\]]+)\]$/);
    const [title, ...options] = heading ? heading[1].split('|').map(value => value.trim()) : [];
    if (title) {
      flush();
      winnersSection = /^(?:победители|пьедестал)(?:\s|$)/iu.test(title);
      if (!winnersSection) startStage(title, options, index + 1);
      return;
    }
    const row = line.startsWith('|') ? line.slice(1).replace(/\|$/, '') : line;
    const cells = row.split('|').map(cell => cell.trim());
    // Headers and optional Markdown table separators are not match boundaries.
    if (/^(?:MatchId|Player\s*1|Игрок\s*1|Place|Место)$/iu.test(cells[0])) return;
    if (cells.every(cell => /^:?-{2,}:?$/.test(cell))) return;
    if (winnersSection) {
      if (cells.length !== 2 || !/^[1-3]$/.test(cells[0])) {
        warnings.push(`Строка ${index + 1}: ожидаются место и имя победителя.`);
      } else if (cells[1] && !/^[-—–?]$/.test(cells[1])) {
        const place = Number(cells[0]);
        if (winners.some(winner => winner.place === place || winner.name === cells[1])) {
          warnings.push(`Строка ${index + 1}: повторное место или имя в списке победителей.`);
        } else winners.push({ place, name: cells[1] });
      }
      return;
    }
    const hasMatchId = cells.length === 5;
    const values = hasMatchId ? cells.slice(1) : cells;
    if (values.length !== 4 || !values[0] || !values[2] || values[0] === values[2]) {
      flush();
      warnings.push(`Строка ${index + 1}: не удалось прочитать матч.`);
      return;
    }
    if (!stage) startStage('Матчи', [], index + 1);
    matchNumber++;
    const match = { id: `match-${matchNumber}`, number: matchNumber, matchId: null, winScore: stage.winScore, players: [values[0], values[2]], scores: [scoreValue(values[1], index + 1), scoreValue(values[3], index + 1)] };
    if (match.winScore !== null && match.scores.every(score => score !== null && score >= match.winScore)) {
      warnings.push(`Строка ${index + 1}: оба игрока достигли порога победы ${match.winScore}. Проверьте счёт матча; победитель пока не определён.`);
    }
    if (hasMatchId) {
      const matchId = cells[0];
      if (!isMatchId(matchId)) {
        warnings.push(`Строка ${index + 1}: некорректный MatchId «${matchId}». Список выигранных игр для этого матча недоступен.`);
      } else if (matchIds.has(matchId)) {
        // Neither occurrence can safely own game wins from the external file.
        matchIds.get(matchId).matchId = null;
        warnings.push(`Строка ${index + 1}: повторный MatchId «${matchId}». Списки выигранных игр для матчей с этим идентификатором недоступны.`);
      } else {
        match.matchId = matchId;
        matchIds.set(matchId, match);
      }
    }
    block.push(match);
  });
  flush();
  return { stages, winners: winners.sort((a, b) => a.place - b.place), warnings };
}

/** Column order follows first occurrence; unassigned stages each own a column. */
export function groupStageColumns(stages) {
  const columns = new Map();
  for (const stage of stages) {
    const key = stage.column ?? stage;
    if (!columns.has(key)) columns.set(key, []);
    columns.get(key).push(stage);
  }
  return [...columns.values()];
}

export function filterBlocks(stage, { search = '', status = 'all' } = {}) {
  const query = search.trim().toLocaleLowerCase('ru-RU');
  // Keep all three matches together, even when only one row matches a filter.
  return stage.blocks.filter(block => block.matches.some(match => {
    const matchesPlayer = !query || match.players.some(name => name.toLocaleLowerCase('ru-RU').includes(query));
    const complete = matchState(match).status === 'completed';
    return matchesPlayer && (status === 'all' || (status === 'completed' ? complete : !complete));
  }));
}

export function plainMarkdown(value) {
  return value.replace(/\\([\\`*_{}\[\]()#+.!>~-])/g, '$1').replace(/\*\*|__/g, '').replace(/^#{1,6}\s*/, '').trim();
}

export function parseRules(text) {
  const source = text.replace(/^\uFEFF/, '');
  const sections = [];
  let title = '';
  let preamble = [];
  let current = null;
  for (const line of source.split(/\r?\n/)) {
    if (/^#\s+/.test(line) && !title) { title = plainMarkdown(line); continue; }
    if (/^##\s+/.test(line)) {
      current = { title: plainMarkdown(line).replace(/^\d+\.\s*/, ''), body: '' };
      sections.push(current);
    } else if (current) current.body += `${line}\n`;
    else preamble.push(line);
  }
  const plain = plainMarkdown(source);
  const date = plain.match(/проходить\s+(\d{1,2}(?:\s*,\s*\d{1,2})*\s+и\s+\d{1,2})\s+([а-яё]+)/iu);
  const days = date ? date[1].match(/\d+/g).map(Number) : [];
  const consecutive = days.length > 1 && days.every((day, index) => index === 0 || day === days[index - 1] + 1);
  const dateLabel = date ? `${consecutive ? `${days[0]}–${days.at(-1)}` : days.join(', ')} ${date[2]}` : null;
  const dateNote = plain.match(/\((если участников[^)]+)\)/iu)?.[1];
  const prizeMatch = plain.match(/Призовой фонд[^\n.]*?(?:составит|составляет|:)\s*([\d\s\u00a0]+)\s*(?:руб|₽)/iu);
  const money = value => value ? Number(value.replace(/\s/g, '')) : null;
  const payouts = {};
  ['Первое', 'второе', 'третье'].forEach((word, index) => {
    const found = plain.match(new RegExp(`${word}\\s+(?:место\\s+)?(?:получает\\s+)?([\\d\\s\\u00a0]+)\\s*(?:руб|₽)`, 'iu'));
    if (found) payouts[index + 1] = money(found[1]);
  });
  return { title, sections, preamble: preamble.join('\n').trim(), dateLabel, dateNote: dateNote ? dateNote[0].toUpperCase() + dateNote.slice(1) : null, prizeTotal: money(prizeMatch?.[1]), payouts };
}

/** Small, escaped Markdown renderer: no raw HTML, images, or executable URLs. */
export function inlineMarkdown(text) {
  const tokens = /\\([\\`*_{}\[\]()#+.!>~-])|`([^`]+)`|\[([^\]]+)\]\(([^\s)]+)\)|\*\*(.+?)\*\*|__(.+?)__|\*([^*]+)\*/g;
  let html = '';
  let start = 0;
  for (const token of text.matchAll(tokens)) {
    html += escapeHtml(text.slice(start, token.index));
    if (token[1]) html += escapeHtml(token[1]);
    else if (token[2]) html += `<code>${escapeHtml(token[2])}</code>`;
    else if (token[3]) {
      const url = token[4];
      const allowed = /^(?:https?:\/\/|mailto:|#|\.\.?\/)/i.test(url);
      html += allowed ? `<a href="${escapeHtml(url)}"${/^https?:/i.test(url) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(token[3])}</a>` : escapeHtml(token[3]);
    } else if (token[5] || token[6]) html += `<strong>${inlineMarkdown(token[5] || token[6])}</strong>`;
    else html += `<em>${escapeHtml(token[7])}</em>`;
    start = token.index + token[0].length;
  }
  return html + escapeHtml(text.slice(start));
}

export function renderMarkdown(source, { stripHeadingNumbers = false } = {}) {
  const blocks = [];
  let paragraph = [];
  let list = [];
  let listType = null;
  function flushParagraph() { if (paragraph.length) blocks.push(`<p>${inlineMarkdown(paragraph.join('\n')).replace(/ {2}\n/g, '<br>').replace(/\n/g, ' ')}</p>`); paragraph = []; }
  function flushList() { if (list.length) blocks.push(`<${listType}>${list.map(item => `<li>${inlineMarkdown(item)}</li>`).join('')}</${listType}>`); list = []; listType = null; }
  for (const raw of source.split(/\r?\n/)) {
    const line = raw;
    const heading = line.match(/^(#{1,6})\s+(.+)/);
    const item = line.match(/^\s*(?:([-+*])|\d+[.)])\s+(.+)/);
    if (!line.trim()) { flushParagraph(); flushList(); }
    else if (heading) {
      flushParagraph(); flushList();
      const level = Math.max(3, heading[1].length);
      const title = stripHeadingNumbers
        ? heading[2].replace(/^(\*\*|__)?\d+(?:\.\d+)+\.?\s+/, '$1')
        : heading[2];
      blocks.push(`<h${level}>${inlineMarkdown(title)}</h${level}>`);
    }
    else if (item) { flushParagraph(); const type = item[1] ? 'ul' : 'ol'; if (listType && listType !== type) flushList(); listType = type; list.push(item[2]); }
    else if (/^>\s?/.test(line)) { flushParagraph(); flushList(); blocks.push(`<blockquote>${inlineMarkdown(line.replace(/^>\s?/, ''))}</blockquote>`); }
    else if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) { flushParagraph(); flushList(); blocks.push('<hr>'); }
    else { flushList(); paragraph.push(line); }
  }
  flushParagraph(); flushList();
  return blocks.join('\n');
}
