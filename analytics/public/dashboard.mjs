const $ = (selector) => document.querySelector(selector);
const format = new Intl.NumberFormat('en');
const labels = {
  direct: 'Direct / unknown',
  internal: 'Internal',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  google: 'Google',
  bing: 'Bing',
  x: 'X / Twitter',
  youtube: 'YouTube',
  facebook: 'Facebook',
  other: 'Other websites',
  desktop: 'Desktop',
  mobile: 'Mobile',
  tablet: 'Tablet',
  unknown: 'Unknown',
};
let report;
let controller;

function cells(parent, values, tag = 'td') {
  const row = document.createElement('tr');
  for (const value of values) {
    const cell = document.createElement(tag);
    cell.textContent = value;
    row.append(cell);
  }
  parent.append(row);
}
function table(id, values, total) {
  const root = $(id);
  root.replaceChildren();
  if (!values.length) {
    cells(root, ['No data yet', '—', '—']);
    return;
  }
  for (const value of values)
    cells(root, [
      labels[value.name] || value.name,
      format.format(value.count),
      `${Math.round((value.count / total) * 100)}%`,
    ]);
}
function svg(name, attributes, text) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes))
    element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}
function chart(daily) {
  const root = $('#chart');
  root.replaceChildren();
  const max = Math.max(1, ...daily.map((day) => day.views));
  root.append(
    svg(
      'title',
      {},
      `Daily counts. ${daily.map((day) => `${day.date}: ${day.views ?? 'unavailable'} requests, ${day.visitors ?? 'unavailable'} estimated visitors`).join('; ')}`,
    ),
  );
  for (const ratio of [0, 0.5, 1]) {
    const y = 200 - ratio * 160;
    root.append(svg('line', { x1: 55, y1: y, x2: 890, y2: y, class: 'grid' }));
    root.append(
      svg(
        'text',
        { x: 45, y: y + 5, 'text-anchor': 'end' },
        format.format(Math.round(max * ratio)),
      ),
    );
  }
  const width = 825 / daily.length;
  for (const [index, day] of daily.entries()) {
    if (day.views === null) continue;
    const height = (day.views / max) * 160;
    const bar = svg('rect', {
      x: 60 + index * width,
      y: 200 - height,
      width: Math.max(1, width * 0.65),
      height,
      rx: 2,
      class: 'bar',
    });
    bar.append(
      svg(
        'title',
        {},
        `${day.date}: ${format.format(day.views)} page requests`,
      ),
    );
    root.append(bar);
  }
  let segment = [];
  const draw = () => {
    if (segment.length)
      root.append(
        svg('polyline', { class: 'visitor-line', points: segment.join(' ') }),
      );
    segment = [];
  };
  for (const [index, day] of daily.entries()) {
    if (day.visitors === null) {
      draw();
      continue;
    }
    segment.push(
      `${60 + index * width + width * 0.325},${200 - (day.visitors / max) * 160}`,
    );
  }
  draw();
  root.append(svg('text', { x: 55, y: 230 }, daily[0].date));
  root.append(
    svg('text', { x: 890, y: 230, 'text-anchor': 'end' }, daily.at(-1).date),
  );
}
function render(data) {
  $('#views').textContent = format.format(data.views);
  $('#visitors').textContent = data.identifiedRequests
    ? format.format(data.visitors)
    : data.views || !data.visitorCountingReady
      ? '—'
      : '0';
  $('#errors').textContent = format.format(data.errors);
  const mobile = data.devices
    .filter((row) => ['mobile', 'tablet'].includes(row.name))
    .reduce((sum, row) => sum + row.count, 0);
  $('#mobile').textContent = data.views
    ? `${Math.round((mobile / data.views) * 100)}%`
    : '—';
  $('#range').textContent =
    `${data.start} to ${data.end} · JST · Today is partial`;
  $('#empty').hidden = data.views !== 0;
  for (const key of ['pages', 'sources', 'devices'])
    table(`#${key}`, data[key], data.views);
  $('#daily').replaceChildren();
  for (const day of data.daily)
    cells($('#daily'), [
      day.date,
      day.visitors === null ? '—' : format.format(day.visitors),
      day.views === null ? '—' : format.format(day.views),
      day.errors === null ? '—' : format.format(day.errors),
    ]);
  chart(data.daily);
  const date = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  });
  $('#coverage').textContent =
    `Collection began ${date.format(new Date(data.startedAt))} JST. Earlier dates have no collected data.`;
  $('#visitor-coverage').textContent = !data.visitorCountingReady
    ? 'Visitor counting is unavailable: the configured proxy could not be resolved. Page requests are still counted.'
    : data.views && data.identifiedRequests < data.views
      ? `Visitor estimates cover ${format.format(data.identifiedRequests)} of ${format.format(data.views)} page requests. Check the proxy’s client-address forwarding if this remains incomplete.`
      : 'Visitor estimates use the configured proxy address. The total sums daily estimates, not unique people across the entire period.';
  $('#status').textContent =
    `Updated ${date.format(new Date(data.generatedAt))} JST. Refresh to load new counts.`;
  $('#status').className = '';
  $('#report').hidden = false;
}
async function refresh() {
  controller?.abort();
  const request = new AbortController();
  controller = request;
  const timeout = setTimeout(() => request.abort(), 15_000);
  $('#refresh').disabled = true;
  $('#report').hidden = true;
  $('#status').className = '';
  $('#status').textContent = 'Loading analytics…';
  try {
    const response = await fetch(
      `/analytics/data.json?days=${$('#period').value}`,
      { cache: 'no-store', credentials: 'same-origin', signal: request.signal },
    );
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? 'Sign in again by reloading this page.'
          : 'Analytics are unavailable. Try Refresh in a moment.',
      );
    const data = await response.json();
    if (controller !== request) return;
    render(data);
    report = data;
  } catch (error) {
    if (controller !== request) return;
    report = null;
    $('#status').className = 'error';
    $('#status').textContent =
      error.name === 'AbortError'
        ? 'The request timed out. Try Refresh again.'
        : error.message;
  } finally {
    clearTimeout(timeout);
    if (controller === request) $('#refresh').disabled = false;
  }
}
$('#refresh').addEventListener('click', refresh);
$('#period').addEventListener('change', refresh);
$('#export').addEventListener('click', () => {
  if (!report) return;
  const csv = [
    'date_jst,estimated_daily_visitors,page_requests,http_errors',
    ...report.daily.map(
      (day) =>
        `${day.date},${day.visitors ?? ''},${day.views ?? ''},${day.errors ?? ''}`,
    ),
  ].join('\r\n');
  const url = URL.createObjectURL(
    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `gyaruinthemix-${report.start}-${report.end}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
refresh();
