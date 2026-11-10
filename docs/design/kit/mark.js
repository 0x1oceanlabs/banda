/*!
 * Banda Mark for mockups: the tile character with eyes, as approved on
 * 2026-11-09 (ADR 0099). A faithful, compact port of the engine in the
 * brand workspace's artifacts/sidebar-card/marks-final.html (and its port in
 * the sidebar prototype, client/proto-sidebar/src/mark/engine.js on the
 * branch proto/sidebar-inbox). Self-contained: no deps.
 *
 *   BandaMark.mount(el, { state, doing, satellites, size, logo, calls, still, seed, news, glance })
 *     -> { set(opts), destroy(), svg }
 *   BandaMark.scan(root)   mounts every [data-mark] under root (done on load)
 *   BandaMark.svg(opts)    a still SVG string, for static places
 *   BandaMark.quiet = true stills every call (asks hop, failed shake, woke ring)
 *
 * state:  asks | failed | done | woke | open | later | offline | working | rest
 *         (aliases: asking -> asks, idle -> open; rest = the logo with no eyes)
 * doing:  (with state "working") think | read | search | edit | execute | fetch |
 *         reply | other | subagents | compacting | stuck | limit
 * satellites: 0..3, or an array of up to 3 states, e.g. ["working","asks"]
 *         (one dot per running sub-agent; an array colours each dot by its own
 *         state: an extension for the sub-agent mocks, not in marks-final)
 * size:   px, default 16 (the sidebar row's size; 20 in the bar)
 * logo:   true draws the bar's logo: two tiles in the text's colour, and the
 *         Agent's hat, the only part that takes the state's colour and motion
 * calls:  false for the open Thread: same look, no call (no hop/shake/ring)
 * still:  true draws the still pose (reduced motion, tray, notifications)
 * news:   true plays the arrival (done flips, woke wakes up); by default a mark
 *         starts as if it had been there (ADR 0099 decision 4)
 * glance: awake marks look at the pointer over their row (default true)
 *
 * Declarative: <span data-mark="working" data-doing="execute" data-satellites="2" data-size="16"></span>
 * Colour: the SVG gets data-look; kit.css (or the small defaults injected
 * here) colours it. Dimming of working/later rows is the row's job.
 */
