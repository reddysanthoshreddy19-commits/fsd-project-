/* ================= calc.js ================= */
/* ===== SipStreak scoring logic (pure functions, no page code) ===== */
const ML_PER_KG = 35;
const MAX_SQUAD = 8;
const dayKey = (d) => new Date(d).toLocaleDateString('en-CA'); // YYYY-MM-DD in the user's own timezone
const today = () => dayKey(Date.now());

/** Base goal = weight x 35 ml, rounded to 10 ml (or the user's custom goal). */
function baseGoal(user) {
  return user.customGoal || Math.round((user.weight * ML_PER_KG) / 10) * 10;
}
function logsOn(db, userId, day) {
  return db.logs.filter((l) => l.userId === userId && dayKey(l.at) === day);
}
/** Caffeine game rule: every coffee / energy drink raises that day's goal by the bonus (if the rule is on). */
function goalFor(db, user, day) {
  const bonus = db.settings.caffeineOn ? db.settings.caffeineBonus : 0;
  const caf = logsOn(db, user.id, day).filter((l) => l.kind !== 'water').length;
  return baseGoal(user) + caf * bonus;
}
function intake(db, user, day) {
  return logsOn(db, user.id, day).reduce((a, l) => a + l.ml, 0);
}
/** Progress is capped at 100% so nobody can carry (or hide behind) the team. */
function progress(db, user, day) {
  return Math.min(1, intake(db, user, day) / goalFor(db, user, day));
}
function members(db, squadId) {
  return db.users.filter((u) => u.squadId === squadId);
}
/** Team Fair Participation Formula: average of the members' capped progress x 100. */
function teamScore(db, squadId, day) {
  const m = members(db, squadId);
  if (!m.length) return 0;
  return (m.reduce((a, u) => a + progress(db, u, day), 0) / m.length) * 100;
}
function ranking(db, day) {
  return db.squads
    .map((s) => ({ squad: s, score: teamScore(db, s.id, day), size: members(db, s.id).length }))
    .sort((a, b) => b.score - a.score || b.size - a.size);
}
function dayOffset(n) { const d = new Date(); d.setDate(d.getDate() - n); return dayKey(d); }
/** Consecutive days (ending today, or yesterday if today is not done yet) with the goal reached. */
function streak(db, user) {
  let n = 0, i = progress(db, user, today()) >= 1 ? 0 : 1;
  for (; i < 400; i++) { if (progress(db, user, dayOffset(i)) >= 1) n++; else break; }
  return n;
}
function week(db, user) {
  return [6, 5, 4, 3, 2, 1, 0].map((i) => {
    const day = dayOffset(i);
    return { day, label: new Date(day + 'T12:00:00').toLocaleDateString('en', { weekday: 'short' }), ml: intake(db, user, day), goal: goalFor(db, user, day) };
  });
}

