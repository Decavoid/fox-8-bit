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
  if (first === null || second === null) return { status: 'pending', winner: null };
  if (first === second) return { status: 'tied', winner: null };
  return { status: 'completed', winner: first > second ? 0 : 1 };
}

export function groupStandings(matches) {
  const players = [...new Set(matches.flatMap(match => match.players))];
  const standings = players.map(name => ({ name, wins: 0 }));
  for (const match of matches) {
    const state = matchState(match);
    if (state.winner !== null) standings.find(player => player.name === match.players[state.winner]).wins++;
  }
  standings.sort((a, b) => b.wins - a.wins);
  const complete = matches.length === 3 && matches.every(match => matchState(match).status === 'completed');
  const replay = complete && standings.length === 3 && standings.every(player => player.wins === 1);
  return { standings, complete, replay, winners: complete && !replay ? standings.slice(0, 2).map(player => player.name) : [] };
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
    const title = heading?.[1].trim();
    if (title) {
      flush();
      winnersSection = /^(?:победители|пьедестал)(?:\s|$)/iu.test(title);
      if (!winnersSection) {
        stage = { id: `stage-${stages.length + 1}`, title, blocks: [] };
        stages.push(stage);
      }
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
    if (!stage) {
      stage = { id: 'stage-1', title: 'Матчи', blocks: [] };
      stages.push(stage);
    }
    matchNumber++;
    const match = { id: `match-${matchNumber}`, number: matchNumber, matchId: null, players: [values[0], values[2]], scores: [scoreValue(values[1], index + 1), scoreValue(values[3], index + 1)] };
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