(function (global) {
  'use strict'
  // ---- shapes: a polygon grown by a radius, sampled by normal direction
  var POINTS = 160, CX = 76, CY = 22.5, TILT = -8
  var oct = []
  for (var i = 0; i < 8; i++) { var a0 = (i / 8) * Math.PI * 2 + Math.PI / 8; oct.push([18.6 * Math.cos(a0), 18.6 * Math.sin(a0)]) }
  var SHAPES = [
    { corners: [[-9, -7.5], [9, -7.5], [9, 7.5], [-9, 7.5]], radius: 15, eyes: [-1.5, 8.6] }, // square
    { corners: [[0, 0]], radius: 23.5, eyes: [-1, 8.2] },                                    // circle
    { corners: [[0, -16.5], [16, 12.5], [-16, 12.5]], radius: 8.5, eyes: [6.5, 7] },          // triangle
    { corners: oct, radius: 4.2, eyes: [-0.5, 8.2] },                                          // octagon
  ]
  var OUT = SHAPES.map(function (s) {
    var xs = new Float32Array(POINTS), ys = new Float32Array(POINTS)
    for (var i = 0; i < POINTS; i++) {
      var a = (i / POINTS) * Math.PI * 2 - Math.PI / 2, ux = Math.cos(a), uy = Math.sin(a), best = s.corners[0], far = -Infinity
      for (var k = 0; k < s.corners.length; k++) { var c = s.corners[k], d = c[0] * ux + c[1] * uy; if (d > far + 1e-9) { far = d; best = c } }
      xs[i] = best[0] + s.radius * ux; ys[i] = best[1] + s.radius * uy
    }
    return { xs: xs, ys: ys }
  })
  var SQ = 0, CI = 1, TR = 2, OC = 3
  var sin = Math.sin, cos = Math.cos, PI = Math.PI
  var clamp = function (t) { return Math.max(0, Math.min(1, t)) }
  var ease = function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 }
  var lerp = function (a, b, m) { return a + (b - a) * m }
  var only = function (i) { var w = [0, 0, 0, 0]; w[i] = 1; return w }
  var f = function (n) { return n.toFixed(2) }
  // The rhythm (ADR 0099 decision 4)
  var CALL = 4.4, BLINK = 3.7, BREATH = 2.6, SLEEP = 4.2
  var blink = function (time, every) { return (time % (every || BLINK) < .12 ? .08 : 1) }

  var BASE = { w: only(SQ), tx: 0, ty: 0, rot: 0, spin: 0, sx: 1, sy: 1, ex: 0, ey: 0, open: 1, big: 1, eye: 'open', eyes: 1, zz: 0, bells: 0, ring: 0, dots: null, cursor: 1, lensR: 5.2 }
  var KEYS = Object.keys(BASE)
  function P(o) { var p = {}; for (var k in BASE) p[k] = BASE[k]; for (var j in o) p[j] = o[j]; return p }
  function mix(a, b, m) {
    var o = {}
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i]
      if (k === 'w') o.w = a.w.map(function (v, j) { return lerp(v, b.w[j], m) })
      else if (k === 'eye') o.eye = m < .5 ? a.eye : b.eye
      else if (k === 'dots') o.dots = b.dots
      else o[k] = lerp(a[k], b[k], m)
    }
    return o
  }

  // ---- motions: (t since it began, time now, seed) -> pose
  function orbit(n, time, s, r) { // satellites: n dots circling; returns { dots, a } (a = the one it looks at)
    var a0 = (time + s) * 1.1, dots = [], who = Math.floor((time + s) / 1.6) % n
    for (var i = 0; i < n; i++) { var a = a0 + i * 2 * PI / n; dots.push([CX + 32 * cos(a), CY + 28 * sin(a), r || 3.1, .9]) }
    return { dots: dots, a: a0 + who * 2 * PI / n }
  }
  var M = {
    open: function (t, time, s) { var b = sin(2 * PI * (time + s) / BREATH), p = (time + s) % 6
      return P({ sx: 1 - .012 * b, sy: 1 + .03 * b, ex: p < 1 ? 0 : p < 2.6 ? -3.4 : p < 4.4 ? 3.4 : 0, open: blink(time + s) }) },
    think: function (t, time) { var s = sin(time * 2.2)
      return P({ w: [.12 + .1 * s, .76, .12 - .1 * s, 0], ty: -3 + 1.5 * sin(time * 2.8), rot: -4 + 5 * sin(time * 1.4), ex: 2.6 + .8 * sin(time * .9), ey: -3.2, open: blink(time * 1.1) }) },
    // reads: the body is still and breathes, the eyes run along lines
    read: function (t, time, s) { var L = 1.5, q = ((time + s) % (L * 3)), line = Math.floor(q / L), p = (q % L) / L
      var back = p > .85, x = back ? lerp(3.2, -3.2, (p - .85) / .15) : lerp(-3.2, 3.2, p / .85)
      return P({ w: only(CI), sy: 1 + .02 * sin(time * 2), sx: 1 - .01 * sin(time * 2), ex: x, ey: 1.2 + line * 1.4, open: back ? .25 : .62 }) },
    // writes to the Person: eyes down, types in short bursts
    reply: function (t, time, s) { var q = (time + s) % 1.3, on = q < .85, tap = on ? Math.max(0, sin((time + s) * PI * 14)) : 0
      return P({ w: only(CI), ex: lerp(-3, 3, on ? q / .85 : 1), ey: 3.4, open: .5, sy: 1 - .03 * tap, sx: 1 + .012 * tap }) },
    glance: function (t, time) { return P({ w: only(CI), ex: 2.6, ey: -3.4, open: blink(time * 1.3, 1.6), rot: -2 + 2 * sin(time * 1.5) }) },
    // edit: eyes down-right, the body leans with each stroke
    edit: function (t, time, s) { var st = sin((time + s) * PI * 3)
      return P({ w: only(CI), ex: 1.5 + 1.5 * st, ey: 3.4, open: .55, rot: 2.5 * st, sy: 1 - .015 * Math.abs(st) }) },
    // search: one eye is a lens; it moves slowly around, looking
    search: function (t, time, s) { var a = (time + s) * 1.3
      return P({ w: only(CI), eye: 'lens', ex: 2.6 * cos(a), ey: 1.8 * sin(2 * a), lensR: 5.2 + .4 * sin(time * 4) }) },
    // execute: the eyes become a prompt ">_", the cursor blinks (530 ms)
    execute: function (t, time, s) { return P({ w: only(CI), eye: 'prompt', cursor: ((time + s) % 1.06) < .53 ? 1 : 0, ex: -.5 }) },
    // fetch: looks far up, a dot goes out to the net and comes back
    fetch: function (t, time, s) { var q = ((time + s) % 2.4) / 2.4, out = q < .5 ? q / .5 : 1 - (q - .5) / .5
      return P({ w: only(CI), ex: 2.8, ey: -3, open: blink(time + s, 2.9), dots: [[CX + 26 + 14 * ease(out), CY - 16 - 10 * ease(out), 2.8, .9]] }) },
    // compacting the context: squeezes, eyes shut, lets go
    compacting: function (t, time, s) { var q = ((time + s) % 2.2) / 2.2, sq = q < .5 ? ease(q / .5) : 1 - ease((q - .5) / .5)
      return P({ w: only(CI), sx: 1 - .2 * sq, sy: 1 + .06 * sq, eye: sq > .4 ? 'closed' : 'open', open: .7 }) },
    // stuck: no event for 3+ min: droopy eyes, slower
    stuck: function (t, time, s) { var b = sin(2 * PI * (time + s) / SLEEP)
      return P({ w: only(CI), eye: 'half', ex: -1 + 2 * sin((time + s) * .4), ty: 1.5, rot: 5, sy: .97 + .03 * b, sx: 1.02 }) },
    // usage limit: dozes, sand drips beside it
    limit: function (t, time, s) { var q = ((time + s) % 1.8) / 1.8, b = sin(2 * PI * time / SLEEP)
      return P({ w: only(CI), eye: 'closed', ey: 2, rot: 5, sy: 1 + .03 * b, dots: [[CX + 30, CY - 14 + 26 * q, 2.6, sin(PI * q)]] }) },
    asks: function (t, time, s) { var p = (time + s) % CALL, ty = 0
      if (p < .3) ty = -6 * sin(PI * p / .3); else if (p > .35 && p < .65) ty = -4 * sin(PI * (p - .35) / .3)
      return P({ w: only(TR), ty: ty, rot: -6, ex: -2.5, ey: 1.5, big: 1.12, open: blink(time + s) }) },
    done: function (t, time) { if (t < 1.9) return flip(t); var b = sin(2 * PI * time / BREATH)
      return P({ eye: 'happy', sx: 1 - .012 * b, sy: 1 + .03 * b }) },
    // the stop sign: octagon, × eyes, a shake once a call beat
    failed: function (t, time, s) { var p = (time + s) % CALL, shake = p < .6 ? sin(time * 45) * 2.4 * (1 - p / .6) : 0
      return P({ w: only(OC), tx: shake, ty: 1, rot: -TILT + shake * 1.2, eye: 'cross' }) },
    // later: asleep: closed eyes, leans, breathes slowly, no zz
    later: function (t, time) { var b = sin(2 * PI * time / SLEEP)
      return P({ ty: 1.5, rot: 7, sx: 1 + .02 * b, sy: 1 + .04 * b, ey: 2.5, eye: 'closed' }) },
    offline: function (t, time) { var b = sin(2 * PI * time / SLEEP)
      return P({ ty: 1.5, rot: 7, sx: 1 + .02 * b, sy: 1 + .045 * b, ey: 2.5, eye: 'closed', zz: 1 }) },
    rest: function () { return P({ eyes: 0 }) },
  }
  function flip(t) {
    var pose = P({ eye: t > .2 ? 'happy' : 'open' })
    if (t < .25) { var c = ease(t / .25); return Object.assign(pose, { sy: 1 - .15 * c, sx: 1 + .08 * c }) }
    if (t < .95) { var q = (t - .25) / .7, a = sin(PI * q); return Object.assign(pose, { ty: -24 * a, spin: 360 * ease(q), w: [1 - a, a, 0, 0], sy: 1 + .06 * a }) }
    if (t < 1.2) { var a2 = sin(PI * (t - .95) / .25); return Object.assign(pose, { sy: 1 - .14 * a2, sx: 1 + .08 * a2 }) }
    return pose
  }
  // woke: an alarm clock: two bells, rings once a call beat
  function alarm(t, time, s) { var p = (time + s) % CALL, ring = p < .7 ? (1 - p / .7) : 0, w = sin(time * 55)
    return P({ big: 1.12, open: blink(time + s), bells: 1, ring: ring * w, rot: 3 * ring * w, tx: .8 * ring * w, ty: -1.5 * ring }) }
  // arrives asleep, stretches, opens its eyes into `into`
  function arrives(into) {
    return function (t, time, s) {
      var sleepPose = M.later(t, time)
      if (t < 1) return sleepPose
      var to = into(t - 1.6, time, s)
      if (t < 1.6) { var q = (t - 1) / .6, st = sin(PI * q), p = mix(sleepPose, to, ease(q))
        p.sy *= 1 + .16 * st; p.sx *= 1 - .05 * st; p.ty -= 3 * st
        p.eye = q < .35 ? 'closed' : to.eye; p.open = q < .35 ? 1 : lerp(.2, to.open, (q - .35) / .65); p.bells = to.bells * ease(q)
        return p }
      return to
    }
  }
  // several quiet motions in a row, blended at the seams ("other")
  function seq(parts) {
    var total = parts.reduce(function (n, p) { return n + p[0] }, 0)
    return function (t0, time, s) {
      var t = (time + s * 7) % total, at = 0
      for (var i = 0; i < parts.length; i++) { var d = parts[i][0], m = parts[i][1]
        if (t < at + d) { var pose = m(t - at, time, s), q = (t - at) / .35
          if (q < 1) { var prev = parts[(i + parts.length - 1) % parts.length]; return mix(prev[1](prev[0], time, s), pose, ease(q)) }
          return pose }
        at += d }
      return parts[0][1](0, time, s)
    }
  }
  var OTHER = seq([[4.5, M.read], [3.9, M.reply], [1.8, M.glance]])
  var WOKE = arrives(alarm)
  // the open Thread does not call: the same looks, still
  var CALM = {
    asks: function (t, time, s) { var p = M.asks(t, time, s); p.ty = 0; return p },
    failed: function () { return P({ w: only(OC), ty: 1, rot: -TILT, eye: 'cross' }) },
    woke: function (t, time, s) { var p = alarm(t, time, s); p.ring = 0; p.rot = 0; p.tx = 0; p.ty = 0; return p },
  }
  // with satellites: the body keeps what it does, sub-agents circle it
  function withSatellites(n, body) {
    return function (t, time, s) {
      var o = orbit(n, time, s)
      if (!body) { var p = P({ w: only(CI), ex: 3 * cos(o.a), ey: 2.6 * sin(o.a), open: blink(time + s), sy: 1 + .015 * sin(2 * PI * time / BREATH), dots: o.dots }); return p }
      var q = body(t, time, s); q.dots = o.dots; return q
    }
  }

  // ---- still poses (ADR 0099 decision 8)
  function stillOf(o) {
    var n = o.n
    if (o.state === 'working') {
      var sat = n ? [[CX + 30, CY - 12, 3.1, .9], [CX - 28, CY - 14, 3.1, .9], [CX + 2, CY + 30, 3.1, .9]].slice(0, n) : null
      var d = {
        think: P({ w: only(CI), ex: 2.6, ey: -3.2 }), read: P({ w: only(CI), ex: -1.5, ey: 1.5, open: .62 }),
        search: P({ w: only(CI), eye: 'lens' }), edit: P({ w: only(CI), ex: 1.5, ey: 3.4, open: .55 }),
        execute: P({ w: only(CI), eye: 'prompt', ex: -.5 }), fetch: P({ w: only(CI), ex: 2.8, ey: -3, dots: [[CX + 34, CY - 22, 2.8, .9]] }),
        reply: P({ w: only(CI), ey: 3.4, open: .5 }), compacting: P({ w: only(CI), sx: .84, sy: 1.04, eye: 'closed' }),
        stuck: P({ w: only(CI), eye: 'half', ty: 1.5, rot: 5 }), limit: P({ w: only(CI), eye: 'closed', ey: 2, rot: 5, dots: [[CX + 30, CY, 2.6, .9]] }),
        other: P({ w: only(CI), ex: -1.5, ey: 1.5, open: .62 }),
      }[o.doing] || P({ w: only(CI), ex: 2.2, ey: -1.5 })
      if (sat) d.dots = sat
      return d
    }
    return {
      asks: P({ w: only(TR), rot: -6, ex: -2.5, ey: 1.5, big: 1.12 }), failed: P({ w: only(OC), rot: -TILT, eye: 'cross' }),
      done: P({ eye: 'happy' }), woke: P({ big: 1.12, bells: 1 }), open: P({}),
      later: P({ ty: 1.5, rot: 7, ey: 2.5, eye: 'closed' }), offline: P({ ty: 1.5, rot: 7, ey: 2.5, eye: 'closed', zz: 1 }),
      rest: P({ eyes: 0 }),
    }[o.state] || P({})
  }

  // ---- options -> motion
  var STATE_ALIAS = { asking: 'asks', ask: 'asks', idle: 'open', running: 'working', snoozed: 'later', thinking: 'working' }
  var DOING_ALIAS = { 'sub-agents': 'subagents', subagent: 'subagents', compact: 'compacting', thought: 'think', run: 'execute', write: 'reply' }
  function norm(o) {
    var state = STATE_ALIAS[o.state] || o.state || (o.logo ? 'rest' : 'open')
    if (o.state === 'thinking' && !o.doing) o.doing = 'think'
    var doing = DOING_ALIAS[o.doing] || o.doing
    if (doing && state !== 'working') state = 'working'
    var sats = o.satellites, tones = null, n = 0
    if (Array.isArray(sats)) { tones = sats.slice(0, 3).map(function (x) { return STATE_ALIAS[x] || x }); n = tones.length }
    else if (sats) n = Math.max(0, Math.min(3, +sats | 0))
    if (state === 'working' && doing === 'subagents' && !n) n = 3
    return { state: state, doing: doing, n: n, tones: tones }
  }
  function motionOf(o, calls) {
    var quiet = !calls || BandaMark.quiet
    if (o.state === 'working') {
      var body = { think: M.think, read: M.read, search: M.search, edit: M.edit, execute: M.execute, fetch: M.fetch, reply: M.reply,
        compacting: M.compacting, stuck: M.stuck, limit: M.limit, other: OTHER }[o.doing]
      if (o.n) return withSatellites(o.n, o.doing && o.doing !== 'subagents' ? body : null)
      return body || OTHER
    }
    switch (o.state) {
      case 'asks': return quiet ? CALM.asks : M.asks
      case 'failed': return quiet ? CALM.failed : M.failed
      case 'woke': return quiet ? CALM.woke : WOKE
      case 'done': return M.done
      case 'later': return M.later
      case 'offline': return M.offline
      case 'rest': return M.rest
      default: return M.open
    }
  }
  var AWAKE = { asks: 1, failed: 1, done: 1, woke: 1, open: 1 }

  // ---- drawing
  function drawn(p) {
    var w = p.w, d = ''
    for (var i = 0; i < POINTS; i++) {
      var x = CX, y = CY
      for (var k = 0; k < 4; k++) { if (w[k]) { x += w[k] * OUT[k].xs[i]; y += w[k] * OUT[k].ys[i] } }
      d += (i ? 'L' : 'M') + f(x) + ' ' + f(y)
    }
    d += 'Z'
    var transform = 'translate(' + f(p.tx) + ' ' + f(p.ty) + ') rotate(' + f(TILT + p.rot) + ' 54 45) translate(76 45) scale(' + f(p.sx) + ' ' + f(p.sy) + ') translate(-76 -45) rotate(' + f(p.spin) + ' ' + CX + ' ' + CY + ')'
    var e0 = 0, e1 = 0; for (var j = 0; j < 4; j++) { e0 += w[j] * SHAPES[j].eyes[0]; e1 += w[j] * SHAPES[j].eyes[1] }
    var ex = CX + p.ex, ey = CY + e0 + p.ey, gap = e1 * Math.min(p.big, 1.06), xs = [ex - gap, ex + gap]
    var shown = clamp(p.eyes), round = p.eye === 'open' || p.eye === 'closed' || p.eye === 'half', closed = p.eye === 'closed'
    var none = xs.map(function (x) { return { cx: x, cy: ey, rx: 0, ry: 0 } })
    if (p.eye === 'prompt') { var A = xs[0], B = xs[1]
      return { d: d, transform: transform, eyes: none, glyph: 'M' + f(A - 3.4) + ' ' + f(ey - 4.6) + 'L' + f(A + 2.8) + ' ' + f(ey) + 'L' + f(A - 3.4) + ' ' + f(ey + 4.6) + (p.cursor > .5 ? 'M' + f(B - 4.2) + ' ' + f(ey + 4.2) + 'L' + f(B + 4.2) + ' ' + f(ey + 4.2) : '') } }
    if (p.eye === 'lens') { var a = xs[0], b = xs[1], R = p.lensR
      return { d: d, transform: transform, eyes: none, glyph: 'M' + f(a) + ' ' + f(ey - 2.6) + 'L' + f(a) + ' ' + f(ey + 2.6) + 'M' + f(b - R) + ' ' + f(ey) + 'a' + R + ' ' + R + ' 0 1 0 ' + 2 * R + ' 0a' + R + ' ' + R + ' 0 1 0 ' + (-2 * R) + ' 0M' + f(b + R * .7) + ' ' + f(ey + R * .7) + 'L' + f(b + R * .7 + 3.4) + ' ' + f(ey + R * .7 + 3.4) } }
    var eyes = xs.map(function (x) {
      return shown < .02 || !round ? { cx: x, cy: ey, rx: 0, ry: 0 }
        : { cx: x, cy: ey + (p.eye === 'half' ? 1.6 : 0), rx: (closed ? 5.4 : 4.9 * p.big) * Math.min(1, shown * 1.6), ry: (closed ? 1.7 : p.eye === 'half' ? 3.2 : 7 * p.big * p.open) * shown }
    })
    var glyph = shown < .02 || round ? '' : xs.map(function (x) {
      return p.eye === 'happy' ? 'M' + f(x - 4.6) + ' ' + f(ey + 2.6) + 'Q' + f(x) + ' ' + f(ey - 6.5) + ' ' + f(x + 4.6) + ' ' + f(ey + 2.6)
        : p.eye === 'flat' ? 'M' + f(x - 4.4) + ' ' + f(ey) + 'L' + f(x + 4.4) + ' ' + f(ey)
        : 'M' + f(x - 3.6) + ' ' + f(ey - 3.6) + 'L' + f(x + 3.6) + ' ' + f(ey + 3.6) + 'M' + f(x + 3.6) + ' ' + f(ey - 3.6) + 'L' + f(x - 3.6) + ' ' + f(ey + 3.6)
    }).join('')
    return { d: d, transform: transform, eyes: eyes, glyph: glyph }
  }
  var shapeOf = function (p) { return p.w.indexOf(Math.max.apply(null, p.w)) }
  function hop(t, start, length) { var q = (t - start) / length
    if (q < 0 || q > 1) return 0
    if (q < .45) return ease(q / .45)
    if (q < .8) return 1 - ease((q - .45) / .35)
    return -.18 * sin(PI * (q - .8) / .2) }
  function jumped(p, lift) { var up = Math.max(lift, 0), sq = Math.min(lift, 0), o = mix(p, p, 1)
    o.ty = p.ty - 11 * up; o.rot = p.rot - 12 * up; o.sx = p.sx * (1 - sq * .25); o.sy = p.sy * (1 + sq * .9); return o }

  var NS = 'http://www.w3.org/2000/svg'
  function el(tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e }
  var TONE = { asks: 'var(--attention, #ff8a3d)', failed: 'var(--destructive, #ff6467)', done: 'var(--added, #05df72)', woke: 'var(--woke, #f5c542)' }
  var uid = 0, marks = [], running = false
  var reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches

  function injectStyle() {
    if (document.getElementById('banda-mark-defaults')) return
    var s = document.createElement('style'); s.id = 'banda-mark-defaults'
    s.textContent = ':where(svg[data-banda-mark]){display:inline-block;flex:none;overflow:visible;vertical-align:middle}' +
      ':where(svg[data-banda-mark][data-look=asks]){color:var(--attention,#ff8a3d)}' +
      ':where(svg[data-banda-mark][data-look=failed]){color:var(--destructive,#ff6467)}' +
      ':where(svg[data-banda-mark][data-look=done]){color:var(--added,#05df72)}' +
      ':where(svg[data-banda-mark][data-look=woke]){color:var(--woke,#f5c542)}'
    document.head.appendChild(s)
  }

  function build(svg, logo) {
    while (svg.firstChild) svg.removeChild(svg.firstChild)
    svg.setAttribute('viewBox', logo ? '-4 -18 120 120' : '44 -10 64 64')
    svg.setAttribute('data-banda-mark', '')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.overflow = 'visible'
    if (logo) {
      el('rect', { x: 0, y: 0, width: 42, height: 100, rx: 15, fill: 'var(--logo-tiles, var(--foreground, #ededef))' }, svg)
      el('rect', { x: 52, y: 55, width: 48, height: 45, rx: 15, fill: 'var(--logo-tiles, var(--foreground, #ededef))' }, svg)
    }
    var id = 'bm' + (uid++)
    var defs = el('defs', {}, svg)
    var mask = el('mask', { id: id, maskUnits: 'userSpaceOnUse', x: -60, y: -90, width: 260, height: 260 }, defs)
    el('rect', { x: -60, y: -90, width: 260, height: 260, fill: '#fff' }, mask)
    var eyes = [el('ellipse', { fill: '#000' }, mask), el('ellipse', { fill: '#000' }, mask)]
    var glyph = el('path', { fill: 'none', stroke: '#000', 'stroke-width': 3.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, mask)
    var zzG = el('g', { fill: 'currentColor', 'font-weight': 700, 'font-family': 'Inter, system-ui, sans-serif' }, svg)
    var zz = [0, 1, 2].map(function () { var t = el('text', {}, zzG); t.textContent = 'z'; return t })
    var hat = el('g', {}, svg)
    var body = el('path', { fill: 'currentColor', mask: 'url(#' + id + ')' }, hat)
    var bells = el('g', { fill: 'currentColor' }, hat)
    var bell = [0, 1].map(function () { return el('path', { d: 'M-7 1.5A7 7 0 0 1 7 1.5Z' }, bells) })
    var dotsG = el('g', { fill: 'currentColor' }, svg)
    var dots = [0, 1, 2].map(function () { return el('circle', { r: 0 }, dotsG) })
    return { body: body, hat: hat, eyes: eyes, glyph: glyph, zz: zz, bells: bells, bell: bell, dots: dots }
  }

  function paint(m, p, time) {
    var parts = m.parts, r = drawn(p)
    parts.body.setAttribute('d', r.d); parts.hat.setAttribute('transform', r.transform)
    for (var i = 0; i < 2; i++) { var e = parts.eyes[i], q = r.eyes[i]; e.setAttribute('cx', f(q.cx)); e.setAttribute('cy', f(q.cy)); e.setAttribute('rx', f(q.rx)); e.setAttribute('ry', f(q.ry)) }
    parts.glyph.setAttribute('d', r.glyph)
    for (var z = 0; z < 3; z++) { var ph = (time * .45 + z / 3) % 1, t = parts.zz[z]
      t.setAttribute('x', f(100 + ph * 12)); t.setAttribute('y', f(4 - ph * 24)); t.setAttribute('font-size', f(8 + ph * 8)); t.setAttribute('opacity', f(sin(PI * ph) * p.zz)) }
    parts.bells.setAttribute('opacity', f(clamp(p.bells)))
    for (var b = 0; b < 2; b++) { var side = b ? 1 : -1
      parts.bell[b].setAttribute('transform', 'translate(' + f(CX + side * 17) + ' ' + f(CY - 25 - 4 * (1 - p.bells)) + ') rotate(' + f(side * 38 + 14 * p.ring) + ')') }
    for (var d = 0; d < 3; d++) { var c = parts.dots[d], dq = p.dots && p.dots[d]
      if (dq) { c.setAttribute('cx', f(dq[0])); c.setAttribute('cy', f(dq[1])); c.setAttribute('r', f(dq[2])); c.setAttribute('opacity', f(dq[3]))
        c.setAttribute('fill', m.o.tones && m.o.tones[d] && TONE[m.o.tones[d]] ? TONE[m.o.tones[d]] : 'currentColor') }
      else c.setAttribute('r', 0) }
  }

  function frame(now) {
    var time = now / 1000
    for (var i = marks.length - 1; i >= 0; i--) {
      var m = marks[i]
      if (!m.svg.isConnected) { if (m.seen) marks.splice(i, 1); continue }
      m.seen = true
      if (m.still) continue
      var t = Math.max(0, time - m.began), p = m.motion(t, time, m.seed)
      if (m.look && p.eyes > .5 && p.eye !== 'closed') { p = mix(p, p, 1); p.ex = m.look[0]; p.ey = m.look[1]; p.rot += m.look[0] * .8 }
      var q = (time - m.fromAt) / .45
      if (m.from && q < 1) p = mix(m.from, p, ease(clamp(q)))
      if (time < m.leap) p = jumped(p, hop(time, m.leap - .6, .6))
      m.last = p
      paint(m, p, time)
    }
    if (marks.length) requestAnimationFrame(frame); else running = false
  }
  function loop() { if (!running) { running = true; requestAnimationFrame(frame) } }

  function readData(node) {
    var ds = node.dataset, o = {}
    if (ds.mark) o.state = ds.mark
    if (ds.doing) o.doing = ds.doing
    if (ds.satellites) o.satellites = /^\d+$/.test(ds.satellites) ? +ds.satellites : ds.satellites.split(/[\s,]+/)
    if (ds.size) o.size = +ds.size
    if (ds.logo !== undefined) o.logo = ds.logo !== 'false'
    if (ds.calls === 'false') o.calls = false
    if (ds.still !== undefined) o.still = ds.still !== 'false'
    if (ds.news !== undefined) o.news = true
    if (ds.seed) o.seed = +ds.seed
    return o
  }

  function mount(target, opts) {
    if (typeof document === 'undefined') return null
    injectStyle()
    opts = Object.assign({ size: 16, calls: true, glance: true }, opts || {})
    var svg = target instanceof SVGSVGElement ? target : el('svg', {}, target)
    if (target.__bandaMark) target.__bandaMark.destroy()
    var m = { svg: svg, opts: opts, parts: build(svg, !!opts.logo), seed: opts.seed != null ? opts.seed : Math.random() * 3, look: null, from: null, fromAt: -1e9, leap: -1e9, last: null }
    function apply(o, first) {
      var next = Object.assign({}, m.opts, o)
      // a new look that is not work drops what the work did
      if (!first && o.state && o.state !== 'working' && !('doing' in o)) { delete next.doing; if (!('satellites' in o)) delete next.satellites }
      m.opts = o = next
      m.o = norm(o)
      var size = o.size; if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size) }
      svg.setAttribute('data-look', o.logo && m.o.state === 'working' ? 'working' : m.o.state)
      if (m.o.doing) svg.setAttribute('data-doing', m.o.doing); else svg.removeAttribute('data-doing')
      m.still = !!o.still || reduced
      var motion = motionOf(m.o, o.calls !== false)
      var now = performance.now() / 1000
      if (m.still) { var sp = stillOf(m.o); paint(m, sp, now); m.last = sp; return }
      if (first) { m.motion = motion; m.began = now - (o.news ? 0 : 2.5); m.last = motion(now - m.began, now, m.seed); paint(m, m.last, now); return }
      if (m.last && shapeOf(m.last) !== shapeOf(motion(0, now, m.seed))) m.leap = now + .6
      m.from = m.last; m.fromAt = now; m.motion = motion; m.began = now
    }
    apply(opts, true)
    // awake marks glance at the pointer over their row (ADR 0099 decision 6)
    var row = opts.glance ? (svg.closest('[data-row], .b-card, .b-row, .b-glance') || null) : null
    var onMove = function (e) {
      if (!AWAKE[m.o.state] || m.o.state === 'working') return
      var b = svg.getBoundingClientRect(), dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height / 2), dd = Math.hypot(dx, dy) || 1, g = Math.min(1, dd / 80)
      m.look = [dx / dd * 3.6 * g, dy / dd * 3 * g]
    }
    var onLeave = function () { m.look = null }
    if (row) { row.addEventListener('pointermove', onMove); row.addEventListener('pointerleave', onLeave) }
    var handle = {
      svg: svg,
      set: function (o) { apply(o, false); loop(); return handle },
      destroy: function () { var i = marks.indexOf(m); if (i >= 0) marks.splice(i, 1); if (row) { row.removeEventListener('pointermove', onMove); row.removeEventListener('pointerleave', onLeave) } delete target.__bandaMark },
    }
    target.__bandaMark = handle
    marks.push(m); loop()
    return handle
  }

  function scan(root) {
    (root || document).querySelectorAll('[data-mark]').forEach(function (node) {
      if (node.__bandaMark) return
      mount(node, readData(node))
    })
  }

  // A still SVG as a string, for static places (notifications, docs).
  function svgString(opts) {
    var holder = document.createElement('div'), h = mount(holder, Object.assign({}, opts, { still: true, glance: false }))
    var s = holder.innerHTML; h.destroy(); return s
  }

  var BandaMark = { mount: mount, scan: scan, svg: svgString, quiet: false,
    states: ['asks', 'failed', 'done', 'woke', 'open', 'later', 'offline', 'working', 'rest'],
    doings: ['think', 'read', 'search', 'edit', 'execute', 'fetch', 'reply', 'other', 'subagents', 'compacting', 'stuck', 'limit'],
    rhythm: { call: CALL, blink: BLINK, breath: BREATH, sleep: SLEEP, cursorMs: 530, blendS: .45, leapS: .6, holdS: 1.5 } }
  global.BandaMark = BandaMark
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { scan() })
    else scan()
  }
})(typeof window !== 'undefined' ? window : this)