/* ================= data.js ================= */
/* ===== Storage (localStorage) and sample data ===== */
const KEY = 'sipstreak.html.v1';
const uid = (p) => p + Math.random().toString(36).slice(2, 9);
const SQUAD_COLORS = ['#35d6ff', '#5cf2b0', '#ffb86b', '#c9a6ff', '#ff8a9b'];

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function seed() {
  const now = Date.now(), H = 36e5;
  const at = (daysAgo, hour) => { const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(hour, 0, 0, 0); return d.getTime(); };
  const db = { users: [], squads: [], logs: [], session: null, settings: { caffeineOn: true, caffeineBonus: 200 } };
  // squads: [name, code, member progress % today]
  const defs = [
    ['Hostel Block A', 'HBA7Q2', [90, 80, 70, 60]],
    ['Hostel Block B', 'HBB4K9', [64, 90, 70, 64]],   // first member is the demo user, Priya
    ['Aqua Knights', 'AQK3M8', [70, 68, 66, 68]],
    ['Hydration Homies', 'HYD6P5', [60, 55, 62, 51]],
  ];
  const names = [['Aarav', 'Diya', 'Kabir', 'Meera'], ['Priya', 'Rohan', 'Sana', 'Vikram'], ['Ishaan', 'Neha', 'Arjun', 'Tara'], ['Kavya', 'Yash', 'Anaya', 'Dev']];
  defs.forEach(([name, code, pcts], si) => {
    const sq = { id: 'sq' + si, name, code, color: SQUAD_COLORS[si] };
    db.squads.push(sq);
    pcts.forEach((pct, mi) => {
      const u = { id: 'u' + si + mi, name: names[si][mi], email: '', weight: 60, customGoal: null, squadId: sq.id, hash: '', demo: si === 1 && mi === 0 };
      if (u.demo) u.email = 'priya@demo.dev';
      db.users.push(u);
      const goal = baseGoal(u), ml = Math.round((pct / 100) * goal);
      const first = Math.round(ml * 0.6 / 10) * 10;
      db.logs.push({ id: uid('l'), userId: u.id, ml: first, kind: 'water', at: at(0, 9) });
      if (ml - first > 0) db.logs.push({ id: uid('l'), userId: u.id, ml: ml - first, kind: 'water', at: at(0, 11) });
      // earlier days, so the history chart and streaks have data
      for (let d = 1; d <= 6; d++) {
        const frac = u.demo ? 1.05 : 0.7 + ((si * 3 + mi * 5 + d * 7) % 5) * 0.09; // the demo user already has a streak
        db.logs.push({ id: uid('l'), userId: u.id, ml: Math.round(goal * frac / 10) * 10, kind: 'water', at: at(d, 15) });
      }
    });
  });
  return db;
}

let db = load();
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) { /* fall through */ }
  const fresh = seed(); localStorage.setItem(KEY, JSON.stringify(fresh)); return fresh;
}
function save() { localStorage.setItem(KEY, JSON.stringify(db)); }
function resetAll() { localStorage.removeItem(KEY); db = load(); }
const me = () => db.users.find((u) => u.id === db.session) || null;

/* ---- account actions: each returns an error message, or '' on success ---- */
async function signup({ name, email, password, weight }) {
  name = name.trim(); email = email.trim().toLowerCase(); weight = Number(weight);
  if (name.length < 2 || name.length > 40) return 'Please enter your name (2 to 40 letters).';
  if (!/^\S+@\S+\.\S+$/.test(email)) return 'Please enter a valid email.';
  if (password.length < 6) return 'Password needs at least 6 characters.';
  if (!(weight >= 25 && weight <= 250)) return 'Weight must be between 25 and 250 kg.';
  if (db.users.some((u) => u.email === email)) return 'An account with this email already exists.';
  const u = { id: uid('u'), name, email, weight, customGoal: null, squadId: null, hash: await sha256(email + ':' + password), demo: false };
  db.users.push(u); db.session = u.id; save(); return '';
}
async function login(email, password) {
  email = email.trim().toLowerCase();
  const u = db.users.find((x) => x.email === email && x.hash);
  if (!u || u.hash !== (await sha256(email + ':' + password))) return 'Email or password is incorrect.';
  db.session = u.id; save(); return '';
}
function loginDemo() { db.session = db.users.find((u) => u.demo).id; save(); }
function logout() { db.session = null; save(); }

/* ---- water actions ---- */
function addWater(ml, kind = 'water') {
  const u = me(); if (!u) return 'Please log in first.';
  ml = Math.round(Number(ml));
  if (!(ml >= 1 && ml <= 2000)) return 'Enter an amount between 1 and 2000 ml.';
  db.logs.push({ id: uid('l'), userId: u.id, ml, kind, at: Date.now() }); save(); return '';
}
function removeWater(ml) { // removes up to `ml` from today's newest drinks
  const u = me(); let left = ml;
  const todays = logsOn(db, u.id, today()).sort((a, b) => b.at - a.at);
  for (const l of todays) {
    if (left <= 0) break;
    if (l.ml <= left) { left -= l.ml; db.logs = db.logs.filter((x) => x.id !== l.id); }
    else { l.ml -= left; left = 0; }
  }
  save();
}
function setTodayTotal(total) {
  const u = me(); total = Math.round(Number(total));
  if (!(total >= 0 && total <= 10000)) return 'Enter a total between 0 and 10000 ml.';
  db.logs = db.logs.filter((l) => !(l.userId === u.id && dayKey(l.at) === today()));
  if (total > 0) db.logs.push({ id: uid('l'), userId: u.id, ml: total, kind: 'water', at: Date.now() });
  save(); return '';
}

