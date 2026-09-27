'use strict';
// Research builder: a better form for adding (or editing) a technology in Control.
//   Prerequisites are picked from the game's real techs with autocomplete, as chips, so names are always
//   spelled exactly and joined with semicolons the way the site wants. A name that isn't in the game yet
//   can still be added on purpose.
//   The tree follows the prerequisites: if they come from one corp's tree, the new tech goes in that tree.
//   Nothing is sent until you confirm, and afterwards the tool re-reads the site to check what was saved.
window.RHComposer = function createComposer(deps) {
  const { esc, keyOf, getModel, fetchPage, gameBase, post, refreshNow, select, addLog, mount } = deps;
  const fold = s => keyOf(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const st = { site: null, mode: 'new', editing: null, chips: [], active: -1, matches: [], treeNote: '', treeAuto: null, confirm: false, busy: false, msg: null };
  const $ = sel => mount.querySelector(sel);

  // Trees (with their corporation) and facility types come from the Cards page.
  async function loadSite() {
    const C = await fetchPage(gameBase() + '/cards', 'technologies');
    st.site = {
      trees: C.props.technologyTrees || [],
      facilityTypes: (C.props.facilityTypes || []).map(f => ({ id: f.id, name: f.name })),
      suits: C.props.researchSuits || [],
      technologies: C.props.technologies || [],
    };
  }

  const techs = () => (getModel() ? getModel().techs : []);
  const techByKey = n => techs().find(t => keyOf(t.name) === keyOf(n));
  const treeInfo = slug => (st.site.trees.find(t => t.tree === slug) || null);
  const treeLabel = slug => { const m = getModel(); const t = m && m.treeBySlug.get(slug); return t ? t.name : (treeInfo(slug) || { label: slug }).label; };
  const treeColor = slug => { const m = getModel(); const t = m && m.treeBySlug.get(slug); return t ? t.color : 'var(--t-std)'; };

  // ---------- Prerequisite picker ----------
  function search(q) {
    const f = fold(q);
    if (!f) return [];
    const chosen = new Set(st.chips.map(keyOf));
    const self = st.editing ? keyOf(st.editing.name) : null;
    // A tech can't need itself or anything that already needs it.
    const blocked = new Set();
    if (st.editing) {
      const stack = [st.editing.name];
      while (stack.length) { const n = stack.pop(); if (blocked.has(keyOf(n))) continue; blocked.add(keyOf(n)); const t = techByKey(n); if (t) stack.push(...t.kids); }
    }
    const scored = [];
    for (const t of techs()) {
      const k = keyOf(t.name);
      if (chosen.has(k) || k === self || blocked.has(k) || t.kind !== 'research') continue;
      const n = fold(t.name), code = fold(t.code || '');
      let score = n.startsWith(f) ? 0 : n.split(/[\s'-]+/).some(w => w.startsWith(f)) ? 1 : n.includes(f) ? 2 : code.includes(f) ? 3 : -1;
      if (score >= 0) scored.push({ t, score });
    }
    scored.sort((a, b) => a.score - b.score || a.t.name.localeCompare(b.t.name));
    const out = scored.slice(0, 8).map(x => ({ kind: 'tech', name: x.t.name, t: x.t }));
    // Typing part of a name that's already picked says so, rather than offering it as a new name.
    const picked = st.chips.find(c => fold(c).includes(f));
    if (picked && !out.length) return [{ kind: 'picked', name: picked }];
    const exact = techByKey(q);
    if (!exact && !picked && q.trim()) out.push({ kind: 'new', name: q.trim() });
    return out;
  }

  function addChip(name) {
    const t = techByKey(name);
    const n = t ? t.name : name.trim();
    if (!n || st.chips.some(c => keyOf(c) === keyOf(n))) return;
    st.chips.push(n);
    $('#rcPreInput').value = '';
    st.matches = []; st.active = -1;
    followTree();
    render();
    $('#rcPreInput').focus();
  }
  function removeChip(i) { st.chips.splice(i, 1); followTree(); render(); }

  // Put the tech in the tree its prerequisites come from, when that's a single corp's tree.
  function followTree() {
    const corpTrees = [...new Set(st.chips.map(techByKey).filter(t => t && t.tree !== 'standard').map(t => t.tree))];
    if (corpTrees.length === 1) {
      const from = st.chips.filter(n => { const t = techByKey(n); return t && t.tree === corpTrees[0]; });
      $('#rcTree').value = corpTrees[0];
      st.treeAuto = corpTrees[0];
      st.treeNote = `Set to ${treeLabel(corpTrees[0])} because it builds on ${from.join(', ')}.`;
    } else if (corpTrees.length > 1) {
      st.treeAuto = null;
      st.treeNote = `Its prerequisites come from ${corpTrees.map(treeLabel).join(' and ')}. Pick which tree it belongs in.`;
    } else {
      st.treeAuto = null;
      st.treeNote = st.chips.length ? 'Its prerequisites are all Standard, so pick any tree.' : '';
    }
  }

  // ---------- Form ----------
  const COSTS = [['cog', 'Cog'], ['brain', 'Brain'], ['leaf', 'Leaf'], ['maths', 'Maths']];

  function open(mode, tech) {
    st.mode = mode; st.editing = tech || null; st.confirm = false; st.msg = null; st.busy = false;
    st.chips = tech ? [...tech.prerequisites] : [];
    st.matches = []; st.active = -1; st.treeNote = ''; st.treeAuto = null;
    mount.innerHTML = '<div class="rc-body"><p class="hint">Loading the trees and facility types…</p></div>';
    if (!mount.open) mount.showModal();
    loadSite().then(() => { build(); if (tech) fill(tech); else followTree(); render(); $('#rcName').focus(); })
      .catch(e => { mount.innerHTML = `<div class="rc-body"><p class="banner">Could not load the Cards page: ${esc(e.message)}</p><button type="button" class="btn" data-close>Close</button></div>`; mount.querySelector('[data-close]').addEventListener('click', () => mount.close()); });
  }

  function build() {
    const trees = st.site.trees.map(t => `<option value="${esc(t.tree)}">${esc(treeLabel(t.tree))}</option>`).join('');
    const facs = `<option value="">Any facility</option>` + st.site.facilityTypes.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
    mount.innerHTML = `
      <form class="rc-body" id="rcForm" novalidate>
        <div class="rc-head">
          <h2>${st.mode === 'edit' ? `Edit ${esc(st.editing.name)}` : 'New research'}</h2>
          <button type="button" class="btn quiet" data-close>Close</button>
        </div>
        <div class="rc-grid">
          <label class="rc-f wide" for="rcName">Name <input id="rcName" required autocomplete="off" placeholder="Hybrid Fruit"><span class="rc-warn" id="rcNameWarn"></span></label>

          <div class="rc-f wide">
            <label for="rcPreInput">Prerequisites</label>
            <div class="rc-chips" id="rcChips">
              <span id="rcChipList"></span>
              <input id="rcPreInput" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="rcPreList" placeholder="Type to search techs…">
            </div>
            <ul class="rc-list" id="rcPreList" role="listbox" hidden></ul>
            <span class="mini">Pick as many as you need. Enter adds the highlighted tech; Backspace removes the last one.</span>
          </div>

          <label class="rc-f" for="rcTree">Tree <select id="rcTree">${trees}</select><span class="mini" id="rcTreeNote"></span></label>
          <label class="rc-f" for="rcHoused">Must be housed in <select id="rcHoused">${facs}</select></label>

          <label class="rc-f wide" for="rcDesc">Description <input id="rcDesc" autocomplete="off" placeholder="Making mixed genetic fruits!"></label>
          <label class="rc-f wide" for="rcEffect">Effect <input id="rcEffect" autocomplete="off" placeholder="Increase income, or Unlock: Keresh"></label>

          <div class="rc-f wide">
            <span>Cost in Research Points</span>
            <div class="rc-costs">${COSTS.map(([k, l]) => `<label for="rc_${k}">${l} <input id="rc_${k}" type="number" min="0" step="1" inputmode="numeric"></label>`).join('')}</div>
            <span class="mini" id="rcCostNote">Leave every suit blank for a starting tech. 0 is a real price.</span>
          </div>

          <label class="rc-f" for="rcCopy">Copy strength <input id="rcCopy" type="number" min="0" value="4"></label>
          <label class="rc-f" for="rcDestroy">Destroy strength <input id="rcDestroy" type="number" min="0" value="4"></label>
          <label class="rc-f" for="rcCode">Card code <input id="rcCode" autocomplete="off"><button type="button" class="btn quiet" id="rcCodeSuggest" hidden></button></label>
        </div>
        <p class="rc-preview" id="rcPreview"></p>
        <p class="banner" id="rcMsg" hidden></p>
        <div class="rc-actions" id="rcActions"></div>
      </form>`;
    mount.querySelector('[data-close]').addEventListener('click', () => mount.close());
    const pre = $('#rcPreInput');
    pre.addEventListener('input', () => { st.matches = search(pre.value); st.active = st.matches.length ? 0 : -1; renderList(); });
    pre.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' && st.matches.length) { e.preventDefault(); st.active = (st.active + 1) % st.matches.length; renderList(); }
      else if (e.key === 'ArrowUp' && st.matches.length) { e.preventDefault(); st.active = (st.active - 1 + st.matches.length) % st.matches.length; renderList(); }
      else if (e.key === 'Enter' || e.key === ';' || e.key === ',') {
        e.preventDefault();
        if (st.active >= 0 && st.matches[st.active] && st.matches[st.active].kind !== 'picked') addChip(st.matches[st.active].name);
        else if (pre.value.trim()) addChip(pre.value);
      } else if (e.key === 'Backspace' && !pre.value && st.chips.length) { removeChip(st.chips.length - 1); }
      else if (e.key === 'Escape' && st.matches.length) { e.preventDefault(); e.stopPropagation(); st.matches = []; renderList(); }
    });
    pre.addEventListener('blur', () => setTimeout(() => { st.matches = []; renderList(); }, 150));
    // Pasting a semicolon list from the old form turns into chips.
    pre.addEventListener('paste', e => {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (!/[;,]/.test(text)) return;
      e.preventDefault();
      text.split(/[;,]/).map(s => s.trim()).filter(Boolean).forEach(addChip);
    });
    $('#rcTree').addEventListener('change', () => { st.treeNote = st.treeAuto && $('#rcTree').value !== st.treeAuto ? `You picked this tree. Its prerequisites point to ${treeLabel(st.treeAuto)}.` : st.treeNote; render(); });
    ['#rcName', '#rcCode', ...COSTS.map(([k]) => '#rc_' + k)].forEach(s => $(s).addEventListener('input', render));
    $('#rcForm').addEventListener('submit', e => { e.preventDefault(); });
  }

  function fill(t) {
    $('#rcName').value = t.name;
    $('#rcTree').value = t.tree;
    $('#rcDesc').value = t.description || '';
    $('#rcEffect').value = t.effect || '';
    COSTS.forEach(([k]) => { $('#rc_' + k).value = t.starting ? '' : (t.cost[k] ?? 0); });
    const ft = st.site.facilityTypes.find(f => keyOf(f.name) === keyOf(t.required_facility_type || ''));
    $('#rcHoused').value = ft ? ft.id : '';
    $('#rcCopy').value = t.copy_strength ?? 4;
    $('#rcDestroy').value = t.destroy_strength ?? 4;
    $('#rcCode').value = t.code || '';
  }

  function values() {
    const num = s => { const v = $(s).value.trim(); return v === '' ? null : Math.max(0, Math.round(+v)); };
    const tree = $('#rcTree').value;
    const ti = treeInfo(tree);
    // Blank in every suit means a starting tech; once any suit has a price, the blank ones cost 0.
    const costs = COSTS.map(([k]) => num('#rc_' + k));
    const anyCost = costs.some(c => c !== null);
    const [cog, brain, leaf, maths] = costs.map(c => (anyCost ? c ?? 0 : null));
    return {
      name: $('#rcName').value.trim(),
      tree,
      corporation_id: ti ? ti.corporation_id : null,
      description: $('#rcDesc').value.trim() || null,
      effect: $('#rcEffect').value.trim() || null,
      cog_cost: cog, brain_cost: brain, leaf_cost: leaf, maths_cost: maths,
      prerequisites: st.chips.join('; ') || null,
      required_facility_type_id: $('#rcHoused').value ? +$('#rcHoused').value : null,
      copy_strength: num('#rcCopy'), destroy_strength: num('#rcDestroy'),
      code: $('#rcCode').value.trim() || null,
    };
  }

  // Next free code for a tree, following the existing pattern (e.g. RGR105).
  function suggestCode(tree) {
    const same = techs().filter(t => t.tree === tree && /^[A-Z]{3}\d+$/.test(t.code || ''));
    if (!same.length) return null;
    const prefix = same[0].code.slice(0, 3);
    const max = Math.max(...techs().filter(t => /^[A-Z]{3}\d+$/.test(t.code || '')).map(t => +t.code.slice(3)));
    const width = same[0].code.length - 3;
    return prefix + String(max + 1).padStart(width, '0');
  }

  function problems(v) {
    const out = [];
    if (!v.name) out.push('Give it a name.');
    const clash = techByKey(v.name);
    if (clash && (!st.editing || clash.id !== st.editing.id)) out.push(`A tech called ${clash.name} already exists (${clash.code || 'no code'}, ${treeLabel(clash.tree)}).`);
    if (v.code) {
      const codeClash = techs().find(t => t.code && t.code.toUpperCase() === v.code.toUpperCase() && (!st.editing || t.id !== st.editing.id));
      if (codeClash) out.push(`The code ${v.code} is already used by ${codeClash.name}.`);
    }
    return out;
  }

  function preview(v) {
    const m = getModel();
    if (!m) return '';
    const inTree = st.chips.map(techByKey).filter(t => t && t.tree === v.tree);
    // Tier: one after the deepest prerequisite in the same tree.
    const tierOf = (t, seen = new Set()) => { if (seen.has(t.name)) return 1; seen.add(t.name); const ps = t.prerequisites.map(techByKey).filter(p => p && p.tree === t.tree); return ps.length ? 1 + Math.max(...ps.map(p => tierOf(p, seen))) : 1; };
    const tier = inTree.length ? 1 + Math.max(...inTree.map(t => tierOf(t))) : 1;
    const unknown = st.chips.filter(n => !techByKey(n));
    const other = st.chips.map(techByKey).filter(t => t && t.tree !== v.tree);
    const allBlank = ['cog_cost', 'brain_cost', 'leaf_cost', 'maths_cost'].every(k => v[k] === null);
    const bits = [`Goes in <b>${esc(treeLabel(v.tree))}</b> at <b>tier ${tier}</b>${inTree.length ? `, after ${esc(inTree.map(t => t.name).join(', '))}` : ', with no prerequisites in that tree'}.`];
    if (other.length) bits.push(`Also needs ${esc(other.map(t => `${t.name} (${treeLabel(t.tree)})`).join(', '))} from another tree.`);
    if (unknown.length) bits.push(`<span class="bad">${esc(unknown.join(', '))} ${unknown.length === 1 ? 'isn’t' : 'aren’t'} in the game yet, so nobody can research this until ${unknown.length === 1 ? 'it exists' : 'they exist'}.</span>`);
    if (allBlank) bits.push('<span class="bad">No cost in any suit makes this a starting tech.</span>');
    return bits.join(' ');
  }

  // ---------- Rendering ----------
  function renderList() {
    const list = $('#rcPreList'), input = $('#rcPreInput');
    if (!list) return;
    list.hidden = !st.matches.length;
    input.setAttribute('aria-expanded', String(!!st.matches.length));
    list.innerHTML = st.matches.map((x, i) => x.kind === 'picked'
      ? `<li role="option" data-i="${i}" class="picked" aria-disabled="true"><span class="n">${esc(x.name)} is already added</span></li>`
      : x.kind === 'tech'
      ? `<li role="option" data-i="${i}" class="${i === st.active ? 'on' : ''}" aria-selected="${i === st.active}" style="--c:${treeColor(x.t.tree)}"><span class="sw"></span><span class="n">${esc(x.t.name)}</span><span class="mini">${esc(treeLabel(x.t.tree))}${x.t.code ? ' · ' + esc(x.t.code) : ''}</span></li>`
      : `<li role="option" data-i="${i}" class="new ${i === st.active ? 'on' : ''}" aria-selected="${i === st.active}"><span class="n">Use “${esc(x.name)}”</span><span class="mini">not in the game yet</span></li>`).join('');
    list.querySelectorAll('li:not(.picked)').forEach(li => li.addEventListener('mousedown', e => { e.preventDefault(); addChip(st.matches[+li.dataset.i].name); }));
  }

  function render() {
    if (!$('#rcForm')) return;
    $('#rcChipList').innerHTML = st.chips.map((n, i) => {
      const t = techByKey(n);
      return `<span class="rc-chip${t ? '' : ' unknown'}" style="--c:${t ? treeColor(t.tree) : 'var(--warn)'}" title="${esc(t ? `${treeLabel(t.tree)} · ${t.code || ''}` : 'Not in the game yet')}"><span class="sw"></span>${esc(n)}<button type="button" data-rm="${i}" aria-label="Remove ${esc(n)}">×</button></span>`;
    }).join('');
    $('#rcChipList').querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => removeChip(+b.dataset.rm)));
    renderList();
    $('#rcTreeNote').textContent = st.treeNote;
    const v = values();
    const probs = problems(v);
    $('#rcNameWarn').textContent = probs.find(p => p.startsWith('A tech called')) || '';
    const code = suggestCode(v.tree), cs = $('#rcCodeSuggest');
    cs.hidden = !code || v.code === code || (st.editing && st.editing.code);
    if (code) { cs.textContent = `Use ${code}`; cs.onclick = () => { $('#rcCode').value = code; render(); }; }
    $('#rcPreview').innerHTML = preview(v);
    $('#rcMsg').hidden = !st.msg;
    if (st.msg) { $('#rcMsg').className = 'banner' + (st.msg.ok ? ' ok' : ''); $('#rcMsg').innerHTML = st.msg.html; }

    const verb = st.mode === 'edit' ? 'Save changes' : 'Add research';
    const acts = $('#rcActions');
    if (st.busy) acts.innerHTML = `<span class="mini">Sending to the game…</span>`;
    else if (st.confirm) acts.innerHTML = `<span class="rc-confirm">${st.mode === 'edit' ? `Change <b>${esc(st.editing.name)}</b> in the live game?` : `Add <b>${esc(v.name)}</b> to <b>${esc(treeLabel(v.tree))}</b> in the live game?`}</span>
        <button type="button" class="btn primary" id="rcGo">${verb}</button><button type="button" class="btn" id="rcBack">Back</button>`;
    else acts.innerHTML = `${probs.length ? `<span class="rc-warn">${esc(probs.join(' '))}</span>` : ''}<button type="button" class="btn primary" id="rcNext"${probs.length ? ' disabled' : ''}>${verb}…</button>`;
    const next = $('#rcNext'), go = $('#rcGo'), back = $('#rcBack');
    if (next) next.addEventListener('click', () => { st.confirm = true; st.msg = null; render(); });
    if (back) back.addEventListener('click', () => { st.confirm = false; render(); });
    if (go) go.addEventListener('click', submit);
  }

  // ---------- Sending ----------
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  async function submit() {
    const v = values();
    st.busy = true; st.confirm = false; render();
    try {
      if (st.mode === 'edit') await post(`/technologies/${st.editing.id}`, v, { method: 'PATCH', json: true });
      else await post('/technologies', v, { json: true });
      // Re-read the site and check what it actually saved.
      const C = await fetchPage(gameBase() + '/cards', 'technologies');
      const errs = Object.values(C.props.errors || {}).flat();
      const saved = (C.props.technologies || []).find(t => st.mode === 'edit' ? t.id === st.editing.id : keyOf(t.name) === keyOf(v.name));
      if (!saved) throw new Error(errs[0] || 'the site didn’t save it. Nothing changed.');
      const want = {
        name: v.name, tree: v.tree,
        prerequisites: st.chips,
        cost: { cog: v.cog_cost ?? 0, brain: v.brain_cost ?? 0, leaf: v.leaf_cost ?? 0, maths: v.maths_cost ?? 0 },
        effect: v.effect, description: v.description,
      };
      const got = {
        name: saved.name, tree: saved.tree, prerequisites: saved.prerequisites || [],
        cost: { cog: saved.cost.cog || 0, brain: saved.cost.brain || 0, leaf: saved.cost.leaf || 0, maths: saved.cost.maths || 0 },
        effect: saved.effect, description: saved.description,
      };
      const off = Object.keys(want).filter(k => !same(want[k], got[k]));
      const label = { name: 'name', tree: 'tree', prerequisites: 'prerequisites', cost: 'cost', effect: 'effect', description: 'description' };
      addLog({ kind: 'tech', tech: saved.name, text: `${st.mode === 'edit' ? 'Edited' : 'Added'} ${saved.name} (${treeLabel(saved.tree)} tree)${saved.prerequisites && saved.prerequisites.length ? `, needs ${saved.prerequisites.join('; ')}` : ''}` });
      st.msg = off.length
        ? { ok: false, html: `Saved, but the site didn’t take the ${off.map(k => label[k]).join(', ')}. ${st.mode === 'edit' ? 'It may not allow editing those; remove the tech and add it again instead.' : 'Check it on the Cards page.'}` }
        : { ok: true, html: `${st.mode === 'edit' ? 'Saved' : 'Added'} <b>${esc(saved.name)}</b>. It will appear on the tree in a moment.` };
      if (!off.length && st.mode === 'new') { st.chips = []; build(); followTree(); }
      if (st.mode === 'edit') st.editing = { ...st.editing, ...saved, prerequisites: saved.prerequisites || [] };
      refreshNow();
      setTimeout(() => select(saved.name, true), 1500);
    } catch (e) {
      console.error(e);
      st.msg = { ok: false, html: `Couldn’t ${st.mode === 'edit' ? 'save' : 'add'} it: ${esc(e.message)}` };
    } finally {
      st.busy = false; render();
    }
  }

  return { open, state: st };
};
