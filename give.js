'use strict';
// Give a tech: hand a corp a technology card and drop it straight into a facility with room.
// Defaults to "Researched", which arrives working. The facility is picked automatically (free slot,
// right type, most room) and can be changed. Tick "Charge them" to take the research cost from the
// corp's Research Points too. The tool re-reads the site afterwards to confirm both.
window.RHGive = function createGive(deps) {
  const { esc, keyOf, getModel, fetchPage, researchPath, post, addLog, refreshNow, mount } = deps;
  const fold = s => keyOf(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const normType = s => String(s || '').toLowerCase().replace(/\s*facility$/, '').trim();
  const st = { tech: null, matches: [], active: -1, busy: false, msg: null, lastCorp: null, charge: false };
  const SUITS = () => (model().suits || []);
  const costOf = t => SUITS().filter(s => (t.cost[s.value] || 0) > 0).map(s => ({ s, n: t.cost[s.value] }));
  const costText = t => costOf(t).map(x => `${x.n} ${x.s.label}`).join(', ');
  const $ = sel => mount.querySelector(sel);

  const model = () => getModel();
  const findTech = n => model().techs.find(t => keyOf(t.name) === keyOf(n));
  const color = slug => { const t = model().treeBySlug.get(slug); return t ? t.color : 'var(--t-std)'; };
  const treeName = slug => { const t = model().treeBySlug.get(slug); return t ? t.name : slug; };

  // Facilities that can take this tech: available, a free slot, and the required type if it has one.
  function roomFor(corp, tech) {
    const need = tech && tech.required_facility_type ? normType(tech.required_facility_type) : null;
    return (corp.facilities || [])
      .filter(f => f.available !== false && (f.stored || 0) < (f.capacity || 0) && (!need || normType(f.facility_type) === need))
      .map(f => ({ ...f, free: (f.capacity || 0) - (f.stored || 0) }))
      .sort((a, b) => b.free - a.free || a.name.localeCompare(b.name));
  }

  function search(q) {
    const f = fold(q);
    if (!f) return [];
    const scored = [];
    for (const t of model().techs) {
      if (t.is_deck_customisation) continue;
      const n = fold(t.name), code = fold(t.code || '');
      const score = n.startsWith(f) ? 0 : n.split(/[\s'-]+/).some(w => w.startsWith(f)) ? 1 : n.includes(f) ? 2 : code.includes(f) ? 3 : -1;
      if (score >= 0) scored.push({ t, score });
    }
    return scored.sort((a, b) => a.score - b.score || a.t.name.localeCompare(b.t.name)).slice(0, 8).map(x => x.t);
  }

  function open(tech, corpId) {
    const m = model();
    if (!m) return;
    st.tech = tech || null; st.msg = null; st.busy = false; st.matches = []; st.active = -1;
    const corps = m.corps.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    const origins = (m.r.origins || [{ value: 'researched', label: 'Researched', default_discount_percent: 0 }])
      .map(o => `<option value="${esc(o.value)}">${esc(o.label)}${o.value === 'researched' ? ' (works straight away)' : ` (${o.default_discount_percent}% off, still to be paid for)`}</option>`).join('');
    mount.innerHTML = `
      <form class="rc-body" id="gvForm" novalidate>
        <div class="rc-head"><h2>Give a tech</h2><button type="button" class="btn quiet" data-close>Close</button></div>
        <div class="rc-grid">
          <div class="rc-f wide">
            <label for="gvTech">Tech</label>
            <div class="rc-chips"><span id="gvChip"></span><input id="gvTech" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="gvList" placeholder="Type to search techs…"></div>
            <ul class="rc-list" id="gvList" role="listbox" hidden></ul>
          </div>
          <label class="rc-f" for="gvCorp">To <select id="gvCorp">${corps}</select></label>
          <label class="rc-f" for="gvOrigin">How they got it <select id="gvOrigin">${origins}</select></label>
          <label class="rc-f wide" for="gvFac">Goes into <select id="gvFac"></select><span class="mini" id="gvFacNote"></span></label>
          <div class="rc-f wide">
            <label class="switch" for="gvCharge"><input type="checkbox" id="gvCharge"> <span id="gvChargeLabel">Charge them the research cost</span></label>
            <span class="mini" id="gvChargeNote"></span>
          </div>
        </div>
        <p class="rc-preview" id="gvNote"></p>
        <p class="banner" id="gvMsg" hidden></p>
        <div class="rc-actions"><button type="submit" class="btn primary" id="gvGo">Give</button></div>
      </form>`;
    if (corpId || st.lastCorp) $('#gvCorp').value = String(corpId || st.lastCorp);
    $('[data-close]').addEventListener('click', () => mount.close());
    const input = $('#gvTech');
    input.addEventListener('input', () => { st.matches = search(input.value); st.active = st.matches.length ? 0 : -1; renderList(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' && st.matches.length) { e.preventDefault(); st.active = (st.active + 1) % st.matches.length; renderList(); }
      else if (e.key === 'ArrowUp' && st.matches.length) { e.preventDefault(); st.active = (st.active - 1 + st.matches.length) % st.matches.length; renderList(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (st.matches[st.active]) pick(st.matches[st.active]); }
      else if (e.key === 'Backspace' && !input.value && st.tech) { st.tech = null; render(); }
      else if (e.key === 'Escape' && st.matches.length) { e.preventDefault(); e.stopPropagation(); st.matches = []; renderList(); }
    });
    input.addEventListener('blur', () => setTimeout(() => { st.matches = []; renderList(); }, 150));
    $('#gvCorp').addEventListener('change', () => { st.lastCorp = +$('#gvCorp').value; render(); });
    $('#gvOrigin').addEventListener('change', render);
    $('#gvCharge').checked = st.charge;
    $('#gvCharge').addEventListener('change', () => { st.charge = $('#gvCharge').checked; render(); });
    $('#gvForm').addEventListener('submit', e => { e.preventDefault(); give(); });
    if (!mount.open) mount.showModal();
    render();
    (st.tech ? $('#gvCorp') : input).focus();
  }

  function pick(t) {
    st.tech = t; st.matches = []; st.active = -1; st.msg = null;
    $('#gvTech').value = '';
    render();
    $('#gvCorp').focus();
  }

  function renderList() {
    const list = $('#gvList'), input = $('#gvTech');
    if (!list) return;
    list.hidden = !st.matches.length;
    input.setAttribute('aria-expanded', String(!!st.matches.length));
    list.innerHTML = st.matches.map((t, i) => `<li role="option" data-i="${i}" class="${i === st.active ? 'on' : ''}" aria-selected="${i === st.active}" style="--c:${color(t.tree)}"><span class="sw"></span><span class="n">${esc(t.name)}</span><span class="mini">${esc(treeName(t.tree))}${t.code ? ' · ' + esc(t.code) : ''}</span></li>`).join('');
    list.querySelectorAll('li').forEach(li => li.addEventListener('mousedown', e => { e.preventDefault(); pick(st.matches[+li.dataset.i]); }));
  }

  function render() {
    if (!$('#gvForm')) return;
    const m = model();
    const t = st.tech;
    $('#gvChip').innerHTML = t ? `<span class="rc-chip" style="--c:${color(t.tree)}"><span class="sw"></span>${esc(t.name)}<button type="button" id="gvClear" aria-label="Clear">×</button></span>` : '';
    $('#gvTech').hidden = !!t;
    if (t) $('#gvClear').addEventListener('click', () => { st.tech = null; render(); $('#gvTech').focus(); });
    renderList();

    const corp = m.corpById.get(+$('#gvCorp').value);
    const room = t && corp ? roomFor(corp, t) : [];
    const prev = $('#gvFac').value;
    $('#gvFac').innerHTML = room.map((f, i) => `<option value="${f.id}">${esc(f.name)} (${esc(f.facility_type)}, ${f.stored}/${f.capacity})${i === 0 ? ' · most room' : ''}</option>`).join('')
      + `<option value="">Not in a facility yet</option>`;
    if (prev && room.some(f => String(f.id) === prev)) $('#gvFac').value = prev;
    $('#gvFacNote').textContent = !t ? '' : room.length
      ? (t.required_facility_type ? `Needs a ${t.required_facility_type} facility.` : 'Any facility with a free slot.')
      : `${corp.name} has no free slot${t.required_facility_type ? ` in a ${t.required_facility_type} facility` : ''}. It can still be given without a facility and placed later.`;

    const notes = [];
    if (t && corp) {
      const has = (m.holders.get(t.name) || []).filter(x => x.corp.id === corp.id);
      if (has.length) notes.push(`<span class="bad">${esc(corp.name)} already holds ${esc(t.name)} (${has.map(x => esc(x.h.status_label || x.h.status)).join(', ')}).</span>`);
      if ($('#gvOrigin').value !== 'researched') notes.push('Copies arrive as <b>Claimed</b>: they take a slot but don’t work until the corp’s research player pays for them.');
      else notes.push(`Arrives working. Anything it unlocks will be handed out automatically if Hand-outs is on.`);
      if (t.kind === 'start') notes.push('This is a starting tech.');
    }
    $('#gvNote').innerHTML = notes.join(' ');

    // Charging: only for Researched (copies are paid for by the research player on their own page).
    const charge = chargePlan(t, corp);
    const box = $('#gvCharge');
    box.disabled = !charge.possible;
    $('#gvChargeLabel').textContent = t && costOf(t).length ? `Charge them the research cost (${costText(t)})` : 'Charge them the research cost';
    $('#gvChargeNote').innerHTML = !t ? '' : charge.why ? esc(charge.why)
      : `${esc(corp.name)} has ${SUITS().map(s => `${corp.points[s.value] || 0} ${esc(s.label)}`).join(', ')}.`
        + (box.checked && charge.short.length ? ` <span class="bad">Short by ${charge.short.map(x => `${x.need} ${esc(x.s.label)}`).join(', ')}.</span>` : '');
    $('#gvMsg').hidden = !st.msg;
    if (st.msg) { $('#gvMsg').className = 'banner' + (st.msg.ok ? ' ok' : ''); $('#gvMsg').innerHTML = st.msg.html; }
    const go = $('#gvGo');
    const chargeBlocked = st.charge && charge.possible && charge.short.length > 0;
    go.disabled = st.busy || !t || !corp || chargeBlocked;
    go.textContent = st.busy ? 'Giving…' : t && corp ? `Give ${t.name} to ${corp.name}${st.charge && charge.possible ? ` and charge ${costText(t)}` : ''}` : 'Give';
  }

  function chargePlan(t, corp) {
    if (!t || !corp) return { possible: false, short: [] };
    if ($('#gvOrigin').value !== 'researched') return { possible: false, short: [], why: 'Copies arrive Claimed; their research player pays for them on their own page.' };
    const cost = costOf(t);
    if (!cost.length) return { possible: false, short: [], why: `${t.name} has no research cost.` };
    const short = cost.filter(x => (corp.points[x.s.value] || 0) < x.n).map(x => ({ s: x.s, need: x.n - (corp.points[x.s.value] || 0) }));
    return { possible: true, cost, short };
  }

  async function give() {
    const m = model();
    const t = st.tech, corp = m.corpById.get(+$('#gvCorp').value);
    if (!t || !corp || st.busy) return;
    const facilityId = $('#gvFac').value ? +$('#gvFac').value : null;
    const origin = $('#gvOrigin').value;
    const fac = facilityId ? corp.facilities.find(f => f.id === facilityId) : null;
    const before = new Set(corp.holdings.map(h => h.id));
    const plan = chargePlan(t, corp);
    const charging = st.charge && plan.possible;
    if (charging && plan.short.length) return;
    st.busy = true; st.msg = null; render();
    try {
      await post('/technology-holdings', { corporation_id: corp.id, technology_type_id: t.id, origin, facility_id: facilityId, discount_percent: null }, { json: true });
      // Confirm it arrived before saying so.
      const page = await fetchPage(researchPath());
      const c2 = page.props.research.corporations.find(c => c.id === corp.id);
      const got = c2 && c2.holdings.find(h => !before.has(h.id) && h.technology_type_id === t.id);
      if (!got) throw new Error(Object.values(page.props.errors || {}).flat()[0] || 'the site didn’t add it.');
      const where = got.facility || 'not in a facility yet';
      addLog({ kind: 'gain', corp: corp.id, tech: t.name, text: `Gave ${t.name} to ${corp.name} (${got.origin_label || origin}) · ${where}` });
      let charged = '';
      if (charging) {
        // One adjustment per suit, the same as the game panel's point buttons; each lands in the game log.
        const failed = [];
        for (const x of plan.cost) {
          try {
            await post('/trackers', { subject_type: 'corporation', subject_id: corp.id, tracker: `research_${x.s.value}`, mode: 'adjust', value: -x.n, reason: `Paid for ${t.name}` });
          } catch (e) { failed.push(`${x.n} ${x.s.label} (${e.message})`); }
        }
        const after = (await fetchPage(researchPath())).props.research.corporations.find(c => c.id === corp.id);
        const now = SUITS().map(s => `${after.points[s.value] || 0} ${s.label}`).join(', ');
        if (failed.length) throw Object.assign(new Error(`${t.name} was given, but charging failed for ${failed.join('; ')}. Adjust their points by hand on the game panel. They now have ${now}.`), { partial: true });
        charged = ` Charged ${esc(costText(t))}; they now have ${esc(now)}.`;
        addLog({ kind: 'points', corp: corp.id, tech: t.name, text: `Charged ${corp.name} ${costText(t)} for ${t.name}` });
      }
      st.msg = { ok: true, html: `Gave <b>${esc(t.name)}</b> to <b>${esc(corp.name)}</b> as ${esc(got.origin_label || origin)}, in ${esc(where)}. ${got.usable === false ? 'It’s Claimed until they pay for it.' : 'It’s working.'}${charged}` };
      st.lastCorp = corp.id;
      st.tech = null;
      refreshNow();
    } catch (e) {
      console.error(e);
      st.msg = { ok: false, html: e.partial ? `Partly done: ${esc(e.message)}` : `Couldn’t give it: ${esc(e.message)}` };
      if (e.partial) st.tech = null;
    } finally {
      st.busy = false;
      render();
      if (!st.tech && $('#gvTech')) $('#gvTech').focus();
    }
  }

  return { open, state: st };
};