/* ---- squads ---- */
function createSquad(name) {
  name = name.trim();
  if (name.length < 3 || name.length > 32) return 'Squad name needs 3 to 32 characters.';
  if (db.squads.some((s) => s.name.toLowerCase() === name.toLowerCase())) return 'That squad name is taken.';
  let code; do { code = Math.random().toString(36).slice(2, 8).toUpperCase(); } while (db.squads.some((s) => s.code === code));
  const s = { id: uid('sq'), name, code, color: SQUAD_COLORS[db.squads.length % SQUAD_COLORS.length] };
  db.squads.push(s); me().squadId = s.id; save(); return '';
}
function joinSquad(code) {
  const s = db.squads.find((x) => x.code === code.trim().toUpperCase());
  if (!s) return 'No squad has that invite code.';
  if (me().squadId !== s.id && members(db, s.id).length >= MAX_SQUAD) return `That squad is full (${MAX_SQUAD}/${MAX_SQUAD}).`;
  me().squadId = s.id; save(); return '';
}
function leaveSquad() { me().squadId = null; save(); }

/* ================= bottle.js ================= */
/* ===== Animated water bottle drawn on a <canvas> (no libraries) ===== */
const Bottle = (() => {
  let canvas, ctx, raf, level = 0, target = 0, ripple = 0, t = 0, bubbles = [], color = '#35d6ff';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function path(c, w, h) { // bottle outline
    const x = w * 0.22, r = 36, nw = w * 0.14, top = h * 0.07, shoulder = h * 0.24, bottom = h * 0.96;
    c.beginPath();
    c.moveTo(w / 2 - nw, top);
    c.lineTo(w / 2 + nw, top);
    c.lineTo(w / 2 + nw, shoulder * 0.7);
    c.bezierCurveTo(w / 2 + nw, shoulder, w - x, shoulder * 0.9, w - x, shoulder + 30);
    c.lineTo(w - x, bottom - r);
    c.quadraticCurveTo(w - x, bottom, w - x - r, bottom);
    c.lineTo(x + r, bottom);
    c.quadraticCurveTo(x, bottom, x, bottom - r);
    c.lineTo(x, shoulder + 30);
    c.bezierCurveTo(x, shoulder * 0.9, w / 2 - nw, shoulder, w / 2 - nw, shoulder * 0.7);
    c.closePath();
  }
  function frame() {
    const w = canvas.width, h = canvas.height;
    t += 0.03; level += (target - level) * 0.06; ripple *= 0.96;
    ctx.clearRect(0, 0, w, h);
    ctx.save(); path(ctx, w, h);
    ctx.fillStyle = 'rgba(160,220,255,0.07)'; ctx.fill(); ctx.clip();
    const top = h * 0.96, floor = h * 0.26, y0 = top - (top - floor) * Math.min(1, level);
    const amp = reduce ? 0 : 4 + ripple * 14;
    for (let layer = 0; layer < 2; layer++) {
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 6) ctx.lineTo(x, y0 + Math.sin(x * 0.03 + t * (1.4 + layer * 0.6) + layer * 2) * amp * (layer ? 0.7 : 1));
      ctx.lineTo(w, h); ctx.closePath();
      ctx.fillStyle = layer ? 'rgba(53,214,255,0.55)' : color; ctx.globalAlpha = layer ? 0.7 : 0.85; ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (!reduce && level > 0.03) { // bubbles
      if (bubbles.length < 14 && Math.random() < 0.08) bubbles.push({ x: w * (0.3 + Math.random() * 0.4), y: top - 6, r: 2 + Math.random() * 4, s: 0.6 + Math.random() });
      bubbles = bubbles.filter((b) => b.y > y0 + 6);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      bubbles.forEach((b) => { b.y -= b.s; b.x += Math.sin(b.y * 0.1) * 0.4; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); });
    }
    ctx.restore();
    path(ctx, w, h); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(200,235,255,0.85)'; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(w * 0.3, h * 0.34, 10, h * 0.5); // glass highlight
    ctx.fillStyle = '#e8f4fb'; ctx.font = '700 46px Outfit, Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(Math.round(target * 100) + '%', w / 2, h * 0.62);
    raf = requestAnimationFrame(frame);
  }
  return {
    start(el) { canvas = el; ctx = canvas.getContext('2d'); cancelAnimationFrame(raf); frame(); },
    stop() { cancelAnimationFrame(raf); },
    set(frac, col) { target = Math.max(0, frac); if (col) color = col; },
    splash() { ripple = 1; },
  };
})();

