/*!
 * Sub-agents and Crews for Banda mockups (the sub-agent brief, §3 and §5:
 * the brand workspace's artifacts/subagents/concept-brief.md).
 * Needs kit.css + sub.css; load after icons.js (and mark.js). No deps.
 *
 * The satellite: one small shape per sub-agent, shape = state (ADR 0099 grammar).
 *   working ● filled circle, grey      asks    ▲ rounded triangle, orange
 *   failed  ⯃ octagon, red             done    ■ rounded square, fg 70%
 *   stopped □ outline square           queued  ◌ dashed circle (Crews only)
 *   lost    □ faint outline, a gap     aliases: running, error, cancelled, waiting, cached…
 *
 *   Sub.sat(state, size=10, {dim, tip})  -> '<span class="s-sat" data-sat=…><svg…></span>'
 *   <span data-sat="asks" data-size="10" [data-dim] [data-tip="…"]></span>   mounted on load
 *   Sub.set(el, state)                  blends a mounted satellite to a new state
 *                                       (0.45 s; a new shape family leaps, 0.6 s)
 *   Sub.glyph(states|crewState, size=16) the Crew glyph: 3 satellites in a cluster
 *   <span data-glyph="running|finished|lost|asks" or "working asks done"></span>
 *
 *   Sub.strip(el, {phases:[{title, agents:[state | {state,label,dim}]}], current, size, max})
 *       renders a Crew strip; a phase with > max (24) agents, or one that does not fit
 *       on one line, becomes a segmented bar. Re-fits on resize.
 *   <div data-strip="Scan: done*4 | Fix: done done failed working asks | Verify: queued*3"
 *        data-current="1" data-size="8"></div>                         mounted on load
 *   Dots: hover shows a tip, click fires 'sub:open' {phase, index, agent} (bubbles).
 *
 *   Sub.row({state, title, role, now, time, wt, deep, tag, path, open, stop, detail}) -> HTML
 *   Sub.group({title, members:[row data], more, settled, folded}) -> HTML
 *   Sub.crew(el, {state, name, desc, phases, current, narrator, foot, time, action}) renders a card
 *   Sub.counts(states, {noun:'agents', total:true, queued:true}) -> '12 agents · 2 working · …'
 *   Sub.tally(states) -> {working, asks, done, failed, stopped, queued, lost, total}
 *   Sub.icon(name, size)  kit icons plus 'panel-right' (Open beside) and 'stop';
 *                         in markup: <i data-sicon="panel-right" data-size="14"></i>
 *   Sub.word(state)       'Working' | 'Asks' | 'Done' | 'Failed' | 'Stopped' | 'Queued' | 'Lost'
 *   Sub.scan(root)        mounts [data-sat], [data-glyph], [data-strip]; fits fades
 *   Sub.fit(root)         .s-fit fades its end, .s-path its start, only when it overflows
 *   Any [data-tip] shows a small tip on hover (one floating element).
 */
