// The animated core in the middle of each agent's workspace, drawn on a canvas.
// Each core is { draw(ctx, W, H, t, dt, cur, m) }. `cur` holds the current (smoothly changing)
// colour and motion for the agent's state; `m` is 1 normally and small for reduced motion.
(function (root) {
  "use strict";
  var J = root.J = root.J || {};
  var TAU = Math.PI * 2;
  function rgba(cur, a) { return "rgba(" + Math.round(cur.c[0]) + "," + Math.round(cur.c[1]) + "," + Math.round(cur.c[2]) + "," + a + ")"; }

  // ---------- JARVIS: a particle sphere inside faint rings ----------
  var N = 750, PHI = Math.PI * (3 - Math.sqrt(5));
  var pts = [];
  for (var i = 0; i < N; i++) {
    var y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = PHI * i;
    pts.push({ x: Math.cos(th) * r, y: y, z: Math.sin(th) * r, s: .5 + Math.random() * 1.1 });
  }
  var LEVELS = 10, levels = [];
  for (var lv = 0; lv < LEVELS; lv++) levels.push([]);
  var sAngle = 0, sRing = 0;
  var sphere = {
    draw: function (ctx, W, H, t, dt, cur, m) {
      sAngle += cur.spin * dt * m; sRing -= .05 * dt * m;
      var cx = W / 2, cy = H / 2 - 6, base = Math.min(W * .5, H * 1.0) * .27;
      var R = base * (1 + cur.amp * Math.sin(TAU * cur.hz * t) * m);

      ctx.lineWidth = 1; ctx.strokeStyle = rgba(cur, .14);
      [1.4, 1.78].forEach(function (f) { ctx.beginPath(); ctx.arc(cx, cy, base * f, 0, TAU); ctx.stroke(); });
      ctx.fillStyle = rgba(cur, .55);
      for (var k = 0; k < 120; k++) {
        var a = sRing + (k / 120) * TAU, rr = base * 1.6, sz = k % 5 === 0 ? 2.4 : 1.2;
        ctx.fillRect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, sz, sz);
      }

      // Particles are grouped into a few brightness levels and drawn one level at a time, which
      // is far lighter on a slow computer than setting a new colour for each of the 750 dots.
      var ca = Math.cos(sAngle), sa = Math.sin(sAngle), tilt = .38, ct = Math.cos(tilt), st = Math.sin(tilt), b;
      for (b = 0; b < LEVELS; b++) levels[b].length = 0;
      for (var n = 0; n < N; n++) {
        var p = pts[n];
        var x = p.x * ca + p.z * sa, z = -p.x * sa + p.z * ca, yy = p.y;
        var y2 = yy * ct - z * st, z2 = yy * st + z * ct;
        var persp = 1 / (1 - z2 * .28);
        var sx = cx + x * R * persp, sy = cy + y2 * R * persp;
        if (cur.jit > .0005) { sx += (Math.random() - .5) * cur.jit * R; sy += (Math.random() - .5) * cur.jit * R; }
        var depth = (z2 + 1) / 2;
        levels[Math.min(LEVELS - 1, (depth * LEVELS) | 0)].push(sx, sy, p.s * persp * (.8 + depth * .8));
      }
      for (b = 0; b < LEVELS; b++) {
        var L = levels[b]; if (!L.length) continue;
        ctx.fillStyle = rgba(cur, (.18 + .82 * (b + .5) / LEVELS).toFixed(3));
        ctx.beginPath();
        for (var q = 0; q < L.length; q += 3) ctx.rect(L[q], L[q + 1], L[q + 2], L[q + 2]);
        ctx.fill();
      }

      var gr = R * .33 * (1 + cur.amp * .8 * Math.sin(TAU * cur.hz * t) * m);
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, gr * 2.4);
      g.addColorStop(0, "rgba(255,255,255,.95)"); g.addColorStop(.25, rgba(cur, .9)); g.addColorStop(.6, rgba(cur, .25)); g.addColorStop(1, rgba(cur, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, gr * 2.4, 0, TAU); ctx.fill();
    }
  };

  // ---------- ULTRON: an angular reactor. Counter-rotating wire solids, blades and arc plates ----------
  var G = (1 + Math.sqrt(5)) / 2;
  var ICO = [[-1, G, 0], [1, G, 0], [-1, -G, 0], [1, -G, 0], [0, -1, G], [0, 1, G], [0, -1, -G], [0, 1, -G], [G, 0, -1], [G, 0, 1], [-G, 0, -1], [-G, 0, 1]]
    .map(function (v) { var l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; });
  var OCT = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  function edgesOf(vs) {
    var d = function (a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }, min = Infinity, out = [], x, y;
    for (x = 0; x < vs.length; x++) for (y = x + 1; y < vs.length; y++) min = Math.min(min, d(vs[x], vs[y]));
    for (x = 0; x < vs.length; x++) for (y = x + 1; y < vs.length; y++) if (d(vs[x], vs[y]) < min * 1.05) out.push([x, y]);
    return out;
  }
  var ICO_E = edgesOf(ICO), OCT_E = edgesOf(OCT);
  var uA = 0, uB = 0, uRing = 0;

  function wire(ctx, cur, vs, es, cx, cy, R, ay, ax, jit, lineW, alphaBase) {
    var cy_ = Math.cos(ay), sy_ = Math.sin(ay), cx_ = Math.cos(ax), sx_ = Math.sin(ax), proj = [];
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i];
      var x = v[0] * cy_ + v[2] * sy_, z = -v[0] * sy_ + v[2] * cy_, y = v[1];
      var y2 = y * cx_ - z * sx_, z2 = y * sx_ + z * cx_;
      var persp = 1 / (1 - z2 * .3);
      var px = cx + x * R * persp, py = cy + y2 * R * persp;
      if (jit > .0005) { px += (Math.random() - .5) * jit * R; py += (Math.random() - .5) * jit * R; }
      proj.push([px, py, (z2 + 1) / 2]);
    }
    ctx.lineWidth = lineW; ctx.lineJoin = "miter";
    for (var e = 0; e < es.length; e++) {
      var a = proj[es[e][0]], b = proj[es[e][1]], depth = (a[2] + b[2]) / 2;
      ctx.strokeStyle = rgba(cur, (alphaBase * (.25 + .75 * depth)).toFixed(3));
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.fillStyle = rgba(cur, .9);
    for (var p = 0; p < proj.length; p++) { var s = 1.5 + proj[p][2] * 2; ctx.fillRect(proj[p][0] - s / 2, proj[p][1] - s / 2, s, s); }
  }

  var reactor = {
    draw: function (ctx, W, H, t, dt, cur, m) {
      uA += cur.spin * dt * m; uB -= cur.spin * 1.4 * dt * m; uRing += .12 * dt * m;
      var cx = W / 2, cy = H / 2 - 6, base = Math.min(W * .5, H * 1.0) * .27;
      var pulse = 1 + cur.amp * Math.sin(TAU * cur.hz * t) * m, R = base * pulse;

      // outer: a ring of blades, and three heavy arc plates turning the other way
      ctx.strokeStyle = rgba(cur, .5); ctx.lineWidth = 1.4;
      for (var k = 0; k < 36; k++) {
        var a = uRing + (k / 36) * TAU, long = k % 3 === 0, r1 = base * 1.5, r2 = base * (long ? 1.78 : 1.64);
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
      }
      ctx.lineWidth = 3; ctx.strokeStyle = rgba(cur, .32);
      for (var s = 0; s < 3; s++) {
        var a0 = -uRing * 1.6 + s * (TAU / 3);
        ctx.beginPath(); ctx.arc(cx, cy, base * 1.38, a0, a0 + TAU / 5); ctx.stroke();
      }
      ctx.lineWidth = 1; ctx.strokeStyle = rgba(cur, .14);
      ctx.beginPath(); ctx.arc(cx, cy, base * 1.9, 0, TAU); ctx.stroke();

      // middle: the two wire solids
      wire(ctx, cur, ICO, ICO_E, cx, cy, R * 1.12, uA, .5, cur.jit, 1.3, .95);
      wire(ctx, cur, OCT, OCT_E, cx, cy, R * .62, uB, -.4, cur.jit, 1.1, .8);

      // inner: a hot core
      var gr = R * .26 * (1 + cur.amp * .9 * Math.sin(TAU * cur.hz * t) * m);
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, gr * 2.6);
      g.addColorStop(0, "rgba(255,235,225,.95)"); g.addColorStop(.22, rgba(cur, .95)); g.addColorStop(.6, rgba(cur, .22)); g.addColorStop(1, rgba(cur, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, gr * 2.6, 0, TAU); ctx.fill();
    }
  };

  // ---------- DAREDEVIL: three nodes around one table (the three lenses), linked by lines that flare while they argue ----------
  var NODE_TINT = [[255, 207, 107], [255, 122, 122], [126, 200, 255]];   // Steven, Marc, Jake: same colours as their chat labels
  var dA = 0, dRing = 0;
  var council = {
    draw: function (ctx, W, H, t, dt, cur, m) {
      dA += cur.spin * dt * m; dRing -= .06 * dt * m;
      var cx = W / 2, cy = H / 2 - 6, base = Math.min(W * .5, H * 1.0) * .27;
      var pulse = 1 + cur.amp * Math.sin(TAU * cur.hz * t) * m, R = base * 1.05 * pulse;
      var debate = Math.min(1, cur.spin / 1.8);                           // 0 when calm, 1 while thinking

      // outer ring of ticks and a slow counter-turning outline triangle
      ctx.fillStyle = rgba(cur, .5);
      for (var k = 0; k < 90; k++) {
        var a = dRing + (k / 90) * TAU, rr = base * 1.75, sz = k % 6 === 0 ? 2.6 : 1.1;
        ctx.fillRect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, sz, sz);
      }
      ctx.strokeStyle = rgba(cur, .16); ctx.lineWidth = 1;
      ctx.beginPath();
      for (var v = 0; v < 3; v++) {
        var av = -dA * .4 + v * TAU / 3 - Math.PI / 2, rv = base * 1.55;
        if (v === 0) ctx.moveTo(cx + Math.cos(av) * rv, cy + Math.sin(av) * rv); else ctx.lineTo(cx + Math.cos(av) * rv, cy + Math.sin(av) * rv);
      }
      ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.0, 0, TAU); ctx.strokeStyle = rgba(cur, .12); ctx.stroke();

      // the three nodes
      var nodes = [];
      for (var n = 0; n < 3; n++) {
        var an = dA + n * TAU / 3 - Math.PI / 2, jit = cur.jit > .0005 ? (Math.random() - .5) * cur.jit * R : 0;
        nodes.push([cx + Math.cos(an) * R + jit, cy + Math.sin(an) * R + jit]);
      }
      // links between nodes and spokes to the centre; they brighten in turn while the council debates
      for (var i = 0; i < 3; i++) {
        var j = (i + 1) % 3, flare = debate * (.5 + .5 * Math.sin(t * 5 + i * 2.1));
        ctx.strokeStyle = rgba(cur, (.22 + .55 * flare).toFixed(3)); ctx.lineWidth = 1 + flare * 1.5;
        ctx.beginPath(); ctx.moveTo(nodes[i][0], nodes[i][1]); ctx.lineTo(nodes[j][0], nodes[j][1]); ctx.stroke();
        ctx.strokeStyle = rgba(cur, .14); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(nodes[i][0], nodes[i][1]); ctx.stroke();
      }
      for (var q = 0; q < 3; q++) {
        var tint = NODE_TINT[q], hot = debate * (.5 + .5 * Math.sin(t * 5 + q * 2.1)), nr = base * (.17 + .05 * hot);
        var g = ctx.createRadialGradient(nodes[q][0], nodes[q][1], 0, nodes[q][0], nodes[q][1], nr * 2.4);
        g.addColorStop(0, "rgba(" + tint.join(",") + ",.95)"); g.addColorStop(.35, "rgba(" + tint.join(",") + "," + (.35 + .3 * hot) + ")"); g.addColorStop(1, "rgba(" + tint.join(",") + ",0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(nodes[q][0], nodes[q][1], nr * 2.4, 0, TAU); ctx.fill();
        ctx.strokeStyle = "rgba(" + tint.join(",") + ",.8)"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(nodes[q][0], nodes[q][1], nr, 0, TAU); ctx.stroke();
      }

      // the table: a small hot diamond at the centre
      var cr = base * .16 * (1 + cur.amp * Math.sin(TAU * cur.hz * t) * m);
      var cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 3);
      cg.addColorStop(0, "rgba(255,235,225,.9)"); cg.addColorStop(.3, rgba(cur, .85)); cg.addColorStop(1, rgba(cur, 0));
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, cr * 3, 0, TAU); ctx.fill();
      ctx.fillStyle = rgba(cur, .95);
      ctx.beginPath(); ctx.moveTo(cx, cy - cr); ctx.lineTo(cx + cr, cy); ctx.lineTo(cx, cy + cr); ctx.lineTo(cx - cr, cy); ctx.closePath(); ctx.fill();
    }
  };

  J.cores = { sphere: sphere, reactor: reactor, council: council };
  if (typeof module !== "undefined" && module.exports) module.exports = J;
})(typeof window !== "undefined" ? window : globalThis);
