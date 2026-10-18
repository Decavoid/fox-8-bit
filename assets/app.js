import { escapeHtml as esc, plural, parsePlayers, parseGames, parseGamesWon, parseScores, parseRules, matchState, groupStandings, filterBlocks, renderMarkdown } from './tournament.js';
import { enhanceStatusSelect } from './status-select.js';

const $ = selector => document.querySelector(selector);
const statusSelect = enhanceStatusSelect($('#match-status'));
const state = { scores: null, gamesWon: null, players: null, games: null, rules: null, stage: 'all', search: '', gameSearch: '', gamesExpanded: false, status: 'all', loading: false };
const gamesMobile = window.matchMedia('(max-width: 660px)');
const previous = new Map();
const failures = new Set();
let shownGames = null;
const rubles = value => `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
const pad = number => String(number).padStart(2, '0');
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#icon-${name}"/></svg>`;

function statusLabel(status) {
  return { completed: 'Завершён', pending: 'Ожидается', tied: 'Счёт равный' }[status];
}

function contestantRows(match, result) {
  return match.players.map((player, index) => {
    const score = match.scores[index];
    const scoreLabel = score === null ? 'Счёт пока не указан' : `Выигранные раунды: ${score}`;
    return `<span class="contestant${result.winner === null ? '' : result.winner === index ? ' winner' : ' loser'}">
      <span class="contestant-name">${esc(player)}</span>
      ${result.winner === index ? '<span class="sr-only">Победитель.</span>' : ''}
      <span class="score${score === null ? ' pending-score' : ''}" aria-label="${scoreLabel}">${score ?? '—'}</span>
    </span>`;
  }).join('');
}

const matchKey = match => match.matchId ? `source:${match.matchId}` : `row:${match.id}`;
const findMatch = key => state.scores?.stages.flatMap(stage => stage.blocks.flatMap(block => block.matches)).find(match => matchKey(match) === key);
const matchDescription = match => `Матч ${match.number}: ${match.players[0]} ${match.scores[0] ?? '—'} : ${match.scores[1] ?? '—'} ${match.players[1]}`;

function renderGamesDialog() {
  if (!shownGames) return false;
  const match = findMatch(shownGames.key);
  // Legacy rows have no stable source ID; do not switch an open result to a different pair.
  if (!match || (!match.matchId && JSON.stringify(match.players) !== JSON.stringify(shownGames.players))) {
    $('#games-dialog').close();
    return false;
  }
  const result = matchState(match);
  const order = result.winner === 1 ? [1, 0] : [0, 1];
  const outcome = index => result.winner === null ? '' : result.winner === index ? ' winner' : ' loser';
  const playerName = index => `<span class="games-dialog-player${outcome(index)}">${esc(match.players[index])}</span>`;
  $('#games-dialog-match').textContent = `${matchDescription(match)}. ${statusLabel(result.status)}${result.winner === null ? '' : `. Победитель: ${match.players[result.winner]}`}`;
  $('#games-dialog-scoreboard').innerHTML = `${playerName(order[0])}<div class="games-dialog-scores">${order.map(index => `<span class="games-dialog-result${outcome(index)}"><span class="score${match.scores[index] === null ? ' pending-score' : ''}" aria-label="${esc(match.players[index])}: ${match.scores[index] ?? 'счёт пока не указан'}">${match.scores[index] ?? '—'}</span></span>`).join('')}</div>${playerName(order[1])}`;
  $('#games-dialog-content').innerHTML = order.map(index => {
    const player = match.players[index];
    const games = state.gamesWon?.matches.get(match.matchId)?.get(player) || [];
    return `<section class="games-dialog-games${outcome(index)}" aria-label="Выигранные игры: ${esc(player)}">${games.length
      ? `<ul>${games.map(game => `<li>${esc(game)}</li>`).join('')}</ul>`
      : `<p class="games-dialog-empty">${match.scores[index] === 0 ? 'Нет выигранных раундов.' : 'Игры пока не указаны.'}</p>`}</section>`;
  }).join('');
  return true;
}

