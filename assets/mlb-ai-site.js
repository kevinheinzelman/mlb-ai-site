(async function main() {
  const page = document.body.dataset.page;

  async function loadJson(name) {
    const response = await fetch(`./data/${name}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to load ${name}`);
    return response.json();
  }

  function formatPct(value) {
    if (value == null || Number.isNaN(Number(value))) return '—';
    return `${(Number(value) * 100).toFixed(2)}%`;
  }

  function formatUnits(value) {
    if (value == null || Number.isNaN(Number(value))) return '—';
    return `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(2)}u`;
  }

  function formatNumber(value, digits = 2) {
    if (value == null || Number.isNaN(Number(value))) return '—';
    return Number(value).toFixed(digits);
  }

  function badge(text) {
    return `<span class="chip">${text}</span>`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function titleCaseState(value) {
    if (!value) return 'Unknown';
    return String(value).charAt(0).toUpperCase() + String(value).slice(1);
  }

  function mapOperationalStatusToStrip(status) {
    const trustedForBoard = Boolean(status?.trust?.trusted_for_modeling) && Boolean(status?.trust?.trusted_for_site_shadow);
    const hasFailures = Array.isArray(status?.blocked?.failures) && status.blocked.failures.length > 0;
    const hasWarnings = Array.isArray(status?.blocked?.warnings) && status.blocked.warnings.length > 0;
    const runOverallStatus = status?.run?.overall_status || status?.summary?.last_run_overall_status || null;
    const hasStubs = runOverallStatus === 'completed_with_stubs';

    let severity = 'ok';
    if (!trustedForBoard || hasFailures || status?.state === 'fail') {
      severity = 'fail';
    } else if (hasStubs || hasWarnings || status?.state === 'warning') {
      severity = 'warning';
    }

    let headline = 'Today’s board is trusted.';
    let subheadline = 'Loop run, validation, and MLB AI shadow export all agree on the active board.';

    if (severity === 'fail') {
      headline = 'Today’s board is not trusted.';
      subheadline = hasFailures
        ? `Blocking validation failed: ${status.blocked.failures[0].code}.`
        : 'Required runtime trust signals are not aligned.';
    } else if (hasStubs) {
      headline = 'Today’s board is trusted, with non-board stubs still present.';
      subheadline = 'Modeling and MLB AI shadow trust passed, but the loop finished as completed_with_stubs.';
    } else if (severity === 'warning') {
      headline = 'Today’s board is trusted, with warnings.';
      subheadline = hasWarnings
        ? `Runtime warnings are present: ${status.blocked.warnings[0].code}.`
        : 'Trust passed, but some non-blocking signals need operator review.';
    }

    const chips = [
      `Modeling ${status?.trust?.trusted_for_modeling ? 'trusted' : 'blocked'}`,
      `MLB AI shadow ${status?.trust?.trusted_for_site_shadow ? 'trusted' : 'blocked'}`,
      `Board ${status?.boards?.active_board_date || 'unknown'}`,
      `Final ${status?.validation?.final?.status || 'unknown'}`,
      `Run ${runOverallStatus || 'unknown'}`
    ];

    if (status?.boards?.latest_valid_mlb_ai_board_date && status.boards.latest_valid_mlb_ai_board_date !== status.boards.active_board_date) {
      chips.push(`Latest valid ${status.boards.latest_valid_mlb_ai_board_date}`);
    }
    if (status?.boards?.latest_canonical_board_date && status.boards.latest_canonical_board_date !== status.boards.active_board_date) {
      chips.push(`Canonical ${status.boards.latest_canonical_board_date}`);
    }
    if (hasStubs) {
      chips.push('Non-board stubs');
    }

    return {
      severity,
      headline,
      subheadline,
      chips
    };
  }

  function renderOperationalStatusStrip(status) {
    const shell = document.querySelector('.shell');
    if (!shell) return;
    const mapped = mapOperationalStatusToStrip(status);
    const section = document.createElement('section');
    section.className = `status-strip status-strip-${mapped.severity}`;
    section.innerHTML = `
      <div class="status-strip-copy">
        <p class="status-strip-label">Board trust</p>
        <h2>${escapeHtml(mapped.headline)}</h2>
        <p>${escapeHtml(mapped.subheadline)}</p>
      </div>
      <div class="status-strip-chips">
        ${mapped.chips.map((text) => `<span class="status-chip">${escapeHtml(text)}</span>`).join('')}
      </div>
    `;
    shell.insertBefore(section, shell.firstChild);
  }

  function renderEngineMeta(target, status) {
    if (!target) return;
    target.innerHTML = `
      <div class="meta-grid">
        <div class="metric-card">
          <strong>Active engine</strong>
          <div class="metric-value">${status.active_engine.engine_family}</div>
          <div class="subtle">${status.active_engine.engine_version} / ${status.active_engine.active_policy}</div>
        </div>
        <div class="metric-card">
          <strong>State</strong>
          <div class="metric-value">${status.active_engine.engine_state}</div>
          <div class="subtle">Trusted live: ${status.active_engine.trusted_for_live_betting ? 'yes' : 'no'}</div>
        </div>
        <div class="metric-card">
          <strong>Freshness</strong>
          <div class="metric-value">${status.active_board_date}</div>
          <div class="subtle">Generated ${new Date(status.generated_at).toLocaleString()}</div>
        </div>
      </div>
    `;
  }

  function renderHome(status) {
    renderEngineMeta(document.getElementById('engine-meta'), status);
  }

  function formatOdds(value) {
    if (value == null || Number.isNaN(Number(value))) return '—';
    const number = Number(value);
    return number > 0 ? `+${number}` : `${number}`;
  }

  function classifyLeanRowFallback(row) {
    if (row.confidence_band === 'high') return 'core';
    if (row.confidence_band === 'medium') return 'exploratory';
    return 'hidden';
  }

  function classifyLeanRow(row) {
    const visibilityTier = String(row.visibility_tier || '').toLowerCase();
    if (visibilityTier === 'core' || visibilityTier === 'exploratory' || visibilityTier === 'hidden') {
      return visibilityTier;
    }
    return classifyLeanRowFallback(row);
  }

  function compareLeans(a, b) {
    const bucketOrder = { core_priority: 2, exploratory_priority: 1, hidden: 0 };
    const bucketDelta = (bucketOrder[b.display_sort_bucket] || 0) - (bucketOrder[a.display_sort_bucket] || 0);
    if (bucketDelta !== 0) return bucketDelta;
    const bandOrder = { high: 2, medium: 1, low: 0 };
    const bandDelta = (bandOrder[b.confidence_band] || 0) - (bandOrder[a.confidence_band] || 0);
    if (bandDelta !== 0) return bandDelta;
    const edgeDelta = Number(b.edge || 0) - Number(a.edge || 0);
    if (edgeDelta !== 0) return edgeDelta;
    return Number(a.rank_on_slate || 0) - Number(b.rank_on_slate || 0);
  }

  function buildPrimaryDriversFallback(row) {
    const drivers = [];
    drivers.push(`Model edge ${formatPct(row.edge)}`);
    drivers.push(`Context score ${formatNumber(row.context_score, 3)}`);
    if (row.context_buckets?.weather_bucket) {
      drivers.push(`Weather ${row.context_buckets.weather_bucket.replaceAll('_', ' ')}`);
    } else if (Array.isArray(row.reason_flags) && row.reason_flags.includes('wind_in_context')) {
      drivers.push('Wind-sensitive context');
    }
    return drivers.slice(0, 3);
  }

  function buildPrimaryDrivers(row) {
    if (Array.isArray(row.primary_drivers) && row.primary_drivers.length) {
      return row.primary_drivers.slice(0, 3);
    }
    return buildPrimaryDriversFallback(row);
  }

  function buildSupportingContextFallback(row) {
    const items = [];
    if (row.context_buckets?.action_bucket) {
      items.push(`Action ${row.context_buckets.action_bucket.replaceAll('_', ' ')}`);
    }
    if (row.context_buckets?.baseball_bucket) {
      items.push(`Baseball ${row.context_buckets.baseball_bucket.replaceAll('_', ' ')}`);
    }
    if (row.context_buckets?.total_bucket) {
      items.push(`Total bucket ${row.context_buckets.total_bucket}`);
    }
    if (Array.isArray(row.comparator_flags ? Object.entries(row.comparator_flags) : [])) {
      const aligned = Object.entries(row.comparator_flags)
        .filter(([, value]) => Boolean(value))
        .map(([key]) => key.replaceAll('_', ' '));
      if (aligned.length) {
        items.push(`Comparator alignment ${aligned.slice(0, 2).join(', ')}`);
      }
    }
    return items.slice(0, 3);
  }

  function buildSupportingContext(row) {
    if (Array.isArray(row.supporting_context) && row.supporting_context.length) {
      return row.supporting_context.slice(0, 3);
    }
    return buildSupportingContextFallback(row);
  }

  function expensivePriceLabelFallback(row) {
    const price = Number(row.price_american || 0);
    if (Number.isNaN(price)) return null;
    if (price <= -150) return 'Expensive price';
    if (price <= -130) return 'Priced up';
    return null;
  }

  function expensivePriceLabel(row) {
    const priceFlag = String(row.price_flag || '').toLowerCase();
    if (priceFlag === 'expensive') return 'Expensive price';
    if (priceFlag === 'priced_up') return 'Priced up';
    if (priceFlag === 'standard') return null;
    return expensivePriceLabelFallback(row);
  }

  function marketLabel(row) {
    if (row.market_type === 'total') {
      return `Total ${row.side.toUpperCase()} ${row.line_value}`;
    }
    if (row.market_type === 'moneyline') {
      return `Moneyline ${row.side.toUpperCase()}`;
    }
    if (row.market_type === 'spread') {
      return `Run line ${row.side.toUpperCase()} ${row.line_value}`;
    }
    return `${row.market_type} ${row.side}`.trim();
  }

  function buildLeanCard(row) {
    const primaryDrivers = buildPrimaryDrivers(row);
    const supportingContext = buildSupportingContext(row);
    const expensivePrice = expensivePriceLabel(row);
    return `
      <article class="lean-decision-card">
        <div class="lean-decision-head">
          <div>
            <p class="lean-kicker">${row.matchup}</p>
            <h3>${marketLabel(row)}</h3>
            <p class="lean-subline">Price ${formatOdds(row.price_american)} · ${row.confidence_band} confidence · ${formatNumber(row.suggested_units, 2)}u</p>
          </div>
          <div class="lean-score-stack">
            <span class="badge">${row.confidence_band}</span>
            ${expensivePrice ? `<span class="price-flag">${escapeHtml(expensivePrice)}</span>` : ''}
          </div>
        </div>
        <div class="lean-decision-metrics">
          <div><strong>Recommended side</strong><div>${row.side.toUpperCase()}</div></div>
          <div><strong>Odds</strong><div>${formatOdds(row.price_american)}</div></div>
          <div><strong>Edge</strong><div>${formatPct(row.edge)}</div></div>
          <div><strong>Units</strong><div>${formatNumber(row.suggested_units, 2)}</div></div>
        </div>
        <div class="lean-explain-grid">
          <div class="lean-explain-block">
            <strong>Primary drivers</strong>
            <ul>
              ${primaryDrivers.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
          </div>
          <div class="lean-explain-block">
            <strong>Supporting context</strong>
            <ul>
              ${supportingContext.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
          </div>
        </div>
      </article>
    `;
  }

  function renderLeans(status, leans, operationalStatus) {
    renderEngineMeta(document.getElementById('leans-meta'), status);
    const visibleRows = [...(leans.rows || [])]
      .filter((row) => classifyLeanRow(row) !== 'hidden')
      .sort(compareLeans);
    const coreRows = visibleRows.filter((row) => classifyLeanRow(row) === 'core');
    const exploratoryRows = visibleRows.filter((row) => classifyLeanRow(row) === 'exploratory');

    const summaryBadge = document.getElementById('leans-summary-badge');
    if (summaryBadge) {
      summaryBadge.textContent = `${visibleRows.length} visible plays on ${leans.board_date}`;
    }

    const summaryGrid = document.getElementById('leans-summary-grid');
    if (summaryGrid) {
      const requestedBoardDate = leans.requested_board_date || operationalStatus?.boards?.operating_date || leans.board_date;
      const latestCanonicalBoard = operationalStatus?.boards?.latest_canonical_board_date || 'unknown';
      const latestValidBoard = operationalStatus?.boards?.latest_valid_mlb_ai_board_date || leans.board_date;
      const boardMessage = requestedBoardDate !== leans.board_date
        ? `Requested ${requestedBoardDate}; latest valid MLB AI board is ${leans.board_date}. Canonical betting date is ${latestCanonicalBoard}.`
        : `Requested ${requestedBoardDate}; latest valid MLB AI board matches the request.`;
      summaryGrid.innerHTML = `
        <article class="metric-card">
          <strong>Board date</strong>
          <div class="metric-value">${leans.board_date}</div>
          <div class="subtle">${escapeHtml(boardMessage)}</div>
        </article>
        <article class="metric-card">
          <strong>Core plays</strong>
          <div class="metric-value">${coreRows.length}</div>
          <div class="subtle">High-confidence only</div>
        </article>
        <article class="metric-card">
          <strong>Exploratory plays</strong>
          <div class="metric-value">${exploratoryRows.length}</div>
          <div class="subtle">Moderate-confidence only</div>
        </article>
        <article class="metric-card">
          <strong>Hidden weak plays</strong>
          <div class="metric-value">${Math.max(0, (leans.rows || []).length - visibleRows.length)}</div>
          <div class="subtle">Low-confidence not shown</div>
        </article>
        <article class="metric-card">
          <strong>Latest valid board</strong>
          <div class="metric-value">${latestValidBoard}</div>
          <div class="subtle">Canonical betting date ${latestCanonicalBoard}</div>
        </article>
      `;
    }

    const coreContainer = document.getElementById('leans-core-cards');
    if (coreContainer) {
      coreContainer.innerHTML = coreRows.length
        ? coreRows.map(buildLeanCard).join('')
        : '<div class="empty-state">No core plays are available on the current board.</div>';
    }

    const exploratoryContainer = document.getElementById('leans-exploratory-cards');
    if (exploratoryContainer) {
      exploratoryContainer.innerHTML = exploratoryRows.length
        ? exploratoryRows.map(buildLeanCard).join('')
        : '<div class="empty-state">No exploratory plays are available on the current board.</div>';
    }
  }

  function renderReporting(status, reporting, monthly, comparison, performance, operationalStatus) {
    renderEngineMeta(document.getElementById('reporting-meta'), status);

    const summaryGrid = document.getElementById('policy-summary-grid');
    if (summaryGrid) {
      const cards = [
        {
          title: 'Active historical',
          summary: reporting.active_policy_historical_summary,
          note: `${status.active_engine.active_policy} / 2022-2025`
        },
        {
          title: 'Active shadow',
          summary: reporting.active_policy_shadow_summary,
          note: `Through ${reporting.source_coverage.shadow_results_through}`
        },
        ...comparison.comparators.map((entry) => ({
          title: entry.label,
          summary: entry.historical_summary,
          note: entry.policy_name
        }))
      ];
      summaryGrid.innerHTML = cards.map((card) => `
        <article class="metric-card">
          <strong>${card.title}</strong>
          <div class="metric-value ${Number(card.summary.units || 0) >= 0 ? 'metric-good' : 'metric-bad'}">${formatUnits(card.summary.units)}</div>
          <div class="subtle">${card.note}</div>
          <div class="meta-line">ROI ${formatPct(card.summary.roi)}</div>
          <div class="meta-line">Bets ${card.summary.bets ?? '—'}</div>
          <div class="meta-line">Max DD ${formatNumber(card.summary.max_drawdown, 2)}</div>
        </article>
      `).join('');
    }

    const performanceRows = Array.isArray(performance?.rows) ? performance.rows : [];
    const latestPerformanceRow = performanceRows.length ? performanceRows[performanceRows.length - 1] : null;
    const perfCoverageBadge = document.getElementById('performance-coverage-badge');
    if (perfCoverageBadge) {
      const throughDate = reporting?.source_coverage?.shadow_results_through || latestPerformanceRow?.board_date || 'unknown';
      perfCoverageBadge.textContent = `Results through ${throughDate}`;
    }

    const performanceSummaryGrid = document.getElementById('performance-summary-grid');
    if (performanceSummaryGrid) {
      const requestedBoardDate = operationalStatus?.boards?.operating_date || status.requested_board_date || 'unknown';
      const activeBoardDate = operationalStatus?.boards?.active_board_date || reporting.active_board_date || 'unknown';
      const latestValidBoard = operationalStatus?.boards?.latest_valid_mlb_ai_board_date || activeBoardDate;
      const latestCanonicalBoard = operationalStatus?.boards?.latest_canonical_board_date || 'unknown';
      performanceSummaryGrid.innerHTML = `
        <article class="metric-card">
          <strong>Results through</strong>
          <div class="metric-value">${reporting?.source_coverage?.shadow_results_through || 'unknown'}</div>
          <div class="subtle">2026 shadow grading currently stops at the latest settled active-board date.</div>
        </article>
        <article class="metric-card">
          <strong>Latest 2026 day</strong>
          <div class="metric-value">${latestPerformanceRow?.board_date || 'unknown'}</div>
          <div class="subtle">Requested ${requestedBoardDate}; active board ${activeBoardDate}</div>
        </article>
        <article class="metric-card">
          <strong>Cumulative units</strong>
          <div class="metric-value ${Number(latestPerformanceRow?.cumulative_units || 0) >= 0 ? 'metric-good' : 'metric-bad'}">${formatUnits(latestPerformanceRow?.cumulative_units)}</div>
          <div class="subtle">${latestPerformanceRow ? `${latestPerformanceRow.bets} bets on ${latestPerformanceRow.board_date}` : 'No 2026 rows available'}</div>
        </article>
        <article class="metric-card">
          <strong>Board coverage</strong>
          <div class="metric-value">${latestValidBoard}</div>
          <div class="subtle">Canonical betting date ${latestCanonicalBoard}</div>
        </article>
      `;
    }

    const dailyPerformanceBody = document.querySelector('#daily-performance-table tbody');
    if (dailyPerformanceBody) {
      dailyPerformanceBody.innerHTML = performanceRows.length
        ? performanceRows.map((row) => `
          <tr>
            <td>${row.board_date}</td>
            <td>${row.bets}</td>
            <td>${row.wins}</td>
            <td>${row.losses}</td>
            <td>${row.pushes}</td>
            <td>${formatPct(row.win_rate)}</td>
            <td>${formatUnits(row.units)}</td>
            <td>${formatPct(row.roi)}</td>
            <td>${formatUnits(row.cumulative_units)}</td>
          </tr>
        `).join('')
        : '<tr><td colspan="9" class="subtle">No 2026 daily performance rows are available.</td></tr>';
    }

    const monthlyBody = document.querySelector('#monthly-table tbody');
    if (monthlyBody) {
      const order = [
        ['v8_balanced', 'V8 balanced'],
        ['soft_plus_half_sigma', 'V7 production'],
        ['hybrid_top25_cap3', 'V7 hybrid'],
        ['v8_light', 'V8 light']
      ];
      monthlyBody.innerHTML = order.flatMap(([key, label]) =>
        (monthly.policies[key] || []).map((row) => `
          <tr>
            <td>${row.month}</td>
            <td>${label}</td>
            <td>${row.bets}</td>
            <td>${row.wins}</td>
            <td>${row.losses}</td>
            <td>${row.pushes}</td>
            <td>${formatPct(row.win_pct)}</td>
            <td>${formatUnits(row.units)}</td>
            <td>${formatPct(row.roi)}</td>
          </tr>
        `)
      ).join('');
    }

    const contextBlocks = document.getElementById('context-breakdowns');
    if (contextBlocks) {
      const sections = [
        ['side_mix', 'Side mix'],
        ['total_bucket_mix', 'Total bucket mix'],
        ['price_bucket_mix', 'Price bucket mix'],
        ['wind_mix', 'Wind mix'],
        ['bullpen_mix', 'Bullpen mix'],
        ['action_mix', 'Action mix']
      ];
      contextBlocks.innerHTML = sections.map(([key, title]) => {
        const rows = reporting.context_breakdowns[key] || [];
        return `
          <article class="context-card">
            <strong>${title}</strong>
            ${rows.slice(0, 6).map((row) => `
              <div class="meta-line">${row.bucket}: ${formatUnits(row.units)} / ${formatPct(row.roi)} / ${row.bets} bets</div>
            `).join('')}
          </article>
        `;
      }).join('');
    }
  }

  try {
    const operationalStatus = await loadJson('mlb_operational_status_v1.json');
    renderOperationalStatusStrip(operationalStatus);
    const status = await loadJson('mlb_ai_active_engine_status_v1.json');
    if (page === 'home') {
      renderHome(status);
      return;
    }
    if (page === 'leans') {
      const leans = await loadJson('mlb_ai_daily_leans_v1.json');
      renderLeans(status, leans, operationalStatus);
      return;
    }
    if (page === 'reporting') {
      const reporting = await loadJson('mlb_ai_reporting_v1.json');
      const monthly = await loadJson('mlb_ai_reporting_monthly_v1.json');
      const comparison = await loadJson('mlb_ai_policy_comparison_v1.json');
      const performance = await loadJson('mlb_ai_daily_performance_2026_v1.json');
      renderReporting(status, reporting, monthly, comparison, performance, operationalStatus);
    }
  } catch (error) {
    const shell = document.querySelector('.shell') || document.body;
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.innerHTML = `<div class="empty-state">Failed to load MLB AI viewer artifacts: ${error.message}</div>`;
    shell.appendChild(panel);
  }
}());
