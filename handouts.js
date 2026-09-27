'use strict';
// Hand-outs: when a corp gains a tech whose effect says "Unlock: X", Control owes that corp X.
//   Protection cards go into the corp's hand (one copy).
//   Equipment goes to the corp's Security player, or its CEO if it has no Security player.
//   Facility-type unlocks are skipped: there is nothing to hand out for them on the site.
// Nothing is ever given twice. An item counts as done once the corp has been seen holding it, the tool
// has sent it, or you mark it done, and that is remembered even after the card is used up and returned.
// Automatic hand-outs only fire for research that appears after the tool starts watching a game;
// anything already owed at that point is listed for you to give by hand.
window.RHHandouts = function createHandouts(deps) {
  const { store, esc, cv, keyOf, fetchPage, gameBase, gameKey, post, addLog, select, getModel } = deps;
  const AUTO_MAX_PER_CYCLE = 5;
  const AUX_MAX_AGE = 60 * 1000;
  const DONE = new Set(['held', 'seen', 'given', 'manual']);
  const st = { key: null, aux: null, auxAt: 0, claimSig: '', items: [], ledger: {}, baseline: null, auto: true, busy: false, error: null };
  const $ = id => document.getElementById(id);

  function load() {
    const k = gameKey();
    if (st.key === k) return;
    st.key = k;
    st.ledger = store.get(k + ':handout-ledger', {});
    st.baseline = store.get(k + ':handout-baseline', null);
    st.auto = store.get(k + ':handout-auto', true);
    st.aux = null; st.auxAt = 0; st.claimSig = ''; st.items = []; st.error = null;
  }
  const saveLedger = () => store.set(st.key + ':handout-ledger', st.ledger);

  function unlockNames(effect) {
    const out = [];
    for (const mm of String(effect || '').matchAll(/Unlock:\s*([^.]+)/gi)) {
      mm[1].split(/,|\band\b/).forEach(n => { n = n.trim(); if (n) out.push(n); });
    }
    return out;
  }

  // Every (corp, unlocked thing) pair owed by the corps' current working techs. Starting techs only
  // unlock facility types, so they are left out.
  function claims(m) {
    const out = new Map();
    m.corps.forEach(c => c.holdings.forEach(h => {
      if (h.usable === false) return;
      const t = m.byId.get(h.technology_type_id) || m.byName.get(h.name);
      if (!t || t.starting) return;
      unlockNames(t.effect).forEach(n => {
        if (/\bfacility$/i.test(n)) return;
        const k = c.id + '|' + keyOf(n);
        if (!out.has(k)) out.set(k, { corp: c, name: n, techs: new Set(), holdingIds: [] });
        const o = out.get(k);
        o.techs.add(t.name);
        o.holdingIds.push(h.id);
      });
    }));
    return [...out.values()];
  }

  async function loadAux() {
    const base = gameBase();
    const [F, C] = await Promise.all([fetchPage(base + '/facilities', 'cardHoldings'), fetchPage(base + '/cards', 'protectionCards')]);
    st.aux = {
      F: F.props,
      C: C.props,
      pcByKey: new Map((C.props.protectionCards || []).map(c => [keyOf(c.name), c])),
      eqByKey: new Map((C.props.equipment || []).map(c => [keyOf(c.name), c])),
      ftKeys: new Set((F.props.facilityTypes || []).map(f => keyOf(f.name))),
    };
    st.auxAt = Date.now();
  }

  const protectionCount = (corpId, cardId) => {
    const e = (st.aux.F.cardHoldings || []).find(h => h.corporation_id === corpId);
    const c = e && (e.cards || []).find(x => x.card_type_id === cardId);
    return c ? (c.copies_in_hand || 0) + (c.installed || 0) : 0;
  };
  const corpMembers = corpId => {
    const g = (st.aux.C.equipmentHoldings || []).find(x => x.key === 'corporation:' + corpId);
    return g ? g.members || [] : [];
  };
  const recipientFor = corpId => {
    const ms = corpMembers(corpId);
    return ms.find(x => x.role === 'security') || ms.find(x => x.role === 'ceo') || null;
  };

  function build(m) {
    const baseline = new Set(st.baseline || []);
    const items = [];
    for (const cl of claims(m)) {
      const k = keyOf(cl.name);
      if (st.aux.ftKeys.has(k)) continue;
      const pc = st.aux.pcByKey.get(k), eq = pc ? null : st.aux.eqByKey.get(k);
      const kind = pc ? 'protection' : eq ? 'equipment' : 'other';
      const card = pc || eq || null;
      const it = {
        id: `${cl.corp.id}|${card ? `${kind}:${card.id}` : `other:${k}`}`,
        corp: cl.corp, kind, card, name: card ? card.name : cl.name,
        techs: [...cl.techs],
        isNew: cl.holdingIds.some(h => !baseline.has(h)),
      };
      let held = false;
      if (kind === 'protection') held = protectionCount(cl.corp.id, card.id) > 0;
      if (kind === 'equipment') {
        it.recipient = recipientFor(cl.corp.id);
        // Honey pot and Honey bomb also exist as technology cards; holding either form counts.
        const sameTech = m.techs.find(t => keyOf(t.name) === k);
        held = corpMembers(cl.corp.id).some(mb => (mb.cards || []).some(x => x.card_type_id === card.id))
          || !!(sameTech && m.usableBy.get(cl.corp.id).has(sameTech.name));
      }
      const led = st.ledger[it.id];
      if (held) {
        if (!led || !DONE.has(led.state)) st.ledger[it.id] = { state: led && (led.state === 'sent' || led.state === 'failed') ? 'given' : 'seen', t: Date.now(), how: led && led.how };
        it.status = 'held';
      } else if (led) {
        it.status = led.state;
      } else if (kind === 'other' || (kind === 'equipment' && !it.recipient)) {
        it.status = 'manual-needed';
      } else {
        it.status = st.auto && it.isNew ? 'auto' : 'owed';
      }
      it.led = st.ledger[it.id];
      items.push(it);
    }
    return items;
  }

  async function give(it, how) {
    // Recorded before sending, so a slow or failed confirmation can never lead to a second copy.
    st.ledger[it.id] = { state: 'sent', t: Date.now(), how };
    saveLedger();
    const who = it.kind === 'equipment' ? `${it.recipient.name}` : it.corp.name;
    try {
      if (it.kind === 'protection') {
        await post('/protection-card-holdings/give', { corporation_id: it.corp.id, protection_card_type_id: it.card.id, copies: 1 });
      } else {
        await post('/equipment-holdings/give', { character_id: it.recipient.character_id, equipment_card_type_id: it.card.id, copies: 1 });
      }
      addLog({ kind: 'handout', corp: it.corp.id, tech: it.techs[0], text: `${how === 'auto' ? 'Automatically gave' : 'Gave'} ${it.name} to ${who} (unlocked by ${it.techs.join(', ')})` });
    } catch (e) {
      st.ledger[it.id] = { state: 'failed', t: Date.now(), how, msg: e.message };
      saveLedger();
      addLog({ kind: 'loss', corp: it.corp.id, tech: it.techs[0], text: `Could not give ${it.name} to ${who}: ${e.message}` });
      if (e.auth && st.auto) {
        st.auto = false;
        store.set(st.key + ':handout-auto', false);
        st.error = `Automatic hand-outs are off because ${e.message}`;
      }
    }
  }

  async function update(m) {
    load();
    if (!st.baseline) {
      st.baseline = m.corps.flatMap(c => c.holdings.map(h => h.id));
      store.set(st.key + ':handout-baseline', st.baseline);
    }
    const cls = claims(m);
    const sig = cls.map(c => c.corp.id + '|' + keyOf(c.name) + '|' + c.holdingIds.join(',')).sort().join(';');
    if (!cls.length) { st.items = []; st.claimSig = sig; render(); return; }
    const open = st.items.some(i => !DONE.has(i.status));
    try {
      if (!st.aux || sig !== st.claimSig || open || Date.now() - st.auxAt > AUX_MAX_AGE) await loadAux();
      st.claimSig = sig;
      st.items = build(m);
      saveLedger();
      if (st.auto && !st.busy) {
        const todo = st.items.filter(i => i.status === 'auto').slice(0, AUTO_MAX_PER_CYCLE);
        if (todo.length) {
          st.busy = true;
          try {
            for (const it of todo) await give(it, 'auto');
            await loadAux();
            st.items = build(m);
            saveLedger();
          } finally { st.busy = false; }
        }
      }
      if (!st.error || !st.error.startsWith('Automatic')) st.error = null;
    } catch (e) {
      console.error(e);
      st.error = `Could not check hand-outs: ${e.message}`;
    }
    render();
  }

  async function giveByHand(id) {
    const it = st.items.find(i => i.id === id);
    // Only items still owed can be given; this also stops a double click from sending a second copy.
    if (!it || st.busy || !['owed', 'failed', 'sent'].includes(it.status)) return;
    st.busy = true; render();
    try {
      await give(it, 'manual');
      await loadAux();
      st.items = build(getModel());
      saveLedger();
    } catch (e) {
      st.error = `Could not check hand-outs: ${e.message}`;
    } finally { st.busy = false; render(); }
  }

  function markDone(id) {
    const it = st.items.find(i => i.id === id);
    st.ledger[id] = { state: 'manual', t: Date.now() };
    saveLedger();
    if (it) { it.status = 'manual'; it.led = st.ledger[id]; }
    render();
  }

  // ---------- Rendering ----------
  const time = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const KIND = { protection: 'Protection card', equipment: 'Equipment', other: 'Unlock' };

  function statusHTML(it) {
    const l = it.led || {};
    switch (it.status) {
      case 'held': return l.state === 'given' ? `<span class="hs ok">Given ${l.how === 'auto' ? 'automatically' : 'by you'} · ${time(l.t)}</span>` : '<span class="hs ok">Already has it</span>';
      case 'seen': return '<span class="hs ok">Handed out before</span>';
      case 'given': return `<span class="hs ok">Given · ${time(l.t)}, since used or moved</span>`;
      case 'manual': return '<span class="hs ok">Marked done</span>';
      case 'sent': return `<span class="hs warn">Sent ${time(l.t)}, not showing on the site yet</span>`;
      case 'failed': return `<span class="hs bad">Failed: ${esc(l.msg || 'unknown error')}</span>`;
      case 'auto': return '<span class="hs busy">Handing out…</span>';
      case 'manual-needed': return `<span class="hs warn">${it.kind === 'equipment' ? 'No CEO or Security player to give it to' : 'Not a card the tool can give'}</span>`;
      default: return `<span class="hs owed">Owed${it.isNew ? '' : ' from before'}</span>`;
    }
  }

  function actionsHTML(it) {
    const b = [];
    if (['owed', 'failed', 'sent'].includes(it.status)) b.push(`<button type="button" class="btn" data-give="${esc(it.id)}"${st.busy ? ' disabled' : ''}>${it.status === 'owed' ? 'Give' : 'Retry'}</button>`);
    if (!DONE.has(it.status) && it.status !== 'auto') b.push(`<button type="button" class="btn quiet" data-done="${esc(it.id)}">Mark done</button>`);
    return b.join('');
  }

  function rowHTML(it) {
    const to = it.kind === 'equipment' && it.recipient ? `${esc(it.corp.name)} · ${esc(it.recipient.role_label || it.recipient.name)}` : esc(it.corp.name);
    const techs = it.techs.map(t => `<button type="button" class="linkish" data-tech="${esc(t)}">${esc(t)}</button>`).join(', ');
    return `<li class="ho s-${it.status}" style="${cv(it.corp.color)}">
      <span class="sw"></span>
      <div class="what"><span><b>${esc(it.name)}</b> → ${to}</span><span class="mini">${KIND[it.kind]} · unlocked by ${techs}</span></div>
      <div class="state">${statusHTML(it)}</div>
      <div class="acts">${actionsHTML(it)}</div>
    </li>`;
  }

  function render() {
    const sec = $('handouts');
    if (!sec) return;
    const open = st.items.filter(i => !DONE.has(i.status));
    const done = st.items.filter(i => DONE.has(i.status));
    $('autoHand').checked = st.auto;
    $('handoutCount').textContent = st.items.length ? `${open.length} to do · ${done.length} done` : '';
    $('handoutNote').textContent = st.auto
      ? 'New research is handed out as soon as it appears. Anything owed from before the tool started watching waits for you.'
      : 'Nothing is given until you click Give. Items tick off on their own once the corp holds the card.';
    $('handoutError').hidden = !st.error;
    $('handoutError').textContent = st.error || '';
    $('handoutList').innerHTML = open.length ? open.map(rowHTML).join('') : '<li class="empty">Nothing to hand out.</li>';
    $('handoutDone').hidden = !done.length;
    $('handoutDoneCount').textContent = `Done (${done.length})`;
    $('handoutDoneList').innerHTML = done.map(rowHTML).join('');
    sec.querySelectorAll('[data-give]').forEach(b => b.addEventListener('click', () => giveByHand(b.dataset.give)));
    sec.querySelectorAll('[data-done]').forEach(b => b.addEventListener('click', () => markDone(b.dataset.done)));
    sec.querySelectorAll('[data-tech]').forEach(b => b.addEventListener('click', () => select(b.dataset.tech, true)));
  }

  function setAuto(on) {
    load();
    st.auto = on;
    store.set(st.key + ':handout-auto', on);
    if (on && st.error && st.error.startsWith('Automatic')) st.error = null;
    const m = getModel();
    if (m) update(m); else render();
  }

  return { update, setAuto, render, giveByHand, markDone, state: st };
};