function singleCard(match) {
  const result = matchState(match);
  return `<button type="button" class="match-card match-trigger" data-games-match="${esc(matchKey(match))}" aria-haspopup="dialog" aria-controls="games-dialog" aria-label="${esc(matchDescription(match))}. Открыть результат матча">
    ${result.status === 'completed' ? '' : `<span class="match-card-top"><span class="match-status ${result.status}">${statusLabel(result.status)}</span></span>`}
    ${contestantRows(match, result)}
  </button>`;
}

function groupCard(block) {
  const standings = groupStandings(block.matches);
  return `<article class="match-card group-card" aria-label="Группа из трёх игроков: ${esc(standings.standings.map(player => player.name).join(', '))}">
    <div class="group-games">
      ${block.matches.map(match => {
        const result = matchState(match);
        return `<button type="button" class="group-game match-trigger" data-games-match="${esc(matchKey(match))}" aria-haspopup="dialog" aria-controls="games-dialog" aria-label="${esc(matchDescription(match))}. ${statusLabel(result.status)}${result.winner !== null ? `. Победитель: ${esc(match.players[result.winner])}` : ''}. Открыть результат матча">
          ${contestantRows(match, result)}
        </button>`;
      }).join('')}
    </div>
    ${standings.replay ? '<p class="group-replay">У всех по одной победе в матчах — требуется переигровка группы.</p>' : ''}
  </article>`;
}

function renderStageFilters() {
  if (!state.scores) return;
  const stages = [{ id: 'all', title: 'Все этапы' }, ...state.scores.stages];
  if (!stages.some(stage => stage.id === state.stage)) state.stage = 'all';
  $('#stage-filters').innerHTML = stages.map(stage => `<button type="button" class="filter-button" data-stage="${stage.id}" aria-pressed="${state.stage === stage.id}" aria-controls="match-board">${esc(stage.title)}</button>`).join('');
}

function renderMatches() {
  if (!state.scores) return;
  const board = $('#match-board');
  const focusedMatch = document.activeElement?.closest('[data-games-match]');
  const stages = state.scores.stages.filter(stage => state.stage === 'all' || stage.id === state.stage);
  let anyMatches = false;
  const filtered = Boolean(state.search.trim()) || state.status !== 'all';
  const html = stages.map(stage => {
    const blocks = filterBlocks(stage, state);
    if (blocks.length) anyMatches = true;
    if (filtered && !blocks.length) return '';
    const count = blocks.reduce((total, block) => total + block.matches.length, 0);
    return `<section class="stage" aria-labelledby="${stage.id}-title">
      <header class="stage-header"><h3 id="${stage.id}-title">${esc(stage.title)}</h3><span class="stage-count">${count} ${plural(count, ['матч', 'матча', 'матчей'])}</span></header>
      <div class="stage-matches">${blocks.length ? blocks.map(block => block.type === 'group' ? groupCard(block) : singleCard(block.matches[0])).join('') : '<div class="stage-empty"><span class="empty-symbol" aria-hidden="true">[ ? ]</span>Соперники ещё не определены.<br>Здесь появятся следующие матчи.</div>'}</div>
    </section>`;
  }).join('');
  board.classList.toggle('filtered-stage', state.stage !== 'all');
  board.innerHTML = filtered && !anyMatches ? '<div class="empty-state"><h3>Матчи не найдены</h3><p>Попробуй другое имя, этап или статус.</p><button type="button" class="reset-button" data-reset>Сбросить фильтры</button></div>' : html || '<div class="empty-state"><h3>Жеребьёвка впереди</h3><p>Как только пары будут определены, здесь появятся первые матчи.</p></div>';
  board.setAttribute('aria-busy', 'false');
  if (focusedMatch) {
    const replacement = [...board.querySelectorAll('[data-games-match]')].find(button => button.dataset.gamesMatch === focusedMatch.dataset.gamesMatch);
    (replacement || $('#match-search')).focus({ preventScroll: true });
  }
  renderScoresNotice();
  renderGamesDialog();
}