(function (global) {
  'use strict'
  var ALIAS = { running: 'working', retrying: 'working', asking: 'asks', ask: 'asks', error: 'failed', errored: 'failed',
    blocked: 'failed', cancelled: 'stopped', skipped: 'stopped', interrupted: 'stopped', waiting: 'queued', pending: 'queued',
    unknown: 'lost', cached: 'done', completed: 'done' }
  var FAMILY = { working: 'circle', queued: 'circle', asks: 'triangle', failed: 'octagon', done: 'square', stopped: 'square', lost: 'square' }
  var WORD = { working: 'Working', asks: 'Asks', done: 'Done', failed: 'Failed', stopped: 'Stopped', queued: 'Queued', lost: 'Lost' }
  var SETTLED = { done: 1, failed: 1, stopped: 1, lost: 1 }
  var norm = function (s) { s = String(s || 'working').toLowerCase(); s = ALIAS[s] || s; return FAMILY[s] ? s : 'working' }
  var n2 = function (v) { return Math.round(v * 100) / 100 }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] }) }

  // ---- icons: the kit's, plus two it lacks
  var EXTRA = {
    'panel-right': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none"/>',
  }
  function icon(name, size) {
    size = size || 15
    if (EXTRA[name]) return '<svg class="b-icon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + EXTRA[name] + '</svg>'
    return global.BandaIcons ? global.BandaIcons.svg(name, size) : ''
  }

  // ---- the satellite's shapes, in pixels, in an S×S box at (ox, oy)
  function shape(st, S, ox, oy) {
    ox = ox || 0; oy = oy || 0
    var c = S / 2, sw = S >= 16 ? 1.5 : S >= 12 ? 1.25 : 1
    var pad = Math.max(1, Math.round(S * 0.09)), side = S - 2 * pad, rx = side * 0.3
    var at = function (x, y) { return n2(ox + x) + ' ' + n2(oy + y) }
    var line = 'fill="none" stroke="currentColor" stroke-width="' + sw + '"'
    if (st === 'working') return '<circle cx="' + n2(ox + c) + '" cy="' + n2(oy + c) + '" r="' + n2(side / 2 + S * 0.06) + '" fill="currentColor"/>'
    if (st === 'queued') {
      var r = side / 2 + S * 0.06 - sw / 2, C = 2 * Math.PI * r, k = S <= 8 ? 5 : S <= 12 ? 6 : 8
      return '<circle cx="' + n2(ox + c) + '" cy="' + n2(oy + c) + '" r="' + n2(r) + '" ' + line + ' stroke-dasharray="' + n2(C / k * 0.55) + ' ' + n2(C / k * 0.45) + '" transform="rotate(-90 ' + at(c, c) + ')"/>'
    }
    if (st === 'done') return '<rect x="' + n2(ox + pad) + '" y="' + n2(oy + pad) + '" width="' + side + '" height="' + side + '" rx="' + n2(rx) + '" fill="currentColor"/>'
    if (st === 'stopped') return '<rect x="' + n2(ox + pad + sw / 2) + '" y="' + n2(oy + pad + sw / 2) + '" width="' + n2(side - sw) + '" height="' + n2(side - sw) + '" rx="' + n2(Math.max(0.5, rx - sw / 2)) + '" ' + line + '/>'
    if (st === 'lost') { // the outline square with its top-right corner gone
      var x0 = pad + sw / 2, s = side - sw, q = Math.max(0.5, rx - sw / 2), g = Math.max(0.8, S * 0.1)
      return '<path d="M' + at(x0 + s, x0 + q + g) + 'V' + n2(oy + x0 + s - q) + 'A' + q + ' ' + q + ' 0 0 1 ' + at(x0 + s - q, x0 + s) +
        'H' + n2(ox + x0 + q) + 'A' + q + ' ' + q + ' 0 0 1 ' + at(x0, x0 + s - q) + 'V' + n2(oy + x0 + q) + 'A' + q + ' ' + q + ' 0 0 1 ' +
        at(x0 + q, x0) + 'H' + n2(ox + x0 + s - q - g) + '" ' + line + ' stroke-linecap="round"/>'
    }
    if (st === 'asks') { // rounded by a round-joined stroke as wide as the corner
      var kk = S * 0.14, W = S * 1.04, H = S * 0.92, top = (S - H) / 2 - S * 0.02
      var pts = [at(c, top + kk), at(c + W / 2 - kk, top + H - kk), at(c - W / 2 + kk, top + H - kk)].join(' ')
      return '<polygon points="' + pts + '" fill="currentColor" stroke="currentColor" stroke-width="' + n2(2 * kk) + '" stroke-linejoin="round"/>'
    }
    // failed: an octagon as wide as the box, its flats on whole pixels so it reads
    // as cut corners, not a circle, even at 8px; corners eased by a round join
    var k2 = S >= 12 ? 0.75 : 0.5, cut = Math.round(S * 0.293 * 2) / 2 - k2 * 0.414, lo = k2, hi = S - k2
    var p = [[lo + cut, lo], [hi - cut, lo], [hi, lo + cut], [hi, hi - cut], [hi - cut, hi], [lo + cut, hi], [lo, hi - cut], [lo, lo + cut]].map(function (q) { return at(q[0], q[1]) })
    return '<polygon points="' + p.join(' ') + '" fill="currentColor" stroke="currentColor" stroke-width="' + 2 * k2 + '" stroke-linejoin="round"/>'
  }
  function svgOf(st, S) {
    return '<svg width="' + S + '" height="' + S + '" viewBox="0 0 ' + S + ' ' + S + '" aria-hidden="true" data-shape="' + FAMILY[st] + '">' + shape(st, S) + '</svg>'
  }
  function sat(state, size, o) {
    var st = norm(state), S = +size || 10; o = o || {}
    return '<span class="s-sat' + (o.dim ? ' is-dim' : '') + '" data-sat="' + st + '" style="--sat:' + S + 'px"' +
      (o.tip ? ' data-tip="' + esc(o.tip) + '"' : '') + '>' + svgOf(st, S) + '</span>'
  }
  function mountSat(el) {
    var st = norm(el.getAttribute('data-sat')), S = +(el.getAttribute('data-size') || el.dataset.size || 10)
    el.classList.add('s-sat'); el.setAttribute('data-sat', st); el.style.setProperty('--sat', S + 'px')
    if (el.hasAttribute('data-dim')) el.classList.add('is-dim')
    el.innerHTML = svgOf(st, S); el.__sat = { st: st, S: S }
  }
  // A state change blends (0.45 s); a new shape family leaps a little (0.6 s), as the Mark does.
  function set(el, state) {
    if (!el.__sat) mountSat(el)
    var st = norm(state), cur = el.__sat
    if (st === cur.st) return
    var old = el.querySelector('svg:not(.is-out)'), t = document.createElement('template')
    t.innerHTML = svgOf(st, cur.S); var nu = t.content.firstChild
    nu.classList.add(FAMILY[st] === FAMILY[cur.st] ? 'is-in' : 'is-leap')
    if (old) { old.classList.add('is-out'); setTimeout(function () { old.remove() }, 460) }
    el.appendChild(nu); el.setAttribute('data-sat', st); cur.st = st
  }

  // ---- the Crew glyph: three satellites in a small cluster
  var GLYPH = { running: ['working', 'working', 'working'], finished: ['done', 'done', 'done'], lost: ['lost', 'lost', 'lost'],
    asks: ['queued', 'queued', 'queued'], relaunched: ['working', 'working', 'done'] }
  function glyph(states, size) {
    var G = +size || 16
    var list = (typeof states === 'string' ? (GLYPH[states] || states.split(/[\s,]+/)) : (states || GLYPH.running)).map(norm)
    var s = Math.round(G * 0.44), e = (G - 2 * s) / 3, pos = [[(G - s) / 2, e * 0.6], [e * 0.6, G - s - e * 0.6], [G - s - e * 0.6, G - s - e * 0.6]]
    var body = pos.map(function (p, i) { var st = list[i] || list[0]; return '<g class="s-gsat" data-sat="' + st + '">' + shape(st, s, p[0], p[1]) + '</g>' }).join('')
    return '<span class="s-glyph" style="--glyph:' + G + 'px"><svg width="' + G + '" height="' + G + '" viewBox="0 0 ' + G + ' ' + G + '" aria-hidden="true">' + body + '</svg></span>'
  }

  // ---- counts
  function tally(states) {
    var t = { working: 0, asks: 0, done: 0, failed: 0, stopped: 0, queued: 0, lost: 0, total: 0 }
    ;(states || []).forEach(function (a) { t[norm(a && a.state || a)]++; t.total++ })
    return t
  }
  function counts(states, o) {
    o = o || {}; var t = Array.isArray(states) ? tally(states) : states, out = []
    if (o.total !== false) out.push(t.total + ' ' + (o.noun || 'agents'))
    if (t.working) out.push(t.working + ' working')
    if (t.asks) out.push('<span class="s-n-asks">' + t.asks + ' asks</span>')
    if (t.done) out.push(t.done + ' done')
    if (t.failed) out.push('<span class="s-n-failed">' + t.failed + ' failed</span>')
    if (t.stopped) out.push(t.stopped + ' stopped')
    if (t.queued && o.queued !== false) out.push(t.queued + ' waiting')
    if (t.lost) out.push(t.lost + ' lost')
    return out.join(' · ')
  }

  // ---- the Crew strip
  function parseStrip(src) { // "Scan: done*4 | Fix: done failed working | Verify: queued*3"
    return { phases: String(src).split('|').map(function (part) {
      var m = part.split(':'), title = m[0].trim(), agents = []
      ;(m[1] || '').trim().split(/[\s,]+/).filter(Boolean).forEach(function (tok) {
        var r = tok.split('*'), dim = /^~/.test(r[0]), st = r[0].replace(/^~/, '')
        for (var i = 0; i < (+r[1] || 1); i++) agents.push(dim ? { state: st, dim: true } : st)
      })
      return { title: title, agents: agents }
    }) }
  }
  function currentOf(d) {
    if (typeof d.current === 'number') return d.current
    if (typeof d.current === 'string') { for (var i = 0; i < d.phases.length; i++) if (d.phases[i].title === d.current) return i }
    for (var j = 0; j < d.phases.length; j++) {
      if (d.phases[j].agents.some(function (a) { var st = norm(a.state || a); return !SETTLED[st] || st === 'lost' })) return j
    }
    return d.phases.length // all settled: every phase is past
  }
  function drawStrip(el, d, bars) {
    var cur = currentOf(d), size = d.size || 8, max = d.max || 24, html = []
    d.phases.forEach(function (p, i) {
      var when = i < cur ? 'is-past' : i === cur ? 'is-current' : 'is-future'
      var t = tally(p.agents), settled = t.done + t.failed + t.stopped, bar = bars[i] || p.agents.length > max
      var name = '<span class="s-ph-name">' + (when === 'is-past' && t.total && t.done === t.total ? icon('check', 12) : '') + esc(p.title) +
        (when === 'is-current' && t.total && !bar ? ' <span class="s-ph-n">' + settled + '/' + t.total + '</span>' : '') + '</span>'
      var body = ''
      if (bar) {
        body = '<span class="s-bar" data-tip="' + esc(p.title + ' · ' + counts(t, { noun: 'agents' }).replace(/<[^>]+>/g, '')) + '">' +
          ['done', 'failed', 'asks', 'working', 'stopped', 'lost', 'queued'].map(function (k) { return t[k] ? '<i data-sat="' + k + '" style="flex-grow:' + t[k] + '"></i>' : '' }).join('') +
          '</span><span class="s-ph-n">' + settled + '/' + t.total + '</span>'
      } else if (t.total) {
        body = '<span class="s-dots">' + p.agents.map(function (a, k) {
          var st = norm(a.state || a), label = a.label ? a.label + ' · ' : ''
          return sat(st, size, { dim: a.dim, tip: label + (a.dim ? 'Done · from last run' : WORD[st]) }).replace('<span ', '<span data-i="' + i + ':' + k + '" ')
        }).join('') + '</span>'
      }
      if (i) html.push('<span class="s-rule"></span>')
      html.push('<span class="s-phase ' + when + (bar ? ' has-bar' : '') + '">' + name + body + '</span>')
    })
    el.innerHTML = html.join('')
  }
  function strip(el, data) {
    if (typeof el === 'string') el = document.querySelector(el)
    if (!el) return null
    var d = typeof data === 'string' ? parseStrip(data) : Object.assign({}, data)
    d.phases = (d.phases || []).map(function (p) { return { title: p.title, agents: p.agents || [] } })
    el.__strip = d
    el.classList.add('s-strip'); el.classList.toggle('is-big', (d.size || 8) >= 10)
    var bars = {}
    drawStrip(el, d, bars)
    // one line, always: the busiest dotted phase turns into a bar until it fits
    for (var guard = 0; guard < 8 && el.scrollWidth > el.clientWidth + 1; guard++) {
      var best = -1, most = 3
      d.phases.forEach(function (p, i) { if (!bars[i] && p.agents.length > most) { best = i; most = p.agents.length } })
      if (best < 0) break
      bars[best] = true; drawStrip(el, d, bars)
    }
    if (!el.__wired) {
      el.__wired = true
      el.addEventListener('click', function (e) {
        var dot = e.target.closest('[data-i]'); if (!dot) return
        var ik = dot.getAttribute('data-i').split(':'), p = el.__strip.phases[+ik[0]]
        el.dispatchEvent(new CustomEvent('sub:open', { bubbles: true, detail: { phase: p.title, index: +ik[1], agent: p.agents[+ik[1]] } }))
      })
      if (global.ResizeObserver) { var w = el.clientWidth; new ResizeObserver(function () { if (el.clientWidth !== w) { w = el.clientWidth; strip(el, el.__strip) } }).observe(el) }
    }
    return el
  }

  // ---- rows, groups, cards as HTML (markup is in sub.css's header too)
  function row(r) {
    var st = norm(r.state), stop = r.stop !== false && (st === 'working' || st === 'asks')
    var now = r.now == null ? '' : st === 'asks' && !/^<|^Asks/.test(r.now) ? '<b>Asks:</b> ' + esc(r.now) : r.now
    var title = r.path ? '<span class="s-title s-path"><span>' + esc(r.title) + '</span></span>' : '<span class="s-title s-fit">' + esc(r.title) + '</span>'
    return '<div class="s-row' + (r.open ? ' is-open' : '') + (r.dim ? ' is-dim' : '') + '" data-state="' + st + '">' +
      '<div class="s-line" tabindex="0"><span class="s-slot">' + sat(st, 10, { dim: r.dim }) + '</span>' + title +
      (r.role ? '<span class="s-role">' + esc(r.role) + '</span>' : '') +
      (r.deep ? '<span class="s-deep" data-tip="Its own sub-agents">+' + r.deep + '</span>' : '') +
      (r.wt ? '<span class="s-wt">' + icon('git-branch', 12) + esc(r.wt) + '</span>' : '') +
      (st === 'failed' && r.tag !== false ? '<span class="b-tag is-failed">Failed</span>' : '') +
      (r.tag && r.tag !== true ? '<span class="b-tag">' + esc(r.tag) + '</span>' : '') +
      '<span class="s-now">' + now + '</span>' +
      (r.time ? '<span class="s-time">' + esc(r.time) + '</span>' : '') +
      '<span class="s-acts"><button class="b-act" title="Open beside">' + icon('panel-right', 14) + '</button>' +
      (stop ? '<button class="b-act" title="Stop">' + icon('stop', 14) + '</button>' : '') + '</span>' +
      '<span class="s-chev">' + icon('chevron-right', 14) + '</span></div>' +
      (r.detail ? '<div class="s-detail">' + r.detail + '</div>' : '') + '</div>'
  }
  function group(g) {
    var ms = g.members || [], states = ms.map(function (m) { return m.state }).concat(g.moreStates || [])
    var head = g.title || (g.settled ? 'Ran ' + states.length + ' sub-agents' + (g.time ? ' · ' + g.time : '')
      : states.length + ' sub-agents · ' + counts(states, { total: false, queued: true }))
    var lead = states.slice(0, 3).map(function (s) { return sat(s, 8) }).join('')
    return '<div class="s-group' + (g.settled ? ' is-settled' : '') + (g.folded ? ' is-folded' : '') + '">' +
      '<div class="s-line s-ghead" tabindex="0"><span class="s-sats">' + lead + '</span><span class="s-gtitle s-fit">' + head + '</span>' +
      '<span class="s-chev">' + icon('chevron-right', 14) + '</span></div>' +
      '<div class="s-members">' + ms.map(row).join('') + (g.more ? '<div class="s-more">+ ' + g.more + ' more</div>' : '') + '</div></div>'
  }
  var CREW_FOOT = {
    finished: function (all, d) { var t = tally(all); return t.total + ' agents · ' + d.phases.length + ' phases' + (t.failed ? ' · <span class="s-n-failed">' + t.failed + ' failed</span>' : '') },
    lost: function (all) { var t = tally(all); return 'Stopped when Banda restarted · ' + t.done + ' of ' + t.total + ' done' },
    asks: function () { return '<span class="s-n-asks">Waiting for your OK</span> · not started' },
  }
  function crew(el, d) {
    if (typeof el === 'string') el = document.querySelector(el)
    var st = d.state || 'running', all = []
    ;(d.phases || []).forEach(function (p) { all = all.concat(p.agents || []) })
    var foot = d.foot || (CREW_FOOT[st] ? CREW_FOOT[st](all, d) : counts(all))
    if (st === 'relaunched' && !d.foot) { var back = all.filter(function (a) { return a.dim }).length; if (back) foot += ' · ' + back + ' from last run' }
    var action = d.action != null ? d.action : st === 'lost' ? '<button class="b-btn is-outline is-sm">Ask Claude to go on</button>' : ''
    el.classList.add('s-crew')
    el.setAttribute('data-crew', st)
    el.innerHTML = '<div class="s-crew-head">' + glyph(d.glyph || st, 16) + '<span class="s-crew-title"><span class="s-crew-word">Crew ·</span> ' + esc(d.name) + '</span>' +
      (d.desc ? '<span class="s-crew-desc s-fit">' + esc(d.desc) + '</span>' : '') + '</div>' +
      '<div class="s-strip"></div>' +
      (d.narrator ? '<div class="s-narr">' + icon('chevron-right', 12) + '<span class="s-fit">' + esc(d.narrator) + '</span></div>' : '') +
      '<div class="s-crew-foot"><span class="s-crew-counts s-fit">' + foot + '</span>' + (d.time && st !== 'lost' ? '<span class="s-crew-time">' + esc(d.time) + '</span>' : '') +
      '<span class="s-crew-acts">' + action + (d.open === false ? '' : '<button class="b-btn is-ghost is-sm">Open' + '</button>') + '</span></div>'
    strip(el.querySelector('.s-strip'), { phases: d.phases, current: d.current, size: 8 })
    fit(el)
    return el
  }

  // ---- fades only when the text overflows
  function fit(root) {
    (root || document).querySelectorAll('.s-fit, .s-path').forEach(function (n) {
      var inner = n.classList.contains('s-path') ? n.firstElementChild : null
      var over = inner ? inner.getBoundingClientRect().width > n.clientWidth + 0.5 : n.scrollWidth > n.clientWidth + 0.5
      n.classList.toggle('is-over', over)
    })
  }

  // ---- one floating tip for every [data-tip]
  var tipEl = null
  function tipOn(e) {
    var t = e.target.closest && e.target.closest('[data-tip]')
    if (!t) { if (tipEl) tipEl.hidden = true; return }
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'b-tip s-tipfloat'; (document.querySelector('[data-theme]') || document.body).appendChild(tipEl) }
    tipEl.textContent = t.getAttribute('data-tip'); tipEl.hidden = false
    var b = t.getBoundingClientRect(); tipEl.style.left = (b.left + b.width / 2) + 'px'; tipEl.style.top = b.top + 'px'
  }

  function scan(root) {
    root = root || document
    root.querySelectorAll('[data-sat]').forEach(function (n) { if (!n.__sat && !n.querySelector('svg') && n.tagName !== 'I' && n.tagName !== 'g') mountSat(n) })
    root.querySelectorAll('[data-sicon]').forEach(function (n) { var t = document.createElement('template'); t.innerHTML = icon(n.getAttribute('data-sicon'), +(n.getAttribute('data-size') || 15)); if (t.content.firstChild) n.replaceWith(t.content.firstChild) })
    root.querySelectorAll('[data-glyph]').forEach(function (n) { if (n.__glyph) return; n.__glyph = 1; n.outerHTML = glyph(n.getAttribute('data-glyph'), +(n.getAttribute('data-size') || 16)) })
    root.querySelectorAll('[data-strip]').forEach(function (n) {
      if (n.__strip) return
      var d = parseStrip(n.getAttribute('data-strip')), c = n.getAttribute('data-current')
      if (c != null) d.current = /^\d+$/.test(c) ? +c : c
      if (n.getAttribute('data-size')) d.size = +n.getAttribute('data-size')
      if (n.getAttribute('data-max')) d.max = +n.getAttribute('data-max')
      strip(n, d)
    })
    fit(root)
  }

  var Sub = { sat: sat, set: set, glyph: glyph, strip: strip, row: row, group: group, crew: crew, counts: counts, tally: tally,
    icon: icon, word: function (s) { return WORD[norm(s)] }, norm: norm, scan: scan, fit: fit,
    states: ['working', 'asks', 'done', 'failed', 'stopped', 'queued', 'lost'] }
  global.Sub = Sub
  if (typeof document !== 'undefined') {
    var go = function () {
      scan()
      document.addEventListener('pointerover', tipOn)
      document.addEventListener('pointerleave', function () { if (tipEl) tipEl.hidden = true })
      if (document.fonts) document.fonts.ready.then(function () { fit() })
      var raf = 0; global.addEventListener('resize', function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(function () { fit() }) })
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go()
  }
})(typeof window !== 'undefined' ? window : this)
