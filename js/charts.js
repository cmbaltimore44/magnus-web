// Small DOM chart helpers for Library stats, Log and Insights. Bars use the
// theme accent; every number is also printed as text, so nothing depends
// on reading the bar lengths.

export function statTiles(tiles) {
  const grid = document.createElement('div');
  grid.className = 'stat-grid';
  tiles.forEach(({ label, value }) => {
    const tile = document.createElement('div');
    tile.className = 'stat-tile';
    const v = document.createElement('div');
    v.className = 'stat-value';
    v.textContent = value;
    const l = document.createElement('div');
    l.className = 'stat-label';
    l.textContent = label;
    tile.append(v, l);
    grid.appendChild(tile);
  });
  return grid;
}

export function section(title, ...children) {
  const wrap = document.createElement('section');
  wrap.className = 'stat-section';
  const h = document.createElement('h2');
  h.className = 'meta-label stat-section-title';
  h.textContent = title;
  wrap.appendChild(h);
  children.filter(Boolean).forEach((c) => wrap.appendChild(typeof c === 'string' ? note(c) : c));
  return wrap;
}

export function note(text) {
  const p = document.createElement('p');
  p.className = 'stat-note';
  p.textContent = text;
  return p;
}

// Horizontal bars: rows = [{ label, value, display? }]. `wide`: room for
// longer values like "3 h 20 min".
export function barList(rows, { max, wide = false } = {}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  const list = document.createElement('div');
  list.className = wide ? 'bar-list bar-list-wide' : 'bar-list';
  rows.forEach(({ label, value, display }) => {
    const row = document.createElement('div');
    row.className = 'bar-row';
    const l = document.createElement('span');
    l.className = 'bar-label';
    l.textContent = label;
    l.title = label;
    const track = document.createElement('span');
    track.className = 'bar-track';
    const fill = document.createElement('span');
    fill.className = 'bar-fill';
    fill.style.width = `${top ? (value / top) * 100 : 0}%`;
    track.appendChild(fill);
    const v = document.createElement('span');
    v.className = 'bar-value';
    v.textContent = display ?? String(value);
    row.append(l, track, v);
    list.appendChild(row);
  });
  return list;
}

// Vertical columns over time: points = [{ label, value, title? }] (value may
// be null for "nothing logged"). Labels print under every `labelEvery`th column.
export function columnChart(points, { max, labelEvery = 1, showValues = true } = {}) {
  const top = max ?? Math.max(1, ...points.map((p) => p.value ?? 0));
  const chart = document.createElement('div');
  chart.className = 'column-chart';
  chart.style.setProperty('--cols', points.length);
  points.forEach((p, i) => {
    const col = document.createElement('div');
    col.className = 'column-chart-col';
    col.title = p.title ?? `${p.label}: ${p.value ?? '—'}`;
    const v = document.createElement('span');
    v.className = 'column-chart-value';
    v.textContent = showValues && p.value != null ? String(p.value) : '';
    const bar = document.createElement('span');
    bar.className = 'column-chart-bar' + (p.value == null ? ' empty' : '');
    bar.style.height = `${p.value ? Math.max(2, (p.value / top) * 100) : 0}%`;
    const barWrap = document.createElement('span');
    barWrap.className = 'column-chart-barwrap';
    barWrap.append(v, bar);
    const l = document.createElement('span');
    l.className = 'column-chart-label';
    l.textContent = i % labelEvery === 0 ? p.label : '';
    col.append(barWrap, l);
    chart.appendChild(col);
  });
  return chart;
}