function renderScoresNotice() {
  const notice = $('#scores-notice');
  if (failures.has('scores') && state.scores) {
    notice.hidden = false;
    notice.innerHTML = 'Не удалось обновить результаты. Показаны последние загруженные данные. <button type="button" class="retry-button" data-retry>Повторить загрузку</button>';
  } else if (state.scores?.warnings.length) {
    notice.hidden = false;
    notice.textContent = `Некоторые записи требуют проверки. ${state.scores.warnings.join(' ')}`;
  } else notice.hidden = true;
}

function renderGamesWonNotice() {
  const notice = $('#games-won-notice');
  if (failures.has('gamesWon')) {
    notice.hidden = false;
    notice.innerHTML = `Не удалось ${state.gamesWon ? 'обновить' : 'загрузить'} выигранные игры.${state.gamesWon ? ' Показаны последние загруженные списки.' : ' Счёт матчей доступен отдельно.'} <button type="button" class="retry-button" data-retry>Повторить загрузку</button>`;
  } else if (state.gamesWon?.warnings.length) {
    notice.hidden = false;
    notice.textContent = `Некоторые списки выигранных игр требуют проверки. ${state.gamesWon.warnings.join(' ')}`;
  } else notice.hidden = true;
}

function renderPlayers() {
  if (!state.players) return;
  const count = state.players.length;
  $('#player-count').textContent = count;
  $('#player-count-word').textContent = plural(count, ['участник', 'участника', 'участников']);
  $('#players-list').innerHTML = count ? state.players.map(name => `<button type="button" class="player-button" data-player="${esc(name)}" aria-label="Показать матчи игрока ${esc(name)}"><span class="player-name">${esc(name)}</span></button>`).join('') : '<p class="loading-message">Список участников скоро появится.</p>';
  $('#players-list').setAttribute('aria-busy', 'false');
}

function renderGamesNotice() {
  const notice = $('#games-notice');
  notice.hidden = !failures.has('games') || !state.games;
  if (!notice.hidden) notice.innerHTML = 'Не удалось обновить список игр. Показаны последние загруженные данные. <button type="button" class="retry-button" data-retry>Повторить загрузку</button>';
}

function renderGames() {
  if (!state.games) return;
  const query = state.gameSearch.trim().toLocaleLowerCase('ru-RU');
  const games = state.games.map((name, index) => ({ name, number: index + 1 })).filter(game => game.name.toLocaleLowerCase('ru-RU').includes(query));
  const limit = gamesMobile.matches ? 6 : 12;
  // Search always exposes every match; clearing it restores the chosen preview state.
  const visibleGames = query || state.gamesExpanded ? games : games.slice(0, limit);
  $('#games-result').textContent = query ? `Найдено: ${games.length} из ${state.games.length}` : `Показано ${visibleGames.length} из ${state.games.length} ${plural(state.games.length, ['игры', 'игр', 'игр'])}`;
  $('#games-list').innerHTML = games.length ? `<ol class="games-grid" aria-label="Список игр">${visibleGames.map(game => `<li class="game-item" value="${game.number}"><span class="game-number" aria-hidden="true">${pad(game.number)}</span><span class="game-name">${esc(game.name)}</span></li>`).join('')}</ol>` : state.games.length ? '<div class="empty-state"><h3>Игры не найдены</h3><p>Попробуй другое название или сбрось поиск.</p><button type="button" class="reset-button" data-reset-games>Сбросить поиск</button></div>' : '<p class="loading-message">Список игр скоро появится.</p>';
  const toggle = $('#games-toggle');
  toggle.hidden = Boolean(query) || games.length <= limit;
  toggle.setAttribute('aria-expanded', String(Boolean(query) || state.gamesExpanded));
  toggle.textContent = state.gamesExpanded ? 'Свернуть' : `Показать все ${state.games.length} ${plural(state.games.length, ['игру', 'игры', 'игр'])}`;
  $('#games-list').setAttribute('aria-busy', 'false');
  renderGamesNotice();
}