/* ================= app.js ================= */
/* ===== Pages, routing and event handling ===== */
const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (n) => Math.round(n) + '%';
const litres = (ml) => (ml / 1000).toFixed(2) + ' L';

function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast.id); toast.id = setTimeout(() => (t.className = ''), 2600);
}
function errBox(msg) { return msg ? `<p class="error" role="alert">${esc(msg)}</p>` : ''; }

/* ---------- pages ---------- */
const pages = {
  home() {
    const rank = ranking(db, today()).slice(0, 3);
    return `
    <section class="hero">
      <div>
        <p class="tag">Team hydration challenge</p>
        <h1>Drink together.<br><span class="grad">Stay stronger.</span></h1>
        <p class="lead">Log a drink in one tap, pool your progress with a squad of 4 to 8, and climb the campus leaderboard.</p>
        <div class="row">
          ${me() ? '<a class="btn" href="#dashboard">Open dashboard</a>' : '<a class="btn" href="#signup">Start your streak</a><a class="btn ghost" href="#login">Log in</a>'}
          <a class="btn ghost" href="#leaderboard">See the leaderboard</a>
        </div>
      </div>
      <div class="card glass"><h3>Today’s top squads</h3>
        ${rank.map((r, i) => `<div class="mini"><b>${i + 1}</b><span>${esc(r.squad.name)}</span><em>${pct(r.score)}</em></div>`).join('')}
      </div>
    </section>
    <section class="grid3">
      <article class="card"><h3>Fair for everyone</h3><p>Each member counts up to 100% of their own goal, so one heavy drinker cannot carry the team.</p></article>
      <article class="card"><h3>Quick tap logging</h3><p>+250, +500, +750 ml or a custom amount. The bottle fills instantly.</p></article>
      <article class="card"><h3>Streaks and history</h3><p>A seven-day chart and a streak counter reward the daily habit.</p></article>
    </section>
    <section class="card" id="scoring"><h3>The Team Fair Participation Formula</h3>
      <p class="formula">Team score = ( Σ min(1, intake ÷ goal) ÷ squad size ) × 100</p>
      <p>Daily goal = body weight × 35 ml. Example: members at 100%, 90%, 40% and 75% give (100 + 90 + 40 + 75) ÷ 4 = <b>76.25%</b>.</p>
    </section>`;
  },

  signup() {
    return `<section class="auth card"><h2>Become a HydroHero</h2>
      <form id="signupForm" novalidate>
        <label>Name<input name="name" autocomplete="name" required></label>
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password<input name="password" type="password" minlength="6" autocomplete="new-password" required></label>
        <label>Body weight (kg)<input name="weight" type="number" min="25" max="250" required></label>
        <div id="formErr"></div>
        <button class="btn" type="submit">Create account</button>
      </form>
      <p class="muted">Already have an account? <a href="#login">Log in</a></p></section>`;
  },
  login() {
    return `<section class="auth card"><h2>Welcome back</h2>
      <form id="loginForm" novalidate>
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <div id="formErr"></div>
        <button class="btn" type="submit">Log in</button>
      </form>
      <div class="demo"><p class="muted">Just looking? Use the ready-made demo account.</p>
        <button class="btn ghost" id="demoBtn" type="button">Log in as Priya (demo)</button></div>
      <p class="muted">New here? <a href="#signup">Create an account</a></p></section>`;
  },

  dashboard() {
    const u = me(), d = today(), goal = goalFor(db, u, d), got = intake(db, u, d);
    const sq = db.squads.find((s) => s.id === u.squadId);
    const rank = ranking(db, d), pos = sq ? rank.findIndex((r) => r.squad.id === sq.id) + 1 : 0;
    const list = logsOn(db, u.id, d).sort((a, b) => b.at - a.at);
    return `
    <h2>Good day, ${esc(u.name)}</h2>
    <div class="dash">
      <section class="card bottle-card"><canvas id="bottle" width="320" height="460" aria-label="Water bottle showing ${pct((got / goal) * 100)} of today's goal"></canvas></section>
      <section class="stack">
        <div class="stats">
          <div class="card stat"><span>Today</span><b>${litres(got)}</b></div>
          <div class="card stat"><span>Goal</span><b>${litres(goal)}</b></div>
          <div class="card stat"><span>Streak</span><b>${streak(db, u)} days</b></div>
          <div class="card stat"><span>Squad rank</span><b>${sq ? '#' + pos : '–'}</b></div>
        </div>
        <div class="card"><h3>Quick log</h3>
          <div class="row wrap">
            <button class="btn" data-add="250">+250 ml</button><button class="btn" data-add="500">+500 ml</button><button class="btn" data-add="750">+750 ml</button>
            <button class="btn ghost" data-add="250" data-kind="coffee">☕ Coffee 250</button>
          </div>
          <form id="customForm" class="row"><input name="ml" type="number" min="1" max="2000" placeholder="Custom ml" aria-label="Custom amount in ml"><button class="btn ghost" type="submit">Add</button></form>
          <p class="muted">${db.settings.caffeineOn ? `Caffeine rule on: each coffee or energy drink adds ${db.settings.caffeineBonus} ml to today’s goal.` : 'Caffeine rule is off.'}</p>
        </div>
        <div class="card"><h3>Adjust today’s water</h3>
          <p class="muted">Made a mistake? Remove water, set an exact total, or clear the day.</p>
          <div class="row wrap"><button class="btn ghost" data-rem="100">−100 ml</button><button class="btn ghost" data-rem="250">−250 ml</button><button class="btn ghost" data-rem="500">−500 ml</button></div>
          <form id="setForm" class="row"><input name="total" type="number" min="0" max="10000" placeholder="Exact total (ml)" aria-label="Exact total in ml"><button class="btn ghost" type="submit">Set</button></form>
          <button class="btn danger" id="clearBtn">Clear today’s water</button>
        </div>
        <div class="card"><h3>Today’s drinks</h3>
          ${list.length ? list.map((l) => `<div class="mini"><span>${new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span>${l.kind === 'water' ? 'Water' : 'Coffee / energy'}</span><em>${l.ml} ml</em></div>`).join('') : '<p class="muted">Nothing logged yet. Tap a button above.</p>'}
        </div>
      </section>
    </div>`;
  },

  squad() {
    const u = me(), sq = db.squads.find((s) => s.id === u.squadId), d = today();
    if (!sq) return `<h2>My Squad</h2><div class="grid2">
      <section class="card"><h3>Join with an invite code</h3><form id="joinForm" class="row"><input name="code" maxlength="6" placeholder="e.g. HBB4K9" aria-label="Invite code"><button class="btn" type="submit">Join</button></form><div id="formErr"></div>
      <p class="muted">Try the sample code <b>AQK3M8</b>.</p></section>
      <section class="card"><h3>Create a squad</h3><form id="createForm" class="row"><input name="name" placeholder="Squad name" aria-label="Squad name"><button class="btn" type="submit">Create</button></form><div id="formErr2"></div></section></div>`;
    const m = members(db, sq.id);
    return `<h2>${esc(sq.name)}</h2>
      <p class="lead small">Invite code <b class="code">${sq.code}</b> &middot; ${m.length} of ${MAX_SQUAD} members &middot; team score <b>${pct(teamScore(db, sq.id, d))}</b></p>
      <section class="card">${m.map((x) => { const p = progress(db, x, d) * 100;
        return `<div class="member"><span>${esc(x.name)}${x.id === u.id ? ' (you)' : ''}</span><div class="bar"><i style="width:${p}%;background:${sq.color}"></i></div><em>${pct(p)}</em></div>`; }).join('')}</section>
      <button class="btn ghost" id="leaveBtn">Leave squad</button>`;
  },

  leaderboard() {
    const rank = ranking(db, today()), u = me();
    return `<h2>Leaderboard</h2><p class="lead small">Ranked by the Team Fair Participation Formula, recalculated after every drink.</p>
      <section class="card">${rank.map((r, i) => `
        <div class="rank ${u && r.squad.id === u.squadId ? 'mine' : ''}">
          <b class="pos">${i + 1}</b><span class="sname">${esc(r.squad.name)} <small>${r.size} members</small></span>
          <div class="bar"><i style="width:${Math.min(100, r.score)}%;background:${r.squad.color}"></i></div><em>${r.score.toFixed(1)}%</em>
        </div>`).join('')}</section>
      <p class="muted">Each member counts at most 100% of their own goal. Add water on the dashboard and watch the ranking change.</p>`;
  },

  history() {
    const u = me(), w = week(db, u), hit = w.filter((x) => x.ml >= x.goal).length;
    return `<h2>Weekly history</h2>
      <div class="stats"><div class="card stat"><span>Streak</span><b>${streak(db, u)} days</b></div>
      <div class="card stat"><span>Goals met (7 days)</span><b>${hit} / 7</b></div>
      <div class="card stat"><span>Average</span><b>${litres(w.reduce((a, x) => a + x.ml, 0) / 7)}</b></div></div>
      <section class="card"><canvas id="chart" width="900" height="360" aria-label="Bar chart of water drunk in the last seven days against the daily goal"></canvas></section>`;
  },

  settings() {
    const u = me();
    return `<h2>Settings</h2><section class="card auth"><form id="settingsForm" novalidate>
      <label>Name<input name="name" value="${esc(u.name)}"></label>
      <label>Body weight (kg)<input name="weight" type="number" value="${u.weight}" min="25" max="250"></label>
      <label>Custom daily goal in ml (leave empty to use weight × 35)<input name="goal" type="number" value="${u.customGoal || ''}" min="500" max="6000"></label>
      <label class="check"><input name="caf" type="checkbox" ${db.settings.caffeineOn ? 'checked' : ''}> Caffeine rule: coffee and energy drinks add ${db.settings.caffeineBonus} ml to the goal</label>
      <div id="formErr"></div><button class="btn" type="submit">Save</button></form>
      <p class="muted">Current goal: <b>${litres(baseGoal(u))}</b></p>
      <button class="btn ghost" id="resetBtn">Reset all sample data</button></section>`;
  },
};
const needsLogin = new Set(['dashboard', 'squad', 'history', 'settings']);

/* ---------- router ---------- */
function render() {
  const name = (location.hash || '#home').slice(1);
  let page = pages[name] ? name : 'home';
  if (needsLogin.has(page) && !me()) page = 'login';
  if ((page === 'login' || page === 'signup') && me()) page = 'dashboard';
  Bottle.stop();
  view.innerHTML = pages[page]();
  document.title = 'SipStreak · ' + page[0].toUpperCase() + page.slice(1);
  document.querySelectorAll('#nav a').forEach((a) => {
    a.hidden = a.hasAttribute('data-auth') && !me();
    a.classList.toggle('on', a.getAttribute('href') === '#' + page);
  });
  $('#who').innerHTML = me() ? `<span>${esc(me().name)}</span> <button class="btn ghost sm" id="logoutBtn">Log out</button>` : '<a class="btn sm" href="#login">Log in</a>';
  if (page === 'dashboard') {
    const u = me(); Bottle.start($('#bottle'));
    Bottle.set(intake(db, u, today()) / goalFor(db, u, today()), '#35d6ff');
  }
  if (page === 'history') drawChart();
  window.scrollTo(0, 0);
}

function drawChart() {
  const c = $('#chart'), g = c.getContext('2d'), w = week(db, me()), W = c.width, H = c.height;
  const max = Math.max(...w.map((x) => Math.max(x.ml, x.goal))) * 1.15, pad = 56, bw = (W - pad * 2) / w.length;
  g.clearRect(0, 0, W, H); g.font = '16px Inter, sans-serif';
  g.strokeStyle = 'rgba(255,255,255,0.1)'; g.fillStyle = '#9fb6c9';
  for (let i = 0; i <= 4; i++) { const y = H - 40 - ((H - 80) * i) / 4; g.beginPath(); g.moveTo(pad, y); g.lineTo(W - 10, y); g.stroke(); g.textAlign = 'right'; g.fillText((max * i / 4 / 1000).toFixed(1) + 'L', pad - 8, y + 5); }
  g.textAlign = 'center';
  w.forEach((x, i) => {
    const h = ((H - 80) * x.ml) / max, gx = pad + i * bw + bw * 0.2, gw = bw * 0.6;
    g.fillStyle = x.ml >= x.goal ? '#5cf2b0' : '#35d6ff'; g.fillRect(gx, H - 40 - h, gw, h);
    const gy = H - 40 - ((H - 80) * x.goal) / max; g.fillStyle = '#ffb86b'; g.fillRect(gx - 6, gy - 2, gw + 12, 4);
    g.fillStyle = '#e8f4fb'; g.fillText(x.label, gx + gw / 2, H - 14);
  });
  g.fillStyle = '#ffb86b'; g.textAlign = 'right'; g.fillText('orange line = daily goal   green bar = goal met', W - 12, 22);
}

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'logoutBtn') { logout(); location.hash = '#home'; render(); }
  else if (t.dataset.add) {
    const err = addWater(t.dataset.add, t.dataset.kind || 'water');
    if (err) return toast(err, true);
    render(); Bottle.splash(); toast(`+${t.dataset.add} ml added`);
  } else if (t.dataset.rem) { removeWater(Number(t.dataset.rem)); render(); toast(`Removed up to ${t.dataset.rem} ml`); }
  else if (t.id === 'clearBtn') { if (confirm('Clear all of today’s water?')) { setTodayTotal(0); render(); toast('Today cleared'); } }
  else if (t.id === 'demoBtn') { loginDemo(); location.hash = '#dashboard'; render(); }
  else if (t.id === 'leaveBtn') { leaveSquad(); render(); }
  else if (t.id === 'resetBtn') { if (confirm('Reset everything, including accounts?')) { resetAll(); location.hash = '#home'; render(); toast('Sample data restored'); } }
});

