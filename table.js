'use strict';
// Research table: times each researcher's turn at the sitting Control runs during the Action phase,
// suggests a per-turn limit from the cards left to play and the time left in the phase,
// and (when switched on) passes the turn on for anyone who goes over the limit.
// The site records whose turn it is (current_order) but not when it started, so the tool times turns
// itself from when it first sees each turn begin, checking every couple of seconds while a sitting is
// open. If the site ever sends a turn start time, that is used instead.
window.RHTable = function createTable(deps) {
  const { store, esc, cv, post, fetchPage, researchPath, addLog, getModel, getSkew, isPaused, refreshNow } = deps;
  const DEFAULTS = { auto: false, mode: 'fixed', limit: 90, cardsPerTurn: 1, reserve: 30, minLimit: 15 };
  const st = {
    settings: { ...DEFAULTS, ...store.get('rh.table.settings', {}) },
    turn: null,       // { corpId, startedAt, fromServer, skipping }
    skipping: false,
    error: null,
  };
  const $ = id => document.getElementById(id);
  const now = () => Date.now() + (getSkew() || 0);
  const clock = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const save = () => store.set('rh.table.settings', st.settings);

  const session = m => (m && m.r && m.r.session) || null;
  const currentSeat = s => (s && (s.seats || []).find(x => x.is_turn)) || null;

  // Any turn start time the site may send, on the seat or the sitting.
  function serverStart(s, seat) {
    for (const v of [seat.turn_started_at, seat.started_at, s.turn_started_at, s.current_turn_started_at, s.turn_started]) {
      const t = v ? Date.parse(v) : NaN;
      if (!Number.isNaN(t)) return t;
    }
    return null;
  }

  // Called on every refresh with the new model.
  function observe(m) {
    const s = session(m), seat = currentSeat(s);
    if (!seat) { st.turn = null; render(); return; }
    const fromServer = serverStart(s, seat);
    // A new turn: a different researcher, a new start time from the site, or the same researcher again
    // after a skip (with only one corp seated the turn comes straight back to them).
    const restarted = st.turn && st.turn.skipping && !st.skipping;
    if (!st.turn || restarted || st.turn.corpId !== seat.corporation_id || (fromServer && st.turn.startedAt !== fromServer)) {
      st.turn = { corpId: seat.corporation_id, startedAt: fromServer || now(), fromServer: !!fromServer, skipping: false };
    }
    render();
  }

  function suggestion(m) {
    const s = session(m), ph = m && m.phase;
    if (!s || !ph || !ph.ends_at) return null;
    // Cards left to play: whichever runs out first, the research decks of the corps playing at the
    // table or the public deck.
    // Each seat carries its corp's deck count; the corp list is the fallback.
    const seatedSeats = (s.seats || []).filter(x => x.playing !== false);
    const seated = new Set(seatedSeats.map(x => x.corporation_id));
    const deckCards = seatedSeats.reduce((a, x) => {
      const n = x.deck_remaining ?? (m.corps.find(c => c.id === x.corporation_id) || {}).deck_remaining;
      return a + (+n || 0);
    }, 0);
    const pub = s.public_deck_remaining ?? m.r.public_deck_remaining;
    const publicCards = pub == null ? Infinity : +pub;
    const cards = Math.min(deckCards, publicCards);
    const from = publicCards < deckCards ? 'public' : 'decks';
    const turnsLeft = Math.ceil(cards / Math.max(1, st.settings.cardsPerTurn));
    const timeLeft = (Date.parse(ph.ends_at) - now()) / 1000;
    const base = { cards, from, deckCards, publicCards, players: seated.size, turnsLeft, timeLeft };
    if (!turnsLeft || timeLeft <= 0) return { ...base, limit: null };
    const raw = Math.floor((timeLeft - st.settings.reserve) / turnsLeft);
    return { ...base, raw, limit: Math.max(st.settings.minLimit, raw) };
  }

  function limitFor(m) {
    if (st.settings.mode === 'suggested') {
      const sg = suggestion(m);
      return sg && sg.limit ? sg.limit : st.settings.limit;
    }
    return st.settings.limit;
  }

  // Once a second: update the clock and, if switched on, pass the turn on for anyone over the limit.
  async function tick() {
    const m = getModel();
    render();
    if (!st.settings.auto || !st.turn || st.turn.skipping || st.skipping || isPaused()) return;
    const limit = limitFor(m);
    const elapsed = (now() - st.turn.startedAt) / 1000;
    if (elapsed < limit) return;
    const turn = st.turn;
    turn.skipping = true;
    st.skipping = true;
    try {
      // Check the site again right before skipping: if the turn has already moved on, skipping now
      // would cut the next researcher's turn short.
      const fresh = await fetchPage(researchPath());
      const seat = currentSeat(fresh.props.research.session);
      if (!seat || seat.corporation_id !== turn.corpId) { refreshNow(); return; }
      await post('/research/session/advance', {});
      const who = (m.corpById.get(turn.corpId) || { name: seat.name }).name;
      addLog({ kind: 'skip', corp: turn.corpId, text: `Skipped ${who}’s research turn after ${clock(elapsed)} (limit ${clock(limit)})` });
      st.error = null;
      refreshNow();
    } catch (e) {
      console.error(e);
      st.error = `Could not pass the turn on: ${e.message}`;
      if (e.auth) { st.settings.auto = false; save(); st.error += ' Automatic skipping is off.'; }
    } finally {
      st.skipping = false;
      render();
    }
  }

  async function skipNow() {
    const m = getModel();
    if (!st.turn || st.skipping) return;
    st.skipping = true; render();
    try {
      await post('/research/session/advance', {});
      const who = (m.corpById.get(st.turn.corpId) || { name: 'the researcher' }).name;
      addLog({ kind: 'skip', corp: st.turn.corpId, text: `Passed the turn on from ${who} by hand` });
      st.turn.skipping = true;
      st.error = null;
      refreshNow();
    } catch (e) {
      st.error = `Could not pass the turn on: ${e.message}`;
    } finally { st.skipping = false; render(); }
  }

  // ---------- Rendering ----------
  function render() {
    const sec = $('rtable');
    if (!sec) return;
    const m = getModel();
    const s = session(m);
    const set = st.settings;
    $('rtAuto').checked = set.auto;
    $('rtMode').value = set.mode;
    if (document.activeElement !== $('rtLimit')) $('rtLimit').value = set.limit;
    if (document.activeElement !== $('rtCards')) $('rtCards').value = set.cardsPerTurn;
    if (document.activeElement !== $('rtReserve')) $('rtReserve').value = set.reserve;
    $('rtLimit').disabled = set.mode === 'suggested';
    $('rtError').hidden = !st.error;
    $('rtError').textContent = st.error || '';

    if (!s) {
      $('rtStatus').textContent = 'No sitting open';
      $('rtNow').innerHTML = '<p class="hint">No sitting is open. Control deals the table when the Action phase starts; turns are timed from then.</p>';
      $('rtSuggest').innerHTML = '';
      $('rtSeats').innerHTML = '';
      return;
    }
    const sg = suggestion(m);
    const limit = limitFor(m);
    const seats = (s.seats || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const playing = seats.filter(x => x.playing !== false).length;
    $('rtStatus').textContent = `${playing} at the table${sg ? ` · ${sg.cards} cards left to play` : ''}`;

    if (st.turn) {
      const c = m.corpById.get(st.turn.corpId);
      const elapsed = (now() - st.turn.startedAt) / 1000;
      const frac = Math.min(1, elapsed / Math.max(1, limit));
      const over = elapsed >= limit;
      const state = st.skipping || st.turn.skipping ? 'Passing the turn on…'
        : over ? (set.auto ? 'Over the limit' : 'Over the limit · automatic skipping is off') : `${clock(limit - elapsed)} left`;
      $('rtNow').innerHTML = `<div class="rt-card${over ? ' over' : ''}" style="${cv(c ? c.color : 'var(--faint)')}">
          <span class="mini">Now researching</span>
          <span class="rt-who"><span class="sw"></span>${esc(c ? c.name : 'Unknown')}</span>
          <span class="rt-clock">${clock(elapsed)} <span class="mini">of ${clock(limit)}${set.mode === 'suggested' ? ' (suggested)' : ''}</span></span>
          <span class="rt-bar"><i style="width:${(frac * 100).toFixed(1)}%"></i></span>
          <span class="rt-state">${esc(state)}</span>
          <span class="mini">${st.turn.fromServer ? 'Timed by the site' : 'Timed from when this page saw the turn start'}</span>
          <button type="button" class="btn" id="rtSkip"${st.skipping ? ' disabled' : ''}>Skip now</button>
        </div>`;
      $('rtSkip').addEventListener('click', skipNow);
    } else {
      $('rtNow').innerHTML = '<p class="hint">The sitting is open but it is nobody’s turn.</p>';
    }

    $('rtSuggest').innerHTML = sg && sg.limit
      ? `<div class="rt-card suggest"><span class="mini">Suggested limit</span><span class="rt-clock">${clock(sg.limit)} <span class="mini">per turn</span></span>
          <span class="mini">${clock(sg.timeLeft)} left in the phase, minus ${clock(set.reserve)} in reserve, over ${sg.turnsLeft} turn${sg.turnsLeft === 1 ? '' : 's'} (${sg.cards} card${sg.cards === 1 ? '' : 's'} left ${sg.from === 'public' ? `in the public deck, fewer than the ${sg.deckCards} in the players’ decks` : `in the players’ decks${Number.isFinite(sg.publicCards) ? `, fewer than the ${sg.publicCards} in the public deck` : ''}`}, at ${set.cardsPerTurn} per turn).${sg.raw < sg.limit ? ` That works out to ${clock(Math.max(0, sg.raw))}, so it's raised to the ${clock(set.minLimit)} minimum; not every card will get played in time.` : ''}</span>
          ${set.mode === 'fixed' ? `<button type="button" class="btn quiet" id="rtUse">Use ${clock(sg.limit)} as the limit</button>` : ''}</div>`
      : `<div class="rt-card suggest"><span class="mini">Suggested limit</span><span class="hint">${sg && !sg.turnsLeft ? 'No cards left to play.' : 'Needs a running phase with an end time.'}</span></div>`;
    const use = $('rtUse');
    if (use) use.addEventListener('click', () => { st.settings.limit = sg.limit; save(); render(); });

    $('rtSeats').innerHTML = seats.map(x => {
      const c = m.corpById.get(x.corporation_id);
      return `<li class="${x.is_turn ? 'turn' : ''}${x.playing === false ? ' out' : ''}" style="${cv(c ? c.color : 'var(--faint)')}"><span class="ord">${esc(x.order)}</span><span class="sw"></span>${esc(c ? c.name : x.name)}${x.playing === false ? ' <span class="mini">· not playing</span>' : ''}</li>`;
    }).join('');
  }

  function bindSettings() {
    const num = (id, key, min) => $(id).addEventListener('change', () => {
      const v = Math.round(+$(id).value);
      if (Number.isFinite(v) && v >= min) { st.settings[key] = v; save(); }
      render();
    });
    num('rtLimit', 'limit', 10);
    num('rtCards', 'cardsPerTurn', 1);
    num('rtReserve', 'reserve', 0);
    $('rtMode').addEventListener('change', () => { st.settings.mode = $('rtMode').value; save(); render(); });
    $('rtAuto').addEventListener('change', () => { st.settings.auto = $('rtAuto').checked; if (st.settings.auto) st.error = null; save(); render(); });
    $('rtSettings').addEventListener('submit', e => e.preventDefault());
  }

  bindSettings();
  return { observe, tick, render, skipNow, isOpen: () => !!session(getModel()), state: st };
};