function renderPodium() {
  if (!state.scores) return;
  $('#podium').innerHTML = [1, 2, 3].map(place => {
    const name = state.scores.winners.find(winner => winner.place === place)?.name;
    const payout = state.rules?.payouts[place];
    return `<article class="podium-card" data-place="${place}" aria-label="${place}-е место${name ? `: ${esc(name)}` : ' ещё не определено'}">
      ${place === 1 ? `<span class="podium-label"><span>${name ? 'ПОБЕДИТЕЛЬ' : 'БУДУЩИЙ ПОБЕДИТЕЛЬ'}</span></span>` : ''}
      <span class="podium-place" aria-hidden="true">${place}<sup class="podium-ordinal">${['', 'st', 'nd', 'rd'][place]}</sup></span><div class="podium-info"><h3 class="podium-name${name ? '' : ' unannounced'}">${name ? esc(name) : 'Победитель ещё не определён'}</h3><p class="podium-money">${payout != null ? rubles(payout) : `${place}-е место`}</p></div>${icon('trophy')}
    </article>`;
  }).join('');
}

function renderRules() {
  const rules = state.rules;
  if (!rules) return;
  const openTitles = [...document.querySelectorAll('.rule-accordion[open]')].map(details => details.dataset.ruleTitle);
  const hadRules = Boolean($('#rules-content').querySelector('.rule-accordion'));
  $('#event-date').textContent = rules.dateLabel || 'Даты в правилах';
  $('#event-date-note').textContent = rules.dateNote || 'Все подробности о проведении турнира';
  $('#prize-total').textContent = rules.prizeTotal == null ? 'Призы турнира' : rubles(rules.prizeTotal);
  $('#rules-content').innerHTML = (rules.preamble ? `<div class="rule-body rule-preamble">${renderMarkdown(rules.preamble)}</div>` : '') + rules.sections.map((section, index) => `<details class="rule-accordion" data-rule-title="${esc(section.title)}"${(hadRules ? openTitles.includes(section.title) : index === 0) ? ' open' : ''}><summary>${esc(section.title)}</summary><div class="rule-body">${renderMarkdown(section.body, { stripHeadingNumbers: true })}</div></details>`).join('') || '<p class="loading-message">Правила скоро появятся.</p>';
  $('#rules-content').setAttribute('aria-busy', 'false');
}

const loaders = {
  scores: { path: 'data/scores.txt', parse: parseScores, render: () => { renderStageFilters(); renderMatches(); renderPodium(); }, target: '#match-board', label: 'матчи' },
  gamesWon: { path: 'data/nes-games-won-by-player.txt', parse: parseGamesWon, render: () => { renderMatches(); renderGamesWonNotice(); } },
  players: { path: 'data/players.txt', parse: parsePlayers, render: renderPlayers, target: '#players-list', label: 'участников' },
  games: { path: 'data/games.txt', parse: parseGames, render: renderGames, target: '#games-list', label: 'список игр' },
  rules: { path: 'data/rules.md', parse: parseRules, render: () => { renderRules(); renderPodium(); }, target: '#rules-content', label: 'правила' },
};
const liveDataKeys = ['scores', 'gamesWon'];

