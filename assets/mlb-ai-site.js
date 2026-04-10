(async function main() {
  const page = document.body.dataset.page;
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const num = (v) => Number.isNaN(Number(v)) || v == null;
  const pct = (v) => num(v) ? '--' : `${(Number(v) * 100).toFixed(2)}%`;
  const units = (v) => num(v) ? '--' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}u`;
  const fixed = (v, d = 2) => num(v) ? '--' : Number(v).toFixed(d);
  const odds = (v) => num(v) ? '--' : `${Number(v) > 0 ? '+' : ''}${Number(v)}`;
  const dt = (v) => !v ? 'Unknown' : new Date(v).toLocaleString();
  const json = async (name) => {
    const response = await fetch(`./data/${name}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to load ${name}`);
    return response.json();
  };

  function renderCardGrid(target, cards) {
    if (!target) return;
    target.innerHTML = cards.map((card) => `
      <article class="metric-card">
        <strong>${esc(card.label)}</strong>
        <div class="metric-value ${card.tone || ''}">${esc(card.value)}</div>
        <div class="subtle">${esc(card.note || '')}</div>
      </article>
    `).join('');
  }

  function mapStatus(status) {
    const trusted = Boolean(status?.trust?.trusted_for_modeling) && Boolean(status?.trust?.trusted_for_site_shadow);
    const failures = status?.blocked?.failures || [];
    const warnings = status?.blocked?.warnings || [];
    const runStatus = status?.run?.overall_status || status?.summary?.last_run_overall_status || 'unknown';
    const stubs = runStatus === 'completed_with_stubs';
    let severity = 'ok';
    if (!trusted || failures.length || status?.state === 'fail') severity = 'fail';
    else if (stubs || warnings.length || status?.state === 'warning') severity = 'warning';
    let headline = "Today's board is trusted.";
    let subheadline = "The board, validation, and site export are aligned for today's use.";
    if (severity === 'fail') {
      headline = "Today's board is not trusted.";
      subheadline = failures.length ? `Blocking validation failed: ${failures[0].code}.` : 'Required trust signals are not aligned.';
    } else if (stubs) {
      headline = "Today's board is trusted, with non-board stubs still present.";
      subheadline = 'The board is trusted, but the loop still records non-board stub stages.';
    } else if (severity === 'warning') {
      headline = "Today's board is trusted, with warnings.";
      subheadline = warnings.length ? `Non-blocking runtime warnings are present: ${warnings[0].code}.` : 'Trust passed, but there are non-blocking operator signals to review.';
    }
    const chips = [
      `Modeling ${status?.trust?.trusted_for_modeling ? 'trusted' : 'blocked'}`,
      `Board ${status?.boards?.active_board_date || 'unknown'}`,
      `Final ${status?.validation?.final?.status || 'unknown'}`,
      `Run ${runStatus}`
    ];
    if (status?.boards?.latest_valid_mlb_ai_board_date && status.boards.latest_valid_mlb_ai_board_date !== status.boards.active_board_date) chips.push(`Latest valid ${status.boards.latest_valid_mlb_ai_board_date}`);
    if (status?.boards?.latest_canonical_board_date && status.boards.latest_canonical_board_date !== status.boards.active_board_date) chips.push(`Canonical ${status.boards.latest_canonical_board_date}`);
    if (stubs) chips.push('Non-board stubs');
    return { severity, headline, subheadline, chips };
  }

  function renderStatusStrip(status) {
    const shell = $('.shell');
    if (!shell) return;
    const mapped = mapStatus(status);
    const section = document.createElement('section');
    section.className = `status-strip status-strip-${mapped.severity}`;
    section.innerHTML = `
      <div class="status-strip-copy">
        <p class="status-strip-label">Board trust</p>
        <h2>${esc(mapped.headline)}</h2>
        <p>${esc(mapped.subheadline)}</p>
      </div>
      <div class="status-strip-chips">${mapped.chips.map((t) => `<span class="status-chip">${esc(t)}</span>`).join('')}</div>
    `;
    shell.insertBefore(section, shell.firstChild);
  }

  function vis(row) {
    const tier = String(row.visibility_tier || '').toLowerCase();
    if (tier === 'core' || tier === 'exploratory' || tier === 'hidden') return tier;
    if (row.confidence_band === 'high') return 'core';
    if (row.confidence_band === 'medium') return 'exploratory';
    return 'hidden';
  }

  function leanCmp(a, b) {
    const buckets = { core_priority: 2, exploratory_priority: 1, hidden: 0 };
    const bands = { high: 2, medium: 1, low: 0 };
    return (buckets[b.display_sort_bucket] || 0) - (buckets[a.display_sort_bucket] || 0)
      || (bands[b.confidence_band] || 0) - (bands[a.confidence_band] || 0)
      || Number(b.edge || 0) - Number(a.edge || 0)
      || Number(a.rank_on_slate || 0) - Number(b.rank_on_slate || 0);
  }

  function primaryDrivers(row) {
    if (Array.isArray(row.primary_drivers) && row.primary_drivers.length) return row.primary_drivers.slice(0, 3);
    const items = [`Model edge ${pct(row.edge)}`, `Context score ${fixed(row.context_score, 3)}`];
    if (row.context_buckets?.weather_bucket) items.push(`Weather ${String(row.context_buckets.weather_bucket).replaceAll('_', ' ')}`);
    return items.slice(0, 3);
  }

  function supportDrivers(row) {
    if (Array.isArray(row.supporting_context) && row.supporting_context.length) return row.supporting_context.slice(0, 3);
    const items = [];
    if (row.context_buckets?.action_bucket) items.push(`Action ${String(row.context_buckets.action_bucket).replaceAll('_', ' ')}`);
    if (row.context_buckets?.baseball_bucket) items.push(`Baseball ${String(row.context_buckets.baseball_bucket).replaceAll('_', ' ')}`);
    if (row.context_buckets?.total_bucket) items.push(`Total bucket ${row.context_buckets.total_bucket}`);
    return items.slice(0, 3);
  }

  function marketLabel(row) {
    if (row.market_type === 'total') return `Total ${String(row.side || '').toUpperCase()} ${row.line_value}`;
    if (row.market_type === 'moneyline') return `Moneyline ${String(row.side || '').toUpperCase()}`;
    if (row.market_type === 'spread') return `Run line ${String(row.side || '').toUpperCase()} ${row.line_value}`;
    return `${row.market_type || 'Market'} ${row.side || ''}`.trim();
  }

  function priceFlag(row) {
    if (String(row.price_flag || '').toLowerCase() === 'expensive') return 'Expensive price';
    if (String(row.price_flag || '').toLowerCase() === 'priced_up') return 'Priced up';
    return '';
  }

  function leanCard(row) {
    const primary = primaryDrivers(row);
    const support = supportDrivers(row);
    const price = priceFlag(row);
    return `
      <article class="lean-decision-card">
        <div class="lean-decision-head">
          <div>
            <p class="lean-kicker">${esc(row.matchup)}</p>
            <h3>${esc(marketLabel(row))}</h3>
            <p class="lean-subline">Recommended: ${esc(String(row.side || '').toUpperCase())} | Price ${esc(odds(row.price_american))}</p>
          </div>
          <div class="lean-score-stack">
            <span class="badge">${esc(row.confidence_band || 'unknown')} confidence</span>
            ${price ? `<span class="price-flag">${esc(price)}</span>` : ''}
          </div>
        </div>
        <div class="lean-decision-metrics">
          <div><strong>Edge</strong><div>${pct(row.edge)}</div></div>
          <div><strong>Model</strong><div>${pct(row.model_probability)}</div></div>
          <div><strong>Market</strong><div>${pct(row.market_probability)}</div></div>
          <div><strong>Units</strong><div>${fixed(row.suggested_units, 2)}</div></div>
        </div>
        <div class="lean-explain-grid">
          <div class="lean-explain-block"><strong>Why it made the card</strong><ul>${primary.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>
          <div class="lean-explain-block"><strong>Supporting context</strong><ul>${support.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>
        </div>
      </article>
    `;
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

  function renderLeans(status, leans, operationalStatus) {
    const requested = leans.requested_board_date || operationalStatus?.boards?.operating_date || leans.board_date || 'unknown';
    const latestCanonical = leans.latest_canonical_board_date || operationalStatus?.boards?.latest_canonical_board_date || 'unknown';
    const latestValid = leans.latest_valid_mlb_ai_board_date || operationalStatus?.boards?.latest_valid_mlb_ai_board_date || leans.active_board_date || leans.board_date || 'unknown';
    const noBoard = leans.board_state === 'no_valid_board_for_requested_date' || Boolean(leans.board_available) === false;
    const visible = [...(leans.rows || [])].filter((row) => vis(row) !== 'hidden').sort(leanCmp);
    const core = visible.filter((row) => vis(row) === 'core');
    const exploratory = visible.filter((row) => vis(row) === 'exploratory');

    renderCardGrid($('#leans-hero-grid'), [
      { label: 'Requested date', value: requested, note: noBoard ? 'No official board is available for this date.' : 'This is the date the page is checking.' },
      { label: 'Official plays', value: String(visible.length), note: noBoard ? 'The page shows zero official plays when no valid board exists.' : 'Visible core and exploratory plays only.' },
      { label: 'Board status', value: noBoard ? 'No board' : 'Official board', note: noBoard ? `Latest valid board is ${latestValid}.` : `Board is live for ${leans.board_date}.` }
    ]);

    if ($('#leans-summary-badge')) $('#leans-summary-badge').textContent = noBoard ? `No official plays for ${requested}` : `${visible.length} official plays`;

    if ($('#leans-summary-grid')) {
      $('#leans-summary-grid').innerHTML = noBoard ? `
        <article class="metric-card metric-card-wide">
          <strong>No official board for ${esc(requested)}</strong>
          <div class="metric-value">No plays</div>
          <div class="subtle">${esc(leans.availability_reason || `No valid MLB AI board is available for ${requested}.`)}</div>
        </article>
        <article class="metric-card">
          <strong>Latest valid board</strong>
          <div class="metric-value">${esc(latestValid)}</div>
          <div class="subtle">The last board the model considers valid.</div>
        </article>
        <article class="metric-card">
          <strong>Latest betting date</strong>
          <div class="metric-value">${esc(latestCanonical)}</div>
          <div class="subtle">Markets may exist even when the model has no official board.</div>
        </article>
      ` : `
        <article class="metric-card">
          <strong>Official board date</strong>
          <div class="metric-value">${esc(leans.board_date)}</div>
          <div class="subtle">Requested date ${esc(requested)}</div>
        </article>
        <article class="metric-card">
          <strong>Core plays</strong>
          <div class="metric-value">${core.length}</div>
          <div class="subtle">Highest-conviction card.</div>
        </article>
        <article class="metric-card">
          <strong>Exploratory plays</strong>
          <div class="metric-value">${exploratory.length}</div>
          <div class="subtle">Actionable, but less central.</div>
        </article>
        <article class="metric-card">
          <strong>Latest betting date</strong>
          <div class="metric-value">${esc(latestCanonical)}</div>
          <div class="subtle">Useful for checking whether the board is same-day or lagging.</div>
        </article>
      `;
    }

    if ($('#leans-core-cards')) $('#leans-core-cards').innerHTML = noBoard
      ? `<div class="empty-state">No official MLB AI plays are available for ${esc(requested)}.</div>`
      : core.length ? core.map(leanCard).join('') : '<div class="empty-state">No core plays are available on the official board.</div>';

    if ($('#leans-exploratory-cards')) $('#leans-exploratory-cards').innerHTML = noBoard
      ? `<div class="empty-state">The page does not fall back to ${esc(latestValid)} plays when the requested date has no valid board.</div>`
      : exploratory.length ? exploratory.map(leanCard).join('') : '<div class="empty-state">No exploratory plays are available on the official board.</div>';
  }

  function renderPerformance(status, reporting, monthly, comparison, performance, operationalStatus) {
    const rows = Array.isArray(performance?.rows) ? performance.rows.slice() : [];
    const latest = rows.length ? rows[rows.length - 1] : null;
    const requested = operationalStatus?.boards?.operating_date || status.requested_board_date || 'unknown';
    const active = operationalStatus?.boards?.active_board_date || reporting.active_board_date || 'unknown';

    renderCardGrid($('#performance-hero-grid'), [
      { label: 'Results through', value: reporting?.source_coverage?.shadow_results_through || 'unknown', note: 'This is the latest graded day, not the artifact timestamp.' },
      { label: 'Season cumulative', value: units(latest?.cumulative_units), note: latest ? `As of ${latest.board_date}` : 'No 2026 performance rows available.' },
      { label: 'Requested vs board', value: `${requested} / ${active}`, note: 'Requested date first, official board second.' }
    ]);
    if ($('#performance-coverage-badge')) $('#performance-coverage-badge').textContent = `Results through ${reporting?.source_coverage?.shadow_results_through || 'unknown'}`;

    const start = $('#performance-start-date');
    const end = $('#performance-end-date');
    const presets = $('#performance-range-presets');
    const policy = $('#monthly-policy-filter');
    const dailyBody = $('#daily-performance-table tbody');
    const summaryGrid = $('#performance-summary-grid');
    const monthlyBody = $('#monthly-table tbody');
    const comparatorGrid = $('#performance-comparator-grid');
    const contextBlocks = $('#context-breakdowns');
    if (!rows.length || !start || !end || !presets || !policy || !dailyBody || !summaryGrid || !monthlyBody || !comparatorGrid || !contextBlocks) return;

    const defaults = rangeDates(rows, 'season');
    start.min = rows[0].board_date; start.max = rows[rows.length - 1].board_date; start.value = defaults.start;
    end.min = rows[0].board_date; end.max = rows[rows.length - 1].board_date; end.value = defaults.end;

    function setPreset(mode) {
      presets.querySelectorAll('button').forEach((button) => button.classList.toggle('is-active', button.dataset.range === mode));
    }

    function drawMonthly() {
      const activeOnly = policy.value !== 'all_policies';
      const order = activeOnly ? [['hostile_fix_with_caps', 'Active system']] : [
        ['hostile_fix_with_caps', 'Active system'],
        ['v8_balanced', 'V8 baseline'],
        ['soft_plus_half_sigma', 'V7 production'],
        ['hybrid_top25_cap3', 'V7 hybrid'],
        ['v8_light', 'V8 light']
      ];
      monthlyBody.innerHTML = order.flatMap(([key, label]) => (monthly.policies?.[key] || []).map((row) => `
        <tr>
          <td>${esc(row.month)}</td>
          <td>${esc(label)}</td>
          <td>${row.bets}</td>
          <td>${row.wins}</td>
          <td>${row.losses}</td>
          <td>${row.pushes}</td>
          <td>${pct(row.win_pct)}</td>
          <td>${units(row.units)}</td>
          <td>${pct(row.roi)}</td>
        </tr>
      `)).join('');
    }

    function drawPerformance() {
      const filtered = filterDate(rows, start.value, end.value);
      const summary = perfSummary(filtered);
      summaryGrid.innerHTML = `
        <article class="metric-card">
          <strong>Days in range</strong>
          <div class="metric-value">${summary.days}</div>
          <div class="subtle">${esc(start.value || 'start')} through ${esc(end.value || 'end')}</div>
        </article>
        <article class="metric-card">
          <strong>Bets in range</strong>
          <div class="metric-value">${summary.bets}</div>
          <div class="subtle">${summary.wins} wins | ${summary.losses} losses | ${summary.pushes} pushes</div>
        </article>
        <article class="metric-card">
          <strong>Units in range</strong>
          <div class="metric-value ${summary.units >= 0 ? 'metric-good' : 'metric-bad'}">${units(summary.units)}</div>
          <div class="subtle">ROI ${pct(summary.roi)}</div>
        </article>
        <article class="metric-card">
          <strong>Season cumulative</strong>
          <div class="metric-value ${Number(latest?.cumulative_units || 0) >= 0 ? 'metric-good' : 'metric-bad'}">${units(latest?.cumulative_units)}</div>
          <div class="subtle">Latest graded day ${esc(latest?.board_date || 'unknown')}</div>
        </article>
      `;
      dailyBody.innerHTML = filtered.length ? filtered.map((row) => `
        <tr>
          <td>${esc(row.board_date)}</td>
          <td>${row.bets}</td>
          <td>${row.wins}</td>
          <td>${row.losses}</td>
          <td>${row.pushes}</td>
          <td>${pct(row.win_rate)}</td>
          <td>${units(row.units)}</td>
          <td>${pct(row.roi)}</td>
          <td>${units(row.cumulative_units)}</td>
        </tr>
      `).join('') : '<tr><td colspan="9" class="subtle">No 2026 daily performance rows are available for this range.</td></tr>';
    }

    presets.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-range]');
      if (!button) return;
      const range = rangeDates(rows, button.dataset.range);
      start.value = range.start;
      end.value = range.end;
      setPreset(button.dataset.range);
      drawPerformance();
    });
    start.addEventListener('change', () => { setPreset(''); drawPerformance(); });
    end.addEventListener('change', () => { setPreset(''); drawPerformance(); });
    policy.addEventListener('change', drawMonthly);

    comparatorGrid.innerHTML = [
      { label: 'Active historical', value: units(reporting.active_policy_historical_summary?.units), note: `2022-2025 ROI ${pct(reporting.active_policy_historical_summary?.roi)}` },
      { label: '2026 tracked results', value: units(reporting.active_policy_shadow_summary?.units), note: `Through ${reporting.source_coverage.shadow_results_through}` },
      ...((comparison.comparators || []).slice(0, 2).map((entry) => ({ label: entry.label, value: units(entry.historical_summary?.units), note: `Historical ROI ${pct(entry.historical_summary?.roi)}` })))
    ].map((card) => `
      <article class="metric-card">
        <strong>${esc(card.label)}</strong>
        <div class="metric-value">${esc(card.value)}</div>
        <div class="subtle">${esc(card.note)}</div>
      </article>
    `).join('');

    const sections = [['side_mix', 'Side mix'], ['total_bucket_mix', 'Total bucket mix'], ['price_bucket_mix', 'Price mix'], ['wind_mix', 'Wind mix'], ['bullpen_mix', 'Bullpen mix'], ['action_mix', 'Action mix']];
    contextBlocks.innerHTML = sections.map(([key, title]) => {
      const items = reporting.context_breakdowns?.[key] || [];
      return `
        <article class="context-card">
          <strong>${esc(title)}</strong>
          ${items.slice(0, 6).map((row) => `<div class="meta-line">${esc(row.bucket)} | ${units(row.units)} | ${pct(row.roi)} | ${row.bets} bets</div>`).join('')}
        </article>
      `;
    }).join('');

    setPreset('season');
    drawPerformance();
    drawMonthly();
  }

  function renderOperations(status, op) {
    renderCardGrid($('#operations-hero-grid'), [
      { label: 'System state', value: String(op.state || 'unknown').toUpperCase(), note: `Loop status ${op.run?.overall_status || 'unknown'}` },
      { label: 'Last completed run', value: dt(op.summary?.last_run_finished_at), note: `Started ${dt(op.summary?.last_run_started_at)}` },
      { label: 'Board trust', value: op.trust?.trusted_for_modeling && op.trust?.trusted_for_site_shadow ? 'Trusted' : 'Blocked', note: `Active board ${op.boards?.active_board_date || 'unknown'}` }
    ]);
    renderCardGrid($('#operations-validation-grid'), [
      { label: 'Prepublish validation', value: op.validation?.prepublish?.status || 'unknown', note: dt(op.validation?.prepublish?.updated_at) },
      { label: 'Final validation', value: op.validation?.final?.status || 'unknown', note: op.validation?.final?.trusted_for_modeling ? 'Trusted for modeling' : 'Not trusted for modeling' },
      { label: 'Site board trust', value: op.validation?.site_shadow?.status || 'unknown', note: op.validation?.site_shadow?.trusted_for_site_shadow ? 'Trusted for site surface' : 'Blocked' }
    ]);
    renderCardGrid($('#operations-board-grid'), [
      { label: 'Operating date', value: op.boards?.operating_date || 'unknown', note: 'Current run date' },
      { label: 'Active board', value: op.boards?.active_board_date || 'unknown', note: 'Board currently trusted for the site' },
      { label: 'Latest valid MLB AI board', value: op.boards?.latest_valid_mlb_ai_board_date || 'unknown', note: 'Latest date the MLB AI board considers valid' },
      { label: 'Latest canonical betting date', value: op.boards?.latest_canonical_board_date || 'unknown', note: 'Latest date available in canonical betting rows' }
    ]);
    renderCardGrid($('#operations-metrics-grid'), [
      { label: 'Action coverage', value: pct(op.key_metrics?.action_coverage_pct), note: 'Mapped action features on the active window' },
      { label: 'Weather coverage', value: pct(op.key_metrics?.weather_coverage_pct), note: 'Weather coverage on the active window' },
      { label: 'Baseball coverage', value: pct(op.key_metrics?.baseball_coverage_pct), note: 'Baseball context coverage on the active window' },
      { label: 'Resolved mapping', value: pct(op.key_metrics?.mapping_resolved_pct), note: `${op.key_metrics?.unmapped_rows ?? 'unknown'} unmapped rows` }
    ]);
    if ($('#operations-freshness-grid')) {
      $('#operations-freshness-grid').innerHTML = (op.dependency_freshness?.layers || []).map((layer) => `
        <article class="context-card">
          <strong>${esc(layer.name)}</strong>
          <div class="meta-line">State: ${esc(layer.state)}</div>
          <div class="meta-line">Freshness: ${esc(layer.freshness_status)}</div>
          <div class="meta-line">Coverage: ${esc(layer.target_date_coverage || 'unknown')}</div>
          <div class="meta-line">Updated: ${esc(layer.latest_freshness_value || 'unknown')}</div>
          <div class="meta-line">${esc((layer.notes || []).join(' '))}</div>
        </article>
      `).join('');
    }
    if ($('#operations-issues')) {
      const groups = [['Failures', op.blocked?.failures || []], ['Warnings', op.blocked?.warnings || []], ['Info', op.blocked?.info || []]];
      $('#operations-issues').innerHTML = groups.map(([label, entries]) => `
        <article class="stack-card">
          <strong>${esc(label)}</strong>
          ${entries.length ? entries.map((entry) => `<div class="meta-line">${esc(entry.code)}${entry.source ? ` | ${esc(entry.source)}` : ''}</div>`).join('') : '<div class="subtle">None</div>'}
        </article>
      `).join('');
    }
    renderCardGrid($('#operations-engine-grid'), [
      { label: 'Engine family', value: status.active_engine?.engine_family || 'unknown', note: `Version ${status.active_engine?.engine_version || 'unknown'}` },
      { label: 'Active policy', value: status.active_engine?.active_policy || 'unknown', note: status.active_engine?.engine_state || 'unknown' },
      { label: 'Generated', value: dt(status.generated_at), note: `Requested board ${status.requested_board_date || 'unknown'}` },
      { label: 'Live-betting trust', value: status.active_engine?.trusted_for_live_betting ? 'Trusted' : 'Not live', note: 'Technical metadata only' }
    ]);
  }

  try {
    if (page === 'redirect') return;
    const op = await json('mlb_operational_status_v1.json');
    renderStatusStrip(op);
    const status = await json('mlb_ai_active_engine_status_v1.json');
    if (page === 'leans') return renderLeans(status, await json('mlb_ai_daily_leans_v1.json'), op);
    if (page === 'performance') return renderPerformance(status, await json('mlb_ai_reporting_v1.json'), await json('mlb_ai_reporting_monthly_v1.json'), await json('mlb_ai_policy_comparison_v1.json'), await json('mlb_ai_daily_performance_2026_v1.json'), op);
    if (page === 'operations') return renderOperations(status, op);
  } catch (error) {
    const shell = $('.shell') || document.body;
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.innerHTML = `<div class="empty-state">Failed to load the MLB AI site artifacts: ${esc(error.message)}</div>`;
    shell.appendChild(panel);
  }
}());