document.addEventListener('submit', async (e) => {
  e.preventDefault(); const f = e.target, v = Object.fromEntries(new FormData(f));
  const show = (m, id = 'formErr') => { const box = $('#' + id); if (box) box.innerHTML = errBox(m); };
  if (f.id === 'signupForm') { const err = await signup(v); if (err) show(err); else { location.hash = '#squad'; render(); } }
  else if (f.id === 'loginForm') { const err = await login(v.email, v.password); if (err) show(err); else { location.hash = '#dashboard'; render(); } }
  else if (f.id === 'customForm') { const err = addWater(v.ml); if (err) toast(err, true); else { render(); Bottle.splash(); toast(`+${v.ml} ml added`); } }
  else if (f.id === 'setForm') { const err = setTodayTotal(v.total); if (err) toast(err, true); else { render(); toast('Total set'); } }
  else if (f.id === 'joinForm') { const err = joinSquad(v.code); if (err) show(err); else render(); }
  else if (f.id === 'createForm') { const err = createSquad(v.name); if (err) show(err, 'formErr2'); else render(); }
  else if (f.id === 'settingsForm') {
    const u = me(), w = Number(v.weight), goal = v.goal ? Number(v.goal) : null;
    if (String(v.name).trim().length < 2) return show('Please enter your name.');
    if (!(w >= 25 && w <= 250)) return show('Weight must be between 25 and 250 kg.');
    if (goal !== null && !(goal >= 500 && goal <= 6000)) return show('Custom goal must be 500 to 6000 ml.');
    u.name = v.name.trim(); u.weight = w; u.customGoal = goal; db.settings.caffeineOn = !!v.caf; save(); render(); toast('Saved');
  }
});
window.addEventListener('hashchange', render);
render();