async function loadData(keys = Object.keys(loaders)) {
  if (state.loading) return;
  state.loading = true;
  document.querySelectorAll('[data-retry]').forEach(button => { button.disabled = true; });
  try {
    await Promise.allSettled(keys.map(async key => {
      if (!liveDataKeys.includes(key) && previous.has(key)) return;
      const loader = loaders[key];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(new URL(loader.path, document.baseURI), { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        // A hosting fallback can return index.html with HTTP 200 for missing data.
        if (/^\s*<(?:!doctype\s+html|html)[\s>]/i.test(text)) throw new Error('Unexpected HTML');
        const recovered = failures.delete(key);
        if (previous.get(key) !== text || recovered) {
          state[key] = loader.parse(text);
          previous.set(key, text);
          loader.render();
        }
      } catch (error) {
        failures.add(key);
        if (!state[key] && loader.target) {
          const target = $(loader.target);
          target.innerHTML = `<div class="error-state" role="status">Не удалось загрузить ${loader.label}. Проверь подключение и попробуй ещё раз.<button type="button" class="retry-button" data-retry>Повторить загрузку</button></div>`;
          target.setAttribute('aria-busy', 'false');
          if (key === 'scores') {
            $('#podium').innerHTML = '<p class="loading-message">Итоги появятся после загрузки результатов.</p>';
          }
          if (key === 'games') $('#games-result').textContent = 'Список временно недоступен';
        }
        if (key === 'scores') renderScoresNotice();
        if (key === 'gamesWon') renderGamesWonNotice();
        if (key === 'games') renderGamesNotice();
      } finally { clearTimeout(timeout); }
    }));
  } finally {
    state.loading = false;
    document.querySelectorAll('[data-retry]').forEach(button => { button.disabled = false; });
  }
}

function setStage(id) {
  state.stage = id;
  document.querySelectorAll('[data-stage]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.stage === id)));
}

function resetFilters() {
  state.search = ''; state.status = 'all'; setStage('all');
  $('#match-search').value = '';
  $('#match-status').value = 'all';
  statusSelect.sync();
  renderMatches();
}

document.addEventListener('click', event => {
  const stage = event.target.closest('[data-stage]');
  const player = event.target.closest('[data-player]');
  const games = event.target.closest('[data-games-match]');
  if (games) {
    const match = findMatch(games.dataset.gamesMatch);
    if (match) {
      shownGames = { key: games.dataset.gamesMatch, players: match.players };
      if (renderGamesDialog()) $('#games-dialog').showModal();
    }
  }
  if (event.target.closest('[data-close-games]')) $('#games-dialog').close();
  if (stage) { setStage(stage.dataset.stage); renderMatches(); }
  if (player) {
    resetFilters(); state.search = player.dataset.player;
    $('#match-search').value = state.search;
    renderMatches();
    $('#matches').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    $('#match-search').focus({ preventScroll: true });
  }
  if (event.target.closest('[data-reset]')) { resetFilters(); $('#match-search').focus(); }
  if (event.target.closest('[data-reset-games]')) { state.gameSearch = ''; $('#game-search').value = ''; renderGames(); $('#game-search').focus(); }
  if (event.target.closest('[data-retry]')) loadData();
});
$('#games-dialog').addEventListener('click', event => {
  if (event.target !== event.currentTarget) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
});
$('#games-dialog').addEventListener('close', () => {
  const trigger = [...document.querySelectorAll('[data-games-match]')].find(button => button.dataset.gamesMatch === shownGames?.key);
  shownGames = null;
  (trigger || $('#match-search')).focus({ preventScroll: true });
});
$('#match-search').addEventListener('input', event => { state.search = event.target.value; renderMatches(); });
$('#game-search').addEventListener('input', event => { state.gameSearch = event.target.value; renderGames(); });
$('#games-toggle').addEventListener('click', () => {
  state.gamesExpanded = !state.gamesExpanded;
  renderGames();
  // Return to the preview when collapsing a long list from its bottom.
  if (!state.gamesExpanded) $('#games').scrollIntoView({ block: 'start', behavior: 'instant' });
});
gamesMobile.addEventListener('change', renderGames);
$('#match-status').addEventListener('change', event => { state.status = event.target.value; renderMatches(); });

// Match results refresh automatically; the other files load once, with manual retry on failure.
setInterval(() => { if (!document.hidden) loadData(liveDataKeys); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadData(liveDataKeys); });
loadData();
