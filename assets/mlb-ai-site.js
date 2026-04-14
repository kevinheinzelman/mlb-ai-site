(async function main() {
  const page = document.body.dataset.page;
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const bad = (v) => v == null || v === '' || Number.isNaN(Number(v));
  const pct = (v) => bad(v) ? '--' : `${(Number(v) * 100).toFixed(1)}%`;
  const pctEdge = (v) => bad(v) ? '--' : `${Number(v) >= 0 ? '+' : ''}${(Number(v) * 100).toFixed(1)} pts`;
  const units = (v) => bad(v) ? '--' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}u`;
  const fixed = (v, d = 2) => bad(v) ? '--' : Number(v).toFixed(d);
  const odds = (v) => bad(v) ? '--' : `${Number(v) > 0 ? '+' : ''}${Number(v)}`;
  const dt = (v) => !v ? 'Unknown' : new Date(v).toLocaleString();
  const title = (v) => String(v || '').replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  const freshnessPill = (value) => {
    const key = String(value || 'unknown').toLowerCase();
    const cls = key === 'green' ? 'freshness-pill freshness-pill-green'
      : key === 'red' ? 'freshness-pill freshness-pill-red'
      : 'freshness-pill freshness-pill-yellow';
    return `<span class="${cls}">${esc(String(value || 'unknown').toUpperCase())}</span>`;
  };
  const changePill = (value) => {
    const yes = Boolean(value);
    return `<span class="${yes ? 'change-pill change-pill-yes' : 'change-pill change-pill-no'}">${yes ? 'CHANGED' : 'UNCHANGED'}</span>`;
  };
  const json = async (name) => {
    const res = await fetch(`./data/${name}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${name}`);
    return res.json();
  };
  const card = (c) => `<article class="metric-card"><strong>${esc(c.label)}</strong><div class="metric-value ${esc(c.tone || '')}">${esc(c.value)}</div><div class="subtle">${esc(c.note || '')}</div></article>`;
  const pills = (items) => (items || []).filter(Boolean).map((t) => `<span class="hero-pill">${esc(t)}</span>`).join('');
  const sumUnits = (rows) => rows.reduce((sum, row) => sum + Number(row.units || 0), 0);

  function latestPerformanceRow(performance) {
    const rows = Array.isArray(performance?.rows) ? performance.rows : [];
    return rows.length ? rows[rows.length - 1] : null;
  }

  function recentPerformanceUnits(performance, days) {
    const rows = Array.isArray(performance?.rows) ? performance.rows : [];
    if (!rows.length) return null;
    const range = rangeDates(rows, days === 7 ? '7d' : days === 30 ? '30d' : 'season');
    return sumUnits(filterDate(rows, range.start, range.end));
  }

  function boardDate(leads) {
    return leads?.board_available === false
      ? (leads.active_board_date || leads.latest_valid_mlb_ai_board_date || null)
      : (leads?.board_date || leads?.active_board_date || null);
  }

  function primarySurface(payload, op) {
    return payload?.site_surface || op?.site_system_contract?.primary_system || null;
  }

  function retainedInternalSystems(payload, op) {
    return payload?.retained_internal_systems || op?.site_system_contract?.retained_internal_systems || [];
  }

  function primarySurfaceLabel(payload, op) {
    return primarySurface(payload, op)?.label || 'Primary system';
  }

  function primaryThreshold(payload, op) {
    return primarySurface(payload, op)?.threshold || payload?.selection_contract || op?.summary?.ranker_shadow_selection_threshold || op?.boards?.ranker_shadow_threshold || 'edge_gte_0_03';
  }

  function market(row) {
    const line = bad(row.line_value) ? '' : ` ${row.line_value}`;
    if (row.market_type === 'total') return `Total ${String(row.side || '').toUpperCase()}${line}`;
    if (row.market_type === 'moneyline') return `Moneyline ${String(row.side || '').toUpperCase()}`;
    if (row.market_type === 'spread') return `Run line ${String(row.side || '').toUpperCase()}${line}`;
    return `${title(row.market_type)} ${String(row.side || '').toUpperCase()}${line}`.trim();
  }

  function confidenceClass(v) {
    v = String(v || '').toLowerCase();
    if (v === 'high') return 'confidence-pill confidence-pill-high';
    if (v === 'medium') return 'confidence-pill confidence-pill-medium';
    return 'confidence-pill';
  }

  function priceChip(flag) {
    flag = String(flag || '').toLowerCase();
    if (flag === 'expensive') return '<span class="price-pill price-pill-expensive">Expensive price</span>';
    if (flag === 'priced_up') return '<span class="price-pill price-pill-priced-up">Priced up</span>';
    return '';
  }

  function vis(row) {
    const tier = String(row.visibility_tier || '').toLowerCase();
    if (tier === 'core' || tier === 'exploratory' || tier === 'hidden') return tier;
    if (String(row.confidence_band || '').toLowerCase() === 'high') return 'core';
    if (String(row.confidence_band || '').toLowerCase() === 'medium') return 'exploratory';
    return 'hidden';
  }

  function leanSort(a, b) {
    const buckets = { core_priority: 3, exploratory_priority: 2, hidden: 1 };
    const bands = { high: 3, medium: 2, low: 1 };
    return (buckets[b.display_sort_bucket] || 0) - (buckets[a.display_sort_bucket] || 0)
      || (bands[b.confidence_band] || 0) - (bands[a.confidence_band] || 0)
      || Number(b.edge || 0) - Number(a.edge || 0)
      || Number(a.rank_on_slate || 0) - Number(b.rank_on_slate || 0);
  }

  function statusMap(status) {
    const trusted = Boolean(status?.trust?.trusted_for_modeling) && Boolean(status?.trust?.trusted_for_site_shadow);
    const failures = status?.blocked?.failures || [];
    const warnings = status?.blocked?.warnings || [];
    const runStatus = status?.run?.overall_status || status?.summary?.last_run_overall_status || 'unknown';
    const stubs = runStatus === 'completed_with_stubs';
    let severity = 'ok';
    if (!trusted || failures.length || status?.state === 'fail') severity = 'fail';
    else if (stubs || warnings.length || status?.state === 'warning') severity = 'warning';
    let headline = "Today's board is trusted.";
    let subheadline = 'The board, validation, and published surface are aligned.';
    if (severity === 'fail') {
      headline = "Today's board is not trusted.";
      subheadline = failures.length ? `Blocking validation failed: ${failures[0].code}.` : 'Required trust signals are not aligned.';
    } else if (stubs) {
      headline = "Today's board is trusted, with non-board stubs still present.";
      subheadline = 'The board is trusted, but the loop still records non-board stub stages.';
    } else if (severity === 'warning') {
      headline = "Today's board is trusted, with warnings.";
      subheadline = warnings.length ? `Non-blocking warnings are present: ${warnings[0].code}.` : 'Trust passed, but operator review is still warranted.';
    }
    return {
      severity,
      headline,
      subheadline,
      chips: [
        `Modeling ${status?.trust?.trusted_for_modeling ? 'trusted' : 'blocked'}`,
        `Site ${status?.trust?.trusted_for_site_shadow ? 'trusted' : 'blocked'}`,
        `Board ${status?.boards?.active_board_date || 'unknown'}`,
        `Final ${status?.validation?.final?.status || 'unknown'}`
      ].concat(stubs ? ['Non-board stubs'] : [])
    };
  }

  function renderStatusStrip(status) {
    const shell = $('.page-shell');
    if (!shell) return;
    const mapped = statusMap(status);
    const section = document.createElement('section');
    section.className = `status-strip status-strip-${mapped.severity}`;
    section.innerHTML = `<div class="status-strip-copy"><p class="status-strip-label">Board trust</p><h2>${esc(mapped.headline)}</h2><p>${esc(mapped.subheadline)}</p></div><div class="status-strip-chips">${mapped.chips.map((chip) => `<span class="status-chip">${esc(chip)}</span>`).join('')}</div>`;
    shell.insertBefore(section, shell.firstChild);
  }

  function renderTrustBar(target, config) {
    const node = typeof target === 'string' ? $(target) : target;
    if (!node) return;
    node.className = `trust-bar trust-bar-${esc(config.severity || 'ok')}`;
    node.innerHTML = `<div class="trust-bar-copy"><p class="status-strip-label">${esc(config.kicker || 'Board trust')}</p><h2>${esc(config.title || '')}</h2><p>${esc(config.subtitle || '')}</p></div><div class="trust-bar-grid">${(config.items || []).map((item) => `<article class="trust-bar-item"><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong><small>${esc(item.note || '')}</small></article>`).join('')}</div>`;
  }

  function renderLeans(status, leans, op, performance) {
    const primaryLabel = primarySurfaceLabel(leans, op);
    const threshold = primaryThreshold(leans, op);
    const requested = leans.requested_board_date || op?.boards?.operating_date || 'unknown';
    const active = boardDate(leans);
    const latestValid = leans.latest_valid_mlb_ai_board_date || op?.boards?.latest_valid_mlb_ai_board_date || active || 'unknown';
    const noBoard = leans.board_available === false || leans.board_state === 'no_valid_board_for_requested_date';
    const rows = [...(leans.rows || [])].filter((row) => vis(row) !== 'hidden').sort(leanSort);
    const core = rows.filter((row) => vis(row) === 'core');
    const exploratory = rows.filter((row) => vis(row) === 'exploratory');
    const featured = core[0] || rows[0] || null;

    const heroMeta = $('#leans-hero-meta');
    if (heroMeta) heroMeta.innerHTML = pills([primaryLabel, `Threshold ${threshold}`, `Requested ${requested}`, noBoard ? 'No official board' : `Board ${active}`, `Latest valid ${latestValid}`, op?.trust?.trusted_for_modeling ? 'Board trusted' : 'Trust blocked']);
    const hero = $('#leans-hero-grid');
    if (hero) hero.innerHTML = [
      { label: 'Surface shown', value: primaryLabel, note: 'This page shows the live public ranker card.' },
      { label: 'Official plays', value: String(rows.length), note: noBoard ? 'A no-board day shows zero official plays on purpose.' : 'Only surfaced core and exploratory plays are shown.' },
      { label: 'Core card', value: String(core.length), note: 'Highest-confidence positions.' },
      { label: 'Selection threshold', value: threshold, note: 'Every public pick cleared this edge threshold.' }
    ].map(card).join('');
    renderTrustBar('#leans-trust-bar', {
      severity: noBoard ? 'warning' : (op?.trust?.trusted_for_modeling ? 'ok' : 'fail'),
      kicker: 'System identity',
      title: noBoard ? `No ${primaryLabel} board for ${requested}` : `${primaryLabel}: ${core.length} core play${core.length === 1 ? '' : 's'} on the official board`,
      subtitle: noBoard
        ? (leans.availability_reason || `The requested date ${requested} does not currently have a valid MLB AI board.`)
        : `${primaryLabel} is the live public site surface for ${active}. Every public pick shown here comes from the fixed threshold contract ${threshold}.`,
      items: [
        { label: 'Primary surface', value: primaryLabel, note: 'Live public daily card' },
        { label: 'Selection threshold', value: threshold, note: 'Public ranker contract' },
        { label: 'Results through', value: performance?.results_through || performance?.source_coverage?.shadow_results_through || latestPerformanceRow(performance)?.board_date || 'Unknown', note: 'Latest graded MLB AI date' },
        { label: 'Board state', value: noBoard ? 'No board' : `${rows.length} plays`, note: noBoard ? `Requested ${requested}` : `${core.length} core | ${exploratory.length} exploratory` }
      ]
    });
    const badge = $('#leans-summary-badge');
    if (badge) badge.textContent = noBoard ? `No official plays for ${requested}` : `${rows.length} official plays`;
    const summary = $('#leans-summary-grid');
    if (summary) summary.innerHTML = noBoard
      ? [
          { label: `${primaryLabel} board for ${requested}`, value: 'No plays', note: leans.availability_reason || `No valid MLB AI board is available for ${requested}.` },
          { label: 'Latest valid board', value: latestValid, note: 'This is the most recent date the model considers official.' },
          { label: 'Selection threshold', value: threshold, note: 'Public ranker contract' }
        ].map(card).join('')
      : [
          { label: 'Official board date', value: active, note: `${primaryLabel} | requested date ${requested}` },
          { label: 'Slate rows scored', value: String(leans?.slate_summary?.total_rows_scored || '--'), note: 'Total rows evaluated by the active engine.' },
          { label: 'Selected bets', value: String(leans?.slate_summary?.selected_bets || rows.length), note: Object.entries(leans?.slate_summary?.selected_by_market || {}).map(([key, value]) => `${title(key)} ${value}`).join(' | ') || 'Ranker picks on the public card' },
          { label: 'Selection threshold', value: threshold, note: 'Public ranker contract' }
        ].map(card).join('');

    const featureWrap = $('#leans-featured-section');
    const feature = $('#leans-featured-play');
    if (featureWrap && feature) {
      if (noBoard || !featured) featureWrap.style.display = 'none';
      else feature.innerHTML = `<article class="lean-featured-card"><div class="lean-featured-top"><div><p class="lean-featured-matchup">${esc(featured.matchup)}</p><h3 class="lean-featured-play">${esc(market(featured))}</h3><p class="lean-featured-market">${esc(String(featured.side || '').toUpperCase())} at ${esc(odds(featured.price_american))} | ${esc(fixed(featured.suggested_units, 2))} unit official position</p></div><div class="history-chip-row"><span class="${confidenceClass(featured.confidence_band)}">${esc(title(featured.confidence_band || 'unknown'))} confidence</span><span class="badge">${esc(fixed(featured.suggested_units, 2))} units</span>${priceChip(featured.price_flag)}</div></div><div class="lean-featured-metrics"><div class="metric-tile"><label>Edge</label><strong>${esc(pctEdge(featured.edge))}</strong></div><div class="metric-tile"><label>Model</label><strong>${esc(pct(featured.model_probability))}</strong></div><div class="metric-tile"><label>Market</label><strong>${esc(pct(featured.market_probability))}</strong></div><div class="metric-tile"><label>Slate rank</label><strong>#${esc(String(featured.rank_on_slate || '--'))}</strong></div></div><div class="lean-explain-grid"><div class="lean-explain-block"><strong>Primary drivers</strong><ul>${(featured.primary_drivers || []).slice(0, 3).map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div><div class="lean-explain-block"><strong>Short read</strong><ul><li>${esc(featured.explanation_summary || 'No explanation available.')}</li></ul></div></div></article>`;
    }

    const leanCard = (row) => `<article class="lean-decision-card"><div class="lean-decision-head"><div><p class="lean-kicker">${esc(row.matchup)}</p><h3>${esc(String(row.away_team || '').toUpperCase())} vs ${esc(String(row.home_team || '').toUpperCase())}</h3><div class="lean-bet-callout">${esc(market(row))}</div><p class="lean-subline">Official side: ${esc(String(row.side || '').toUpperCase())} at ${esc(odds(row.price_american))}</p></div><div class="lean-score-stack"><span class="${confidenceClass(row.confidence_band)}">${esc(title(row.confidence_band || 'unknown'))} confidence</span><span class="badge">${esc(fixed(row.suggested_units, 2))} units</span>${priceChip(row.price_flag)}</div></div><div class="lean-decision-metrics"><div class="metric-tile"><label>Edge</label><strong>${esc(pctEdge(row.edge))}</strong></div><div class="metric-tile"><label>Model</label><strong>${esc(pct(row.model_probability))}</strong></div><div class="metric-tile"><label>Market</label><strong>${esc(pct(row.market_probability))}</strong></div><div class="metric-tile"><label>Slate rank</label><strong>#${esc(String(row.rank_on_slate || '--'))}</strong></div></div><div class="lean-explain-grid"><div class="lean-explain-block"><strong>Why it made the card</strong><ul>${(row.primary_drivers || []).slice(0, 3).map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div><div class="lean-explain-block"><strong>Supporting context</strong><ul>${(row.supporting_context || []).slice(0, 3).map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div></div></article>`;

    const coreNode = $('#leans-core-cards');
    if (coreNode) coreNode.innerHTML = noBoard ? `<div class="empty-state">No official MLB AI plays are available for ${esc(requested)}. The site does not fall back to yesterday's board.</div>` : core.length ? core.map(leanCard).join('') : '<div class="empty-state">No core plays made the official board today.</div>';
    const expNode = $('#leans-exploratory-cards');
    if (expNode) expNode.innerHTML = noBoard ? `<div class="empty-state">${esc(leans.availability_reason || `No valid MLB AI board is available for ${requested}.`)}</div>` : exploratory.length ? exploratory.map(leanCard).join('') : '<div class="empty-state">No exploratory plays are available on the official board.</div>';
  }

  function rangeDates(rows, mode) {
    if (!rows.length) return { start: '', end: '' };
    const maxDate = rows[rows.length - 1].board_date;
    const max = new Date(`${maxDate}T00:00:00`);
    let start = rows[0].board_date;
    if (mode === '7d') { const d = new Date(max); d.setDate(d.getDate() - 6); start = d.toISOString().slice(0, 10); }
    if (mode === '30d') { const d = new Date(max); d.setDate(d.getDate() - 29); start = d.toISOString().slice(0, 10); }
    if (mode === 'season') start = rows.find((r) => String(r.board_date).startsWith('2026-'))?.board_date || rows[0].board_date;
    return { start, end: maxDate };
  }

  function filterDate(rows, startDate, endDate) {
    return rows.filter((row) => (!startDate || row.board_date >= startDate) && (!endDate || row.board_date <= endDate));
  }

  function perfSummary(rows) {
    const bets = rows.reduce((s, r) => s + Number(r.bets || 0), 0);
    const wins = rows.reduce((s, r) => s + Number(r.wins || 0), 0);
    const losses = rows.reduce((s, r) => s + Number(r.losses || 0), 0);
    const pushes = rows.reduce((s, r) => s + Number(r.pushes || 0), 0);
    const unitsValue = rows.reduce((s, r) => s + Number(r.units || 0), 0);
    const graded = wins + losses;
    return { days: rows.length, bets, wins, losses, pushes, units: unitsValue, roi: bets ? unitsValue / bets : null, winRate: graded ? wins / graded : null };
  }

  function historyCard(row) {
    const edgeDrivers = (row.top_edge_drivers || []).slice(0, 3).map((item) => `${title(item.feature)} ${fixed(item.contribution, 3)}`);
    const contextDrivers = (row.top_context_drivers || []).slice(0, 3).map((item) => `${title(item.feature)} ${fixed(item.contribution, 3)}`);
    return `<article class="history-card"><div class="history-card-head"><div><p class="lean-kicker">${esc(row.board_date)}</p><h3>${esc(market(row))}</h3><p class="lean-subline">${esc(row.canonical_game_id)} | ${esc(odds(row.price_american))} | ${esc(fixed(row.suggested_units, 2))} unit recommendation</p></div><div class="history-chip-row"><span class="${confidenceClass(row.confidence_band)}">${esc(title(row.confidence_band || 'unknown'))}</span><span class="badge">${esc(pctEdge(row.edge))} edge</span></div></div><div class="history-card-metrics"><div class="metric-tile"><label>Final score</label><strong>${esc(fixed(row.final_score, 3))}</strong></div><div class="metric-tile"><label>Context score</label><strong>${esc(fixed(row.context_score, 3))}</strong></div><div class="metric-tile"><label>Hostile penalty</label><strong>${esc(fixed(row.hostile_penalty_multiplier, 3))}</strong></div></div><p class="history-summary">${esc(row.explanation_summary || 'No explanation summary available.')}</p><div class="lean-explain-grid"><div class="lean-explain-block"><strong>Why the pick graded well</strong><ul>${edgeDrivers.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div><div class="lean-explain-block"><strong>What shaped the context</strong><ul>${contextDrivers.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div></div></article>`;
  }

  function renderPerformance(status, reporting, monthly, comparison, performance, pickHistory, op) {
    const primaryLabel = primarySurfaceLabel(reporting, op);
    const threshold = primaryThreshold(reporting, op);
    const rows = Array.isArray(performance?.rows) ? performance.rows.slice() : [];
    const latest = rows[rows.length - 1] || null;
    const requested = op?.boards?.operating_date || status.requested_board_date || 'unknown';
    const active = op?.boards?.active_board_date || reporting.active_board_date || 'unknown';
    const resultsThrough = reporting?.source_coverage?.shadow_results_through || latest?.board_date || 'unknown';

    const heroMeta = $('#performance-hero-meta');
    if (heroMeta) heroMeta.innerHTML = pills([primaryLabel, `Threshold ${threshold}`, `Results through ${resultsThrough}`, `Requested ${requested}`, `Official board ${active}`, op?.trust?.trusted_for_modeling ? 'Board trusted' : 'Trust blocked']);
    const hero = $('#performance-hero-grid');
    if (hero) hero.innerHTML = [
      { label: 'Surface shown', value: primaryLabel, note: 'This page reports the public ranker record.' },
      { label: 'Season cumulative', value: units(latest?.cumulative_units), note: latest ? `As of ${latest.board_date}` : 'No 2026 results available.' },
      { label: 'Selection threshold', value: threshold, note: 'Public ranker contract' }
    ].map(card).join('');
    renderTrustBar('#performance-trust-bar', {
      severity: op?.trust?.trusted_for_modeling ? 'ok' : 'fail',
      kicker: 'System identity',
      title: `${primaryLabel} results are settled through ${resultsThrough}`,
      subtitle: `${primaryLabel} is the current public performance surface. This page reports the public ranker contract ${threshold} from the same system that drives the live board.`,
      items: [
        { label: 'Primary surface', value: primaryLabel, note: 'Live public reporting contract' },
        { label: 'Selection threshold', value: threshold, note: 'Public ranker contract' },
        { label: 'Results through', value: resultsThrough, note: 'Latest graded MLB AI date' },
        { label: '2026 cumulative', value: units(latest?.cumulative_units), note: latest?.board_date ? `Full season through ${latest.board_date}` : 'No 2026 results available' }
      ]
    });
    const trust = $('#performance-trust-grid');
    if (trust) trust.innerHTML = [
      { label: 'Results through', value: resultsThrough, note: `${primaryLabel} grading frontier.` },
      { label: 'Artifact generated', value: dt(reporting?.generated_at), note: 'Refresh time for the exported reporting artifact.' },
      { label: 'Filtered vs season', value: 'Separated', note: 'Filtered views do not overwrite the full-season cumulative line.' },
      { label: 'Selection threshold', value: threshold, note: 'Public ranker contract' }
    ].map(card).join('');
    const windowGrid = $('#performance-window-grid');
    const recent = (label, mode) => {
      const range = rangeDates(rows, mode);
      const summary = perfSummary(filterDate(rows, range.start, range.end));
      return { label, value: units(summary.units), tone: summary.units > 0 ? 'metric-good' : summary.units < 0 ? 'metric-bad' : '', note: `${summary.bets} bets | ${pct(summary.roi)} ROI` };
    };
    if (windowGrid && rows.length) windowGrid.innerHTML = [recent('Last 7 days', '7d'), recent('Last 30 days', '30d'), recent('2026 season', 'season'), { label: `${primaryLabel} historical`, value: units(reporting?.active_policy_historical_summary?.units), note: `2022-2025 ROI ${pct(reporting?.active_policy_historical_summary?.roi)}` }].map(card).join('');
    const coverage = $('#performance-coverage-badge');
    if (coverage) coverage.textContent = `Results through ${resultsThrough}`;

    const start = $('#performance-start-date');
    const end = $('#performance-end-date');
    const presets = $('#performance-range-presets');
    const monthlyFilter = $('#monthly-policy-filter');
    const summary = $('#performance-summary-grid');
    const dailyBody = $('#daily-performance-table tbody');
    const monthlyBody = $('#monthly-table tbody');
    const comp = $('#performance-comparator-grid');
    const context = $('#context-breakdowns');
    if (!rows.length || !start || !end || !summary || !dailyBody || !monthlyBody || !comp || !context) return;

    const seasonRange = rangeDates(rows, 'season');
    start.min = rows[0].board_date; start.max = rows[rows.length - 1].board_date; start.value = seasonRange.start;
    end.min = rows[0].board_date; end.max = rows[rows.length - 1].board_date; end.value = seasonRange.end;

    function drawDaily() {
      const filtered = filterDate(rows, start.value, end.value);
      const sums = perfSummary(filtered);
      summary.innerHTML = [
        { label: 'Filtered range', value: `${start.value || 'start'} to ${end.value || 'end'}`, note: `${sums.days} graded day${sums.days === 1 ? '' : 's'} in view` },
        { label: 'Filtered bets', value: String(sums.bets), note: `${sums.wins} wins | ${sums.losses} losses | ${sums.pushes} pushes` },
        { label: 'Filtered units', value: units(sums.units), tone: sums.units > 0 ? 'metric-good' : sums.units < 0 ? 'metric-bad' : '', note: `Only for the visible range | ROI ${pct(sums.roi)}` },
        { label: 'Full 2026 cumulative', value: units(latest?.cumulative_units), tone: Number(latest?.cumulative_units || 0) > 0 ? 'metric-good' : Number(latest?.cumulative_units || 0) < 0 ? 'metric-bad' : '', note: `Separate season line through ${resultsThrough}` }
      ].map(card).join('');
      dailyBody.innerHTML = filtered.length ? filtered.map((row) => `<tr><td>${esc(row.board_date)}</td><td>${row.bets}</td><td>${row.wins}</td><td>${row.losses}</td><td>${row.pushes}</td><td>${pct(row.win_rate)}</td><td>${units(row.units)}</td><td>${pct(row.roi)}</td><td>${units(row.cumulative_units)}</td></tr>`).join('') : '<tr><td colspan="9" class="subtle">No 2026 daily rows are available for this filter.</td></tr>';
    }

    function drawMonthly() {
      const activeOnly = monthlyFilter?.value !== 'all_thresholds';
      const order = activeOnly ? [[threshold, `${primaryLabel} (${threshold})`]] : [[threshold, `${primaryLabel} (${threshold})`], ['top5', 'Top 5 baseline'], ['edge_gte_0_01', 'Edge >= 0.01'], ['edge_gte_0_02', 'Edge >= 0.02'], ['edge_gte_0_04', 'Edge >= 0.04']];
      monthlyBody.innerHTML = order.flatMap(([key, label]) => (monthly.policies?.[key] || []).map((row) => `<tr><td>${esc(row.month)}</td><td>${esc(label)}</td><td>${row.bets}</td><td>${row.wins}</td><td>${row.losses}</td><td>${row.pushes ?? '--'}</td><td>${pct(row.win_pct)}</td><td>${units(row.units)}</td><td>${pct(row.roi)}</td><td>${units(row.cumulative_units)}</td></tr>`)).join('');
    }

    if (presets) {
      presets.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-range]');
        if (!button) return;
        const range = rangeDates(rows, button.dataset.range);
        start.value = range.start;
        end.value = range.end;
        presets.querySelectorAll('button').forEach((node) => node.classList.toggle('is-active', node === button));
        drawDaily();
      });
      presets.querySelector('button[data-range="season"]')?.classList.add('is-active');
    }
    start.addEventListener('change', () => { presets?.querySelectorAll('button').forEach((n) => n.classList.remove('is-active')); drawDaily(); });
    end.addEventListener('change', () => { presets?.querySelectorAll('button').forEach((n) => n.classList.remove('is-active')); drawDaily(); });
    monthlyFilter?.addEventListener('change', drawMonthly);

    comp.innerHTML = [
      { label: `${primaryLabel} 2026`, value: units(reporting?.active_policy_shadow_summary?.units), note: `${reporting?.active_policy_shadow_summary?.bets || 0} bets | ${pct(reporting?.active_policy_shadow_summary?.roi)}` },
      { label: `${primaryLabel} historical`, value: units(reporting?.active_policy_historical_summary?.units), note: `2022-2025 ROI ${pct(reporting?.active_policy_historical_summary?.roi)}` },
      { label: 'Threshold contract', value: threshold, note: 'Public ranker selection rule' },
      ...((comparison.comparators || []).slice(0, 2).map((entry) => ({ label: entry.label, value: units(entry.shadow_summary?.units), note: `2026 ROI ${pct(entry.shadow_summary?.roi)}` })))
    ].map(card).join('');
    context.innerHTML = [['market_family', 'Market mix'], ['market_side', 'Side mix'], ['price_bucket', 'Price mix'], ['edge_bucket', 'Edge mix']].map(([key, label]) => `<article class="context-card"><strong>${esc(label)}</strong>${(reporting.context_breakdowns?.[key] || []).slice(0, 6).map((row) => `<div class="meta-line">${esc(row.bucket)} | ${row.bets} bets | ${units(row.units)} | ${pct(row.roi)}</div>`).join('')}</article>`).join('');

    drawDaily();
    drawMonthly();

    const historyRows = Array.isArray(pickHistory?.rows) ? pickHistory.rows.slice() : [];
    const hStart = $('#history-start-date');
    const hEnd = $('#history-end-date');
    const hPresets = $('#history-range-presets');
    const hConfidence = $('#history-confidence-filter');
    const hMarket = $('#history-market-filter');
    const hSummary = $('#history-summary-grid');
    const hGrid = $('#pick-history-grid');
    const hGap = $('#pick-history-gap');
    if (!historyRows.length || !hStart || !hEnd || !hSummary || !hGrid || !hGap) return;

    const historyRange = rangeDates(historyRows, 'season');
    hStart.min = historyRows[0].board_date; hStart.max = historyRows[historyRows.length - 1].board_date; hStart.value = historyRange.start;
    hEnd.min = historyRows[0].board_date; hEnd.max = historyRows[historyRows.length - 1].board_date; hEnd.value = historyRange.end;

    function drawHistory() {
      const filtered = historyRows.filter((row) => (!hStart.value || row.board_date >= hStart.value) && (!hEnd.value || row.board_date <= hEnd.value) && (!hConfidence || hConfidence.value === 'all' || row.confidence_band === hConfidence.value) && (!hMarket || hMarket.value === 'all' || row.market_type === hMarket.value));
      const avgEdge = filtered.length ? filtered.reduce((sum, row) => sum + Number(row.edge || 0), 0) / filtered.length : null;
      const avgUnits = filtered.length ? filtered.reduce((sum, row) => sum + Number(row.suggested_units || 0), 0) / filtered.length : null;
      hSummary.innerHTML = [
        { label: 'Picks shown', value: String(filtered.length), note: `${hStart.value || 'start'} through ${hEnd.value || 'end'}` },
        { label: 'Average edge', value: pctEdge(avgEdge), note: 'Mean model-vs-market edge inside the visible picks.' },
        { label: 'Average units', value: fixed(avgUnits, 2), note: 'Recommended size from the pick artifact.' }
      ].map(card).join('');
      hGrid.innerHTML = filtered.length ? filtered.slice().sort((a, b) => String(b.board_date).localeCompare(String(a.board_date)) || Number(b.final_score || 0) - Number(a.final_score || 0)).map(historyCard).join('') : '<div class="empty-state">No 2026 pick-history rows match the current filters.</div>';
      hGap.innerHTML = '<h3>Next artifact unlock</h3><p><strong>mlb_ai_leans_history_view_v1.json</strong> should power the next step in this explorer: actual matchup labels, settled result status, result units, and cumulative-after-pick history. That would let the page connect each pick directly to what happened, instead of stopping at pick inspection and explanation.</p><div class="meta-line">Required fields: board_date, canonical_game_id, matchup, market_type, side, line_value, price_american, confidence_band, suggested_units, result_status, result_units, cumulative_units_after_pick, edge.</div>';
    }

    if (hPresets) {
      hPresets.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-range]');
        if (!button) return;
        const range = rangeDates(historyRows, button.dataset.range);
        hStart.value = range.start;
        hEnd.value = range.end;
        hPresets.querySelectorAll('button').forEach((node) => node.classList.toggle('is-active', node === button));
        drawHistory();
      });
      hPresets.querySelector('button[data-range="season"]')?.classList.add('is-active');
    }
    hStart.addEventListener('change', () => { hPresets?.querySelectorAll('button').forEach((n) => n.classList.remove('is-active')); drawHistory(); });
    hEnd.addEventListener('change', () => { hPresets?.querySelectorAll('button').forEach((n) => n.classList.remove('is-active')); drawHistory(); });
    hConfidence?.addEventListener('change', drawHistory);
    hMarket?.addEventListener('change', drawHistory);
    drawHistory();
  }

  function renderOperations(status, op) {
    const primaryLabel = op?.site_system_contract?.primary_system?.label || status?.site_system_contract?.primary_system?.label || status?.active_engine?.engine_family || 'Primary system';
    const threshold = op.summary?.ranker_shadow_selection_threshold || op.boards?.ranker_shadow_threshold || status?.site_system_contract?.primary_system?.threshold || 'edge_gte_0_03';
    const heroMeta = $('#operations-hero-meta');
    if (heroMeta) heroMeta.innerHTML = pills([primaryLabel, `Threshold ${threshold}`, `Run ${op.run?.overall_status || 'unknown'}`, `Operating ${op.boards?.operating_date || 'unknown'}`, `Board ${op.boards?.active_board_date || 'unknown'}`, op.trust?.trusted_for_site_shadow ? 'Site trusted' : 'Site blocked']);
    const hero = $('#operations-hero-grid');
    if (hero) hero.innerHTML = [
      { label: 'System state', value: String(op.state || 'unknown').toUpperCase(), note: `Loop status ${op.run?.overall_status || 'unknown'}` },
      { label: 'Primary surface', value: primaryLabel, note: 'Current live public site surface' },
      { label: 'Last completed run', value: dt(op.summary?.last_run_finished_at), note: `Started ${dt(op.summary?.last_run_started_at)}` },
      { label: 'Publish state', value: op.publish?.public_site_publish?.status || 'unknown', note: `Published ${dt(op.summary?.latest_published_at)}` },
      { label: 'Selection threshold', value: threshold, note: 'Public ranker contract' }
    ].map(card).join('');

    const validation = $('#operations-validation-grid');
    if (validation) validation.innerHTML = [
      { label: 'Prepublish validation', value: op.validation?.prepublish?.status || 'unknown', note: dt(op.validation?.prepublish?.updated_at) },
      { label: 'Final validation', value: op.validation?.final?.status || 'unknown', note: op.validation?.final?.trusted_for_modeling ? 'Trusted for modeling' : 'Not trusted for modeling' },
      { label: 'Site board trust', value: op.validation?.site_shadow?.status || 'unknown', note: op.validation?.site_shadow?.trusted_for_site_shadow ? 'Trusted for site surface' : 'Blocked' },
      { label: 'Latest graded date', value: op.summary?.latest_graded_date || 'unknown', note: 'Canonical ranker grading frontier' }
    ].map(card).join('');

    const publish = $('#operations-publish-grid');
    if (publish) publish.innerHTML = [
      { label: 'Viewer export', value: op.publish?.viewer_publish?.status || 'unknown', note: dt(op.publish?.viewer_publish?.updated_at) },
      { label: 'Public site publish', value: op.publish?.public_site_publish?.status || 'unknown', note: dt(op.publish?.public_site_publish?.updated_at) },
      { label: 'Status finalize publish', value: op.publish?.operational_status_finalize_publish?.status || 'unknown', note: dt(op.publish?.operational_status_finalize_publish?.updated_at) },
      { label: 'Ranker threshold', value: threshold, note: 'Public site threshold contract' },
      { label: 'Overlap guard', value: op.hourly_automation?.overlap_guard || 'unknown', note: op.hourly_automation?.safe_to_run_unattended ? 'Safe for unattended hourly scheduling' : 'Lock currently active' }
    ].map(card).join('');

    const board = $('#operations-board-grid');
    if (board) board.innerHTML = [
      { label: 'Operating date', value: op.boards?.operating_date || 'unknown', note: 'Current run date' },
      { label: 'Active board', value: op.boards?.active_board_date || 'unknown', note: `${primaryLabel} board currently trusted for the site` },
      { label: 'Latest valid board', value: op.boards?.latest_valid_mlb_ai_board_date || 'unknown', note: 'Latest date the MLB AI board considers valid' },
      { label: 'Latest canonical betting date', value: op.boards?.latest_canonical_board_date || 'unknown', note: 'Latest date available in canonical betting rows' }
    ].map(card).join('');

    const metrics = $('#operations-metrics-grid');
    if (metrics) metrics.innerHTML = [
      { label: 'Action coverage', value: pct(op.key_metrics?.action_coverage_pct), note: 'Mapped action features on the active window' },
      { label: 'Weather coverage', value: pct(op.key_metrics?.weather_coverage_pct), note: 'Weather coverage on the active window' },
      { label: 'Baseball coverage', value: pct(op.key_metrics?.baseball_coverage_pct), note: 'Baseball context coverage on the active window' },
      { label: 'Resolved mapping', value: pct(op.key_metrics?.mapping_resolved_pct), note: `${op.key_metrics?.unmapped_rows ?? 'unknown'} unmapped rows` }
    ].map(card).join('');

    const freshness = $('#operations-freshness-grid');
    if (freshness) freshness.innerHTML = (op.dependency_freshness?.layers || []).map((layer) => `<article class="context-card"><strong>${esc(layer.name)}</strong><div class="meta-line">State: ${esc(layer.state)}</div><div class="meta-line">Freshness: ${esc(layer.freshness_status)}</div><div class="meta-line">Coverage: ${esc(layer.target_date_coverage || 'unknown')}</div><div class="meta-line">Updated: ${esc(layer.latest_freshness_value || 'unknown')}</div><div class="meta-line">${esc((layer.notes || []).join(' '))}</div></article>`).join('');

    const changed = $('#operations-change-grid');
    if (changed) {
      const objects = Array.isArray(op.loop_objects) ? op.loop_objects.filter((item) => item.object_type !== 'stage') : [];
      const changedObjects = objects.filter((item) => item.changed_flag);
      const staleObjects = objects.filter((item) => String(item.freshness_status).toLowerCase() === 'red');
      changed.innerHTML = [
        { label: 'Changed objects', value: String(changedObjects.length), note: `${objects.length} tracked objects in contract` },
        { label: 'Stale objects', value: String(staleObjects.length), note: staleObjects.slice(0, 3).map((item) => item.object_name).join(', ') || 'None' },
        { label: 'Latest graded date', value: op.summary?.latest_graded_date || 'unknown', note: 'Canonical result attach frontier' },
        { label: 'Latest published', value: dt(op.summary?.latest_published_at), note: op.publish?.public_site_publish?.status || 'unknown' }
      ].map(card).join('');
    }

    const issues = $('#operations-issues');
    if (issues) issues.innerHTML = [['Failures', op.blocked?.failures || []], ['Warnings', op.blocked?.warnings || []], ['Info', op.blocked?.info || []]].map(([label, rows]) => `<article class="stack-card"><strong>${esc(label)}</strong>${rows.length ? rows.map((entry) => `<div class="meta-line">${esc(entry.code)}${entry.source ? ` | ${esc(entry.source)}` : ''}</div>`).join('') : '<div class="subtle">None</div>'}</article>`).join('');

    const engine = $('#operations-engine-grid');
    if (engine) engine.innerHTML = [
      { label: 'Primary surface', value: primaryLabel, note: `Engine ${status.active_engine?.engine_family || 'unknown'} ${status.active_engine?.engine_version || 'unknown'}` },
      { label: 'Active policy', value: status.active_engine?.active_policy || 'unknown', note: status.active_engine?.engine_state || 'unknown' },
      { label: 'Selection threshold', value: threshold, note: 'Public ranker contract' },
      { label: 'Generated', value: dt(status.generated_at), note: `Requested board ${status.requested_board_date || 'unknown'}` },
      { label: 'Live-betting trust', value: status.active_engine?.trusted_for_live_betting ? 'Trusted' : 'Not live', note: 'Technical metadata only' }
    ].map(card).join('');

    const objectBody = $('#operations-object-table tbody');
    if (objectBody) {
      const rows = Array.isArray(op.loop_objects) ? op.loop_objects.filter((item) => item.object_type !== 'stage') : [];
      objectBody.innerHTML = rows.length
        ? rows.sort((a, b) => String(a.domain).localeCompare(String(b.domain)) || String(a.object_name).localeCompare(String(b.object_name)))
            .map((row) => `<tr>
              <td>${esc(row.object_name)}</td>
              <td>${esc(row.object_type)}</td>
              <td>${esc(row.domain)}</td>
              <td>${esc(dt(row.last_refresh_timestamp))}</td>
              <td>${esc(dt(row.latest_generated_at_previous))}</td>
              <td>${esc(row.latest_game_date_or_board_date || '--')}</td>
              <td>${esc(row.latest_game_date_previous || '--')}</td>
              <td>${esc(row.row_count_current ?? '--')}</td>
              <td>${esc(row.row_count_previous ?? '--')}</td>
              <td>${esc(row.delta_rows ?? '--')}</td>
              <td>${changePill(row.changed_flag)}</td>
              <td>${freshnessPill(row.freshness_status)}</td>
            </tr>`).join('')
        : '<tr><td colspan="11" class="subtle">No loop object records are available.</td></tr>';
    }

    const stageBody = $('#operations-stage-table tbody');
    if (stageBody) {
      const rows = Array.isArray(op.loop_objects) ? op.loop_objects.filter((item) => item.object_type === 'stage') : [];
      stageBody.innerHTML = rows.length
        ? rows.sort((a, b) => String(a.last_refresh_timestamp || '').localeCompare(String(b.last_refresh_timestamp || '')))
            .map((row) => `<tr>
              <td>${esc(row.object_name)}</td>
              <td>${esc(row.domain)}</td>
              <td>${freshnessPill(row.status_value === 'completed' || row.status_value === 'warning' ? 'green' : 'red')} <span class="subtle">${esc(row.status_value || 'unknown')}</span></td>
              <td>${esc(dt(row.last_refresh_timestamp))}</td>
              <td>${esc(row.status_message || '--')}</td>
            </tr>`).join('')
        : '<tr><td colspan="5" class="subtle">No stage records are available.</td></tr>';
    }
  }

  try {
    if (page === 'redirect') return;
    const op = await json('mlb_operational_status_v1.json');
    renderStatusStrip(op);
    const status = await json('mlb_ai_active_engine_status_v1.json');
    if (page === 'leans') return renderLeans(status, await json('mlb_ai_daily_leans_v1.json'), op, await json('mlb_ai_daily_performance_2026_v1.json'));
    if (page === 'performance') return renderPerformance(status, await json('mlb_ai_reporting_v1.json'), await json('mlb_ai_reporting_monthly_v1.json'), await json('mlb_ai_policy_comparison_v1.json'), await json('mlb_ai_daily_performance_2026_v1.json'), await json('mlb_ai_pick_explanations_2026_v1.json'), op);
    if (page === 'operations') return renderOperations(status, op);
  } catch (error) {
    const shell = $('.page-shell') || document.body;
    const panel = document.createElement('section');
    panel.className = 'page-section';
    panel.innerHTML = `<div class="empty-state">Failed to load the MLB AI site artifacts: ${esc(error.message)}</div>`;
    shell.appendChild(panel);
  }
}());
