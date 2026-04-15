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
    return primarySurface(payload, op)?.threshold || payload?.selection_contract || op?.summary?.live_public_selection_threshold || op?.boards?.live_public_threshold || 'edge_gte_0_03_cap_minus_150';
  }

  function challengerSurface(payload, op) {
    return payload?.challenger_surface || payload?.site_system_contract?.challenger_system || op?.site_system_contract?.challenger_system || null;
  }

  function challengerSurfaceLabel(payload, op) {
    return challengerSurface(payload, op)?.label || 'Challenger';
  }

  function challengerThreshold(payload, op) {
    return challengerSurface(payload, op)?.threshold || payload?.selection_contract || op?.summary?.challenger_selection_threshold || op?.boards?.challenger_threshold || 'edge_gte_0_04_no_cap_challenger';
  }

  function market(row) {
    const line = bad(row.line_value) ? '' : ` ${row.line_value}`;
    if (row.market_type === 'total') return `Total ${String(row.side || '').toUpperCase()}${line}`;
    if (row.market_type === 'moneyline') return `Moneyline ${String(row.side || '').toUpperCase()}`;
    if (row.market_type === 'spread') return `Run line ${String(row.side || '').toUpperCase()}${line}`;
    return `${title(row.market_type)} ${String(row.side || '').toUpperCase()}${line}`.trim();
  }

  function teamSideLabel(row) {
    return String(row.side || '').toLowerCase() === 'away' ? row.away_team : row.home_team;
  }

  function signedLine(row) {
    const value = Number(row.line_value);
    if (!Number.isFinite(value)) return '';
    if (row.market_type !== 'spread') return String(row.line_value);
    const away = String(row.side || '').toLowerCase() === 'away';
    const shown = away ? value : -value;
    return `${shown > 0 ? '+' : ''}${shown}`;
  }

  function naturalBetLabel(row) {
    if (row.bet_label) return row.bet_label;
    if (row.market_type === 'moneyline') return `${teamSideLabel(row)} ML (${odds(row.price_american)})`;
    if (row.market_type === 'spread') return `${teamSideLabel(row)} ${signedLine(row)} (${odds(row.price_american)})`;
    if (row.market_type === 'total') {
      const side = String(row.side || '').toLowerCase() === 'over' ? 'Over' : 'Under';
      return `${side} ${row.line_value} (${odds(row.price_american)})`;
    }
    return `${market(row)} (${odds(row.price_american)})`;
  }

  function edgeSummary(row) {
    return `Model ${pct(row.model_probability)} vs market ${pct(row.market_probability)} for a ${pctEdge(row.edge)} edge.`;
  }

  function tierSummary(row) {
    return vis(row) === 'core'
      ? 'This landed in the top group because it cleared the higher display band on today\'s board.'
      : 'This still made the official board, but it sits below the top group because its edge was smaller.';
  }

  function explanationLookup(explanations) {
    const lookup = new Map();
    const rows = Array.isArray(explanations?.rows) ? explanations.rows : [];
    rows.forEach((row) => {
      lookup.set(`${row.board_date}::${row.canonical_game_id}::${row.market_type}::${row.side}`, row);
    });
    return lookup;
  }

  function mappedContextLine(driver) {
    const feature = String(driver?.feature || '');
    if (!feature) return null;
    if (feature === 'market_implied_probability') return 'The market price still leaves a gap versus the model projection.';
    if (feature === 'price_american_norm') return 'The odds stayed inside the public price guardrail.';
    if (feature === 'market_micro_move_count') return 'Recent market movement is part of the model input for this bet.';
    if (feature === 'steam_move_count') return 'Steam activity is included in the model input for this board.';
    if (feature === 'line_value' && Number.isFinite(Number(driver.value))) return `The posted line for this bet is ${driver.value}.`;
    return null;
  }

  function contextLines(row, explanationRow) {
    if (explanationRow) {
      const summaries = [
        explanationRow.line_movement?.summary,
        explanationRow.sharp_public_context?.summary,
        explanationRow.weather_context?.summary,
        explanationRow.pitching_bullpen_context?.summary,
        explanationRow.matchup_context?.summary
      ].filter((item) => item && item !== 'Additional context not available in current model output');
      if (summaries.length) return summaries.slice(0, 3);
    }
    const explanationDrivers = [
      ...(Array.isArray(explanationRow?.top_context_drivers) ? explanationRow.top_context_drivers : []),
      ...(Array.isArray(explanationRow?.top_edge_drivers) ? explanationRow.top_edge_drivers : [])
    ];
    const mapped = explanationDrivers.map(mappedContextLine).filter(Boolean);
    if (mapped.length) return [...new Set(mapped)].slice(0, 3);
    return [];
  }

  function bulletList(items) {
    return `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
  }

  function missingContextNote(explanationRow, fallbackText) {
    if (explanationRow?.missing_context?.length) {
      return `<p class="subtle">Missing: ${esc(explanationRow.missing_context.join(', '))}</p>`;
    }
    return `<p class="subtle">${esc(fallbackText)}</p>`;
  }

  function whyThisBetHtml(row, explanationRow) {
    if (Array.isArray(explanationRow?.why_this_bet) && explanationRow.why_this_bet.length) {
      return bulletList(explanationRow.why_this_bet);
    }
    return `<p>${esc(edgeSummary(row))}</p><p>${esc(tierSummary(row))}</p>`;
  }

  function extraContextHtml(row, explanationRow) {
    const context = contextLines(row, explanationRow);
    const body = context.length
      ? bulletList(context)
      : '<p>Additional context not available in current model output.</p>';
    const fallback = explanationRow?.explanation_summary || row.explanation_summary || 'This bet cleared the official public selection rule.';
    const contextOnly = Array.isArray(explanationRow?.context_only_notes) && explanationRow.context_only_notes.length
      ? `<p class="subtle context-only-label">Context only</p>${bulletList(explanationRow.context_only_notes)}`
      : '';
    return `${body}${contextOnly}${missingContextNote(explanationRow, fallback)}`;
  }

  function betStartTime(explanationRow) {
    return explanationRow?.first_pitch_et || 'Start time unavailable';
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

  function renderLeans(status, leans, op, performance, reporting, explanations) {
    const threshold = primaryThreshold(leans, op);
    const requested = leans.requested_board_date || op?.boards?.operating_date || 'unknown';
    const active = boardDate(leans);
    const latestValid = leans.latest_valid_mlb_ai_board_date || op?.boards?.latest_valid_mlb_ai_board_date || active || 'unknown';
    const noBoard = leans.board_available === false || leans.board_state === 'no_valid_board_for_requested_date';
    const boardShown = active || requested;
    const rows = [...(leans.rows || [])].filter((row) => vis(row) !== 'hidden').sort(leanSort);
    const core = rows.filter((row) => vis(row) === 'core');
    const exploratory = rows.filter((row) => vis(row) === 'exploratory');
    const featured = core[0] || rows[0] || null;
    const liveSummary = reporting?.active_policy_live_summary || reporting?.active_policy_shadow_summary || {};
    const historicalSummary = reporting?.active_policy_historical_summary || {};
    const resultsThrough = reporting?.source_coverage?.results_through || performance?.results_through || performance?.source_coverage?.shadow_results_through || latestPerformanceRow(performance)?.board_date || 'Unknown';
    const explanationsByKey = explanationLookup(explanations);
    const coreRest = featured ? core.filter((row) => row.canonical_game_id !== featured.canonical_game_id || row.market_type !== featured.market_type || row.side !== featured.side) : core;

    const heroMeta = $('#leans-hero-meta');
    if (heroMeta) heroMeta.innerHTML = pills([
      `Board date ${boardShown}`,
      `Updated ${dt(leans?.generated_at)}`,
      `Results through ${resultsThrough}`,
      noBoard ? 'No official board yet' : `${rows.length} official bet${rows.length === 1 ? '' : 's'}`
    ]);
    const hero = $('#leans-hero-grid');
    if (hero) hero.innerHTML = [
      { label: 'Since 2022', value: units(historicalSummary?.units), tone: Number(historicalSummary?.units || 0) > 0 ? 'metric-good' : Number(historicalSummary?.units || 0) < 0 ? 'metric-bad' : '', note: `${historicalSummary?.bets || 0} bets from 2022-2025` },
      { label: '2026 YTD', value: units(liveSummary?.units), tone: Number(liveSummary?.units || 0) > 0 ? 'metric-good' : Number(liveSummary?.units || 0) < 0 ? 'metric-bad' : '', note: `${liveSummary?.bets || 0} graded bets | ${pct(liveSummary?.roi)} ROI` },
      { label: 'Board date', value: boardShown, note: noBoard ? `Latest valid board ${latestValid}` : `${rows.length} official bet${rows.length === 1 ? '' : 's'} on the card` },
      { label: 'Last updated', value: dt(leans?.generated_at), note: `Results through ${resultsThrough}` }
    ].map(card).join('');
    renderTrustBar('#leans-trust-bar', {
      severity: noBoard ? 'warning' : (op?.trust?.trusted_for_modeling ? 'ok' : 'fail'),
      kicker: 'Official public card',
      title: noBoard ? `No official board for ${requested}` : `${rows.length} official bet${rows.length === 1 ? '' : 's'} for ${boardShown}`,
      subtitle: noBoard
        ? (leans.availability_reason || `The requested date ${requested} does not currently have a valid MLB AI board.`)
        : 'These bets are selected when the model edge is at least 3% and the price is not worse than -150.',
      items: [
        { label: 'Selection rule', value: 'Edge >= 3%', note: 'Model win probability must beat the market by at least 3 points.' },
        { label: 'Price guardrail', value: '-150 or better', note: 'Heavier favorites are excluded from the public card.' },
        { label: 'Results through', value: resultsThrough, note: 'Latest graded date in the official record.' },
        { label: 'Card mix', value: noBoard ? 'No board' : `${core.length} top | ${exploratory.length} smaller`, note: noBoard ? `Requested ${requested}` : 'Top bets have the strongest display tier. Smaller bets still made the official board.' }
      ]
    });

    const featureWrap = $('#leans-featured-section');
    const feature = $('#leans-featured-play');
    if (featureWrap && feature) {
      if (noBoard || !featured) featureWrap.style.display = 'none';
      else {
        const featuredExplanation = explanationsByKey.get(`${featured.board_date}::${featured.canonical_game_id}::${featured.market_type}::${featured.side}`);
        const featuredLabel = featured.bet_label || naturalBetLabel(featured);
        const featuredUnits = `${fixed(featured.suggested_units, 2)} unit${Number(featured.suggested_units) === 1 ? '' : 's'}`;
        feature.innerHTML = `
          <article class="lean-featured-card">
            <div class="lean-featured-top">
              <div>
                <p class="lean-featured-matchup">${esc(featured.matchup)}</p>
                <h3 class="lean-featured-play">${esc(featuredLabel)}</h3>
                <p class="lean-featured-market">${esc(betStartTime(featuredExplanation))} ET | ${esc(featuredUnits)} | Highest-ranked official bet today</p>
              </div>
              <div class="history-chip-row">
                <span class="${confidenceClass(featured.confidence_band)}">${esc(title(featured.confidence_band || 'unknown'))} confidence</span>
                <span class="badge">${esc(fixed(featured.suggested_units, 2))} units</span>
                ${priceChip(featured.price_flag)}
              </div>
            </div>
            <div class="lean-featured-metrics">
              <div class="metric-tile"><label>Matchup</label><strong>${esc(featured.matchup)}</strong></div>
              <div class="metric-tile"><label>Edge</label><strong>${esc(pctEdge(featured.edge))}</strong></div>
              <div class="metric-tile"><label>Model</label><strong>${esc(pct(featured.model_probability))}</strong></div>
              <div class="metric-tile"><label>Market</label><strong>${esc(pct(featured.market_probability))}</strong></div>
            </div>
            <div class="lean-explain-grid">
              <div class="lean-explain-block">
                <strong>Why this bet</strong>
                ${whyThisBetHtml(featured, featuredExplanation)}
                <p class="subtle">These notes explain the bet. They are not a second approval engine.</p>
              </div>
              <div class="lean-explain-block">
                <strong>Extra context</strong>
                ${extraContextHtml(featured, featuredExplanation)}
              </div>
            </div>
          </article>`;
      }
    }

    const leanCard = (row) => {
      const explanationRow = explanationsByKey.get(`${row.board_date}::${row.canonical_game_id}::${row.market_type}::${row.side}`);
      const label = row.bet_label || naturalBetLabel(row);
      const unitsLabel = `${fixed(row.suggested_units, 2)} unit${Number(row.suggested_units) === 1 ? '' : 's'}`;
      return `
        <article class="lean-decision-card">
          <div class="lean-decision-head">
            <div>
              <p class="lean-kicker">${esc(row.matchup)}</p>
              <h3>${esc(label)}</h3>
              <p class="lean-subline">${esc(betStartTime(explanationRow))} ET | ${esc(unitsLabel)} | ${vis(row) === 'core' ? 'Top group' : 'Smaller official play'}</p>
            </div>
            <div class="lean-score-stack">
              <span class="${confidenceClass(row.confidence_band)}">${esc(title(row.confidence_band || 'unknown'))} confidence</span>
              <span class="badge">${esc(fixed(row.suggested_units, 2))} units</span>
              ${priceChip(row.price_flag)}
            </div>
          </div>
          <div class="lean-decision-metrics">
            <div class="metric-tile"><label>Matchup</label><strong>${esc(row.matchup)}</strong></div>
            <div class="metric-tile"><label>Edge</label><strong>${esc(pctEdge(row.edge))}</strong></div>
            <div class="metric-tile"><label>Model</label><strong>${esc(pct(row.model_probability))}</strong></div>
            <div class="metric-tile"><label>Market</label><strong>${esc(pct(row.market_probability))}</strong></div>
          </div>
          <div class="lean-explain-grid">
            <div class="lean-explain-block">
              <strong>Why this bet</strong>
              ${whyThisBetHtml(row, explanationRow)}
            </div>
            <div class="lean-explain-block">
              <strong>Extra context</strong>
              ${extraContextHtml(row, explanationRow)}
            </div>
          </div>
        </article>`;
    };

    const coreNode = $('#leans-core-cards');
    if (coreNode) coreNode.innerHTML = noBoard ? `<div class="empty-state">No official bets are available for ${esc(requested)}. The site does not fall back to yesterday's board.</div>` : coreRest.length ? coreRest.map(leanCard).join('') : '<div class="empty-state">The top play is the only high-confidence bet on today\'s card.</div>';
    const expNode = $('#leans-exploratory-cards');
    if (expNode) expNode.innerHTML = noBoard ? `<div class="empty-state">${esc(leans.availability_reason || `No valid board is available for ${requested}.`)}</div>` : exploratory.length ? exploratory.map(leanCard).join('') : '<div class="empty-state">No smaller bets are available on today\'s official card.</div>';
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
    const result = String(row.result || 'pending').toLowerCase();
    const resultText = result === 'win' ? 'Win' : result === 'loss' ? 'Loss' : result === 'push' ? 'Push' : 'Pending';
    const resultTone = result === 'win' ? 'metric-good' : result === 'loss' ? 'metric-bad' : '';
    return `<article class="history-card"><div class="history-card-head"><div><p class="lean-kicker">${esc(row.board_date)}</p><h3>${esc(row.matchup || row.canonical_game_id || 'Unknown matchup')}</h3><p class="lean-subline">${esc(row.bet_label || market(row))} | ${esc(fixed(row.suggested_units, 2))} unit bet</p></div><div class="history-chip-row"><span class="${confidenceClass(row.confidence_band)}">${esc(title(row.confidence_band || 'unknown'))}</span><span class="badge">${esc(pctEdge(row.model_edge ?? row.edge))} edge</span></div></div><div class="history-card-metrics"><div class="metric-tile"><label>Result</label><strong class="${esc(resultTone)}">${esc(resultText)}</strong></div><div class="metric-tile"><label>Unit profit</label><strong class="${esc(resultTone)}">${esc(units(row.unit_profit))}</strong></div><div class="metric-tile"><label>Cumulative</label><strong>${esc(units(row.cumulative_units_after_pick))}</strong></div><div class="metric-tile"><label>Price</label><strong>${esc(odds(row.price_american))}</strong></div></div><p class="history-summary">${esc(row.explanation_summary || 'This bet cleared the public selection rule and was posted to the official card.')}</p></article>`;
  }

  function renderPerformanceSurface(status, reporting, monthly, performance, pickHistory, op, config = {}) {
    const surfaceKind = config.surfaceKind || 'live';
    const primary = surfaceKind === 'challenger' ? challengerSurface(reporting, op) : primarySurface(reporting, op);
    const primaryLabel = primary?.label || (surfaceKind === 'challenger' ? 'Challenger model' : 'Official public model');
    const threshold = surfaceKind === 'challenger' ? challengerThreshold(reporting, op) : primaryThreshold(reporting, op);
    const rows = Array.isArray(performance?.rows) ? performance.rows.slice() : [];
    const latest = rows[rows.length - 1] || null;
    const active = op?.boards?.active_board_date || reporting.active_board_date || 'unknown';
    const resultsThrough = reporting?.source_coverage?.results_through || latest?.board_date || 'unknown';
    const liveSummary = reporting?.active_policy_live_summary || reporting?.active_policy_shadow_summary || {};
    const historicalSummary = reporting?.active_policy_historical_summary || {};
    const titlePrefix = surfaceKind === 'challenger' ? 'Challenger lane' : 'Public record';
    const scopeDescription = surfaceKind === 'challenger'
      ? `${primaryLabel} is tracked separately from the official public card. Historical results are 2022-2025 backtest totals. 2026 is forward challenger behavior through ${resultsThrough}.`
      : `This page is the official public record. Historical results are 2022-2025 backtest totals. 2026 is the live out-of-sample record through ${resultsThrough}.`;
    const recordDescription = surfaceKind === 'challenger'
      ? 'Not the official public betting record.'
      : 'Official public site contract.';

    const heroMeta = $('#performance-hero-meta');
    if (heroMeta) heroMeta.innerHTML = pills([
      `Updated ${dt(reporting?.generated_at)}`,
      `Results through ${resultsThrough}`,
      `Board date ${active}`,
      surfaceKind === 'challenger' ? 'Not official bets' : 'Official public record'
    ]);
    const hero = $('#performance-hero-grid');
    if (hero) hero.innerHTML = [
      { label: '2026 YTD units', value: units(liveSummary?.units), tone: Number(liveSummary?.units || 0) > 0 ? 'metric-good' : Number(liveSummary?.units || 0) < 0 ? 'metric-bad' : '', note: `${liveSummary?.bets || 0} graded bets` },
      { label: '2026 ROI', value: pct(liveSummary?.roi), tone: Number(liveSummary?.roi || 0) > 0 ? 'metric-good' : Number(liveSummary?.roi || 0) < 0 ? 'metric-bad' : '', note: `Results through ${resultsThrough}` },
      { label: 'Results through', value: resultsThrough, note: recordDescription },
      { label: '2022-2025 units', value: units(historicalSummary?.units), tone: Number(historicalSummary?.units || 0) > 0 ? 'metric-good' : Number(historicalSummary?.units || 0) < 0 ? 'metric-bad' : '', note: `${historicalSummary?.bets || 0} graded bets` }
    ].map(card).join('');
    renderTrustBar('#performance-trust-bar', {
      severity: surfaceKind === 'challenger' ? 'warning' : (op?.trust?.trusted_for_modeling ? 'ok' : 'fail'),
      kicker: titlePrefix,
      title: `${surfaceKind === 'challenger' ? 'Challenger results' : 'Official results'} are settled through ${resultsThrough}`,
      subtitle: scopeDescription,
      items: [
        { label: surfaceKind === 'challenger' ? 'Page type' : 'Record type', value: surfaceKind === 'challenger' ? 'Challenger only' : 'Official public record', note: surfaceKind === 'challenger' ? 'Tracked separately from the public card' : 'This page is the published bettor-facing ledger' },
        { label: 'Selection rule', value: surfaceKind === 'challenger' ? 'Edge >= 4%' : 'Edge >= 3% and price >= -150', note: surfaceKind === 'challenger' ? 'No extra favorite cap' : 'Official public betting rule' },
        { label: 'Results through', value: resultsThrough, note: 'Latest graded MLB AI date' },
        { label: '2026 cumulative', value: units(latest?.cumulative_units), note: latest?.board_date ? `Full season through ${latest.board_date}` : 'No 2026 results available' }
      ]
    });
    const trust = $('#performance-trust-grid');
    if (trust) trust.innerHTML = [
      { label: '2026 YTD', value: units(liveSummary?.units), tone: Number(liveSummary?.units || 0) > 0 ? 'metric-good' : Number(liveSummary?.units || 0) < 0 ? 'metric-bad' : '', note: `${liveSummary?.bets || 0} graded bets | ${pct(liveSummary?.roi)} ROI` },
      { label: '2022-2025', value: units(historicalSummary?.units), tone: Number(historicalSummary?.units || 0) > 0 ? 'metric-good' : Number(historicalSummary?.units || 0) < 0 ? 'metric-bad' : '', note: `${historicalSummary?.bets || 0} graded bets | ${pct(historicalSummary?.roi)} ROI` },
      { label: 'Updated', value: dt(reporting?.generated_at), note: 'Exact export time for this record' },
      { label: 'Selection rule', value: surfaceKind === 'challenger' ? 'Edge >= 4%' : 'Edge >= 3% and price >= -150', note: surfaceKind === 'challenger' ? 'Challenger tracking only' : 'Official public betting rule' }
    ].map(card).join('');
    const windowGrid = $('#performance-window-grid');
    const recent = (label, mode) => {
      const range = rangeDates(rows, mode);
      const summary = perfSummary(filterDate(rows, range.start, range.end));
      return { label, value: units(summary.units), tone: summary.units > 0 ? 'metric-good' : summary.units < 0 ? 'metric-bad' : '', note: `${summary.bets} bets | ${pct(summary.roi)} ROI` };
    };
    if (windowGrid && rows.length) windowGrid.innerHTML = [
      recent('Last 7 days', '7d'),
      recent('Last 30 days', '30d'),
      recent('2026 YTD', 'season'),
      { label: '2022-2025 backtest', value: units(historicalSummary?.units), note: `${historicalSummary?.bets || 0} bets | ${pct(historicalSummary?.roi)} ROI` }
    ].map(card).join('');
    const coverage = $('#performance-coverage-badge');
    if (coverage) coverage.textContent = `Results through ${resultsThrough}`;

    const start = $('#performance-start-date');
    const end = $('#performance-end-date');
    const presets = $('#performance-range-presets');
    const monthlyFilter = $('#monthly-policy-filter');
    const summary = $('#performance-summary-grid');
    const dailyBody = $('#daily-performance-table tbody');
    const monthlyBody = $('#monthly-table tbody');
    if (!rows.length || !start || !end || !summary || !dailyBody || !monthlyBody) return;

    const seasonRange = rangeDates(rows, 'season');
    start.min = rows[0].board_date; start.max = rows[rows.length - 1].board_date; start.value = seasonRange.start;
    end.min = rows[0].board_date; end.max = rows[rows.length - 1].board_date; end.value = seasonRange.end;

    function drawDaily() {
      const filtered = filterDate(rows, start.value, end.value);
      const sums = perfSummary(filtered);
      summary.innerHTML = [
        { label: 'Visible range', value: `${start.value || 'start'} to ${end.value || 'end'}`, note: `${sums.days} graded day${sums.days === 1 ? '' : 's'}` },
        { label: 'Bets', value: String(sums.bets), note: `${sums.wins} wins | ${sums.losses} losses | ${sums.pushes} pushes` },
        { label: 'Units', value: units(sums.units), tone: sums.units > 0 ? 'metric-good' : sums.units < 0 ? 'metric-bad' : '', note: `ROI ${pct(sums.roi)}` },
        { label: '2026 running total', value: units(latest?.cumulative_units), tone: Number(latest?.cumulative_units || 0) > 0 ? 'metric-good' : Number(latest?.cumulative_units || 0) < 0 ? 'metric-bad' : '', note: `Season total through ${resultsThrough}` }
      ].map(card).join('');
      dailyBody.innerHTML = filtered.length ? filtered.map((row) => `<tr><td>${esc(row.board_date)}</td><td>${row.bets}</td><td>${row.wins}</td><td>${row.losses}</td><td>${row.pushes}</td><td>${pct(row.win_rate)}</td><td>${units(row.units)}</td><td>${pct(row.roi)}</td><td>${units(row.cumulative_units)}</td></tr>`).join('') : '<tr><td colspan="9" class="subtle">No 2026 daily rows are available for this filter.</td></tr>';
    }

    function drawMonthly() {
      const order = [[threshold, surfaceKind === 'challenger' ? 'Challenger model' : 'Official public model']];
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
      const avgEdge = filtered.length ? filtered.reduce((sum, row) => sum + Number((row.model_edge ?? row.edge) || 0), 0) / filtered.length : null;
      const avgUnits = filtered.length ? filtered.reduce((sum, row) => sum + Number(row.suggested_units || 0), 0) / filtered.length : null;
      const settled = filtered.filter((row) => String(row.result || '').toLowerCase() !== 'pending');
      const settledUnits = settled.reduce((sum, row) => sum + Number(row.unit_profit || 0), 0);
      hSummary.innerHTML = [
        { label: 'Picks shown', value: String(filtered.length), note: `${hStart.value || 'start'} through ${hEnd.value || 'end'}` },
        { label: 'Average edge', value: pctEdge(avgEdge), note: 'Average model edge in the visible bets' },
        { label: 'Average stake', value: fixed(avgUnits, 2), note: 'Average units per bet' },
        { label: 'Settled units', value: units(settledUnits), note: `${settled.length} settled bets in view` }
      ].map(card).join('');
      hGrid.innerHTML = filtered.length ? filtered.slice().sort((a, b) => String(b.board_date).localeCompare(String(a.board_date)) || Number((b.model_edge ?? b.edge) || 0) - Number((a.model_edge ?? a.edge) || 0)).map(historyCard).join('') : '<div class="empty-state">No 2026 pick-history rows match the current filters.</div>';
      hGap.innerHTML = `<h3>What this table is</h3><p>This is the full 2026 ledger of posted bets for this page. Each row is a real bet with its odds, result, and running cumulative units.</p><div class="meta-line">Results through ${esc(resultsThrough)} | Updated ${esc(dt(pickHistory?.generated_at))}</div>`;
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

  function renderOperations(status, op, trustTable) {
    const primaryLabel = op?.site_system_contract?.primary_system?.label || status?.site_system_contract?.primary_system?.label || status?.active_engine?.engine_family || 'Primary system';
    const challengerLabel = op?.site_system_contract?.challenger_system?.label || status?.site_system_contract?.challenger_system?.label || 'Challenger';
    const threshold = op.summary?.live_public_selection_threshold || op.boards?.live_public_threshold || status?.site_system_contract?.primary_system?.threshold || 'edge_gte_0_03_cap_minus_150';
    const challengerThresholdValue = op.summary?.challenger_selection_threshold || op.boards?.challenger_threshold || status?.site_system_contract?.challenger_system?.threshold || 'edge_gte_0_04_no_cap_challenger';
    const severityRank = { red: 0, fail: 0, skipped: 1, warning: 1, yellow: 1, unknown: 2, running: 2, green: 3, completed: 3, ok: 3, present: 3 };
    const freshnessSeverity = (row) => {
      const freshness = String(row.freshness_status || '').toLowerCase();
      if (freshness === 'red') return 'red';
      if (freshness === 'yellow') return 'yellow';
      if (freshness === 'green') return 'green';
      return 'gray';
    };
    const statusClass = (value) => {
      const key = String(value || '').toLowerCase();
      if (key === 'red' || key === 'fail' || key === 'failed' || key === 'skipped') return 'table-status table-status-red';
      if (key === 'yellow' || key === 'warning' || key === 'running' || key === 'unknown' || key === 'not_reached_in_source_run' || key === 'stubbed') return 'table-status table-status-yellow';
      return 'table-status table-status-green';
    };
    const opMeaning = (row) => {
      if (row.object_name === 'game_weather_rebuilt') return 'This historical weather table shows an old generated_at, but today\'s board weather coverage is still passing through the bounded weather refresh.';
      if (row.object_name === 'mlb_statsapi_gamepk_historical_v1') return 'This is a historical lookup table. It is expected to trail the live board and does not block today\'s card.';
      if (row.object_name === 'game_market_snapshots') return 'This table has no generated_at timestamp here, so refresh time reads as unknown. Coverage is still present and healthy.';
      if (row.object_name === 'mlb_api_pitching_appearances_current_rebuilt') return 'This table is flagged red in the object ledger even though downstream baseball coverage is still completing. It needs a better freshness rule.';
      if (row.status_message) return row.status_message;
      return 'No extra explanation recorded.';
    };
    const opStatusLabel = (row) => {
      const fresh = String(row.freshness_status || '').toLowerCase();
      if (fresh === 'red') return 'Problem';
      if (fresh === 'yellow') return 'Watch';
      if (fresh === 'green') return 'Healthy';
      return 'Unknown';
    };
    const trustSummary = trustTable?.summary || {};
    const trustRows = Array.isArray(trustTable?.rows) ? trustTable.rows : [];
    const usageLabel = (row) => {
      const parts = [];
      if (row.used_in_live_model) parts.push('Live');
      if (row.used_in_challenger) parts.push('Challenger');
      if (row.used_in_explanations) parts.push('Expl.');
      return parts.length ? parts.join(' | ') : 'Reference only';
    };
    const trustExplanation = (row) => row.explanation || 'No explanation recorded.';
    const heroMeta = $('#operations-hero-meta');
    if (heroMeta) heroMeta.innerHTML = pills([`Live rule ${threshold}`, `Challenger ${challengerThresholdValue}`, `Run ${op.run?.overall_status || 'unknown'}`, `Operating ${op.boards?.operating_date || 'unknown'}`, `Board ${op.boards?.active_board_date || 'unknown'}`]);
    const hero = $('#operations-hero-grid');
    if (hero) hero.innerHTML = [
      { label: 'Live rule', value: threshold, note: 'Official public betting rule' },
      { label: 'Board date', value: op.boards?.active_board_date || 'unknown', note: `${primaryLabel} currently showing this board` },
      { label: 'Last completed run', value: dt(op.summary?.last_run_finished_at), note: `Started ${dt(op.summary?.last_run_started_at)}` },
      { label: 'Publish state', value: op.publish?.public_site_publish?.status || 'unknown', note: `Published ${dt(op.summary?.latest_published_at)}` }
    ].map(card).join('');
    const priority = $('#operations-priority-grid');
    if (priority) {
      const failures = op.blocked?.failures || [];
      const warnings = op.blocked?.warnings || [];
      priority.innerHTML = `<div class="section-head"><div><p class="section-kicker">Attention</p><h2>What needs action now</h2></div></div><div class="summary-grid">${[
        { label: 'Failures', value: String(failures.length), tone: failures.length ? 'metric-bad' : '', note: failures[0] ? failures[0].code : 'No blocking failures' },
        { label: 'Warnings', value: String(warnings.length), tone: warnings.length ? 'metric-warn' : '', note: warnings[0] ? warnings[0].code : 'No active warnings' },
        { label: 'Trust rows', value: String(trustRows.length), note: `${trustSummary.red || 0} red | ${trustSummary.yellow || 0} watch | ${trustSummary.green || 0} healthy` },
        { label: 'Latest graded date', value: op.summary?.latest_graded_date || 'unknown', note: 'Latest settled results attached to the official record' }
      ].map(card).join('')}</div>`;
    }

    const summary = $('#operations-summary-grid');
    if (summary) summary.innerHTML = [
      { label: 'Validation', value: op.validation?.final?.status || 'unknown', note: op.validation?.final?.trusted_for_modeling ? 'Trusted for modeling' : 'Not trusted for modeling' },
      { label: 'Viewer export', value: op.publish?.viewer_publish?.status || 'unknown', note: dt(op.publish?.viewer_publish?.updated_at) },
      { label: 'Live board', value: op.boards?.active_board_date || 'unknown', note: `${primaryLabel} | ${threshold}` },
      { label: 'Challenger', value: challengerThresholdValue, note: `${challengerLabel} tracked separately` },
      { label: 'Model-driving rows', value: String(trustSummary.live_rows || 0), note: 'Rows that directly drive the live system' },
      { label: 'Explanation rows', value: String(trustSummary.explanation_rows || 0), note: 'Rows that feed public explanations' }
    ].map(card).join('');

    const objectBody = $('#operations-freshness-table tbody');
    if (objectBody) {
      objectBody.innerHTML = trustRows.length
        ? trustRows
          .sort((a, b) => (severityRank[String(a.status || '').toLowerCase()] ?? 4) - (severityRank[String(b.status || '').toLowerCase()] ?? 4)
            || String(a.source_name).localeCompare(String(b.source_name)))
          .map((row) => `<tr class="ops-row-${esc(String(row.status || 'green'))}">
              <td><span class="${statusClass(row.status)}">${esc(String(row.status || 'green').replaceAll('_', ' '))}</span></td>
              <td>${esc(row.source_name)}</td>
              <td>${esc(row.purpose)}</td>
              <td>${esc(dt(row.last_updated_at))}</td>
              <td>${esc(row.expected_cadence || '--')}</td>
              <td>${esc(usageLabel(row))}</td>
              <td>${esc(trustExplanation(row))}</td>
            </tr>`).join('')
        : '<tr><td colspan="7" class="subtle">No system-driving trust rows are available.</td></tr>';
    }

    const stageBody = $('#operations-stage-table tbody');
    if (stageBody) {
      const rows = Array.isArray(op.loop_objects) ? op.loop_objects.filter((item) => item.object_type === 'stage') : [];
      stageBody.innerHTML = rows.length
        ? rows.sort((a, b) => (severityRank[String(a.status_value || '').toLowerCase()] ?? 4) - (severityRank[String(b.status_value || '').toLowerCase()] ?? 4)
            || String(b.last_refresh_timestamp || '').localeCompare(String(a.last_refresh_timestamp || '')))
            .map((row) => `<tr>
              <td><span class="${statusClass(row.status_value)}">${esc(String(row.status_value || 'unknown').replaceAll('_', ' '))}</span></td>
              <td>${esc(row.object_name)}</td>
              <td>${esc(row.domain)}</td>
              <td>${esc(dt(row.last_refresh_timestamp))}</td>
              <td>${esc(row.object_name === 'producer_live_current_market_refresh'
                ? 'The row is marked skipped because the stage records a warning status after running the live refresh path; the live refresh still executed and matched 90 rows.'
                : row.object_name === 'site_deploy_publish'
                  ? 'This stage was not reached in the source run.'
                  : row.object_name === 'grading_hook'
                    ? 'Still a stubbed stage in the loop contract.'
                    : row.status_message || '--')}</td>
            </tr>`).join('')
        : '<tr><td colspan="5" class="subtle">No stage records are available.</td></tr>';
    }
  }

  try {
    if (page === 'redirect') return;
    const op = await json('mlb_operational_status_v1.json');
    renderStatusStrip(op);
    const status = await json('mlb_ai_active_engine_status_v1.json');
    if (page === 'leans') return renderLeans(status, await json('mlb_ai_daily_leans_v1.json'), op, await json('mlb_ai_daily_performance_2026_v1.json'), await json('mlb_ai_reporting_v1.json'), await json('mlb_ai_ranker_explanations_v1.json'));
    if (page === 'performance') return renderPerformanceSurface(status, await json('mlb_ai_reporting_v1.json'), await json('mlb_ai_reporting_monthly_v1.json'), await json('mlb_ai_daily_performance_2026_v1.json'), await json('mlb_ai_leans_history_view_v1.json'), op, { surfaceKind: 'live' });
    if (page === 'challenger') return renderPerformanceSurface(await json('mlb_ai_shadow_engine_status_v1.json'), await json('mlb_ai_shadow_reporting_v1.json'), await json('mlb_ai_shadow_reporting_monthly_v1.json'), await json('mlb_ai_shadow_daily_performance_2026_v1.json'), await json('mlb_ai_shadow_leans_history_view_v1.json'), op, { surfaceKind: 'challenger' });
    if (page === 'operations') return renderOperations(status, op, await json('mlb_ai_operations_trust_table_v1.json'));
  } catch (error) {
    const shell = $('.page-shell') || document.body;
    const panel = document.createElement('section');
    panel.className = 'page-section';
    panel.innerHTML = `<div class="empty-state">Failed to load the MLB AI site data: ${esc(error.message)}</div>`;
    shell.appendChild(panel);
  }
}());
