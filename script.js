/* ==========================================================================
   DeployX · CI/CD Pipeline Simulator
   Vanilla ES6+. Sections:
     1. Utilities            5. Rendering (pure view functions)
     2. Store (LocalStorage) 6. Overlays (modal, palette, toasts)
     3. Pipeline engine      7. Actions and event wiring
     4. App state / history  8. Boot
   The engine owns pipeline state; the UI only renders what the engine reports.
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* 1. Utilities                                                        */
  /* ------------------------------------------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pad = (n) => String(n).padStart(2, '0');
  const fill = (tpl, ctx) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => (k in ctx ? ctx[k] : m));
  const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const short = (hash) => String(hash).slice(0, 7);

  const fmtClock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const fmtDur = (ms) => {
    if (!Number.isFinite(ms) || ms <= 0) return '0.0s';
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${pad(Math.round((ms % 60000) / 1000))}s`;
  };
  const fmtDate = (iso) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const fmtAgo = (iso) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
  };
  const randomHash = () => Array.from({ length: 12 }, () => '0123456789abcdef'[randInt(0, 15)]).join('');

  function downloadFile(name, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  }

  /* ------------------------------------------------------------------ */
  /* 2. Store: persistent preferences and history                        */
  /* ------------------------------------------------------------------ */
  const STORAGE_KEY = 'deployx:v1';
  const PROFILE_ROLES = ['Developer', 'DevOps engineer', 'SRE', 'Engineering manager', 'Student'];
  const PROFILE_COLORS = { amber: ['#FFB627', '#14161A'], blue: ['#2A69EA', '#FFFFFF'], green: ['#0B6B4E', '#FFFFFF'], orange: ['#EE5A24', '#14161A'], red: ['#B3261E', '#FFFFFF'], slate: ['#4A5059', '#FFFFFF'] };
  const MAX_HISTORY = 150;

  const Store = {
    state: null,
    defaults() {
      return {
        prefs: {
          theme: 'light', environment: 'development', branch: 'main', speed: 1,
          autoScroll: true, confirmProd: true, approval: 'manual', strategy: 'env', chaosIntensity: 'normal', tourSeen: false, sidebarCollapsed: false, view: 'overview',
          failure: { enabled: false, mode: 'stage', stage: 'test', chance: 50 }
        },
        history: [], nextRun: 1001, commitCursor: 0, seeded: false, drills: {}, pipeline: null, incidents: [], nextInc: 1, chat: [], nextMsg: 1,
        profile: { name: 'Guest Engineer', role: 'DevOps engineer', team: 'Platform', color: 'amber', reviewer: 'auto', earned: {}, counters: { approvals: 0, rejections: 0, commands: 0 }, tourDone: false, created: new Date().toISOString() }
      };
    },
    load() {
      const base = this.defaults();
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (saved && typeof saved === 'object') {
          Object.assign(base, saved);
          base.prefs = { ...this.defaults().prefs, ...(saved.prefs || {}) };
          base.prefs.failure = { ...this.defaults().prefs.failure, ...((saved.prefs || {}).failure || {}) };
          base.history = Array.isArray(saved.history) ? saved.history.filter((r) => r && r.id && Array.isArray(r.stages)) : [];
          if (!base.drills || typeof base.drills !== 'object' || Array.isArray(base.drills)) base.drills = {};
          if (!Array.isArray(base.pipeline)) base.pipeline = null;
          if (!Array.isArray(base.incidents)) base.incidents = [];
          if (!Number.isFinite(base.nextInc)) base.nextInc = base.incidents.length + 1;
          const dp = this.defaults().profile;
          const sp = saved.profile && typeof saved.profile === 'object' ? saved.profile : {};
          const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
          base.profile = {
            name: typeof sp.name === 'string' && sp.name.trim() ? sp.name.trim().slice(0, 28) : dp.name,
            role: PROFILE_ROLES.includes(sp.role) ? sp.role : dp.role,
            team: typeof sp.team === 'string' ? sp.team.slice(0, 24) : dp.team,
            color: PROFILE_COLORS[sp.color] ? sp.color : dp.color,
            reviewer: typeof sp.reviewer === 'string' ? sp.reviewer.slice(0, 40) : 'auto',
            earned: sp.earned && typeof sp.earned === 'object' && !Array.isArray(sp.earned) ? sp.earned : {},
            counters: { approvals: count((sp.counters || {}).approvals), rejections: count((sp.counters || {}).rejections), commands: count((sp.counters || {}).commands) },
            tourDone: !!sp.tourDone,
            created: typeof sp.created === 'string' ? sp.created : dp.created
          };
          base.chat = Array.isArray(base.chat) ? base.chat.filter((m) => m && m.id && m.ch && (m.text || m.card)) : [];
          if (!Number.isFinite(base.nextMsg)) base.nextMsg = base.chat.length + 1;
          /* buttons that act on live state, and "in progress" cards, mean nothing after a reload */
          base.chat.forEach((m) => {
            const c = m.card;
            if (!c) return;
            c.buttons = (c.buttons || []).filter((b) => b.act === 'nav' || b.act === 'detail');
            if (c.color === 'blue' && /^(Starting|Running|Rolling out|Waiting)/.test(c.status || '')) { c.color = 'grey'; c.status = 'Interrupted when the page was reloaded.'; }
            if (c.status === 'Investigating' || /approvals ·/.test(c.status || '')) { c.color = 'grey'; c.status = 'Interrupted when the page was reloaded.'; }
          });
        }
      } catch (err) {
        console.warn('DeployX: stored data was unreadable, starting fresh.', err);
      }
      this.state = base;
      return base;
    },
    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        return true;
      } catch (err) {
        console.warn('DeployX: could not save to LocalStorage.', err);
        return false;
      }
    },
    wipe() {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
      this.state = this.defaults();
    }
  };

  /* ------------------------------------------------------------------ */
  /* 3. Pipeline engine (no DOM access in here)                          */
  /* ------------------------------------------------------------------ */
  class CancelledError extends Error {}
  /* A reviewer rejected the deployment, or nobody approved in time. Not a failure: the run is stopped. */
  class GateDeclined extends Error {
    constructor(kind, by, reason) { super(kind); this.kind = kind; this.by = by; this.reason = reason; }
  }
  class StageFailure extends Error {
    constructor(stage, info) { super(info.message); this.stage = stage; this.info = info; }
  }

  /* Stages that share a `parallel` group and sit next to each other run side by side
     (a "wave"); every other stage is a wave of one. Waves run in sequence. */
  function buildWaves(stages) {
    const waves = [];
    stages.forEach((s) => {
      const last = waves[waves.length - 1];
      if (s.parallel && last && last[0].parallel === s.parallel) last.push(s);
      else waves.push([s]);
    });
    return waves;
  }

  class PipelineEngine {
    constructor(stages) {
      this.stages = stages;
      this.waves = buildWaves(stages);
      this.run = null;
      this.handlers = { update: [], log: [], gate: [], rollout: [] };
      this.rollout = null;
      this.gateState = null;
      this.declined = null;
      this.forceFail = null;
      this.abort = null;
      this.ticker = null;
    }
    on(evt, fn) { this.handlers[evt].push(fn); }
    emit(evt, payload) { this.handlers[evt].forEach((fn) => fn(payload)); }
    get isRunning() { return !!this.run && this.run.status === 'running'; }
    stateOf(id) { return this.run.stages.find((s) => s.id === id); }

    log(level, message) {
      const entry = { t: Date.now(), level, msg: fill(message, this.ctx) };
      this.run.logs.push(entry);
      this.emit('log', entry);
    }

    /* Cancellable delay: rejects with CancelledError when the given signal aborts. */
    sleep(ms, signal = this.abort.signal) {
      return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(new CancelledError());
        const onAbort = () => { clearTimeout(id); reject(new CancelledError()); };
        const id = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }

    cancel() {
      if (!this.isRunning) return false;
      this.abort.abort();
      return true;
    }

    /* Progress is derived from real elapsed time against each running stage's planned duration. */
    tick() {
      const run = this.run;
      run.stages.filter((s) => s.status === 'running').forEach((st) => {
        /* a stage waiting for approval progresses with the approvals given, not with the clock */
        if (st.waiting) st.progress = this.gateState ? Math.min(0.97, this.gateState.approvals.length / this.gateState.required) : st.progress;
        else if (st.rolling && this.rollout) {
          /* a progressive rollout advances one traffic step at a time */
          const r = this.rollout;
          const part = r.phase === 'soak' && r.soakMs ? Math.min(1, (performance.now() - r.soakStart) / r.soakMs) : 0;
          st.progress = Math.min(0.97, (Math.max(0, r.stepIdx) + part) / r.steps.length);
          st.rolloutPct = r.traffic;
        } else st.progress = Math.min(0.97, (performance.now() - st.t0) / st.planned);
      });
      run.durationMs = performance.now() - run.t0;
      this.emit('update', run);
    }

    async start(opts) {
      if (this.isRunning) throw new Error('A pipeline is already running.');
      this.ctx = opts.ctx;
      this.abort = new AbortController();
      this.declined = null;
      this.gateState = null;
      this.rollout = null;
      this.forceFail = null;
const run = this.run = {
        id: opts.id, status: 'running', attempt: opts.attempt || 1, retryOf: opts.retryOf || null,
        promotedFrom: opts.promotedFrom || null, drill: opts.drill || null, rollbackFrom: opts.rollbackFrom || null, declined: null, autoRollback: false,
        envId: opts.env.id, branch: opts.branch, commit: opts.commit,
        startedAt: new Date().toISOString(), finishedAt: null, t0: performance.now(), durationMs: 0,
        failedStage: null, error: null, logs: [],
        stages: this.stages.map((s) => ({ id: s.id, status: 'idle', progress: 0, durationMs: 0 }))
      };
      this.emit('update', run);
      this.ticker = setInterval(() => this.tick(), 90);
      if (opts.preface) this.log('warn', opts.preface);

      try {
        /* A rollback redeploys a stored image, so only the listed stages run. */
        if (opts.only) run.stages.forEach((s) => { if (!opts.only.includes(s.id)) s.status = 'skipped'; });
        for (const [wi, wave] of this.waves.entries()) {
          const defs = wave.filter((d) => this.stateOf(d.id).status !== 'skipped');
          if (!defs.length) continue;
          if (opts.beforeWave) await this.holdFor(opts.beforeWave(defs, wi), this.abort.signal); /* the guided tour pauses here */
          await this.execWave(defs, opts);
        }
        run.status = 'success';
        run.durationMs = performance.now() - run.t0;
        this.log('success', `Pipeline {id} finished in ${fmtDur(run.durationMs)} · {env} is live (simulated).`);
      } catch (err) {
        const now = performance.now();
        run.stages.filter((s) => s.status === 'running').forEach((s) => { s.status = 'cancelled'; s.durationMs = Math.round(now - s.t0); });
        const rest = run.stages.filter((s) => s.status === 'idle');
        rest.forEach((s) => { s.status = 'skipped'; });
        const nameOf = (id) => this.stages.find((d) => d.id === id).name;
        const skipped = rest.map((s) => this.stages.find((d) => d.id === s.id).short).join(', ');
        if (err instanceof CancelledError) {
          run.status = 'cancelled';
          const names = run.stages.filter((s) => s.status === 'cancelled').map((s) => nameOf(s.id)).join(' and ');
          this.log('warn', `Pipeline {id} cancelled by user${names ? ` during ${names}` : ''}.`);
        } else if (err instanceof StageFailure) {
          run.status = 'failed';
          run.failedStage = err.stage.id;
          run.error = { code: err.info.code, message: fill(err.info.message, this.ctx), hint: err.info.hint, details: (err.info.details || []).map((d) => fill(d, this.ctx)) };
          this.log('error', `Pipeline {id} failed at ${err.stage.name} [${err.info.code}].`);
          if (err.info.hint) this.log('warn', `Hint: ${err.info.hint}`);
        } else if (err instanceof GateDeclined) {
          run.status = 'cancelled';
          run.declined = err.kind;
          this.log('warn', err.kind === 'timeout'
            ? 'Pipeline {id} stopped: nobody approved in time, so the deployment was not released.'
            : `Pipeline {id} stopped: ${err.by} rejected the deployment${err.reason ? ` (${err.reason})` : ''}.`);
        } else {
          throw err;
        }
        if (skipped) this.log('dim', `Skipped stages: ${skipped}.`);
      } finally {
        clearInterval(this.ticker);
        if (this.gateState) { this.gateState.cleanup && this.gateState.cleanup(); this.gateState = null; this.emit('gate', { type: 'close' }); }
        run.durationMs = Math.round(performance.now() - run.t0);
        run.finishedAt = new Date().toISOString();
        this.emit('update', run);
      }
      return run;
    }

    /* Waits for a promise (a person pressing Continue) but still honours cancellation. */
    holdFor(promise, signal) {
      return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(new CancelledError());
        const onAbort = () => reject(new CancelledError());
        signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(promise).then((v) => { signal.removeEventListener('abort', onAbort); resolve(v); }, reject);
      });
    }

    /* Runs one wave. Several stages run at once (fan-out); the next wave starts only when
       all of them pass (fan-in). If one fails, its siblings are cancelled (fail-fast). */
    async execWave(defs, opts) {
      const par = defs.length > 1;
      const group = new AbortController();
      const relay = () => group.abort();
      if (this.abort.signal.aborted) group.abort();
      else this.abort.signal.addEventListener('abort', relay, { once: true });

      const t0 = performance.now();
      if (par) this.log('dim', `Fan-out: ${defs.map((d) => d.name).join(' and ')} run in parallel.`);
      let failure = null;
      await Promise.all(defs.map((def) => this.execStage(def, opts, par, group.signal).catch((err) => {
        if (err instanceof StageFailure) { if (!failure) { failure = err; group.abort(); } }
        else if (err instanceof GateDeclined) { if (!this.declined) { this.declined = err; group.abort(); } }
        else if (!(err instanceof CancelledError)) throw err;
      })));
      this.abort.signal.removeEventListener('abort', relay);

      if (failure) {
        defs.filter((d) => this.stateOf(d.id).status === 'cancelled')
          .forEach((d) => this.log('warn', `${d.name} cancelled: a parallel stage failed (fail-fast).`));
        throw failure;
      }
      if (this.declined) throw this.declined;
      if (defs.some((d) => this.stateOf(d.id).status === 'cancelled')) throw new CancelledError();
      if (par) {
        const seq = defs.reduce((sum, d) => sum + this.stateOf(d.id).durationMs, 0);
        this.log('success', `Fan-in: ${defs.map((d) => d.name).join(' and ')} passed in ${fmtDur(performance.now() - t0)} (one after another: ~${fmtDur(seq)}).`);
      }
    }

    /* The approval gate. Environments without protection rules pass straight through; protected ones
       wait for enough reviewers (never the change's author) to approve, or for a rejection or timeout. */
    async execGate(def, st, opts, signal) {
      const gate = opts.env.gate;
      if (!gate) {
        this.log('info', def.steps[0].message);
        await this.sleep(350 / opts.speed, signal);
        this.log('success', def.steps[1].message);
        return;
      }
      const author = this.ctx.author;
      const eligible = gate.approvers.filter((n) => n !== author);
      const g = this.gateState = {
        stageId: def.id, envName: opts.env.name, approvers: gate.approvers, author,
        required: Math.max(1, Math.min(gate.required || 1, eligible.length)),
        approvals: [], decided: false, t0: performance.now(), timeoutMs: gate.timeoutSec * 1000, timers: [], resolve: null, cleanup: null
      };
      st.waiting = true;
      st.planned = g.timeoutMs;
      this.log('warn', `Approval required for ${opts.env.name}: ${g.required} reviewer${g.required > 1 ? 's' : ''} other than the author (${author}). Times out in ${gate.timeoutSec}s.`);
      this.emit('gate', { type: 'open', g });
      const outcome = await new Promise((resolve, reject) => {
        g.resolve = resolve;
        const timer = setTimeout(() => resolve({ type: 'timeout' }), g.timeoutMs);
        const onAbort = () => reject(new CancelledError());
        signal.addEventListener('abort', onAbort, { once: true });
        g.cleanup = () => { clearTimeout(timer); g.timers.forEach(clearTimeout); signal.removeEventListener('abort', onAbort); };
        if (signal.aborted) onAbort();
        else if (opts.autoApprove) {
          eligible.slice(0, g.required).forEach((name, i) => g.timers.push(setTimeout(() => this.approve(name, 'sim'), (1300 + i * 1200) / opts.speed)));
        }
      }).finally(() => {
        g.cleanup();
        this.gateState = null;
        st.waiting = false;
        this.emit('gate', { type: 'close', g });
      });
      if (outcome.type === 'approved') {
        this.log('success', `Approved by ${g.approvals.map((a) => a.name).join(' and ')}. Release unblocked.`);
        return;
      }
      if (outcome.type === 'rejected') throw new GateDeclined('rejected', outcome.by, outcome.reason);
      throw new GateDeclined('timeout');
    }

    approve(name, actor = 'user') {
      const g = this.gateState;
      if (!g || g.decided) return { ok: false, reason: 'No approval is pending.' };
      if (!g.approvers.includes(name)) return { ok: false, reason: `${name} is not a reviewer for ${g.envName}.` };
      if (name === g.author) return { ok: false, reason: 'The author of a change cannot approve their own deployment.' };
      if (g.approvals.some((a) => a.name === name)) return { ok: false, reason: `${name} has already approved.` };
      g.approvals.push({ name, t: Date.now() });
      this.log('success', `✓ ${name} approved (${g.approvals.length} of ${g.required}).`);
      if (g.approvals.length >= g.required) { g.decided = true; g.resolve({ type: 'approved' }); }
      this.emit('gate', { type: 'update', g, actor });
      return { ok: true };
    }

    reject(name, reason) {
      const g = this.gateState;
      if (!g || g.decided) return { ok: false, reason: 'No approval is pending.' };
      const why = String(reason || '').replace(/[{}]/g, '').trim().slice(0, 60);
      this.log('error', `✕ ${name} rejected the deployment${why ? `: ${why}` : ''}.`);
      g.decided = true;
      g.resolve({ type: 'rejected', by: name, reason: why });
      this.emit('gate', { type: 'rejected', g, actor: 'user' });
      return { ok: true };
    }

    /* A progressive rollout: traffic moves to the new version in steps. At every step the new version's
       error rate is sampled against an error budget; two bad samples in a row roll everything back. */
    async execRollout(def, st, opts, signal) {
      const plan = opts.rollout;
      const canary = plan.kind === 'canary';
      const bad = opts.failStage === def.id || this.forceFail === def.id; /* failure simulation at Deployment = a bad release */
      const badFrom = bad ? (plan.steps.length > 1 ? 1 : 0) : -1;
      const sc = this.ctx.commit;
      const r = this.rollout = {
        kind: plan.kind, steps: plan.steps, stepIdx: -1, traffic: 0, phase: 'deploying', samples: [], budgetPct: plan.budgetPct,
        baselinePct: plan.baselinePct, stable: plan.stable, commit: sc, newPct: plan.baselinePct, basePct: plan.baselinePct,
        soakStart: 0, soakMs: 0, skip: false, abort: false
      };
      st.rolling = true;
      st.rolloutPct = 0;
      this.emit('rollout', { type: 'open', r });
      try {
        this.log('info', canary
          ? `Canary rollout: ${sc} runs next to the stable release (${plan.stable}). Traffic steps ${plan.steps.join('% → ')}%, error budget ${plan.budgetPct}%.`
          : `Blue/green: starting the green environment for ${sc} next to blue (${plan.stable}). Traffic moves in one switch and blue stays on standby for an instant rollback.`);
        await this.sleep(plan.standbyMs / opts.speed, signal);
        this.log('dim', canary ? 'Canary pods are healthy and receiving no traffic yet.' : 'Green passed its smoke checks.');

        const rollBack = async (auto, reason, errPct) => {
          r.phase = 'rollback';
          this.emit('rollout', { type: 'phase', r });
          this.log('error', reason);
          await this.sleep(600 / opts.speed, signal);
          r.traffic = 0;
          st.rolloutPct = 0;
          this.emit('rollout', { type: 'phase', r });
          this.log('success', canary ? `Traffic returned to the stable release (${plan.stable}). The canary was scaled to zero.` : `Switched back to blue (${plan.stable}).`);
          const where = `${r.steps[Math.max(0, r.stepIdx)]}%`;
          if (auto) this.run.autoRollback = true;
          throw new StageFailure(def, auto
            ? {
              code: canary ? 'CANARY_ERROR_BUDGET_EXCEEDED' : 'BLUEGREEN_ERRORS_AFTER_SWITCH',
              message: `${canary ? 'Canary' : 'Release'} rolled back automatically at ${where}: error rate ${errPct.toFixed(1)}% exceeded the ${plan.budgetPct}% budget.`,
              details: [`New version ${sc}: ${errPct.toFixed(1)}% errors · stable ${plan.stable}: ${r.basePct.toFixed(1)}% errors`,
                canary ? `Users were exposed at ${where} of traffic for only a few seconds.` : 'All traffic was moved back to the stable environment.'],
              hint: 'Fix the regression, then run the pipeline again.'
            }
            : { code: 'ROLLOUT_ABORTED', message: `Rollout aborted by an operator at ${where}. Traffic was returned to the stable release.`, details: [], hint: 'Find out why it was aborted, then run the pipeline again.' });
        };

        for (let i = 0; i < plan.steps.length; i++) {
          r.stepIdx = i;
          r.traffic = plan.steps[i];
          st.rolloutPct = r.traffic;
          r.phase = 'soak';
          this.log('info', canary ? `Shifting ${r.traffic}% of traffic to ${sc}.` : `Switching all traffic to green (${sc}).`);
          r.soakMs = plan.soakMs / opts.speed;
          r.soakStart = performance.now();
          this.emit('rollout', { type: 'step', r });
          let breaches = 0;
          while (performance.now() - r.soakStart < r.soakMs) {
            await this.sleep(250, signal);
            if (r.abort) await rollBack(false);
            if (r.skip) { r.skip = false; this.log('dim', `Soak skipped by an operator at ${r.traffic}%.`); break; }
            const noise = () => (Math.random() - 0.5) * 0.12;
            const base = Math.max(0.05, plan.baselinePct + noise());
            const neu = bad && i >= badFrom ? plan.budgetPct * rand(2.2, 4) : Math.max(0.05, plan.baselinePct + 0.04 + noise());
            r.basePct = base;
            r.newPct = neu;
            r.samples.push({ i, newPct: neu, basePct: base });
            this.emit('rollout', { type: 'sample', r });
            breaches = neu > plan.budgetPct ? breaches + 1 : 0;
            if (breaches >= 2) await rollBack(true, `Error rate on ${sc} is ${neu.toFixed(1)}% (budget ${plan.budgetPct}%) at ${r.traffic}% traffic.`, neu);
          }
          if (r.abort) await rollBack(false);
          this.log('success', canary ? `${r.traffic}% looks healthy: ${r.newPct.toFixed(2)}% errors against a ${plan.budgetPct}% budget.` : `Green is healthy after the switch (${r.newPct.toFixed(2)}% errors).`);
        }
        r.phase = 'done';
        this.log('success', canary ? `Promoted: 100% of traffic is on ${sc}. The previous release was scaled down.` : 'Promoted: green is live. Blue stays on standby for an instant rollback.');
      } finally {
        st.rolling = false;
        this.rollout = null;
        this.emit('rollout', { type: 'close', r });
      }
    }

    rolloutSkip() {
      const r = this.rollout;
      if (!r || r.phase !== 'soak') return { ok: false, reason: 'There is no rollout step to promote right now.' };
      r.skip = true;
      return { ok: true };
    }

    rolloutAbort() {
      const r = this.rollout;
      if (!r || r.phase === 'rollback' || r.phase === 'done') return { ok: false, reason: 'There is no rollout to abort.' };
      r.abort = true;
      this.log('warn', 'An operator is aborting the rollout.');
      return { ok: true };
    }

    async execStage(def, opts, par, signal) {
      const st = this.stateOf(def.id);
      const say = (level, msg) => this.log(level, par ? `[${def.short}] ${msg}` : msg);
      st.status = 'running';
      st.t0 = performance.now();
      st.planned = (rand(def.duration.min, def.duration.max) * opts.env.durationFactor) / opts.speed;
      this.log('stage', `▸ STAGE ${this.stages.indexOf(def) + 1}/${this.stages.length} · ${def.name.toUpperCase()}${par ? ' · PARALLEL' : ''}`);
      this.emit('update', this.run);

      const weights = def.steps.map(() => rand(0.6, 1.4));
      const total = weights.reduce((a, b) => a + b, 0);
      const failAt = opts.failStage === def.id || this.forceFail === def.id ? randInt(1, def.steps.length - 1) : -1;
      const fault = opts.failure && opts.failStage === def.id ? opts.failure : def.failure; /* drills inject their own fault */

      try {
        if (def.kind === 'gate') await this.execGate(def, st, opts, signal);
        else if (def.kind === 'deploy' && opts.rollout && !opts.failure) await this.execRollout(def, st, opts, signal);
        else for (let i = 0; i < def.steps.length; i++) {
          await this.sleep((st.planned * weights[i]) / total, signal);
          if (i === failAt) {
            st.progress = Math.min(0.97, (performance.now() - st.t0) / st.planned);
            say('error', `ERROR ${fault.code}: ${fault.message}`);
            (fault.details || []).forEach((d) => say('error', `  ${d}`));
            throw new StageFailure(def, fault);
          }
          say(def.steps[i].level, def.steps[i].message);
        }
      } catch (err) {
        st.durationMs = Math.round(performance.now() - st.t0);
        st.status = err instanceof StageFailure ? 'failed' : 'cancelled';
        throw err;
      }
      st.status = 'success';
      st.progress = 1;
      st.durationMs = Math.round(performance.now() - st.t0);
      this.emit('update', this.run);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 4. App state, history and statistics                                */
  /* ------------------------------------------------------------------ */
  const App = {
    pipeline: null, stages: [], baseStages: [], catalog: [], editor: { tab: 'definition', items: null },
    tour: null, tourData: null, rolloutCfg: null, chaosCfg: null, incident: null,
    waves: [], layout: null, envs: [], demo: null, engine: null,
    filters: { q: '', status: 'all', env: 'all' },
    termLogs: [], launching: false, alert: null,
    drills: [], drillCfg: null, drill: null, drillTimer: null,
    metricsFilter: { days: 7, env: 'all' }
  };
  const prefs = () => Store.state.prefs;
  const history = () => Store.state.history;
  const envById = (id) => App.envs.find((e) => e.id === id) || App.envs[0];
  const stageById = (id) => App.stages.find((s) => s.id === id);
  const recordById = (id) => history().find((r) => r.id === id);

  const VIEWS = {
    overview: { title: 'Overview', sub: () => `${App.demo.repository.name} · ${history().length} pipeline runs` },
    pipelines: { title: 'Pipelines', sub: () => `${App.pipeline.name} · ${App.stages.length} stages` },
    deployments: { title: 'Deployments', sub: () => 'Every pipeline run, searchable and exportable' },
    builds: { title: 'Build History', sub: () => 'Stage-by-stage timing for each run' },
    environment: { title: 'Environment', sub: () => 'Three simulated lines to deploy onto' },
    metrics: { title: 'DORA Metrics', sub: () => 'Delivery performance, computed from your simulated runs' },
    chaos: { title: 'Chaos Mode', sub: () => (chaos.armed ? 'Armed: something will break soon' : 'Random incidents to triage, scored and fed into DORA') },
    drills: { title: 'Incident Drills', sub: () => `${drillStats().done} of ${App.drills.length} solved · ${drillStats().points} pts · ${drillStats().rank.name}` },
    settings: { title: 'Settings', sub: () => 'Preferences are saved in this browser' },
    profile: { title: 'Profile', sub: () => `${profile().role}${profile().team ? ` · ${profile().team}` : ''}` }
  };

  /* Preference validation: every write goes through here. */
  const PREF_RULES = {
    theme: (v) => ['light', 'dark', 'system'].includes(v),
    environment: (v) => App.envs.some((e) => e.id === v),
    branch: (v) => App.demo.branches.includes(v),
    speed: (v) => [0.5, 1, 2, 4].includes(v),
    autoScroll: (v) => typeof v === 'boolean',
    confirmProd: (v) => typeof v === 'boolean',
    approval: (v) => ['manual', 'auto'].includes(v),
    tourSeen: (v) => typeof v === 'boolean',
    strategy: (v) => ['env', 'canary', 'bluegreen', 'rolling', 'recreate'].includes(v),
    chaosIntensity: (v) => ['calm', 'normal', 'wild'].includes(v),
    sidebarCollapsed: (v) => typeof v === 'boolean',
    view: (v) => v in VIEWS,
    'failure.enabled': (v) => typeof v === 'boolean',
    'failure.mode': (v) => ['stage', 'random'].includes(v),
    'failure.stage': (v) => App.stages.some((s) => s.id === v),
    'failure.chance': (v) => Number.isFinite(v) && v >= 10 && v <= 100
  };
  const getPref = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), prefs());
  function setPref(path, value) {
    const rule = PREF_RULES[path];
    if (!rule || !rule(value)) return false;
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], prefs())[last] = value;
    Store.save();
    syncPrefs();
    return true;
  }
  function sanitizePrefs() {
    const d = Store.defaults().prefs;
    Object.keys(PREF_RULES).forEach((path) => {
      if (!PREF_RULES[path](getPref(path))) {
        const keys = path.split('.');
        const last = keys.pop();
        keys.reduce((o, k) => o[k], prefs())[last] = keys.concat(last).reduce((o, k) => o[k], d);
      }
    });
  }

  function seedHistory() {
    const weights = App.baseStages.map((s) => (s.duration.min + s.duration.max) / 2); /* demo history always uses the default pipeline */
    const seeds = [...App.demo.seedHistory].sort((a, b) => b.minutesAgo - a.minutesAgo);
    const records = seeds.map((seed) => {
      const failIdx = seed.status === 'failed' ? App.baseStages.findIndex((s) => s.id === seed.failedStage) : -1;
      const ran = failIdx >= 0 ? failIdx + 1 : App.baseStages.length;
      const sum = weights.slice(0, ran).reduce((a, b) => a + b, 0);
      const start = Date.now() - seed.minutesAgo * 60000;
      const failDef = failIdx >= 0 ? App.baseStages[failIdx].failure : null;
      const commit = App.demo.commits[seed.commit % App.demo.commits.length];
      return {
        id: `DPX-${Store.state.nextRun++}`, status: seed.status, attempt: 1, retryOf: null, seeded: true,
        commit, branch: seed.branch, environment: seed.environment, durationMs: seed.durationMs,
        startedAt: new Date(start).toISOString(), finishedAt: new Date(start + seed.durationMs).toISOString(),
        failedStage: failIdx >= 0 ? seed.failedStage : null,
        error: failDef ? { code: failDef.code, message: fill(failDef.message, { commit: short(commit.hash), branch: seed.branch }), hint: failDef.hint, details: [] } : null,
        stages: App.baseStages.map((s, i) => ({
          id: s.id,
          status: i < ran - 1 || failIdx < 0 ? (i < ran ? 'success' : 'skipped') : i === failIdx ? 'failed' : 'skipped',
          durationMs: i < ran ? Math.round((seed.durationMs * weights[i]) / sum) : 0
        })),
        logs: []
      };
    });
    Store.state.history = records.reverse();
    Store.state.seeded = true;
  }

  function computeStats(list) {
    const success = list.filter((r) => r.status === 'success');
    const failed = list.filter((r) => r.status === 'failed');
    const done = success.length + failed.length;
    const finished = [...success, ...failed];
    const weekAgo = Date.now() - 7 * 86400000;
    const recent = success.filter((r) => new Date(r.startedAt).getTime() >= weekAgo).length;
    return {
      total: list.length, success: success.length, failed: failed.length,
      cancelled: list.length - done,
      rate: done ? Math.round((success.length / done) * 100) : null,
      avg: finished.length ? finished.reduce((a, r) => a + r.durationMs, 0) / finished.length : null,
      recent, perDay: recent / 7
    };
  }

  function toRecord(run) {
    return {
      id: run.id, status: run.status, attempt: run.attempt, retryOf: run.retryOf, promotedFrom: run.promotedFrom, drill: run.drill, rollbackFrom: run.rollbackFrom, declined: run.declined || null, autoRollback: !!run.autoRollback, seeded: false,
      commit: run.commit, branch: run.branch, environment: run.envId, durationMs: run.durationMs,
      startedAt: run.startedAt, finishedAt: run.finishedAt, failedStage: run.failedStage, error: run.error,
      stages: run.stages.map(({ id, status, durationMs }) => ({ id, status, durationMs })),
      logs: run.logs
    };
  }

  const idleRun = () => ({
    id: null, status: 'idle', envId: prefs().environment, attempt: 1, durationMs: 0,
    stages: App.stages.map((s) => ({ id: s.id, status: 'idle', progress: 0, durationMs: 0 }))
  });
  const displayRun = () => App.engine.run || idleRun();
  /* The run Retry applies to: the latest non-drill run, unless it succeeded or a drill is in progress. */
  function lastRetryable() {
    if (App.drill && App.drill.phase !== 'done') return null;
    const last = history().find((r) => !r.drill);
    return last && last.status !== 'success' ? last : null;
  }
  const canRetry = () => !App.engine.isRunning && !!lastRetryable();

  function pickFailure() {
    const f = prefs().failure;
    if (!f.enabled) return null;
    if (f.mode === 'stage') return stageById(f.stage) ? f.stage : null;
    const pool = App.stages.filter((s) => s.kind !== 'gate'); /* a gate cannot "fail", it can only be declined */
    return Math.random() * 100 < f.chance ? pool[randInt(0, pool.length - 1)].id : null;
  }

  function nextCommit() {
    const list = App.demo.commits;
    const base = list[Store.state.commitCursor++ % list.length];
    return { hash: randomHash(), message: base.message, author: base.author };
  }

  /* Start a run. `retryOf` is a history record when recovering from a failure.
     `promote` is { record, to } when carrying a live build onto the next line. */
  async function startRun({ retryOf = null, environment = null, promote = null, drill = null, fixLabel = '', rollback = null, tour = null, quiet = false } = {}) {
    if (App.engine.isRunning || App.launching) {
      toast('info', 'Pipeline already running', 'Only one run at a time. Wait for it to finish or cancel it.');
      return;
    }
    if (App.drill && App.drill.phase !== 'done' && !drill) {
      toast('info', 'Drill in progress', 'Finish or abandon the incident drill before starting a normal run.');
      return;
    }
    App.launching = true;
    try {
      const env = envById(retryOf ? retryOf.environment : promote ? promote.to : rollback ? rollback.target.environment : drill ? drill.env : tour ? tour.env : environment || prefs().environment);
      const source = retryOf || (promote && promote.record) || (rollback && rollback.target);
      const promotedFrom = promote ? promote.record.id : retryOf ? retryOf.promotedFrom || null : null;
      if (env.requiresConfirmation && prefs().confirmProd && !rollback && !tour && !App.stages.some((s) => s.kind === 'gate')) {
        const ok = await openModal({
          eyebrow: 'Confirmation required',
          title: `Deploy to ${env.name}?`,
          body: `<p>This run ends at the <strong>${esc(env.name)}</strong> terminus using a ${esc(env.strategy.toLowerCase())} rollout. It is a simulation: no real infrastructure is changed.</p>`,
          actions: [{ label: 'Not now', kind: 'outline', value: false }, { label: `Deploy to ${env.name}`, kind: 'primary', value: true }]
        });
        if (!ok) return;
      }
      const commit = source ? source.commit : nextCommit();
      const branch = source ? source.branch : drill ? (drill.branch || App.demo.repository.defaultBranch) : (App.demo.branches.includes(prefs().branch) ? prefs().branch : App.demo.repository.defaultBranch);
      const id = `DPX-${Store.state.nextRun++}`;
      const attempt = retryOf ? (retryOf.attempt || 1) + 1 : 1;
      Store.save();

      App.alert = null;
      renderAlert();
      termSeparator();
      if (!quiet) navigate(drill ? 'drills' : promote || rollback ? 'environment' : 'overview'); /* chat commands stay where you are */
      if (!drill && !tour) chatRunStart({ id, env, branch, commit, kind: rollback ? 'Rollback' : promote ? 'Promotion' : retryOf ? 'Retry' : 'Deploy' });
      const run = await App.engine.start({
        id, env, branch, commit, attempt, promotedFrom, drill: drill ? drill.id : tour ? 'tour' : null, beforeWave: tour ? tourBeforeWave : null,
        rollbackFrom: rollback ? rollback.live.commit.hash : null, only: rollback ? ['deploy'] : null,
        autoApprove: !!drill || !!tour || prefs().approval === 'auto',
        rollout: rollback ? null : rolloutPlan(env), /* a rollback skips the careful, slow rollout */
        speed: drill || tour ? Math.max(2, prefs().speed) : prefs().speed,
        retryOf: retryOf ? retryOf.id : null,
        failStage: retryOf || rollback || tour ? null : drill ? drill.stage : pickFailure(),
        failure: !retryOf && drill ? drill.failure : null,
        preface: retryOf && drill ? `Fix applied: ${fixLabel}. Re-running the failed commit.`
          : drill ? 'Incident drill started. A fault has been injected on this line.'
          : tour ? 'Guided tour: the run pauses at each stop so you can see what a real pipeline does there.'
          : rollback ? `Rollback: ${env.name} from ${short(rollback.live.commit.hash)} to ${short(rollback.target.commit.hash)} (${rollback.target.id}). Reusing the stored image; build, test and security scan are skipped.` : retryOf ? `Retry of ${retryOf.id} · attempt ${attempt} · injected fault cleared for recovery.`
          : promote ? `Promotion: build ${short(commit.hash)} from ${envById(promote.record.environment).name} (${promote.record.id}) to ${env.name}.` : null,
        ctx: {
          id, commit: short(commit.hash), branch, message: commit.message, author: commit.author,
          env: env.name, url: env.url, region: env.region, replicas: env.replicas, strategy: STRATEGY_LABELS[strategyKind(env)] || env.strategy,
          repo: App.demo.repository.name, deps: randInt(840, 880), unit: randInt(180, 240), integration: randInt(36, 58)
        }
      });
      finishRun(run, env);
    } catch (err) {
      console.error(err);
      toast('error', 'Pipeline error', err.message || 'The simulator hit an unexpected error.');
    } finally {
      App.launching = false;
      renderControls();
    }
  }

  function finishRun(run, env) {
    const record = toRecord(run);
    history().unshift(record);
    if (history().length > MAX_HISTORY) history().length = MAX_HISTORY;
    if (!Store.save()) toast('error', 'History not saved', 'LocalStorage is unavailable or full.');

    if (!run.drill) chatRunFinished(run);
    if (run.drill === 'tour') {
      tourRunFinished(run);
      renderAll();
      return;
    }
    if (run.drill) {
      drillRunFinished(run, record);
      renderAll();
      return;
    }

    if (run.status === 'success') {
      App.alert = run.retryOf ? { kind: 'success', record } : null;
      toast('success', run.rollbackFrom ? 'Rolled back' : run.retryOf ? 'Recovered' : 'Deployment successful',
        `${run.id} reached ${env.name} in ${fmtDur(run.durationMs)}${run.retryOf ? ` after retrying ${run.retryOf}` : ''}.`);
    } else if (run.status === 'failed') {
      App.alert = { kind: 'error', record };
      toast('error', run.autoRollback ? 'Rolled back automatically' : 'Pipeline failed',`${run.id} stopped at ${stageById(run.failedStage).name}.`);
    } else {
      App.alert = { kind: 'warn', record };
      toast('info', run.declined === 'timeout' ? 'Approval timed out' : run.declined ? 'Deployment rejected' : 'Pipeline cancelled',
        run.declined ? `${run.id} was not released. Later stages were skipped.` : `${run.id} was stopped. Later stages were skipped.`);
    }
    renderAll();
  }

  /* ------------------------------------------------------------------ */
  /* 5. Rendering                                                        */
  /* ------------------------------------------------------------------ */
  const STATUS_LABEL = { idle: 'Waiting', running: 'Running', success: 'Passed', failed: 'Failed', skipped: 'Skipped', cancelled: 'Cancelled' };
  const RUN_LABEL = { idle: 'Idle', running: 'Running', success: 'Success', failed: 'Failed', cancelled: 'Cancelled' };
  const flap = (status, label) => `<span class="flap flap-${status}">${esc(label || RUN_LABEL[status] || status)}</span>`;
  const envPill = (id) => { const e = envById(id); return `<span class="env-pill" data-line="${e.line}"><i></i>${esc(e.name)}</span>`; };
  const recordStatus = (r) => (r.status === 'success' && r.retryOf ? flap('success', 'Recovered') : flap(r.status)) + (r.drill ? ` <span class="sim-tag">${r.drill === 'tour' ? 'Tour' : 'Drill'}</span>` : '') + (r.rollbackFrom ? ' <span class="sim-tag">Rollback</span>' : '') + (r.autoRollback ? ' <span class="sim-tag">Auto-rollback</span>' : '');

  /* --- stats --- */
  function renderStats() {
    const s = computeStats(history().filter((r) => !r.drill)); /* training drills do not count as real deployments */
    const tiles = [
      ['Total pipelines', s.total, s.cancelled ? `${s.cancelled} cancelled` : 'All runs recorded'],
      ['Successful', s.success, 'Reached the terminus'],
      ['Failed', s.failed, s.failed ? 'Stopped at a stage' : 'No failures yet'],
      ['Deploy frequency', `${s.perDay.toFixed(1)}<small> /day</small>`, `${s.recent} in the last 7 days`],
      ['Success rate', s.rate == null ? '—' : `${s.rate}<small>%</small>`, 'Excludes cancelled runs'],
      ['Avg duration', s.avg == null ? '—' : fmtDur(s.avg), 'Completed runs only']
    ];
    $('#stats').innerHTML = tiles.map(([label, value, note]) => `
      <div class="card stat"><span class="stat-value">${value}</span><span class="stat-label">${label}</span><span class="stat-note">${note}</span></div>`).join('');
  }

  /* --- metro map: one column per wave; parallel stages fork into two lanes and merge again --- */
  const LANE_GAP = 40;

  /* An edge is a leg between two nodes. Its polyline is kept so a train can be placed at any fraction. */
  function makeEdge(a, b) {
    const dx = b.x - a.x;
    const x1 = a.x + dx * 0.3;
    const x2 = b.x - dx * 0.3;
    const xm = (x1 + x2) / 2;
    const straight = a.y === b.y;
    const pts = [[a.x, a.y]];
    if (straight) {
      pts.push([b.x, b.y]);
    } else {
      pts.push([x1, a.y]);
      for (let i = 1; i <= 16; i++) {
        const t = i / 16;
        const u = 1 - t;
        pts.push([u * u * u * x1 + 3 * u * u * t * xm + 3 * u * t * t * xm + t * t * t * x2,
          u * u * u * a.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t * t * t * b.y]);
      }
      pts.push([b.x, b.y]);
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const d = straight ? `M${a.x} ${a.y}H${b.x}` : `M${a.x} ${a.y}H${x1}C${xm} ${a.y} ${xm} ${b.y} ${x2} ${b.y}H${b.x}`;
    return { d, pts, cum };
  }

  function edgePoint(edge, t) {
    const target = Math.max(0, Math.min(1, t)) * edge.cum[edge.cum.length - 1];
    let i = 1;
    while (i < edge.cum.length - 1 && edge.cum[i] < target) i++;
    const seg = edge.cum[i] - edge.cum[i - 1] || 1;
    const f = (target - edge.cum[i - 1]) / seg;
    return { x: edge.pts[i - 1][0] + (edge.pts[i][0] - edge.pts[i - 1][0]) * f, y: edge.pts[i - 1][1] + (edge.pts[i][1] - edge.pts[i - 1][1]) * f };
  }

  function metroLayout() {
    const forked = App.waves.some((w) => w.length > 1);
    const C = App.waves.length;
    const x0 = 64;
    const x1 = 936;
    const y = forked ? 86 : 36;
    const colX = (c) => x0 + ((x1 - x0) / C) * c;
    const pos = {};
    App.waves.forEach((w, c) => w.forEach((s, k) => {
      const off = w.length === 1 ? 0 : k === 0 ? -LANE_GAP : LANE_GAP;
      pos[s.id] = { x: colX(c), y: y + off, off, n: w.length };
    }));
    const term = { x: x1, y };
    const edges = [];
    App.waves.forEach((w, c) => {
      const targets = c + 1 < C ? App.waves[c + 1].map((s) => ({ id: s.id, ...pos[s.id] })) : [{ id: 'term', ...term }];
      w.forEach((s) => targets.forEach((t) => edges.push({ from: s.id, to: t.id, ...makeEdge(pos[s.id], t) })));
    });
    return { forked, x0, x1, y, colX, pos, term, edges, lanes: Math.max(...App.waves.map((w) => w.length)), height: forked ? 200 : 118 };
  }

  function buildMetro() {
    const L = App.layout = metroLayout();
    const stations = App.stages.map((s) => {
      const p = L.pos[s.id];
      const up = p.off < 0;
      return `<g class="m-station st-idle" data-stage="${s.id}" data-action="stage-info" tabindex="0" role="button" aria-label="${esc(s.name)} stage details${p.n > 1 ? ', runs in parallel' : ''}">
        <circle class="m-dot" cx="${p.x}" cy="${p.y}" r="9"/>
        <path class="m-mark m-check" d="M${p.x - 4} ${p.y + 0.5}l2.8 2.8 5-5.6"/>
        <path class="m-mark m-cross" d="M${p.x - 3.5} ${p.y - 3.5}l7 7M${p.x + 3.5} ${p.y - 3.5}l-7 7"/>
        <text class="m-name" x="${p.x}" y="${up ? p.y - 31 : p.y + 38}">${esc(s.short)}</text>
        <text class="m-status" x="${p.x}" y="${up ? p.y - 16 : p.y + 58}">WAITING</text>
      </g>`;
    }).join('');
    const edges = L.edges.map((e) => `<g class="m-edge"><path class="m-track" d="${e.d}"/><path class="m-done" pathLength="100" d="${e.d}" style="stroke-dasharray:100;stroke-dashoffset:100;opacity:0"/><path class="m-active" d="${e.d}"/></g>`).join('');
    const labels = App.waves.map((w, c) => (w.length > 1 ? `<text class="m-par" x="${L.colX(c)}" y="${L.y + 4}">PARALLEL</text>` : '')).join('');
    const trains = Array.from({ length: L.lanes }, () => `<g class="m-train is-hidden" style="transform: translate(${L.x0}px, ${L.y}px)"><circle cx="0" cy="0" r="15"/><text x="0" y="5.5"></text></g>`).join('');
    const dep = App.stages.find((s) => s.kind === 'deploy');
    const traffic = dep ? `<g class="m-traffic" data-stage="${dep.id}" style="opacity:0" aria-hidden="true"><rect class="mt-bg" x="${L.pos[dep.id].x - 34}" y="${L.pos[dep.id].y - 27}" width="68" height="7" rx="3.5"/><rect class="mt-new" x="${L.pos[dep.id].x - 34}" y="${L.pos[dep.id].y - 27}" width="0" height="7" rx="3.5"/></g>` : '';
    $('#metro').setAttribute('viewBox', `0 0 1000 ${L.height}`);
    $('#metro').innerHTML = `${edges}${labels}${stations}${traffic}
      <g class="m-station" id="m-terminus">
        <circle class="m-term-ring" cx="${L.term.x}" cy="${L.term.y}" r="11"/><circle class="m-term-core" cx="${L.term.x}" cy="${L.term.y}" r="3.5"/>
        <text class="m-name" id="m-term-name" x="${L.term.x}" y="${L.y + 38}"></text>
        <text class="m-status" id="m-term-status" x="${L.term.x}" y="${L.y + 58}">TERMINUS</text>
      </g>${trains}`;
  }

  function buildStageCards() {
    $('#stage-cards').innerHTML = App.stages.map((s) => `
      <button type="button" class="card stage-card" data-stage="${s.id}" data-action="stage-info" aria-label="${esc(s.name)} stage details">
        <span class="stage-top"><span class="tile">${esc(s.code)}</span><span class="stage-name">${esc(s.name)}</span>${s.parallel ? '<span class="sim-tag">Parallel</span>' : ''}</span>
        <span class="stage-desc">${esc(s.description)}</span>
        <span class="bar"><span></span></span>
        <span class="stage-foot"><span class="flap flap-idle" data-flap>Waiting</span><span class="stage-dur" data-dur>—</span></span>
      </button>`).join('');
  }

  const stationLabel = (st) => {
    if (st.status === 'running') return st.waiting ? 'AWAITING' : st.rolling ? `${st.rolloutPct || 0}% NEW` : `${Math.round(st.progress * 100)}%`;
    if (st.status === 'success') return fmtDur(st.durationMs);
    return STATUS_LABEL[st.status].toUpperCase();
  };

  /* Paints the map, stage cards and run header from one run-state object. */
  function renderPipeline(run = displayRun()) {
    const env = envById(run.envId);
    const n = App.stages.length;
    const metro = $('#metro');
    const L = App.layout;
    $('.map-card').dataset.line = env.line;
    metro.setAttribute('class', `metro is-${run.status}${run.rollbackFrom ? ' is-rollback' : ''}`);
    const stOf = (id) => run.stages.find((s) => s.id === id);

    /* Each leg fills as its source stage works and stays filled once that stage has passed. */
    $$('.m-edge', metro).forEach((g, i) => {
      const e = L.edges[i];
      const from = stOf(e.from);
      const t = from.status === 'success' || (run.rollbackFrom && from.status === 'skipped') ? 1
        : ['running', 'failed', 'cancelled'].includes(from.status) ? from.progress || 0 : 0;
      const done = $('.m-done', g);
      done.style.strokeDashoffset = String(100 - 100 * t);
      done.style.opacity = t > 0 ? '1' : '0';
      done.classList.toggle('is-failed', from.status === 'failed');
      $('.m-active', g).classList.toggle('is-on', from.status === 'running');
    });

    /* One train per lane of the current wave; a train waits at the merge once its stage has passed. */
    const cur = App.waves.findIndex((w) => w.some((d) => !['success', 'skipped'].includes(stOf(d.id).status)));
    $$('.m-train', metro).forEach((el, k) => {
      let pt = null;
      let code = env.code;
      if (cur < 0) {
        if (k === 0) pt = L.term;
      } else if (k < App.waves[cur].length) {
        const d = App.waves[cur][k];
        const s = stOf(d.id);
        const edge = L.edges.find((e) => e.from === d.id);
        pt = edgePoint(edge, s.status === 'success' ? 1 : s.status === 'idle' ? 0 : s.progress || 0);
        if (App.waves[cur].length > 1) code = d.code;
      }
      el.classList.toggle('is-hidden', !pt);
      if (pt) {
        el.style.transform = `translate(${pt.x}px, ${pt.y}px)`;
        $('text', el).textContent = run.rollbackFrom && code === env.code ? 'R' : code;
      }
    });
    $('#m-term-name').textContent = env.name;
    $('#m-term-status').textContent = run.status === 'success' ? 'ARRIVED' : 'TERMINUS';

    /* the traffic bar above the Deploy station shows how much traffic the new version has */
    const trafficBar = $('.m-traffic', metro);
    if (trafficBar) {
      const R = App.engine.rollout;
      const dep = stOf(trafficBar.dataset.stage);
      const on = !!(R && dep && dep.status === 'running');
      trafficBar.style.opacity = on ? '1' : '0';
      if (on) {
        $('.mt-new', trafficBar).style.width = `${(68 * R.traffic) / 100}px`;
        trafficBar.classList.toggle('is-rollback', R.phase === 'rollback');
      }
    }

    let sum = 0;
    run.stages.forEach((st) => {
      sum += st.status === 'success' || (run.rollbackFrom && st.status === 'skipped') ? 1 : st.progress || 0;
      const g = $(`.m-station[data-stage="${st.id}"]`, metro);
      g.setAttribute('class', `m-station st-${st.status}${st.waiting ? ' is-waiting' : ''}${tourOn(st.id) ? ' is-tour' : ''}`);
      $('.m-status', g).textContent = stationLabel(st);

      const card = $(`.stage-card[data-stage="${st.id}"]`);
      card.className = `card stage-card is-${st.status}${tourOn(st.id) ? ' is-tour' : ''}`;
      $('.bar span', card).style.width = `${Math.round((st.status === 'success' ? 1 : st.progress || 0) * 100)}%`;
      const f = $('[data-flap]', card);
      f.className = `flap flap-${st.status}`;
      f.textContent = st.waiting ? 'Awaiting' : st.rolling ? `${st.rolloutPct || 0}% new` : STATUS_LABEL[st.status];
      const live = st.status === 'running' ? performance.now() - st.t0 : st.durationMs;
      $('[data-dur]', card).textContent = st.status === 'idle' || st.status === 'skipped' ? '—' : fmtDur(live);
    });

    const pct = Math.round((sum / n) * 100);
    const bar = $('#run-bar');
    bar.classList.toggle('is-failed', run.status === 'failed');
    bar.setAttribute('aria-valuenow', pct);
    $('span', bar).style.width = `${pct}%`;
    $('#run-pct').textContent = `${pct}%`;
    $('#run-elapsed').textContent = fmtDur(run.durationMs);

    const named = (status) => run.stages.filter((s) => s.status === status).map((s) => stageById(s.id).name).join(' + ');
    const titles = {
      idle: 'Ready to depart',
      running: named('running') ? `Now at ${named('running')}` : 'Departing',
      success: `Arrived at ${env.name}`,
      failed: named('failed') ? `Stopped at ${named('failed')}` : 'Stopped',
      cancelled: run.declined === 'timeout' ? 'Approval timed out' : run.declined ? 'Deployment rejected' : 'Run cancelled'
    };
    $('#map-title').textContent = titles[run.status];
    const mf = $('#map-flap');
    mf.className = `flap flap-${run.status}`;
    mf.textContent = RUN_LABEL[run.status];
    $('#map-meta').textContent = run.id
      ? `${run.id} · ${short(run.commit.hash)} · ${run.branch} → ${env.name}${run.attempt > 1 ? ` · attempt ${run.attempt}` : ''}`
      : `Next: ${prefs().branch} → ${env.name} · ${App.waves.length} stops to the terminus`;
  }

  function renderControls() {
    const running = App.engine.isRunning;
    $$('[data-run-btn]').forEach((b) => {
      b.disabled = running;
      b.classList.toggle('is-running', running);
      $('use', b).setAttribute('href', running ? '#i-retry' : '#i-play');
      $('span', b).textContent = running ? 'Running' : 'Run pipeline';
    });
    $$('[data-cancel-btn]').forEach((b) => { b.disabled = !running; });
    $$('[data-retry-btn]').forEach((b) => { b.disabled = !canRetry(); });
    $$('[data-rollback-btn]').forEach((b) => { b.disabled = running || !rollbackTarget(b.dataset.env); });
    renderPromoBoard();
  }

  function renderAlert() {
    const box = $('#run-alert');
    const a = App.alert;
    if (!a || App.engine.isRunning) { box.innerHTML = ''; return; }
    const r = a.record;
    if (a.kind === 'error') {
      box.innerHTML = `<div class="alert alert-error" role="alert">${icon('alert')}<div class="alert-body">
        <p><strong>${esc(r.id)} failed at ${esc(stageById(r.failedStage).name)}.</strong> ${r.autoRollback ? 'Traffic was rolled back automatically, so users were only briefly affected.' : 'Later stages were skipped.'}</p>
        <pre>${esc(r.error.code)}: ${esc(r.error.message)}${r.error.details.length ? '\n' + esc(r.error.details.join('\n')) : ''}</pre>
        <p>${esc(r.error.hint)}</p></div>
        <button class="btn btn-primary btn-sm" data-action="retry">${icon('retry')}<span>Retry</span></button></div>`;
    } else if (a.kind === 'success') {
      box.innerHTML = `<div class="alert alert-success" role="status">${icon('check')}<div class="alert-body">
        <p><strong>Recovered.</strong> ${esc(r.id)} retried ${esc(r.retryOf)} on attempt ${r.attempt} and reached ${esc(envById(r.environment).name)} in ${fmtDur(r.durationMs)}.</p></div></div>`;
    } else {
      box.innerHTML = `<div class="alert alert-warn" role="status">${icon('info')}<div class="alert-body">
        <p><strong>${esc(r.id)} ${r.declined === 'timeout' ? 'was not approved in time.' : r.declined ? 'was rejected at the approval gate.' : 'was cancelled.'}</strong> Nothing was deployed. Retry to run the same commit again.</p></div>
        <button class="btn btn-outline btn-sm" data-action="retry">${icon('retry')}<span>Retry</span></button></div>`;
    }
  }

  /* --- terminal --- */
  const logText = (e) => `[${fmtClock(new Date(e.t))}] ${e.msg}`;
  const logHTML = (e) => `<div class="log log-${e.level}"><span class="log-time">[${fmtClock(new Date(e.t))}]</span><span class="log-msg">${esc(e.msg)}</span></div>`;

  function termEmpty() {
    $('#terminal').innerHTML = '<div class="term-empty">$ deployx run <span class="term-cursor"></span></div><div class="term-empty">Waiting for a pipeline run. Press Run pipeline or the R key.</div>';
    $('#term-count').textContent = '0 lines';
  }
  function termAppend(entry) {
    const body = $('#terminal');
    if (!App.termLogs.length) body.innerHTML = '';
    App.termLogs.push(entry);
    body.insertAdjacentHTML('beforeend', logHTML(entry));
    while (body.childElementCount > 800) body.firstElementChild.remove();
    $('#term-count').textContent = `${App.termLogs.length} line${App.termLogs.length === 1 ? '' : 's'}`;
    if (prefs().autoScroll) body.scrollTop = body.scrollHeight;
  }
  function termSeparator() {
    if (App.termLogs.length) termAppend({ t: Date.now(), level: 'dim', msg: '─'.repeat(48) });
  }
  function termClear() { App.termLogs = []; termEmpty(); }

  /* --- shared controls (dispatch card and settings) --- */
  function runControls(p) {
    return `
      <div class="field"><span class="field-label">Environment</span>
        <div class="seg">${App.envs.map((e) => `<label data-line="${e.line}"><input type="radio" name="${p}-env" value="${e.id}" data-pref="environment"><span><i class="dot"></i>${esc(e.name)}</span></label>`).join('')}</div>
        <p class="field-hint" data-env-hint></p></div>
      <div class="field"><label class="field-label" for="${p}-branch">Branch</label>
        <select id="${p}-branch" class="select" data-pref="branch">${App.demo.branches.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('')}</select></div>`;
  }
  function simControls(p) {
    return `
      <div class="field"><span class="field-label">Simulation speed</span>
        <div class="seg">${[0.5, 1, 2, 4].map((v) => `<label><input type="radio" name="${p}-speed" value="${v}" data-pref="speed" data-type="number"><span>${v}×</span></label>`).join('')}</div></div>
      <div class="field"><label class="field-label" for="${p}-strat">Rollout strategy</label>
        <select id="${p}-strat" class="select" data-pref="strategy">
          <option value="env">Environment default</option><option value="canary">Canary (gradual, auto-rollback)</option>
          <option value="bluegreen">Blue / green (one switch)</option><option value="rolling">Rolling update</option><option value="recreate">Recreate</option></select>
        <p class="field-hint">Canary and blue/green watch the new version's error rate. Turn on Failure simulation at Deployment to see an automatic rollback.</p></div>
      <div class="field"><span class="field-label">Approvals</span>
        <div class="seg"><label><input type="radio" name="${p}-appr" value="manual" data-pref="approval"><span>I approve</span></label>
          <label><input type="radio" name="${p}-appr" value="auto" data-pref="approval"><span>Auto-approve</span></label></div>
        <p class="field-hint">Protected environments (Production) wait for reviewers. Auto-approve lets simulated reviewers sign off after a few seconds.</p></div>
      <label class="switch"><span class="switch-text"><strong>Failure simulation</strong><small>Inject a fault so a stage fails and the line stops.</small></span>
        <input type="checkbox" data-pref="failure.enabled" aria-label="Failure simulation"></label>
      <div data-when="failure" class="mt-2">
        <div class="field"><span class="field-label">Failure mode</span>
          <div class="seg"><label><input type="radio" name="${p}-mode" value="stage" data-pref="failure.mode"><span>Chosen stage</span></label>
            <label><input type="radio" name="${p}-mode" value="random" data-pref="failure.mode"><span>Random</span></label></div></div>
        <div class="field" data-when="mode-stage"><label class="field-label" for="${p}-fstage">Fail at stage</label>
          <select id="${p}-fstage" class="select" data-pref="failure.stage">${App.stages.filter((s) => s.kind !== 'gate').map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field" data-when="mode-random"><label class="field-label" for="${p}-chance">Failure chance · <span data-chance></span></label>
          <input id="${p}-chance" type="range" min="10" max="100" step="10" data-pref="failure.chance" data-type="number">
          <p class="field-hint">Each run may fail at a randomly chosen stage.</p></div>
        <p class="field-hint">Retry always clears the injected fault, so you can watch a recovery.</p>
      </div>`;
  }

  /* Push current preferences into every bound control and dependent element. */
  function syncPrefs() {
    const p = prefs();
    $$('[data-pref]').forEach((el) => {
      const v = getPref(el.dataset.pref);
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'radio') el.checked = String(v) === el.value;
      else el.value = String(v);
    });
    $$('[data-when="failure"]').forEach((el) => { el.hidden = !p.failure.enabled; });
    $$('[data-when="mode-stage"]').forEach((el) => { el.hidden = p.failure.mode !== 'stage'; });
    $$('[data-when="mode-random"]').forEach((el) => { el.hidden = p.failure.mode !== 'random'; });
    $$('[data-chance]').forEach((el) => { el.textContent = `${p.failure.chance}%`; });
    const env = envById(p.environment);
    $$('[data-env-hint]').forEach((el) => { el.textContent = `${env.strategy} · ${env.replicas} replica(s) · ${env.approval}`; });
    const chip = $('#env-chip');
    chip.dataset.line = env.line;
    chip.innerHTML = `<span class="roundel">${esc(env.code)}</span><span>${esc(env.name)}</span>`;
    applyTheme();
    $('#app').classList.toggle('is-collapsed', p.sidebarCollapsed);
    if (!App.engine.isRunning) renderPipeline();
    $$('.env-card').forEach((c) => {
      const sel = c.dataset.env === p.environment;
      c.classList.toggle('is-selected', sel);
      const b = $('[data-action="env-select"]', c);
      if (b) { b.disabled = sel; $('span', b).textContent = sel ? 'Selected' : 'Select line'; }
    });
  }

  function applyTheme() {
    const t = prefs().theme;
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('#theme-icon').setAttribute('href', dark ? '#i-sun' : '#i-moon');
  }

  /* --- pipelines view --- */
  function avgStageDuration(id) {
    const ds = history().map((r) => r.stages.find((s) => s.id === id)).filter((s) => s && s.status === 'success').map((s) => s.durationMs);
    return ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null;
  }
  function renderDefinition(box) {
    const repo = App.demo.repository;
    const f = prefs().failure;
    const env = envById(prefs().environment);
    box.innerHTML = `
      <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <section class="card p-5 xl:col-span-2" data-line="${env.line}">
          <div class="flex flex-wrap items-start justify-between gap-3 mb-5">
            <div><p class="eyebrow">Pipeline definition <span class="sim-tag">Simulated</span></p>
              <h2 class="display text-[30px] leading-8 mt-1">${esc(App.pipeline.name)}</h2>
              <p class="text-muted text-sm mt-1">Trigger: ${esc(App.pipeline.trigger)} · v${esc(App.pipeline.version)} · loaded from <code>data/pipeline-config.json</code></p></div>
            <button class="btn btn-primary" data-action="run" data-run-btn>${icon('play', 'ic-fill')}<span>Run pipeline</span></button>
          </div>
          <div class="vline">
            ${App.stages.map((s, i) => {
              const avg = avgStageDuration(s.id);
              const armed = f.enabled && f.mode === 'stage' && f.stage === s.id;
              return `<div class="vstop">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1"><h3>${i + 1}. ${esc(s.name)}</h3>${s.parallel ? '<span class="sim-tag">Parallel</span>' : ''}${armed ? flap('failed', 'Fault armed') : ''}
                  <span class="mono text-[12.5px] text-muted">avg ${avg == null ? '—' : fmtDur(avg)}</span></div>
                <p class="text-muted text-sm">${esc(s.description)}</p>
                <div class="steps">${s.steps.map((st) => esc(st.message)).join('<br>')}</div>
                <div class="flex flex-wrap gap-2 mt-2">
                  <button class="btn btn-outline btn-sm" data-action="stage-info" data-stage="${s.id}">${icon('info')}<span>Details</span></button>
                  ${s.kind === 'gate' ? '' : `<button class="btn btn-outline btn-sm" data-action="fail-here" data-stage="${s.id}">${icon(armed ? 'x' : 'alert')}<span>${armed ? 'Disarm fault' : 'Fail here'}</span></button>`}
                </div></div>`;
            }).join('')}
            <div class="vstop is-terminus" style="padding-bottom:0"><h3>${esc(env.name)} terminus</h3>
              <p class="text-muted text-sm">${esc(env.url)} · simulated environment</p></div>
          </div>
        </section>
        <div class="flex flex-col gap-4">
          <section class="card p-5"><p class="eyebrow">Repository</p>
            <h2 class="display text-[24px] leading-7 mt-1 mb-3">${esc(repo.name)}</h2>
            <dl class="kv"><dt>Provider</dt><dd>${esc(repo.provider)}</dd><dt>Default</dt><dd class="mono">${esc(repo.defaultBranch)}</dd>
              <dt>Language</dt><dd>${esc(repo.language)}</dd><dt>Branches</dt><dd>${App.demo.branches.length}</dd><dt>About</dt><dd>${esc(repo.description)}</dd></dl>
          </section>
          <section class="card p-5"><p class="eyebrow mb-2">Recent commits</p>
            <div class="rows">${App.demo.commits.slice(0, 6).map((c) => `<div class="py-2"><p class="font-semibold text-sm">${esc(c.message)}</p>
              <p class="mono text-[12px] text-muted">${short(c.hash)} · ${esc(c.author)}</p></div>`).join('')}</div>
          </section>
        </div>
      </div>`;
  }

  /* --- deployments view --- */
  function filteredHistory() {
    const { q, status, env } = App.filters;
    const needle = q.trim().toLowerCase();
    return history().filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (env !== 'all' && r.environment !== env) return false;
      if (!needle) return true;
      return [r.id, r.commit.hash, r.commit.message, r.branch, r.environment, r.status].some((v) => String(v).toLowerCase().includes(needle));
    });
  }
  const emptyState = (title, text, action) => `<div class="empty"><img src="assets/images/line-map.svg" alt=""><h3>${title}</h3><p>${text}</p>${action}</div>`;

  function renderDeployments() {
    const list = filteredHistory();
    const box = $('#dep-table');
    if (!history().length) {
      box.innerHTML = emptyState('No deployments yet', 'Run the pipeline and each run will be recorded here, including failures and cancellations.',
        `<button class="btn btn-primary" data-action="run" data-run-btn>${icon('play', 'ic-fill')}<span>Run pipeline</span></button>`);
      renderControls();
      return;
    }
    if (!list.length) {
      box.innerHTML = emptyState('Nothing matches', 'No deployments match the current search and filters.',
        `<button class="btn btn-outline" data-action="clear-filters">${icon('x')}<span>Clear filters</span></button>`);
      return;
    }
    box.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Deployment ID</th><th>Commit</th><th>Branch</th><th>Environment</th><th>Status</th><th>Duration</th><th>Timestamp</th></tr></thead>
      <tbody>${list.map((r) => `<tr data-action="dep-detail" data-id="${r.id}" tabindex="0" role="button" aria-label="Details for ${r.id}">
        <td class="mono font-semibold">${r.id}</td>
        <td><span class="mono">${short(r.commit.hash)}</span> <span class="text-muted">${esc(r.commit.message)}</span></td>
        <td class="mono">${esc(r.branch)}</td><td>${envPill(r.environment)}</td><td>${recordStatus(r)}</td>
        <td class="mono">${fmtDur(r.durationMs)}</td><td>${fmtDate(r.startedAt)} <span class="text-muted">· ${fmtAgo(r.startedAt)}</span></td></tr>`).join('')}</tbody>
    </table></div><div class="table-foot">Showing ${list.length} of ${history().length} · simulated deployments stored in this browser</div>`;
  }

  /* --- build history view --- */
  const miniLine = (r) => stageLine(r.stages, r.environment);
  const AGG_FAIL = ['failed', 'cancelled', 'running'];
  /* One status for a group of stages (a parallel wave). */
  const aggStatus = (list) => {
    const hit = AGG_FAIL.find((s) => list.includes(s));
    if (hit) return hit;
    if (list.every((s) => s === 'success')) return 'success';
    if (list.every((s) => s === 'skipped')) return 'skipped';
    return list.includes('success') ? 'running' : 'idle';
  };
  const stageLine = (stages, envId) => {
    const get = (id) => stages.find((s) => s.id === id) || { id, status: 'idle', durationMs: 0 };
    const dot = (s) => `<i class="s-${s.status}" title="${esc(stageById(s.id) ? stageById(s.id).name : s.id)}: ${STATUS_LABEL[s.status]}${s.durationMs ? ' · ' + fmtDur(s.durationMs) : ''}"></i>`;
    return `<div class="mini-line" data-line="${envById(envId).line}" role="img" aria-label="Stage results: ${stages.map((s) => `${stageById(s.id) ? stageById(s.id).short : s.id} ${s.status}`).join(', ')}">
      ${App.waves.map((w, i) => {
    const ss = w.map((d) => get(d.id));
    return `${i ? `<b class="s-${aggStatus(ss.map((x) => x.status))}"></b>` : ''}${ss.length > 1 ? `<span class="mini-par">${ss.map(dot).join('')}</span>` : dot(ss[0])}`;
  }).join('')}</div>`;
  };

  function renderBuilds() {
    const list = history();
    const box = $('#builds-view');
    if (!list.length) {
      box.innerHTML = `<div class="card">${emptyState('No builds yet', 'Stage timings appear here after the first pipeline run.',
        `<button class="btn btn-primary" data-action="run" data-run-btn>${icon('play', 'ic-fill')}<span>Run pipeline</span></button>`)}</div>`;
      renderControls();
      return;
    }
    const recent = list.slice(0, 24).reverse();
    const max = Math.max(...recent.map((r) => r.durationMs), 1);
    box.innerHTML = `
      <section class="card p-5">
        <div class="flex flex-wrap items-end justify-between gap-3"><div><p class="eyebrow">Duration trend</p>
          <h2 class="display text-[24px] leading-7 mt-1">Last ${recent.length} runs</h2></div>
          <div class="legend"><span><i></i>Success</span><span><i style="background:var(--red)"></i>Failed</span><span><i style="background:var(--line)"></i>Cancelled</span></div></div>
        <div class="chart" role="list" aria-label="Run durations, oldest first">${recent.map((r) => `<button type="button" role="listitem" class="chart-bar s-${r.status}" style="height:${Math.max(5, (r.durationMs / max) * 100)}%"
          data-action="dep-detail" data-id="${r.id}" title="${r.id} · ${RUN_LABEL[r.status]} · ${fmtDur(r.durationMs)}" aria-label="${r.id}, ${RUN_LABEL[r.status]}, ${fmtDur(r.durationMs)}"></button>`).join('')}</div>
      </section>
      <section class="card mt-4 rows">${list.map((r) => `<div class="build-row">
          <div class="min-w-0"><p class="flex flex-wrap items-center gap-2"><span class="mono font-semibold">${r.id}</span>${recordStatus(r)}</p>
            <p class="text-sm text-muted truncate"><span class="mono">${short(r.commit.hash)}</span> ${esc(r.commit.message)}</p></div>
          <div class="min-w-0">${miniLine(r)}<p class="mono text-[12px] text-muted mt-1">${esc(r.branch)} → ${esc(envById(r.environment).name)} · ${fmtDur(r.durationMs)} · ${fmtAgo(r.startedAt)}</p></div>
          <div class="flex gap-2">
            <button class="btn btn-outline btn-sm" data-action="dep-detail" data-id="${r.id}">${icon('info')}<span>Details</span></button>
            ${r.status !== 'success' && !r.drill ? `<button class="btn btn-outline btn-sm" data-action="retry-run" data-id="${r.id}">${icon('retry')}<span>Retry</span></button>` : ''}
          </div></div>`).join('')}</section>`;
  }

  /* --- network map: every environment as a line, promotion at the interchanges --- */
  const NET = { x0: 130, x1: 870, top: 56, gap: 120 };
  const netY = (r) => NET.top + NET.gap * r;
  const netX = (r, i) => {
    const step = (NET.x1 - NET.x0) / App.waves.length; /* one station per wave */
    return r % 2 ? NET.x1 - step * i : NET.x0 + step * i; /* odd rows run right to left */
  };
  /* The live build plus the newest earlier build that is a safe rollback target.
     Commits that were already rolled back from are never offered again. */
  function rollbackTarget(envId) {
    const runs = history().filter((r) => r.environment === envId && r.status === 'success' && !r.drill);
    const live = runs[0];
    if (!live) return null;
    const bad = new Set(runs.filter((r) => r.rollbackFrom).map((r) => r.rollbackFrom));
    const target = runs.find((r) => r.commit.hash !== live.commit.hash && !bad.has(r.commit.hash));
    return target ? { live, target } : null;
  }

  async function rollback(envId) {
    const env = envById(envId);
    if (App.engine.isRunning || App.launching) { toast('info', 'Line busy', 'Wait for the current run to finish before rolling back.'); return; }
    if (App.drill && App.drill.phase !== 'done') { toast('info', 'Drill in progress', 'Finish or abandon the incident drill first.'); return; }
    const rt = rollbackTarget(envId);
    if (!rt) { toast('info', 'Nothing to roll back to', `${env.name} has no earlier successful build.`); return; }
    const row = (label, r) => `<dt>${label}</dt><dd><span class="mono">${short(r.commit.hash)}</span> · ${esc(r.commit.message)}<br><span class="text-muted">${r.id} · ${fmtAgo(r.startedAt)}</span></dd>`;
    const ok = await openModal({
      eyebrow: 'Rollback', title: `Roll ${env.name} back?`,
      body: `<dl class="kv mb-3">${row('Live now', rt.live)}${row('Return to', rt.target)}</dl>
        <p>Only the <strong>Deploy</strong> stage runs: the stored image is reused, so build, test and security scan are skipped. This is a simulation.</p>`,
      actions: [{ label: 'Keep current build', kind: 'outline', value: false }, { label: `Roll back ${env.name}`, kind: 'danger', value: true }]
    });
    if (ok) startRun({ rollback: rt });
  }

  const liveBuild = (envId) => history().find((r) => r.environment === envId && r.status === 'success' && !r.drill) || null;

  function promoState(from, to) {
    const src = liveBuild(from.id);
    if (!src) return { state: 'none', label: 'No build' };
    const dst = liveBuild(to.id);
    if (dst && dst.commit.hash === src.commit.hash) return { state: 'synced', label: 'In sync', record: src };
    if (App.engine.isRunning || App.launching) return { state: 'busy', label: 'Line busy', record: src };
    return { state: 'ready', label: 'Ready', record: src };
  }

  /* What a line shows: the live run if it is on this line, otherwise its most recent run. */
  function lineState(env) {
    const run = App.engine.run;
    if (run && run.status === 'running' && run.envId === env.id) return run;
    const last = history().find((r) => r.environment === env.id && !r.drill);
    return last ? { status: last.status, stages: last.stages } : { status: 'idle', stages: [] };
  }

  function networkSVG() {
    const n = App.waves.length;
    const lines = App.envs.map((e, r) => {
      const y = netY(r);
      const side = r % 2 ? -1 : 1;
      const sx = netX(r, 0);
      const tx = netX(r, n);
      const anchor = side > 0 ? 'start' : 'end';
      return `<g class="n-line is-idle" data-env="${e.id}" data-line="${e.line}">
        <path class="m-track" d="M${sx} ${y}H${tx}"/><path class="m-done" d="M${sx} ${y}H${sx}"/>
        ${App.waves.map((w, i) => { const x = netX(r, i); const label = w.map((s) => s.short).join(' + '); return `<g class="m-station st-idle" data-stage="${w[0].id}" data-action="stage-info" tabindex="0" role="button" aria-label="${esc(e.name)} line: ${esc(w.map((s) => s.name).join(' and '))}${w.length > 1 ? ', in parallel' : ''}">
          <circle class="m-dot" cx="${x}" cy="${y}" r="8"/>
          <path class="m-mark m-check" d="M${x - 3.6} ${y + 0.4}l2.5 2.5 4.5-5"/>
          <path class="m-mark m-cross" d="M${x - 3} ${y - 3}l6 6M${x + 3} ${y - 3}l-6 6"/>
          <text class="m-name${w.length > 1 ? ' is-wide' : ''}" x="${x}" y="${y + 28}">${esc(label)}</text></g>`; }).join('')}
        <circle class="m-term-ring" cx="${tx}" cy="${y}" r="11"/><circle class="m-term-core" cx="${tx}" cy="${y}" r="3.5"/>
        <text class="m-name" x="${tx + side * 20}" y="${y - 1}" style="text-anchor:${anchor}">${esc(e.name)}</text>
        <text class="m-status n-live" x="${tx + side * 20}" y="${y + 15}" style="text-anchor:${anchor}">NO BUILD</text>
        <text class="m-status n-rb" data-action="rollback" data-env="${e.id}" x="${tx + side * 20}" y="${y + 31}" tabindex="0" role="button" aria-label="Roll ${esc(e.name)} back to its previous build" style="text-anchor:${anchor}"></text>
        <g class="m-train"><circle cx="${sx}" cy="${y}" r="14"/><text x="${sx}" y="${y + 5.5}">${esc(e.code)}</text></g>
      </g>`;
    }).join('');
    const links = App.envs.slice(0, -1).map((from, r) => {
      const to = App.envs[r + 1];
      const x = netX(r, n);
      const inward = r % 2 ? 1 : -1;
      return `<g class="n-xchg" data-action="promote" data-from="${from.id}" data-to="${to.id}" tabindex="0" role="button" aria-label="Promote the live ${esc(from.name)} build to ${esc(to.name)}">
        <path class="n-x-outer" d="M${x} ${netY(r) + 12}V${netY(r + 1) - 10}"/><path class="n-x-inner" d="M${x} ${netY(r) + 12}V${netY(r + 1) - 10}"/>
        <text class="m-status n-x-label" x="${x + inward * 18}" y="${(netY(r) + netY(r + 1)) / 2 + 6}" style="text-anchor:${inward > 0 ? 'start' : 'end'}"></text></g>`;
    }).join('');
    return `<svg id="network" class="metro" viewBox="0 0 1000 ${netY(App.envs.length - 1) + 50}" role="group" aria-label="Network map of all environments">${links}${lines}</svg>`;
  }

  function updateNetwork() {
    const svg = $('#network');
    if (!svg) return;
    const n = App.waves.length;
    App.envs.forEach((e, r) => {
      const g = $(`.n-line[data-env="${e.id}"]`, svg);
      const st = lineState(e);
      const y = netY(r);
      /* a parallel wave shares one station: its status is the group's, its progress the slowest member's */
      const ws = App.waves.map((w) => {
        const ss = w.map((d) => st.stages.find((s) => s.id === d.id)).filter(Boolean);
        return { status: ss.length ? aggStatus(ss.map((s) => s.status)) : 'idle', progress: ss.length ? Math.min(...ss.map((s) => s.progress || 0)) : 0 };
      });
      const idx = ws.findIndex((w) => ['running', 'failed', 'cancelled'].includes(w.status));
      let x = netX(r, 0);
      if (st.status === 'success') x = netX(r, n);
      else if (idx >= 0) x = netX(r, idx) + (netX(r, idx + 1) - netX(r, idx)) * ws[idx].progress;
      const hit = App.incident && App.incident.envId === e.id && App.incident.phase !== 'resolved';
      g.setAttribute('class', `n-line is-${st.status}${st.rollbackFrom ? ' is-rollback' : ''}${hit ? ' is-incident' : ''}`);
      $('.m-done', g).setAttribute('d', `M${netX(r, 0)} ${y}H${x}`);
      $('.m-train', g).style.transform = `translate(${x - netX(r, 0)}px, 0px)`;
      $$('.m-station', g).forEach((el, i) => el.setAttribute('class', `m-station st-${st.stages.length ? ws[i].status : 'idle'}`));
      const live = liveBuild(e.id);
      $('.n-live', g).textContent = hit ? 'INCIDENT' : st.status === 'running' ? 'RUNNING' : live ? `LIVE ${short(live.commit.hash)}` : 'NO BUILD';
      $('.n-rb', g).textContent = rollbackTarget(e.id) && !App.engine.isRunning ? 'ROLL BACK' : '';
    });
    $$('.n-xchg', svg).forEach((g) => {
      const ps = promoState(envById(g.dataset.from), envById(g.dataset.to));
      g.setAttribute('class', `n-xchg is-${ps.state}`);
      $('.n-x-label', g).textContent = ps.state === 'ready' ? `PROMOTE ${short(ps.record.commit.hash)}` : ps.label.toUpperCase();
    });
  }

  function renderPromoBoard() {
    const box = $('#promo-board');
    if (!box) return;
    box.innerHTML = App.envs.slice(0, -1).map((from, i) => {
      const to = App.envs[i + 1];
      const ps = promoState(from, to);
      const sub = ps.record ? `${short(ps.record.commit.hash)} · ${ps.record.commit.message}` : `No successful build on ${from.name} yet`;
      return `<div class="board-row"><span class="tile">${i + 1}</span>
        <span class="board-main"><span class="board-title">${esc(from.name)} → ${esc(to.name)}</span><span class="board-sub">${esc(sub)}</span></span>
        <span class="bflap bflap-${ps.state}">${ps.label}</span>
        <button class="btn btn-sm btn-amber" data-action="promote" data-from="${from.id}" data-to="${to.id}" ${ps.state === 'ready' ? '' : 'disabled'}>${icon('deploy')}<span>Promote</span></button></div>`;
    }).join('');
    updateNetwork();
  }

  /* --- environment view --- */
  function renderEnvironments() {
    $('#env-view').innerHTML = `
      <section class="card map-card mb-4" aria-label="Network map">
        <header class="map-head"><div><p class="eyebrow">Network map <span class="sim-tag">Simulated</span></p>
          <h2 class="display map-title mt-1">Three lines, one route to production</h2>
          <p class="text-muted text-sm mt-1">Each line is an environment. A build that reaches a terminus can change lines at the interchange and be promoted to the next environment.</p></div></header>
        <div class="map-scroll">${networkSVG()}</div>
      </section>
      <section class="board mb-4" aria-label="Promotions">
        <div class="board-head"><span>Promotions</span><span>Same commit · next line</span></div>
        <div id="promo-board"></div>
      </section>
      <div class="alert alert-warn mb-4" role="note">${icon('info')}<div class="alert-body"><p><strong>All three environments are simulated.</strong> URLs, regions and replicas come from <code>data/environments.json</code>. No real servers exist behind them.</p></div></div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">${App.envs.map((e) => {
        const runs = history().filter((r) => r.environment === e.id && !r.drill);
        const last = runs[0];
        const live = runs.find((r) => r.status === 'success');
        const rt = rollbackTarget(e.id);
        const s = computeStats(runs);
        return `<section class="card env-card" data-env="${e.id}" data-line="${e.line}">
          <div class="flex items-center gap-3"><span class="roundel roundel-lg">${esc(e.code)}</span>
            <div class="min-w-0 flex-1"><h2 class="display text-[26px] leading-7">${esc(e.name)}</h2><p class="eyebrow text-[12px]">${cap(e.line)} line <span class="sim-tag">Simulated</span></p></div></div>
          <p class="text-muted text-sm">${esc(e.description)}</p>
          <dl class="kv"><dt>URL</dt><dd class="mono text-[13px]">${esc(e.url)}</dd><dt>Region</dt><dd>${esc(e.region)}</dd><dt>Replicas</dt><dd>${e.replicas}</dd>
            <dt>Strategy</dt><dd>${esc(e.strategy)}</dd><dt>Approval</dt><dd>${esc(e.approval)}</dd>
            <dt>Live build</dt><dd>${live ? `<span class="mono">${short(live.commit.hash)}</span> · ${fmtAgo(live.startedAt)}` : 'Nothing deployed yet'}</dd>
            <dt>Roll back to</dt><dd>${rt ? `<span class="mono">${short(rt.target.commit.hash)}</span> · ${fmtAgo(rt.target.startedAt)}` : 'No earlier build'}</dd>
            <dt>Last run</dt><dd>${last ? `${recordStatus(last)} <span class="mono text-[13px]">${last.id}</span>` : '—'}</dd>
            <dt>Runs</dt><dd>${s.total} total · ${s.rate == null ? '—' : s.rate + '%'} success</dd></dl>
          <div class="flex flex-wrap gap-2 mt-auto">
            <button class="btn btn-outline btn-sm" data-action="env-select" data-env="${e.id}">${icon('check')}<span>Select line</span></button>
            <button class="btn btn-outline btn-sm" data-action="rollback" data-env="${e.id}" data-rollback-btn ${rt && !App.engine.isRunning ? '' : 'disabled'}>${icon('rollback')}<span>Roll back</span></button>
            <button class="btn btn-primary btn-sm" data-action="env-deploy" data-env="${e.id}" data-run-btn>${icon('play', 'ic-fill')}<span>Run pipeline</span></button>
          </div></section>`;
      }).join('')}</div>`;
    renderPromoBoard();
  }

  /* --- settings view --- */
  const SHORTCUTS = [
    ['Ctrl / ⌘ + K', 'Open the command palette'], ['R', 'Run pipeline'], ['X', 'Cancel the running pipeline'],
    ['Shift + R', 'Retry the last failed run'], ['T', 'Toggle dark and light theme'], ['C', 'Open or close ChatOps'], ['1 – 9', 'Jump to a section'],
    ['/', 'Search deployments'], ['?', 'Show keyboard shortcuts'], ['Esc', 'Close dialogs']
  ];
  const shortcutsHTML = () => `<div class="rows">${SHORTCUTS.map(([k, d]) => `<div class="flex items-center justify-between gap-3 py-2"><span>${d}</span><kbd>${k}</kbd></div>`).join('')}</div>`;

  function renderSettings() {
    $('#settings-view').innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section class="card p-5"><p class="eyebrow mb-3">Appearance</p>
          <div class="field"><span class="field-label">Theme</span><div class="seg">${['light', 'dark', 'system'].map((t) => `<label><input type="radio" name="set-theme" value="${t}" data-pref="theme"><span>${cap(t)}</span></label>`).join('')}</div></div>
          <label class="switch"><span class="switch-text"><strong>Compact sidebar</strong><small>Show icons only on wide screens.</small></span><input type="checkbox" data-pref="sidebarCollapsed" aria-label="Compact sidebar"></label>
          <label class="switch"><span class="switch-text"><strong>Terminal auto-scroll</strong><small>Follow new log lines as they arrive.</small></span><input type="checkbox" data-pref="autoScroll" aria-label="Terminal auto-scroll"></label>
        </section>
        <section class="card p-5"><p class="eyebrow mb-3">Simulation</p>${simControls('set')}
          <label class="switch mt-2"><span class="switch-text"><strong>Confirm production runs</strong><small>Ask before a run that ends at Production.</small></span><input type="checkbox" data-pref="confirmProd" aria-label="Confirm production runs"></label>
        </section>
        <section class="card p-5"><p class="eyebrow mb-3">Data</p>
          <p class="text-muted text-sm mb-3">History and preferences live in this browser's LocalStorage under <code>${STORAGE_KEY}</code>. ${history().length} runs stored.</p>
          <div class="flex flex-wrap gap-2">
            <button class="btn btn-outline btn-sm" data-action="export-json">${icon('download')}<span>Export JSON</span></button>
            <button class="btn btn-outline btn-sm" data-action="export-csv">${icon('download')}<span>Export CSV</span></button>
            <button class="btn btn-outline btn-sm" data-action="restore-demo">${icon('retry')}<span>Restore demo data</span></button>
            <button class="btn btn-outline btn-sm" data-action="clear-history">${icon('trash')}<span>Clear history</span></button>
            <button class="btn btn-danger btn-sm" data-action="reset-all">${icon('alert')}<span>Reset everything</span></button>
          </div>
        </section>
        <section class="card p-5"><p class="eyebrow mb-2">Keyboard shortcuts</p>${shortcutsHTML()}</section>
        <section class="card p-5 lg:col-span-2"><p class="eyebrow mb-2">About this simulator</p>
          <p class="text-muted text-sm">DeployX models the path <strong>Git push → Checkout → Build → Test → Security scan → Deploy → Production</strong>. Timings, logs, repositories and environments are generated in the browser to teach how a CI/CD pipeline behaves. It does not run builds, call any API, or change real infrastructure.</p>
        </section>
      </div>`;
  }

  /* --- record detail --- */
  function recordDetailHTML(r) {
    const env = envById(r.environment);
    return `
      <dl class="kv mb-4"><dt>Status</dt><dd>${recordStatus(r)}${r.seeded ? ' <span class="sim-tag">Demo seed</span>' : ''}</dd>
        <dt>Commit</dt><dd><span class="mono">${esc(r.commit.hash)}</span><br>${esc(r.commit.message)} · ${esc(r.commit.author)}</dd>
        <dt>Branch</dt><dd class="mono">${esc(r.branch)}</dd><dt>Environment</dt><dd>${envPill(r.environment)} <span class="text-muted">(simulated) · ${esc(env.url)}</span></dd>
        <dt>Duration</dt><dd class="mono">${fmtDur(r.durationMs)}</dd><dt>Started</dt><dd>${new Date(r.startedAt).toLocaleString()}</dd>
        <dt>Attempt</dt><dd>${r.attempt}${r.retryOf ? ` · retry of <span class="mono">${esc(r.retryOf)}</span>` : ''}</dd>
        ${r.rollbackFrom ? `<dt>Rollback</dt><dd>Replaced build <span class="mono">${esc(short(r.rollbackFrom))}</span> · only the deploy stage ran</dd>` : ''}
        ${r.promotedFrom ? `<dt>Promoted</dt><dd>From <span class="mono">${esc(r.promotedFrom)}</span>${recordById(r.promotedFrom) ? ` (${esc(envById(recordById(r.promotedFrom).environment).name)})` : ''}</dd>` : ''}</dl>
      ${r.error ? `<div class="alert alert-error mb-4">${icon('alert')}<div class="alert-body"><p><strong>${esc(r.error.code)}</strong></p><pre>${esc(r.error.message)}${r.error.details.length ? '\n' + esc(r.error.details.join('\n')) : ''}</pre><p>${esc(r.error.hint)}</p></div></div>` : ''}
      <p class="eyebrow mb-2">Stages</p>
      <div class="rows mb-4">${r.stages.map((s) => { const d = stageById(s.id); return `<div class="flex items-center gap-3 py-2">
        <span class="tile ${s.status === 'success' ? 'is-success' : s.status === 'failed' ? 'is-failed' : ''}">${esc(d ? d.code : '?')}</span>
        <span class="flex-1 font-semibold">${esc(d ? d.name : s.id)}</span>${flap(s.status, STATUS_LABEL[s.status])}
        <span class="mono text-[13px] w-14 text-right">${s.durationMs ? fmtDur(s.durationMs) : '—'}</span></div>`; }).join('')}</div>
      <div class="flex flex-wrap items-center gap-2 mb-2"><p class="eyebrow flex-1">Logs</p>
        ${r.logs.length ? `<button class="btn btn-outline btn-sm" data-action="record-copy" data-id="${r.id}">${icon('copy')}<span>Copy</span></button>
        <button class="btn btn-outline btn-sm" data-action="record-download" data-id="${r.id}">${icon('download')}<span>.txt</span></button>` : ''}</div>
      ${r.logs.length ? `<div class="terminal-body" tabindex="0" role="log" aria-label="Logs for ${r.id}">${r.logs.map(logHTML).join('')}</div>`
        : '<p class="text-muted text-sm">This is a seeded demo record, so no logs were captured for it.</p>'}`;
  }

  async function showRecord(id) {
    const r = recordById(id);
    if (!r) return;
    const actions = [{ label: 'Close', kind: 'outline', value: null }];
    if (r.status !== 'success' && !r.drill) actions.push({ label: 'Retry this run', kind: 'primary', value: 'retry' });
    const choice = await openModal({ eyebrow: 'Deployment', title: r.id, body: recordDetailHTML(r), actions, wide: true });
    if (choice === 'retry') startRun({ retryOf: r });
  }

  function showStage(id) {
    const s = stageById(id);
    if (!s) return;
    const avg = avgStageDuration(id);
    const f = prefs().failure;
    const armed = f.enabled && f.mode === 'stage' && f.stage === id;
    openModal({
      eyebrow: `Stage ${App.stages.indexOf(s) + 1} of ${App.stages.length}`, title: s.name,
      body: `<p class="mb-3">${esc(s.description)}</p>
        <dl class="kv mb-4"><dt>Typical</dt><dd class="mono">${fmtDur(s.duration.min)} – ${fmtDur(s.duration.max)} at 1×</dd>
          <dt>Your avg</dt><dd class="mono">${avg == null ? 'No successful runs yet' : fmtDur(avg)}</dd>
          <dt>Fault code</dt><dd class="mono">${esc(s.failure.code)}</dd><dt>Fault</dt><dd>${armed ? flap('failed', 'Armed for next run') : 'Not armed'}</dd></dl>
        <p class="eyebrow mb-2">What happens here</p><div class="steps">${s.steps.map((st) => esc(st.message)).join('<br>')}</div>`,
      actions: [{ label: 'Close', kind: 'outline', value: null }, { label: armed ? 'Disarm fault' : 'Fail here next run', kind: 'primary', value: 'fail' }]
    }).then((v) => { if (v === 'fail') toggleFault(id); });
  }

  function toggleFault(id) {
    const f = prefs().failure;
    const armed = f.enabled && f.mode === 'stage' && f.stage === id;
    if (armed) {
      setPref('failure.enabled', false);
      toast('info', 'Fault disarmed', 'Failure simulation is off.');
    } else {
      setPref('failure.stage', id);
      setPref('failure.mode', 'stage');
      setPref('failure.enabled', true);
      toast('info', 'Fault armed', `The next run will fail at ${stageById(id).name}.`);
    }
    if (prefs().view === 'pipelines') renderPipelinesView();
    renderControls();
  }

  /* --- DORA metrics: the four keys, derived from run history --- */
  const DAY = 86400000;
  const BANDS = ['elite', 'high', 'medium', 'low'];
  const BAND_NAMES = ['Elite', 'High', 'Medium', 'Low'];
  const ts = (iso) => new Date(iso).getTime();
  const endTs = (r) => ts(r.finishedAt || r.startedAt);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const fmtSpan = (ms) => (ms < 3600000 ? fmtDur(ms) : ms < 2 * DAY ? `${(ms / 3600000).toFixed(1)}h` : `${(ms / DAY).toFixed(1)}d`);

  /* Simplified DORA tiers; each returns 0 (elite) to 3 (low), or null when there is no data. */
  const bandFreq = (perDay) => (perDay == null ? null : perDay >= 1 ? 0 : perDay >= 1 / 7 ? 1 : perDay >= 1 / 30 ? 2 : 3);
  const bandLead = (ms) => (ms == null ? null : ms < DAY ? 0 : ms < 7 * DAY ? 1 : ms < 30 * DAY ? 2 : 3);
  const bandCfr = (pct) => (pct == null ? null : pct <= 15 ? 0 : pct <= 30 ? 1 : pct <= 45 ? 2 : 3);
  const bandMttr = (ms) => (ms == null ? null : ms < 3600000 ? 0 : ms < DAY ? 1 : ms < 7 * DAY ? 2 : 3);

  function computeDora(days, envId) {
    const now = Date.now();
    const since = days ? now - days * DAY : 0;
    const real = history().filter((r) => !r.drill && r.status !== 'cancelled').sort((a, b) => ts(a.startedAt) - ts(b.startedAt));
    const first = {};
    real.forEach((r) => { if (!(r.commit.hash in first)) first[r.commit.hash] = ts(r.startedAt); });
    const scoped = real.filter((r) => envId === 'all' || r.environment === envId);
    /* Rollbacks are recoveries, not changes, so they are left out of frequency, lead time and failure rate. */
    const deploys = scoped.filter((r) => !r.rollbackFrom && ts(r.startedAt) >= since);
    const ok = deploys.filter((r) => r.status === 'success');
    const bad = deploys.filter((r) => r.status === 'failed');
    const spanDays = days || Math.max(1, (now - (deploys.length ? ts(deploys[0].startedAt) : now)) / DAY);
    const leads = ok.map((r) => ({ t: endTs(r), ms: endTs(r) - first[r.commit.hash] }));

    /* Restore time: from a failed run to the next success in the same environment. */
    const restores = [];
    const open = [];
    App.envs.forEach((e) => {
      if (envId !== 'all' && e.id !== envId) return;
      let pending = null;
      scoped.filter((r) => r.environment === e.id).forEach((r) => {
        if (r.status === 'failed' && !pending) pending = r;
        else if (r.status === 'success' && pending) { restores.push({ from: pending, to: r, ms: endTs(r) - endTs(pending), t: endTs(r) }); pending = null; }
      });
      if (pending) open.push({ env: e, run: pending });
    });
    /* Chaos incidents are real restores too: from the alert to the service being restored. */
    const incs = (Store.state.incidents || []).filter((i) => envId === 'all' || i.env === envId);
    incs.forEach((i) => restores.push({ from: { id: i.id, environment: i.env }, to: { id: 'restored' }, ms: i.ttmMs, t: i.resolvedAt, incident: i }));
    const rIn = restores.filter((x) => x.t >= since).sort((a, b) => b.t - a.t);

    const perDay = deploys.length ? ok.length / spanDays : null;
    const leadMs = median(leads.map((l) => l.ms));
    /* A release that caused an incident needing remediation counts as a failed change, even though its run was green. */
    const culprits = new Set(incs.filter((i) => i.cause && i.resolvedAt >= since).map((i) => i.cause));
    const caused = ok.filter((r) => culprits.has(r.id)).length;
    const cfr = ok.length + bad.length ? ((bad.length + caused) / (ok.length + bad.length)) * 100 : null;
    const mttr = mean(rIn.map((x) => x.ms));
    const bands = [bandFreq(perDay), bandLead(leadMs), bandCfr(cfr), bandMttr(mttr)];
    const known = bands.filter((b) => b != null);

    const nb = days || 30;
    const bucket = (t) => { const i = Math.floor((now - t) / DAY); return i >= 0 && i < nb ? nb - 1 - i : -1; };
    const grid = () => Array.from({ length: nb }, () => []);
    const [fq, ld, cf, ms] = [grid(), grid(), grid(), grid()];
    const put = (g, t, v) => { const b = bucket(t); if (b >= 0) g[b].push(v); };
    ok.forEach((r) => put(fq, ts(r.startedAt), 1));
    leads.forEach((l) => put(ld, l.t, l.ms));
    deploys.forEach((r) => put(cf, ts(r.startedAt), r.status === 'failed' ? 100 : 0));
    rIn.forEach((x) => put(ms, x.t, x.ms));

    return {
      days, envId, deploys: deploys.length, ok: ok.length, bad, open, restores: rIn,
      values: { frequencyPerDay: perDay, leadTimeMs: leadMs, changeFailureRatePct: cfr, restoreTimeMs: mttr },
      bands, overall: known.length ? Math.round(mean(known)) : null,
      sparks: [fq.map((a) => a.length), ld.map(median), cf.map(mean), ms.map(mean)]
    };
  }

  const sparkHTML = (vals, fmt, label) => {
    const max = Math.max(0, ...vals.filter((v) => v != null));
    return `<div class="spark" role="img" aria-label="${esc(label)}">${vals.map((v, i) => {
      const ago = vals.length - 1 - i;
      const when = ago === 0 ? 'Today' : `${ago} d ago`;
      return v == null ? `<i class="is-empty" title="${when}: no data"></i>`
        : `<i style="height:${max ? Math.max(5, (v / max) * 100) : 5}%" title="${when}: ${esc(fmt(v))}"></i>`;
    }).join('')}</div>`;
  };

  const DORA_TIPS = [
    ['Ship smaller changes more often', 'Small batches are easier to test, review and roll back. Run the pipeline on every change instead of saving changes up.', 'pipelines', 'See the pipeline'],
    ['Cut the waiting', 'Lead time is mostly queues: reviews, approvals and slow stages. Promote the same build through environments instead of rebuilding it.', 'environment', 'Open environments'],
    ['Strengthen the gates', 'Add a regression test for every failure and keep test and security stages blocking. The hotspot list shows where runs break.', 'drills', 'Practise a drill'],
    ['Practise recovery', 'Restore time shrinks with rehearsed fixes and one-click rollback. A rollback skips build and test, so it is usually the fastest way back.', 'environment', 'Open environments']
  ];

  function renderMetrics() {
    const box = $('#metrics-view');
    if (!box) return;
    const f = App.metricsFilter;
    const d = computeDora(f.days, f.envId || f.env);
    const v = d.values;
    const perWeek = v.frequencyPerDay != null && v.frequencyPerDay < 1;
    const rows = [
      ['Deployment frequency', 'How often changes reach the line terminus', v.frequencyPerDay == null ? '—' : perWeek ? `${(v.frequencyPerDay * 7).toFixed(1)}<small> /week</small>` : `${v.frequencyPerDay.toFixed(1)}<small> /day</small>`,
        (n) => `${n} deploys`, 'Successful deploys per day'],
      ['Lead time for changes', "From a commit's first pipeline run to its deploy", v.leadTimeMs == null ? '—' : fmtSpan(v.leadTimeMs), fmtSpan, 'Median lead time per day'],
      ['Change failure rate', 'Share of deploys that failed', v.changeFailureRatePct == null ? '—' : `${v.changeFailureRatePct.toFixed(0)}<small>%</small>`, (n) => `${n.toFixed(0)}%`, 'Failure rate per day'],
      ['Time to restore', 'From a failed run to the next success', v.restoreTimeMs == null ? '—' : fmtSpan(v.restoreTimeMs), fmtSpan, 'Mean time to restore per day']
    ].map(([title, sub, value, fmt, label], i) => {
      const b = d.bands[i];
      return `<div class="dora-row"><span class="tile">${i + 1}</span>
        <span class="board-main"><span class="board-title">${title}</span><span class="board-sub">${sub}</span></span>
        <span class="dora-value">${value}</span><span class="bflap bflap-${b == null ? 'none' : BANDS[b]}">${b == null ? 'No data' : BAND_NAMES[b]}</span>
        ${sparkHTML(d.sparks[i], fmt, `${label}, last ${d.sparks[i].length} days, newest on the right`)}</div>`;
    }).join('');

    const worst = d.bands.reduce((w, b, i) => (b != null && b > (d.bands[w] == null ? -1 : d.bands[w]) ? i : w), 0);
    const allElite = d.overall != null && d.bands.every((b) => b == null || b === 0);
    const tip = DORA_TIPS[worst];
    const stageRows = App.stages.map((s) => ({ s, n: d.bad.filter((r) => r.failedStage === s.id).length }));
    const maxN = Math.max(0, ...stageRows.map((x) => x.n));
    const envName = (id) => envById(id).name;

    const incident = d.open.length ? `<div class="alert alert-warn mt-4" role="status">${icon('alert')}<div class="alert-body">
      <p><strong>Open incident.</strong> ${d.open.map((o) => `${esc(o.env.name)} has been failing since ${esc(o.run.id)} (${fmtAgo(o.run.finishedAt || o.run.startedAt)})`).join('; ')}. A successful run, retry or rollback stops the restore clock.</p></div>
      <button class="btn btn-outline btn-sm" data-action="nav" data-view="environment">${icon('env')}<span>Environments</span></button></div>` : '';

    box.innerHTML = `
      <div class="card toolbar">
        <label class="flex items-center gap-2"><span class="field-label">Period</span>
          <select class="select" data-metric="days"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="0">All time</option></select></label>
        <label class="flex items-center gap-2"><span class="field-label">Environment</span>
          <select class="select" data-metric="env"><option value="all">All environments</option>${App.envs.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></label>
        <span class="flex-1"></span>
        <button class="btn btn-outline btn-sm" data-action="metrics-export">${icon('download')}<span>Export JSON</span></button>
      </div>
      ${incident}
      <section class="board mt-4" aria-label="DORA metrics">
        <div class="board-head"><span>Delivery performance · ${f.days ? `last ${f.days} days` : 'all time'}</span>
          <span>Overall <span class="bflap bflap-${d.overall == null ? 'none' : BANDS[d.overall]}" style="margin-left:6px">${d.overall == null ? 'No data' : BAND_NAMES[d.overall]}</span></span></div>
        ${rows}
        <p class="dora-note">${d.deploys ? `${d.deploys} deploys counted.` : 'No runs in this window yet. Run the pipeline to start measuring.'} Bands are a simplified form of the DORA research tiers. Simulated pipelines finish in seconds, so lead time and restore time read as elite; frequency and failure rate are the numbers to practise on. Drills and rollbacks are not counted as changes.</p>
      </section>
      <div class="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
        <section class="card p-5"><p class="eyebrow">Focus area</p>
          <h2 class="display text-[24px] leading-7 mt-1 mb-2">${d.overall == null ? 'Run the pipeline first' : allElite ? 'Nothing to fix here' : esc(tip[0])}</h2>
          <p class="text-muted text-sm mb-3">${d.overall == null ? 'Metrics appear once there are runs in the selected period.' : allElite ? 'All measured keys are elite in this window. Keep the habit: small changes, strict gates, rehearsed recovery.' : esc(tip[1])}</p>
          ${d.overall != null && !allElite ? `<button class="btn btn-outline btn-sm" data-action="nav" data-view="${tip[2]}">${icon('chevron')}<span>${esc(tip[3])}</span></button>` : ''}</section>
        <section class="card p-5"><p class="eyebrow mb-1">Where the line breaks</p>
          ${d.bad.length ? `<div class="rows">${stageRows.map((x) => `<div class="py-2"><div class="flex justify-between text-sm"><span>${esc(x.s.name)}</span><span class="mono">${x.n}</span></div>
            <div class="bar is-failed mt-1"><span style="width:${maxN ? (x.n / maxN) * 100 : 0}%"></span></div></div>`).join('')}</div>` : '<p class="text-muted text-sm">No failed deploys in this window.</p>'}</section>
        <section class="card p-5"><p class="eyebrow mb-1">Recent restores</p>
          ${d.restores.length ? `<div class="rows">${d.restores.slice(0, 5).map((x) => `<button type="button" class="restore-row" ${x.incident ? 'data-action="nav" data-view="chaos"' : `data-action="dep-detail" data-id="${x.from.id}"`}>
            <span><span class="mono font-semibold">${x.from.id}</span> → <span class="mono font-semibold">${x.to.id}</span> <span class="text-muted">· ${esc(envName(x.from.environment))} · ${x.incident ? `Incident · ${esc((incAction(x.incident.action) || {}).label || 'fixed')}` : x.to.rollbackFrom ? 'Rollback' : x.to.retryOf === x.from.id ? 'Retry' : 'Next run'}</span></span>
            <span class="mono">${fmtSpan(x.ms)}</span></button>`).join('')}</div>` : '<p class="text-muted text-sm">No failures have been recovered in this window.</p>'}</section>
      </div>`;
    $('[data-metric="days"]', box).value = String(f.days || 0);
    $('[data-metric="env"]', box).value = f.env;
  }

  /* --- incident drills: a fault is injected into a real run, the user picks the fix --- */
  const drillById = (id) => App.drills.find((d) => d.id === id);
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  const shuffleIdx = (n) => {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = randInt(0, i); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  function drillStats() {
    const saved = Store.state.drills;
    const done = App.drills.filter((d) => saved[d.id] && saved[d.id].best != null);
    const points = done.reduce((sum, d) => sum + saved[d.id].best, 0);
    const ranks = App.drillCfg.ranks;
    let idx = 0;
    ranks.forEach((r, i) => { if (points >= r.min) idx = i; });
    const max = App.drills.reduce((sum, d) => sum + App.drillCfg.difficulty[d.difficulty].base, 0);
    return { done: done.length, points, max, rank: ranks[idx], next: ranks[idx + 1] || null };
  }

  /* Score = base − wrong fixes − hint − 1 point per 2 s over par, never below 25% of base. */
  function drillScore(def, diagnoseMs, wrong, hint) {
    const diff = App.drillCfg.difficulty[def.difficulty];
    const wrongPts = wrong * Math.round(diff.base * 0.2);
    const hintPts = hint ? Math.round(diff.base * 0.15) : 0;
    const timePenalty = Math.max(0, Math.floor((diagnoseMs / 1000 - diff.par) / 2));
    const floor = Math.round(diff.base * 0.25);
    const raw = diff.base - wrongPts - hintPts - timePenalty;
    const score = Math.max(floor, raw);
    const ratio = score / diff.base;
    return { score, base: diff.base, wrongPts, hintPts, timePenalty, floored: raw < floor, rating: ratio >= 0.85 ? 'S' : ratio >= 0.65 ? 'A' : ratio >= 0.45 ? 'B' : 'C' };
  }

  const drillLive = (run) => {
    const live = run.stages.filter((s) => s.status === 'running');
    const label = run.status === 'running' && live.length
      ? `Now at ${live.map((s) => stageById(s.id).name).join(' + ')} · ${Math.round(Math.min(...live.map((s) => s.progress)) * 100)}%` : RUN_LABEL[run.status];
    return `${stageLine(run.stages, run.envId)}<p class="mono text-[12.5px] text-muted mt-2">${esc(run.id || '')}${run.id ? ' · ' : ''}${esc(label)} · ${fmtDur(run.durationMs)}</p>`;
  };
  function updateDrillLive(run) {
    const el = $('#drill-live');
    if (el && App.drill && ['running', 'fixing'].includes(App.drill.phase)) el.innerHTML = drillLive(run);
  }

  function stopDrillTimer() { clearInterval(App.drillTimer); App.drillTimer = null; }
  function startDrillTimer() {
    stopDrillTimer();
    App.drillTimer = setInterval(() => {
      const dr = App.drill;
      if (!dr || dr.phase !== 'diagnose') { stopDrillTimer(); return; }
      const el = $('#drill-timer');
      if (el) el.textContent = fmtDur(performance.now() - dr.t0);
    }, 200);
  }

  function drillListHTML() {
    const saved = Store.state.drills;
    return `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">${App.drills.map((d, i) => {
      const s = saved[d.id];
      const diff = App.drillCfg.difficulty[d.difficulty];
      return `<article class="card drill-card">
        <div class="stage-top"><span class="tile">${i + 1}</span><h3 class="stage-name">${esc(d.title)}</h3>${s && s.rating ? `<span class="rating rating-${s.rating}" title="Best rating ${s.rating}">${s.rating}</span>` : ''}</div>
        <p class="stage-desc">${esc(d.briefing)}</p>
        <div class="stage-foot"><span class="flex flex-wrap gap-2"><span class="flap flap-idle">${esc((baseDef(d.stage) || {}).short || d.stage)}</span><span class="flap flap-idle">${diff.label} · ${diff.base} pts</span></span>
          <span class="stage-dur">${s && s.best != null ? `best ${s.best} pts` : 'not tried'}</span></div>
        ${stageById(d.stage) ? '' : `<p class="text-[13px]" style="color:var(--amber-ink)">Needs the ${esc((App.baseStages.find((x) => x.id === d.stage) || {}).name || d.stage)} stage, which is switched off in your pipeline.</p>`}
        <button class="btn btn-primary btn-sm" data-action="drill-start" data-id="${d.id}" ${stageById(d.stage) ? '' : 'disabled'}>${icon('play', 'ic-fill')}<span>${s ? 'Play again' : 'Start drill'}</span></button>
      </article>`;
    }).join('')}</div>`;
  }

  function debriefHTML(dr) {
    const d = dr.def;
    const r = dr.result;
    const prev = Store.state.drills[d.id];
    const rows = d.choices.map((c) => `<div class="py-2"><p class="flex items-start gap-2 font-semibold"><span style="color:${c.correct ? 'var(--green)' : 'var(--red)'}">${icon(c.correct ? 'check' : 'x')}</span><span>${esc(c.label)}</span></p>
      <p class="text-muted text-sm" style="padding-left:26px">${esc(c.why)}</p></div>`).join('');
    return `
      <div class="debrief mt-4"><span class="rating rating-lg rating-${r.rating}" aria-label="Rating ${r.rating}">${r.rating}</span>
        <div><p class="eyebrow">${r.newBest ? 'New best' : 'Recovered'}</p><h3 class="display text-[30px] leading-8">+${r.score} pts</h3>
          <p class="text-muted text-sm">${r.rankUp ? `Promoted to ${esc(r.rank)}.` : `Rank: ${esc(r.rank)}.`}${r.newBest ? '' : ` Your best stays ${prev.best} pts.`}</p></div></div>
      <dl class="kv mt-4"><dt>Diagnosed in</dt><dd class="mono">${fmtDur(r.diagnoseMs)}</dd>
        <dt>Recovered in</dt><dd class="mono">${fmtDur(r.recoveryMs)} <span class="text-muted">· fault to green</span></dd>
        <dt>Wrong fixes</dt><dd>${r.wrong}</dd><dt>Hint</dt><dd>${r.hint ? 'Used' : 'Not used'}</dd>
        <dt>Score</dt><dd class="mono">${r.base} − ${r.wrongPts} wrong − ${r.hintPts} hint − ${r.timePenalty} time${r.floored ? ' (minimum applied)' : ''}</dd></dl>
      <p class="eyebrow mt-4 mb-1">What happened</p><p>${esc(d.explanation)}</p>
      <p class="eyebrow mt-4 mb-1">Why each option</p><div class="rows">${rows}</div>
      <p class="eyebrow mt-4 mb-1">Lesson</p><p class="font-semibold">${esc(d.lesson)}</p>
      <div class="flex flex-wrap gap-2 mt-5">
        <button class="btn btn-primary" data-action="drill-next">${icon('play', 'ic-fill')}<span>Next drill</span></button>
        <button class="btn btn-outline" data-action="drill-start" data-id="${d.id}">${icon('retry')}<span>Play again</span></button>
        <button class="btn btn-outline" data-action="drill-exit">${icon('x')}<span>All drills</span></button></div>`;
  }

  function drillPanelHTML() {
    const dr = App.drill;
    const d = dr.def;
    const diff = App.drillCfg.difficulty[d.difficulty];
    const stage = stageById(d.stage);
    const exit = dr.phase === 'diagnose'
      ? `<button class="btn btn-outline btn-sm" data-action="drill-exit">${icon('x')}<span>Abandon drill</span></button>`
      : dr.phase === 'done' ? '' : `<button class="btn btn-outline btn-sm" data-action="cancel">${icon('stop', 'ic-fill')}<span>Cancel</span></button>`;
    const head = `<div class="flex flex-wrap items-start justify-between gap-3"><div class="min-w-0">
      <p class="eyebrow">Incident drill · ${diff.label} · ${diff.base} pts <span class="sim-tag">Simulated</span></p>
      <h2 class="display map-title mt-1">${esc(d.title)}</h2><p class="text-muted text-sm mt-1">${esc(d.briefing)}</p></div>${exit}</div>`;
    let body;
    if (dr.phase === 'running' || dr.phase === 'fixing') {
      const run = App.engine.isRunning ? App.engine.run : idleRun();
      body = `<div id="drill-live" class="drill-live">${drillLive(run)}</div>
        <p class="text-muted text-sm mt-3">${dr.phase === 'running' ? 'A fault has been injected somewhere on this line. Watch where the train stops.' : `Fix applied: ${esc(d.choices[dr.fix].label)}. Re-running the same commit…`}</p>`;
    } else if (dr.phase === 'diagnose') {
      const logs = dr.record.logs;
      const hintPts = Math.round(diff.base * 0.15);
      const wrongPts = Math.round(diff.base * 0.2);
      body = `<div class="alert alert-error mt-4" role="alert">${icon('alert')}<div class="alert-body">
          <p><strong>${esc(dr.record.id)} stopped at ${esc(stage.name)}.</strong> Read the evidence, then choose the fix.</p></div>
          <span class="mono font-semibold" id="drill-timer" aria-label="Time spent diagnosing">${fmtDur(performance.now() - dr.t0)}</span></div>
        <section class="terminal mt-3" aria-label="Evidence"><header class="terminal-head"><span class="terminal-title">${icon('terminal')} Evidence · pipeline log</span><span class="terminal-count">${logs.length} lines</span></header>
          <div id="drill-evidence" class="terminal-body" role="log" tabindex="0" aria-label="Pipeline log evidence">${logs.map(logHTML).join('')}</div></section>
        <h3 class="display text-[22px] leading-6 mt-5 mb-2">Which fix would you apply?</h3>
        <ul class="choice-list">${dr.order.map((ci, pos) => {
          const c = d.choices[ci];
          const out = dr.wrong.includes(ci);
          return `<li><button type="button" class="choice${out ? ' is-out' : ''}" data-action="drill-choose" data-choice="${ci}" ${out ? 'disabled' : ''}>
            <span class="choice-key">${LETTERS[pos]}</span><span class="choice-body"><span class="choice-text">${esc(c.label)}</span>${out ? `<span class="choice-why">Ruled out. ${esc(c.why)}</span>` : ''}</span></button></li>`;
        }).join('')}</ul>
        <div class="flex flex-wrap items-center gap-3 mt-3">
          ${dr.hint ? `<div class="alert alert-warn flex-1">${icon('info')}<div class="alert-body"><p><strong>Hint.</strong> ${esc(d.hint)}</p></div></div>`
            : `<button class="btn btn-outline btn-sm" data-action="drill-hint">${icon('info')}<span>Use hint (−${hintPts} pts)</span></button>`}
          <p class="text-muted text-[13px]">Each wrong fix costs ${wrongPts} pts. Time past ${diff.par}s costs 1 pt per 2s.</p></div>`;
    } else {
      body = debriefHTML(dr);
    }
    return `<section class="card p-5" data-line="${envById(d.env).line}">${head}${body}</section>`;
  }

  function renderDrills() {
    const box = $('#drills-view');
    if (!box) return;
    const st = drillStats();
    const pct = st.next ? Math.round(((st.points - st.rank.min) / (st.next.min - st.rank.min)) * 100) : 100;
    box.innerHTML = `
      <section class="card rank-card" aria-label="Your rank">
        <div><p class="eyebrow">Your rank</p><h2 class="rank-name">${esc(st.rank.name)}</h2>
          <p class="text-muted text-sm mt-1">A fault is injected into a real pipeline run. Read the logs, choose the right fix, then watch the line recover. Faster, cleaner answers score more.</p></div>
        <div><div class="flex items-baseline justify-between gap-3"><span class="mono font-semibold">${st.points} / ${st.max} pts</span><span class="text-muted text-sm">${st.done} of ${App.drills.length} solved</span></div>
          <div class="bar bar-lg mt-2" role="progressbar" aria-label="Progress to next rank" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
          <p class="text-muted text-sm mt-2">${st.next ? `${st.next.min - st.points} pts to ${esc(st.next.name)}` : 'Top rank reached'}</p></div>
      </section>
      <div class="mt-4">${App.drill ? drillPanelHTML() : drillListHTML()}</div>`;
    const ev = $('#drill-evidence');
    if (ev) ev.scrollTop = ev.scrollHeight;
  }

  async function startDrill(id) {
    const def = drillById(id);
    if (!def) return;
    if (!stageById(def.stage)) { toast('info', 'Stage switched off', 'This drill needs a stage that is disabled in your pipeline.'); return; }
    if (App.engine.isRunning || App.launching || (App.drill && App.drill.phase !== 'done')) {
      toast('info', 'Pipeline busy', 'Finish or cancel the current run before starting a drill.');
      return;
    }
    stopDrillTimer();
    App.drill = { def, phase: 'running', wrong: [], hint: false, order: shuffleIdx(def.choices.length), t0: 0, diagnoseMs: 0, recoveryMs: 0, fix: null, record: null, result: null };
    renderDrills();
    await startRun({ drill: def });
    if (App.drill && App.drill.phase === 'running' && !App.engine.isRunning) { App.drill = null; renderDrills(); }
  }

  async function chooseFix(idx) {
    const dr = App.drill;
    if (!dr || dr.phase !== 'diagnose') return;
    const c = dr.def.choices[idx];
    if (!c || dr.wrong.includes(idx)) return;
    if (!c.correct) {
      dr.wrong.push(idx);
      toast('error', 'Not the cause', 'That fix was ruled out. Read the evidence again.');
      renderDrills();
      return;
    }
    dr.diagnoseMs = performance.now() - dr.t0;
    dr.fix = idx;
    dr.phase = 'fixing';
    stopDrillTimer();
    renderDrills();
    await startRun({ retryOf: dr.record, drill: dr.def, fixLabel: c.label });
    if (App.drill === dr && dr.phase === 'fixing' && !App.engine.isRunning) { App.drill = null; renderDrills(); }
  }

  function completeDrill(dr) {
    const before = drillStats();
    const s = drillScore(dr.def, dr.diagnoseMs, dr.wrong.length, dr.hint);
    const prev = Store.state.drills[dr.def.id] || { attempts: 0 };
    const newBest = prev.best == null || s.score > prev.best;
    Store.state.drills[dr.def.id] = {
      attempts: (prev.attempts || 0) + 1,
      best: newBest ? s.score : prev.best, rating: newBest ? s.rating : prev.rating,
      bestMs: newBest ? Math.round(dr.diagnoseMs) : prev.bestMs, lastAt: new Date().toISOString()
    };
    Store.save();
    const after = drillStats();
    dr.phase = 'done';
    dr.result = { ...s, newBest, diagnoseMs: dr.diagnoseMs, recoveryMs: dr.recoveryMs, wrong: dr.wrong.length, hint: dr.hint, rank: after.rank.name, rankUp: after.rank.name !== before.rank.name };
    toast('success', after.rank.name !== before.rank.name ? `Promoted: ${after.rank.name}` : 'Line recovered',
      `${dr.def.title}: rating ${s.rating}, +${s.score} pts.`);
  }

  function drillRunFinished(run, record) {
    const dr = App.drill;
    if (!dr || dr.def.id !== run.drill) return;
    if (run.status === 'failed' && dr.phase === 'running') {
      dr.phase = 'diagnose';
      dr.record = record;
      dr.t0 = performance.now();
      startDrillTimer();
      toast('error', 'Pipeline broke', `${run.id} stopped at ${stageById(run.failedStage).name}. Find the fix.`);
    } else if (run.status === 'success' && dr.phase === 'fixing') {
      dr.recoveryMs = dr.diagnoseMs + run.durationMs;
      completeDrill(dr);
    } else {
      stopDrillTimer();
      App.drill = null;
      toast('info', 'Drill ended', `${run.id} was ${run.status}. Start the drill again to retry it.`);
    }
  }

  /* --- pipeline editor: reorder, add and switch off stages, then export GitHub Actions YAML --- */
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const baseDef = (id) => App.baseStages.find((s) => s.id === id);
  const defOf = (it) => it.def || baseDef(it.id);

  function validStageDef(d) {
    return !!d && typeof d.id === 'string' && typeof d.name === 'string' && typeof d.short === 'string' && typeof d.code === 'string'
      && d.duration && Number.isFinite(d.duration.min) && Number.isFinite(d.duration.max)
      && Array.isArray(d.steps) && d.steps.length >= 2 && d.failure && d.failure.code && d.failure.message;
  }

  /* The pipeline is a list of items: { id, enabled, par (runs in parallel with the item before it), name, def (added stages only) }. */
  function defaultItems() {
    return App.baseStages.map((s, i) => ({
      id: s.id, enabled: true, name: null,
      par: !!(s.parallel && App.baseStages[i - 1] && App.baseStages[i - 1].parallel === s.parallel)
    }));
  }

  function currentItems() {
    const saved = Store.state.pipeline;
    if (!Array.isArray(saved)) return defaultItems();
    const seen = new Set();
    const items = saved
      .filter((it) => it && typeof it.id === 'string' && !seen.has(it.id) && (baseDef(it.id) || (it.def && it.def.id === it.id && validStageDef(it.def))) && seen.add(it.id))
      .map((it) => ({ id: it.id, enabled: it.enabled !== false, par: !!it.par, name: typeof it.name === 'string' ? it.name.slice(0, 28) : null, ...(it.def ? { def: it.def } : {}) }));
    App.baseStages.forEach((s, i) => { if (!seen.has(s.id)) items.splice(Math.min(i, items.length), 0, { id: s.id, enabled: true, par: false, name: null }); });
    items.forEach((it) => { if (defOf(it).locked) it.enabled = true; });
    return items;
  }

  /* Turns items into the stage list the engine runs. Pairing rule: an enabled item marked `par` joins the
     enabled item before it, unless that one is already the second half of a pair (the map forks into two lanes). */
  function resolvePipeline(items) {
    const info = {};
    const out = [];
    items.forEach((it) => {
      const def = defOf(it);
      if (!def || !(it.enabled || def.locked)) { info[it.id] = { on: false, canPair: false, paired: false }; return; }
      const prev = out[out.length - 1];
      const canPair = !!prev && !prev.second;
      const s = { ...def, name: it.name || def.name, custom: !!it.def, second: false };
      delete s.parallel;
      if (it.par && canPair) { const g = `p-${prev.id}`; prev.parallel = g; s.parallel = g; s.second = true; }
      info[it.id] = { on: true, canPair, paired: false };
      out.push(s);
    });
    out.forEach((s) => { info[s.id].paired = !!s.parallel; });
    return { stages: out.map(({ second, ...s }) => s), info };
  }

  function applyPipelineToApp() {
    App.stages = resolvePipeline(currentItems()).stages;
    App.waves = buildWaves(App.stages);
  }

  /* Swap the running pipeline definition and rebuild everything that is drawn from it. */
  function rebuildPipelineUI() {
    applyPipelineToApp();
    App.engine.stages = App.stages;
    App.engine.waves = App.waves;
    App.engine.run = null;
    if (!App.stages.some((s) => s.id === prefs().failure.stage)) prefs().failure.stage = App.stages[0].id;
    Store.save();
    buildMetro();
    buildStageCards();
    $('#env-view').innerHTML = ''; /* its network map was drawn for the old stage list; it redraws when opened */
    $('#dispatch').innerHTML = runControls('ov') + simControls('ov');
    renderAll();
  }

  function commitPipeline() {
    if (App.engine.isRunning || App.launching || (App.drill && App.drill.phase !== 'done')) {
      toast('info', 'Pipeline busy', 'Finish or cancel the current run or drill before changing the pipeline.');
      return;
    }
    const items = clone(App.editor.items);
    Store.state.pipeline = JSON.stringify(items) === JSON.stringify(defaultItems()) ? null : items;
    Store.save();
    rebuildPipelineUI();
    toast('success', 'Pipeline applied', `${App.stages.length} stages in ${App.waves.length} stops. Saved in this browser.`);
  }

  /* GitHub Actions style workflow. The git stage becomes the trigger; every other stage becomes a job
     that needs the jobs of the previous wave, so parallel stages become jobs that share the same `needs`. */
  const yq = (v) => (/^[A-Za-z0-9_./@-][A-Za-z0-9_./@ -]*$/.test(v) && !/^(true|false|null|yes|no|on|off)$/i.test(v) ? v : JSON.stringify(v));

  function pipelineYAML(stages) {
    const jobs = stages.filter((s) => !(s.ci && (s.ci.trigger || s.ci.gate))); /* the gate is a protection rule, not a job */
    const jid = (s) => s.id.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const L = ['# Generated by DeployX. DeployX only simulates pipelines: review this before using it in a real repository.',
      `name: ${yq(App.pipeline.name)}`, 'on:'];
    if (stages.some((s) => s.ci && s.ci.trigger)) L.push('  push:', `    branches: [${prefs().branch}]`);
    L.push('  workflow_dispatch:', '', 'jobs:');
    let prev = [];
    buildWaves(jobs).forEach((wave) => {
      wave.forEach((s) => {
        L.push(`  ${jid(s)}:`, `    name: ${yq(s.name)}`);
        if (prev.length) L.push(`    needs: [${prev.join(', ')}]`);
        L.push('    runs-on: ubuntu-latest');
        if (s.id === 'deploy') {
          if (stages.some((x) => x.kind === 'gate')) L.push('    # Approval gate: add required reviewers to this environment under Settings > Environments.');
          L.push(`    environment: ${prefs().environment}`);
        }
        L.push('    timeout-minutes: 15', '    steps:');
        const steps = (s.id === 'checkout' ? [] : [{ name: 'Check out source', uses: 'actions/checkout@v4' }]).concat((s.ci && s.ci.steps) || []);
        steps.forEach((st) => {
          L.push(`      - name: ${yq(st.name)}`);
          if (st.uses) L.push(`        uses: ${yq(st.uses)}`);
          if (st.with) { L.push('        with:'); Object.entries(st.with).forEach(([k, v]) => L.push(`          ${k}: ${yq(String(v))}`)); }
          if (st.run) L.push(`        run: ${yq(st.run)}`);
        });
        L.push('');
      });
      prev = wave.map(jid);
    });
    return `${L.join('\n').trimEnd()}\n`;
  }

  const yamlHTML = (text) => text.split('\n').map((ln) => {
    const e = esc(ln);
    return /^\s*#/.test(ln) ? `<span class="y-c">${e}</span>` : e.replace(/^(\s*(?:- )?)([A-Za-z0-9_-]+)(:)/, '$1<span class="y-k">$2</span>$3');
  }).join('\n');

  function renderPipelinesView() {
    const box = $('#pipelines-view');
    const tab = App.editor.tab;
    const dirty = tab === 'editor' && App.editor.items && JSON.stringify(App.editor.items) !== JSON.stringify(currentItems());
    box.innerHTML = `<div class="flex flex-wrap items-center gap-2 mb-4">
      <button class="btn btn-sm ${tab === 'definition' ? 'btn-primary' : 'btn-outline'}" data-action="pl-tab" data-tab="definition" aria-pressed="${tab === 'definition'}">${icon('pipeline')}<span>Definition</span></button>
      <button class="btn btn-sm ${tab === 'editor' ? 'btn-primary' : 'btn-outline'}" data-action="pl-tab" data-tab="editor" aria-pressed="${tab === 'editor'}">${icon('settings')}<span>Editor</span></button>
      ${dirty ? '<span class="flap flap-running">Unsaved changes</span>' : ''}</div><div id="pl-body"></div>`;
    if (tab === 'editor') renderEditor($('#pl-body')); else renderDefinition($('#pl-body'));
  }

  function renderEditor(box) {
    const ed = App.editor;
    if (!ed.items) ed.items = clone(currentItems());
    const items = ed.items;
    const res = resolvePipeline(items);
    const dirty = JSON.stringify(items) !== JSON.stringify(currentItems());
    const waves = buildWaves(res.stages);
    const chain = waves.map((w) => (w.length > 1
      ? `<span class="ed-chip ed-chip-par">${w.map((s) => esc(s.short)).join(' <i>‖</i> ')}</span>` : `<span class="ed-chip">${esc(w[0].short)}</span>`)).join('<span class="ed-arrow" aria-hidden="true">→</span>');
    const rows = items.map((it, i) => {
      const def = defOf(it);
      const inf = res.info[it.id];
      const locked = !!def.locked;
      return `<div class="ed-row${inf.on ? '' : ' is-off'}"><span class="tile">${esc(def.code)}</span>
        <div class="ed-main">
          <div class="flex flex-wrap items-center gap-2">
            <input class="input ed-name" type="text" maxlength="28" value="${esc(it.name || def.name)}" data-ed="name" data-i="${i}" aria-label="Name of stage ${i + 1}" ${inf.on ? '' : 'disabled'}>
            ${locked ? '<span class="sim-tag">Required</span>' : ''}${it.def ? '<span class="sim-tag">Added</span>' : ''}${inf.paired ? '<span class="sim-tag">Parallel</span>' : ''}</div>
          <p class="ed-sub">${esc(def.description)}</p>
          <div class="ed-controls">
            <label class="chk"><input type="checkbox" data-ed="enabled" data-i="${i}" ${inf.on ? 'checked' : ''} ${locked ? 'disabled' : ''}> Enabled</label>
            <label class="chk"><input type="checkbox" data-ed="par" data-i="${i}" ${it.par ? 'checked' : ''} ${inf.on && (inf.canPair || it.par) ? '' : 'disabled'}> Parallel with previous</label>
            <span class="flex-1"></span>
            <button class="btn-icon btn-icon-sm" data-action="ed-up" data-i="${i}" aria-label="Move ${esc(it.name || def.name)} up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
            <button class="btn-icon btn-icon-sm" data-action="ed-down" data-i="${i}" aria-label="Move ${esc(it.name || def.name)} down" ${i === items.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
            ${it.def ? `<button class="btn-icon btn-icon-sm" data-action="ed-remove" data-i="${i}" aria-label="Remove ${esc(it.name || def.name)}">${icon('trash')}</button>` : ''}
          </div></div></div>`;
    }).join('');
    const catalog = App.catalog.map((d) => {
      const added = items.some((it) => it.id === d.id);
      return `<div class="ed-cat"><div class="min-w-0"><p class="font-semibold">${esc(d.name)}</p><p class="text-muted text-[13px]">${esc(d.description)}</p></div>
        <button class="btn btn-outline btn-sm" data-action="ed-add" data-id="${d.id}" ${added ? 'disabled' : ''}>${icon('plus')}<span>${added ? 'Added' : 'Add'}</span></button></div>`;
    }).join('');
    const yaml = pipelineYAML(res.stages);
    box.innerHTML = `<div class="grid grid-cols-1 xl:grid-cols-5 gap-4">
      <div class="xl:col-span-3 flex flex-col gap-4">
        <section class="card p-5">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div><p class="eyebrow">Pipeline editor <span class="sim-tag">Simulated</span></p><h2 class="display text-[26px] leading-8 mt-1">Shape your line</h2>
              <p class="text-muted text-sm mt-1">Reorder stages, switch them off, run two side by side, or add new ones. Changes apply to the map, the engine and the YAML once you press Apply.</p></div>
            <div class="flex flex-wrap gap-2">
              <button class="btn btn-primary btn-sm" data-action="ed-apply" ${dirty ? '' : 'disabled'}>${icon('check')}<span>Apply</span></button>
              <button class="btn btn-outline btn-sm" data-action="ed-discard" ${dirty ? '' : 'disabled'}>${icon('x')}<span>Discard</span></button>
              <button class="btn btn-outline btn-sm" data-action="ed-reset">${icon('retry')}<span>Reset to default</span></button></div></div>
          <p class="eyebrow mt-4 mb-2">Resulting line · ${res.stages.length} stages in ${waves.length} stops</p>
          <div class="ed-chain" aria-label="Resulting pipeline order">${chain}<span class="ed-arrow" aria-hidden="true">→</span><span class="ed-chip ed-chip-end">${esc(envById(prefs().environment).name)}</span></div>
          <div class="ed-rows mt-4">${rows}</div>
        </section>
        <section class="card p-5"><p class="eyebrow">Add a stage</p><h2 class="display text-[22px] leading-6 mt-1 mb-3">Stage library</h2>
          <div class="rows">${catalog}</div></section>
      </div>
      <section class="card p-5 xl:col-span-2 min-w-0">
        <div class="flex flex-wrap items-start justify-between gap-2 mb-3"><div><p class="eyebrow">Export</p><h2 class="display text-[22px] leading-6 mt-1">GitHub Actions workflow</h2></div>
          <div class="flex gap-2"><button class="btn btn-outline btn-sm" data-action="ed-copy">${icon('copy')}<span>Copy</span></button>
            <button class="btn btn-outline btn-sm" data-action="ed-download">${icon('download')}<span>.yml</span></button></div></div>
        <pre class="yaml" tabindex="0" aria-label="Generated workflow YAML">${yamlHTML(yaml)}</pre>
        <p class="text-muted text-[13px] mt-2">The Git stage becomes the trigger. Each other stage becomes a job; stages that run in parallel share the same <code>needs</code>. This is a starting point: check commands, versions and secrets before using it.</p>
      </section></div>`;
  }

  function editorChange(el) {
    const i = Number(el.dataset.i);
    const it = App.editor.items && App.editor.items[i];
    if (!it) return;
    const key = el.dataset.ed;
    if (key === 'enabled') it.enabled = el.checked;
    else if (key === 'par') it.par = el.checked;
    else if (key === 'name') {
      const v = el.value.replace(/[{}]/g, '').trim().slice(0, 28);
      it.name = v && v !== defOf(it).name ? v : null;
    }
    renderPipelinesView();
    const again = $(`[data-ed="${key}"][data-i="${i}"]`);
    if (again) again.focus();
  }

  function editorMove(i, dir) {
    const items = App.editor.items;
    const j = i + dir;
    if (!items || j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    renderPipelinesView();
    const btn = $(`[data-action="${dir < 0 ? 'ed-up' : 'ed-down'}"][data-i="${j}"]:not(:disabled)`) || $(`[data-action="${dir < 0 ? 'ed-down' : 'ed-up'}"][data-i="${j}"]`);
    if (btn) btn.focus();
  }

  /* --- approval gate: the panel a reviewer uses while a protected environment is waiting --- */
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

  function updateGateTimer() {
    const g = App.engine.gateState;
    if (!g) return;
    const left = g.timeoutMs - (performance.now() - g.t0);
    const t = $('#gate-timer');
    if (t) t.textContent = `${mmss(left)} left`;
    const b = $('#gate-bar span');
    if (b) b.style.width = `${Math.max(0, (left / g.timeoutMs) * 100)}%`;
    const ct = $('#appr-time');
    if (ct) ct.textContent = mmss(left);
  }

  function renderApproval() {
    const box = $('#approval-panel');
    const chip = $('#approval-chip');
    const g = App.engine && App.engine.gateState;
    chip.hidden = !g;
    if (!g) { box.innerHTML = ''; return; }
    const run = App.engine.run;
    const done = g.approvals.map((a) => a.name);
    const open = g.approvers.filter((n) => !done.includes(n));
    if (App.approverFor !== g || !open.includes(App.approver)) { /* pick a fresh default for every new gate */
      App.approverFor = g;
      const mine = profile().reviewer; /* your profile's preferred reviewer, unless that person wrote the change */
      App.approver = mine !== 'auto' && open.includes(mine) && mine !== g.author ? mine : open.find((n) => n !== g.author) || open[0] || null;
    }
    const isAuthor = App.approver === g.author;
    const pts = (n) => (done.includes(n) ? 'is-done' : n === g.author ? 'is-author' : '');
    box.innerHTML = `<section class="card approval" role="group" aria-label="Approval required">
      <div class="flex flex-wrap items-start justify-between gap-3"><div class="min-w-0">
        <p class="eyebrow">Approval gate <span class="sim-tag">Simulated</span></p>
        <h2 class="display text-[26px] leading-8 mt-1">${esc(g.envName)} is waiting for sign-off</h2>
        <p class="text-muted text-sm mt-1">${esc(run.id)} · <span class="mono">${short(run.commit.hash)}</span> ${esc(run.commit.message)} · authored by ${esc(g.author)}</p></div>
        <span class="mono font-semibold" id="gate-timer" aria-label="Time left to approve"></span></div>
      <div class="bar bar-lg mt-3" id="gate-bar"><span></span></div>
      <p class="text-sm mt-3">Needs <strong>${g.required}</strong> approval${g.required > 1 ? 's' : ''} from reviewers other than the author. <strong>${g.approvals.length}</strong> given.</p>
      <ul class="appr-list">${g.approvers.map((n) => `<li class="appr ${pts(n)}"><span class="appr-dot">${done.includes(n) ? icon('check') : ''}</span>${esc(n)}<small>${done.includes(n) ? 'Approved' : n === g.author ? 'Author' : 'Pending'}</small></li>`).join('')}</ul>
      <div class="flex flex-wrap items-end gap-3 mt-4">
        <label class="field" style="margin:0"><span class="field-label">Acting as</span>
          <select class="select" data-approver>${open.map((n) => `<option value="${esc(n)}" ${n === App.approver ? 'selected' : ''}>${esc(n)}${n === g.author ? ' (author)' : ''}</option>`).join('')}</select></label>
        <label class="field" style="margin:0;flex:1;min-width:180px"><span class="field-label">Reject reason (optional)</span>
          <input id="gate-reason" class="input" type="text" maxlength="60" placeholder="e.g. needs more testing"></label>
        <button class="btn btn-primary" data-action="gate-approve" ${isAuthor || !App.approver ? 'disabled' : ''}>${icon('check')}<span>Approve</span></button>
        <button class="btn btn-danger" data-action="gate-reject">${icon('x')}<span>Reject</span></button>
      </div>
      ${isAuthor ? '<p class="text-muted text-[13px] mt-2">The author cannot approve their own change (four-eyes principle). Pick another reviewer.</p>' : ''}
    </section>`;
    updateGateTimer();
  }

  function onGateEvent(ev) {
    if (ev.actor === 'user' && ev.type === 'update') bumpCounter('approvals');
    if (ev.actor === 'user' && ev.type === 'rejected') bumpCounter('rejections');
    renderApproval();
    chatGateEvent(ev);
    if (ev.type === 'open') toast('info', 'Approval needed', `${ev.g.envName} needs ${ev.g.required} approval${ev.g.required > 1 ? 's' : ''} before it deploys.`);
  }

  /* --- guided tour: a run that pauses at every station and explains what a real pipeline does there --- */
  function tourOn(id) { return !!(App.tour && App.tour.focus && App.tour.focus.includes(id)); }

  function tourInfo(def) {
    const t = App.tourData.stages[def.id] || {};
    return {
      headline: t.headline || def.name,
      real: t.real || def.description,
      watch: t.watch || App.tourData.fallback.watch,
      risk: t.risk || App.tourData.fallback.risk
    };
  }

  function openTour() {
    if (App.engine.isRunning || App.launching || (App.drill && App.drill.phase !== 'done')) {
      toast('info', 'Pipeline busy', 'Finish or cancel the current run or drill before starting the tour.');
      return;
    }
    if (!prefs().tourSeen) setPref('tourSeen', true);
    App.tour = { phase: 'intro', env: 'production', focus: [], resolve: null, run: null, defs: [], waveIdx: 0 };
    navigate('overview');
    renderTour();
    renderTourInvite();
  }

  async function startTour() {
    const t = App.tour;
    if (!t || t.phase !== 'intro') return;
    const chosen = $('input[name="tour-env"]:checked');
    if (chosen) t.env = chosen.value;
    t.phase = 'running';
    renderTour();
    const map = $('.map-card');
    if (map) map.scrollIntoView({ block: 'start', behavior: 'smooth' });
    await startRun({ tour: { env: t.env } });
    if (App.tour === t && t.phase === 'running' && !App.engine.isRunning) { App.tour = null; renderTour(); } /* the run never started */
  }

  /* Called by the engine before each wave: show what is about to happen and wait for Continue. */
  function tourBeforeWave(defs, wi) {
    const t = App.tour;
    if (!t) return Promise.resolve();
    t.phase = 'paused';
    t.defs = defs;
    t.waveIdx = wi;
    t.focus = defs.map((d) => d.id);
    renderTour();
    renderPipeline();
    return new Promise((resolve) => { t.resolve = resolve; });
  }

  function tourNext() {
    const t = App.tour;
    if (!t || t.phase !== 'paused') return;
    t.phase = 'running';
    const go = t.resolve;
    t.resolve = null;
    renderTour();
    if (go) go();
  }

  function tourBreak(id) {
    const t = App.tour;
    if (!t || t.phase !== 'paused' || !stageById(id)) return;
    App.engine.forceFail = id;
    toast('info', 'Fault injected', `${stageById(id).name} will fail when it runs. Watch the line stop.`);
    tourNext();
  }

  function exitTour() {
    const t = App.tour;
    if (!t) return;
    App.tour = null;
    renderTour();
    renderPipeline();
    if (App.engine.isRunning && App.engine.run.drill === 'tour') App.engine.cancel();
  }

  function tourRunFinished(run) {
    const t = App.tour;
    if (!t) return;
    t.focus = [];
    t.run = { id: run.id, failedStage: run.failedStage };
    if (run.status === 'success') { t.phase = 'done'; profile().tourDone = true; Store.save(); checkAchievements(); }
    else if (run.status === 'failed') t.phase = 'failed';
    else App.tour = null;
    renderTour();
  }

  function renderTour() {
    const box = $('#tour');
    const t = App.tour;
    document.body.classList.toggle('has-tour', !!t);
    if (!t) { box.hidden = true; box.innerHTML = ''; return; }
    const D = App.tourData;
    const N = App.waves.length;
    const exit = `<button class="btn-icon tour-x" data-action="tour-exit" aria-label="Exit the tour">${icon('x')}</button>`;
    const dots = (cur) => `<div class="tour-dots" aria-hidden="true">${App.waves.map((_, i) => `<i class="${i < cur ? 'is-done' : i === cur ? 'is-cur' : ''}"></i>`).join('')}</div>`;
    const lines = (list) => `<ul class="tour-points">${list.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
    let html = '';

    if (t.phase === 'intro') {
      html = `<div class="flex items-start justify-between gap-3"><div><p class="eyebrow">Guided tour · ${N} stops</p><h2 class="tour-title">${esc(D.intro.title)}</h2></div>${exit}</div>
        <p>${esc(D.intro.text)}</p>${lines(D.intro.points)}
        <fieldset class="tour-env"><legend class="field-label">Ride to</legend><div class="flex flex-wrap gap-x-5 gap-y-1">${App.envs.map((e) =>
    `<label class="chk"><input type="radio" name="tour-env" value="${e.id}" ${e.id === t.env ? 'checked' : ''}> ${esc(e.name)}${e.gate ? ' · has an approval gate' : ''}</label>`).join('')}</div></fieldset>
        <div class="tour-actions flex flex-wrap gap-2 mt-4"><button class="btn btn-primary" data-action="tour-start">${icon('play', 'ic-fill')}<span>Start the tour</span></button>
          <button class="btn btn-outline" data-action="tour-exit"><span>Not now</span></button></div>`;
    } else if (t.phase === 'paused') {
      const par = t.defs.length > 1;
      const first = tourInfo(t.defs[0]);
      const block = (d) => {
        const i = tourInfo(d);
        return `<div class="tour-block"><div class="flex items-center gap-2"><span class="tile">${esc(d.code)}</span><h3>${esc(par ? `${d.name}: ${i.headline}` : d.name)}</h3></div>
          <p><b>In a real pipeline.</b> ${esc(i.real)}</p><p><b>Watch for.</b> ${esc(i.watch)}</p><p><b>Classic failure.</b> ${esc(i.risk)}</p></div>`;
      };
      html = `<div class="flex items-start justify-between gap-3"><div><p class="eyebrow">Stop ${t.waveIdx + 1} of ${N}${par ? ' · parallel' : ''}</p>
          <h2 class="tour-title">${esc(par ? `${t.defs.map((d) => d.short).join(' + ')}, side by side` : first.headline)}</h2></div>${exit}</div>
        ${dots(t.waveIdx)}
        ${par ? '<p class="tour-note">Fan-out: both stages start at the same moment on separate tracks. The next stop waits for both (fan-in), and if one fails the other is cancelled.</p>' : ''}
        ${t.defs.map(block).join('')}
        <div class="tour-actions flex flex-wrap items-center gap-2 mt-4"><button class="btn btn-primary" data-action="tour-next"><span>Continue</span>${icon('chevron')}</button>
          ${t.defs.filter((d) => d.kind !== 'gate').map((d) => `<button class="btn btn-outline" data-action="tour-break" data-stage="${d.id}">${icon('alert')}<span>Break ${esc(d.short)}</span></button>`).join('')}
          <span class="flex-1"></span><button class="btn btn-outline" data-action="tour-exit"><span>Exit tour</span></button></div>`;
    } else if (t.phase === 'running') {
      html = `<div class="flex items-center justify-between gap-3"><div class="flex items-center gap-3"><span class="spinner"></span><div>
          <p class="eyebrow">Stop ${t.waveIdx + 1} of ${N}</p><p class="tour-running">${t.defs.length ? `Running ${esc(t.defs.map((d) => d.name).join(' and '))}…` : 'Starting the run…'}</p></div></div>${exit}</div>`;
    } else if (t.phase === 'done') {
      html = `<div class="flex items-start justify-between gap-3"><div><p class="eyebrow">Tour complete</p><h2 class="tour-title">${esc(D.done.title)}</h2></div>${exit}</div>
        <p>${esc(D.done.text)}</p>${lines(D.done.points)}
        <p class="eyebrow mt-3 mb-2">Where next</p>
        <div class="flex flex-wrap gap-2">${D.next.map((n) => `<button class="btn btn-primary btn-sm" data-action="tour-go" data-view="${n.view}">${esc(n.label)}</button>`).join('')}
          <button class="btn btn-outline btn-sm" data-action="tour-exit"><span>Close</span></button></div>`;
    } else {
      const st = t.run && stageById(t.run.failedStage);
      html = `<div class="flex items-start justify-between gap-3"><div><p class="eyebrow">Tour · ${esc(t.run ? t.run.id : '')}</p><h2 class="tour-title">${esc(D.failed.title)}</h2></div>${exit}</div>
        <p>${esc(D.failed.text.replace('{stage}', st ? st.name : 'a stage'))}</p>
        <div class="flex flex-wrap gap-2 mt-3"><button class="btn btn-primary btn-sm" data-action="tour-go" data-view="drills">Practise an incident drill</button>
          <button class="btn btn-outline btn-sm" data-action="tour-exit"><span>Close</span></button></div>`;
    }
    box.hidden = false;
    box.innerHTML = html;
    const focusEl = $('[data-action="tour-next"], [data-action="tour-start"]', box);
    if (focusEl) focusEl.focus({ preventScroll: true });
  }

  function renderTourInvite() {
    const box = $('#tour-invite');
    if (!box) return;
    box.innerHTML = prefs().tourSeen || App.tour ? '' : `<div class="card tour-invite" role="note">
      <div><p class="eyebrow">New here?</p><h2 class="display text-[24px] leading-7 mt-1">Take the guided tour</h2>
        <p class="text-muted text-sm mt-1">Ride a simulated pipeline run that stops at every station and explains what a real CI/CD pipeline does there. It takes a couple of minutes.</p></div>
      <div class="flex flex-wrap gap-2"><button class="btn btn-primary" data-action="tour-open">${icon('play', 'ic-fill')}<span>Start the tour</span></button>
        <button class="btn btn-outline" data-action="tour-dismiss"><span>Maybe later</span></button></div></div>`;
  }

  /* --- rollout strategies: canary and blue/green get a real progressive rollout on the Deploy stage --- */
  const STRATEGY_KINDS = { canary: 'canary', 'blue / green': 'bluegreen', 'rolling update': 'rolling', recreate: 'recreate' };
  const STRATEGY_LABELS = { canary: 'Canary', bluegreen: 'Blue / green', rolling: 'Rolling update', recreate: 'Recreate' };

  function strategyKind(env) {
    const pref = prefs().strategy;
    return pref !== 'env' ? pref : STRATEGY_KINDS[String(env.strategy).toLowerCase()] || 'rolling';
  }

  function normalizeRollout(cfg) {
    const num = (v, d, min = 0) => (Number.isFinite(Number(v)) && Number(v) > min ? Number(v) : d);
    const c = (cfg && cfg.canary) || {};
    const b = (cfg && cfg.bluegreen) || {};
    const stepsOk = Array.isArray(c.steps) && c.steps.length && c.steps.every((n, i, a) => Number.isFinite(n) && n > 0 && n <= 100 && (!i || n > a[i - 1])) && c.steps[c.steps.length - 1] === 100;
    return {
      canary: { steps: stepsOk ? c.steps : [10, 50, 100], soakSec: num(c.soakSec, 3), standbySec: num(c.standbySec, 0.8), errorBudgetPct: num(c.errorBudgetPct, 2), baselinePct: num(c.baselinePct, 0.2, -1) },
      bluegreen: { soakSec: num(b.soakSec, 2), standbySec: num(b.standbySec, 1.2), errorBudgetPct: num(b.errorBudgetPct, 2), baselinePct: num(b.baselinePct, 0.2, -1) }
    };
  }

  function rolloutPlan(env) {
    const kind = strategyKind(env);
    if (kind !== 'canary' && kind !== 'bluegreen') return null;
    const c = App.rolloutCfg[kind];
    const live = liveBuild(env.id);
    return {
      kind, steps: kind === 'canary' ? c.steps : [100], soakMs: c.soakSec * 1000, standbyMs: c.standbySec * 1000,
      budgetPct: c.errorBudgetPct, baselinePct: c.baselinePct, stable: live ? short(live.commit.hash) : 'previous'
    };
  }

  /* The panel shown on the Overview while traffic is being shifted. */
  const pctFmt = (n) => `${n.toFixed(n < 10 ? 2 : 1)}%`;

  function renderRollout() {
    const box = $('#rollout-panel');
    const R = App.engine && App.engine.rollout;
    if (!R) { box.innerHTML = ''; return; }
    const run = App.engine.run;
    const env = envById(run.envId);
    const canary = R.kind === 'canary';
    box.innerHTML = `<section class="card rollout" data-line="${env.line}" role="group" aria-label="Rollout in progress">
      <div class="flex flex-wrap items-start justify-between gap-3"><div class="min-w-0">
        <p class="eyebrow">${canary ? 'Canary rollout' : 'Blue / green release'} <span class="sim-tag">Simulated</span></p>
        <h2 class="display text-[26px] leading-8 mt-1">Shifting traffic to <span class="mono">${esc(R.commit)}</span> on ${esc(env.name)}</h2>
        <p class="text-muted text-sm mt-1">${esc(run.id)} · stable release <span class="mono">${esc(R.stable)}</span> keeps serving the rest.</p></div>
        <span class="flap" id="ro-status">Starting</span></div>
      <div class="ro-bar mt-4" role="img" aria-label="Traffic split between the stable and the new version"><span class="ro-stable" id="ro-stable"></span><span class="ro-new" id="ro-new"></span></div>
      <div class="flex justify-between text-sm mt-1"><span>Stable <b id="ro-stable-pct"></b></span><span>New <b id="ro-new-pct"></b></span></div>
      <ol class="ro-steps mt-3" aria-label="Traffic steps">${R.steps.map((p, i) => `<li class="ro-step ${i < R.stepIdx ? 'is-done' : i === R.stepIdx ? 'is-cur' : ''}">${p}%</li>`).join('')}</ol>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div><p class="eyebrow mb-1">Error rate of the new version · budget ${R.budgetPct}%</p>
          <svg id="ro-spark" class="ro-spark" viewBox="0 0 300 72" role="img" aria-label="Error rate of the new version over the last samples"></svg>
          <p class="ro-metrics mono"><span>New <b id="ro-new-err"></b></span><span>Stable <b id="ro-base-err"></b></span></p></div>
        <div class="flex flex-wrap items-end gap-2 md:justify-end">
          <button class="btn btn-outline" data-action="ro-promote">${icon('chevron')}<span>Promote now</span></button>
          <button class="btn btn-danger" data-action="ro-abort">${icon('rollback')}<span>Abort and roll back</span></button></div></div></section>`;
    updateRolloutLive();
  }

  function updateRolloutLive() {
    const R = App.engine.rollout;
    if (!R || !$('#ro-new')) return;
    $('#ro-new').style.width = `${R.traffic}%`;
    $('#ro-stable').style.width = `${100 - R.traffic}%`;
    $('#ro-new-pct').textContent = `${R.traffic}%`;
    $('#ro-stable-pct').textContent = `${100 - R.traffic}%`;
    $('#ro-new-err').textContent = pctFmt(R.newPct);
    $('#ro-base-err').textContent = pctFmt(R.basePct);
    const over = R.newPct > R.budgetPct || R.phase === 'rollback';
    const status = $('#ro-status');
    status.className = `flap ${over ? 'flap-failed' : R.phase === 'deploying' ? 'flap-idle' : 'flap-success'}`;
    status.textContent = R.phase === 'rollback' ? 'Rolling back' : R.phase === 'deploying' ? 'Starting' : over ? 'Over budget' : 'Healthy';
    const pts = R.samples.slice(-30);
    const max = Math.max(R.budgetPct * 3, ...pts.map((s) => s.newPct));
    const y = (v) => 66 - (v / max) * 60;
    $('#ro-spark').innerHTML = `<line class="ro-budget" x1="0" x2="300" y1="${y(R.budgetPct)}" y2="${y(R.budgetPct)}"/>${pts.length > 1
      ? `<polyline class="ro-line" points="${pts.map((s, i) => `${(i / (pts.length - 1)) * 300},${y(s.newPct)}`).join(' ')}"/>` : ''}`;
  }

  function onRolloutEvent(ev) {
    chatRolloutEvent(ev);
    if (ev.type === 'sample') updateRolloutLive();
    else renderRollout();
  }

  /* --- chaos mode: random incidents strike a live environment and you have to triage them --- */
  const chaos = { armed: false, timer: null, tick: null }; /* runtime only: chaos is never armed on page load */
  const incAction = (id) => App.chaosCfg.actions.find((a) => a.id === id);
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const liveEnvs = () => App.envs.filter((e) => liveBuild(e.id));

  const chaosBusy = () => App.engine.isRunning || App.launching || !!App.tour || (App.drill && App.drill.phase !== 'done') || !!App.incident;

  function renderChaosState() {
    const nav = $('.nav-item[data-view="chaos"]');
    if (nav) nav.classList.toggle('is-armed', chaos.armed);
    if (prefs().view === 'chaos') { renderChaos(); $('#view-sub').textContent = VIEWS.chaos.sub(); }
  }

  function armChaos() {
    if (chaos.armed) return;
    if (!liveEnvs().length) { toast('info', 'Nothing to break yet', 'Chaos needs a live build. Run the pipeline once, then arm it.'); return; }
    chaos.armed = true;
    scheduleStrike();
    renderChaosState();
    chatPost({ ch: 'incidents', text: 'Chaos mode is *armed*. Something will break when you least expect it.' });
    toast('info', 'Chaos armed', 'Something will break when you least expect it.');
  }

  function disarmChaos() {
    if (chaos.armed) chatPost({ ch: 'incidents', text: 'Chaos mode is *disarmed*.' });
    chaos.armed = false;
    clearTimeout(chaos.timer);
    chaos.timer = null;
    renderChaosState();
  }

  function scheduleStrike(delayMs) {
    clearTimeout(chaos.timer);
    const cfg = App.chaosCfg.intensity[prefs().chaosIntensity] || App.chaosCfg.intensity.normal;
    chaos.timer = setTimeout(() => strikeIncident(false), delayMs != null ? delayMs : rand(cfg.minSec, cfg.maxSec) * 1000);
  }

  function incLog(text, level = 'info') {
    App.incident.log.push({ t: Date.now(), text, level });
  }

  function strikeIncident(force) {
    if (!chaos.armed && !force) return;
    if (chaosBusy()) { if (chaos.armed) scheduleStrike(4000); return; } /* never interrupt a run, drill or tour */
    const envs = liveEnvs();
    if (!envs.length) { if (chaos.armed) scheduleStrike(8000); return; }
    const env = envs[randInt(0, envs.length - 1)];
    const live = liveBuild(env.id);
    const pool = App.chaosCfg.incidents.filter((d) => !d.needsRelease || rollbackTarget(env.id));
    const last = Store.state.incidents[0];
    const fresh = pool.filter((d) => !last || d.id !== last.type);
    const choices = fresh.length ? fresh : pool;
    const def = choices[randInt(0, choices.length - 1)];
    const ctx = { env: env.name, commit: short(live.commit.hash), ago: fmtAgo(live.startedAt) };
    App.incident = {
      id: `INC-${Store.state.nextInc++}`, def, envId: env.id, ctx, startedAt: Date.now(), t0: performance.now(), phase: 'active',
      wrong: [], log: [], err: 0.2, lat: 180, errHist: [0.2], latHist: [180], burn: 0, cause: def.needsRelease ? live.id : null, action: null, result: null
    };
    Store.save();
    incLog(`Alert fired on ${env.name}: ${fill(def.title, ctx)}.`, 'error');
    clearInterval(chaos.tick);
    chaos.tick = setInterval(incidentTick, 500);
    chatUI.incMsg = chatPost({
      ch: 'incidents', text: `@here incident on *${env.name}*`, mention: true,
      card: {
        color: 'red', title: `${App.incident.id} · ${def.severity}: ${fill(def.title, ctx)}`, sub: env.name,
        fields: [['First symptom', def.symptoms[0]]], status: 'Investigating', buttons: [{ label: 'Open incident', act: 'nav', arg: 'chaos', kind: 'primary' }]
      }
    });
    toast('error', `Incident on ${env.name}`, fill(def.title, ctx), 8000);
    renderIncident();
    renderChaosState();
    if (prefs().view === 'environment') updateNetwork();
  }

  /* Metrics drift towards the incident's peak, or back to normal while a fix is taking hold. */
  function incidentTick() {
    const inc = App.incident;
    if (!inc || inc.phase === 'resolved') { clearInterval(chaos.tick); return; }
    const mitigating = inc.phase === 'mitigating';
    const target = mitigating ? { err: 0.2, lat: 180 } : inc.def.peak;
    const k = mitigating ? 0.45 : 0.3;
    inc.err = Math.max(0.1, inc.err + (target.err - inc.err) * k + (Math.random() - 0.5) * 0.15);
    inc.lat = Math.max(120, inc.lat + ((target.lat === undefined ? 180 : target.lat) - inc.lat) * k + (Math.random() - 0.5) * 14);
    inc.errHist.push(inc.err);
    inc.latHist.push(inc.lat);
    if (inc.errHist.length > 40) { inc.errHist.shift(); inc.latHist.shift(); }
    inc.burn += 0.5 * inc.err * 0.012; /* error budget burned: faster when more requests fail */
    updateIncidentLive();
  }

  async function incidentAct(actionId) {
    const inc = App.incident;
    if (!inc || inc.phase !== 'active') return;
    const act = incAction(actionId);
    if (!act) return;
    if (!inc.def.fixes.includes(actionId)) {
      inc.wrong.push(actionId);
      inc.err = Math.min(inc.def.peak.err * 1.4, inc.err * 1.2);
      const why = inc.def.wrong[actionId] || App.chaosCfg.defaultWrong;
      incLog(`${act.label}: ${why}`, 'warn');
      toast('error', 'That did not help', why, 6000);
      renderIncident();
      return;
    }
    inc.phase = 'mitigating';
    inc.action = actionId;
    incLog(`${act.label}: ${fill(inc.def.fixText, inc.ctx)}`, 'success');
    renderIncident();
    if (actionId === 'rollback') {
      const rt = rollbackTarget(inc.envId);
      await startRun({ rollback: rt });
      const rec = history()[0];
      if (!rt || !rec || rec.status !== 'success' || !rec.rollbackFrom) {
        inc.phase = 'active';
        incLog('The rollback did not complete. Try again.', 'warn');
        renderIncident();
        return;
      }
      await pause(1200);
    } else {
      await pause(act.durationMs);
    }
    if (App.incident === inc) resolveIncident();
  }

  function resolveIncident() {
    const inc = App.incident;
    if (!inc || inc.phase === 'resolved') return;
    inc.phase = 'resolved';
    inc.resolvedAt = Date.now();
    clearInterval(chaos.tick);
    const ttm = inc.resolvedAt - inc.startedAt;
    const par = App.chaosCfg.parSec;
    const score = Math.max(0, Math.round(100 - inc.wrong.length * 20 - Math.max(0, ttm / 1000 - par) * 1.5));
    const rating = score >= 90 ? 'S' : score >= 70 ? 'A' : score >= 50 ? 'B' : 'C';
    inc.result = { ttm, score, rating };
    incLog(`Service restored in ${fmtDur(ttm)}.`, 'success');
    Store.state.incidents.unshift({
      id: inc.id, type: inc.def.id, title: fill(inc.def.title, inc.ctx), env: inc.envId, startedAt: inc.startedAt, resolvedAt: inc.resolvedAt,
      ttmMs: ttm, wrong: inc.wrong.length, burn: Math.round(inc.burn * 100) / 100, score, rating, action: inc.action, cause: inc.cause, commit: inc.ctx.commit
    });
    if (Store.state.incidents.length > 60) Store.state.incidents.length = 60;
    Store.save();
    if (chatUI.incMsg) {
      chatUpdate(chatUI.incMsg, { card: { color: 'green', title: `${inc.id} resolved in ${fmtDur(ttm)}`, status: `Fixed with ${(incAction(inc.action) || { label: 'a mitigation' }).label}. Rating ${rating}, ${inc.wrong.length} wrong call${inc.wrong.length === 1 ? '' : 's'}.`, buttons: [] } });
      chatUI.incMsg = null;
    }
    checkAchievements();
    toast('success', 'Service restored', `${inc.id} resolved in ${fmtDur(ttm)} · rating ${rating}.`);
    renderIncident();
    renderChaosState();
    if (prefs().view === 'environment') updateNetwork();
    if (prefs().view === 'metrics') renderMetrics();
  }

  function dismissIncident() {
    if (!App.incident || App.incident.phase !== 'resolved') return;
    App.incident = null;
    renderIncident();
    renderChaosState();
    $('#incident-chip').hidden = true;
    if (prefs().view === 'environment') updateNetwork();
    if (chaos.armed) scheduleStrike();
  }

  const sparkPoints = (vals, floorMax) => {
    const max = Math.max(floorMax, ...vals);
    const y = (v) => 62 - (v / max) * 56;
    return vals.length > 1 ? vals.map((v, i) => `${(i / (vals.length - 1)) * 300},${y(v)}`).join(' ') : '';
  };

  function updateIncidentLive() {
    const inc = App.incident;
    const chip = $('#incident-chip');
    if (!inc) { chip.hidden = true; return; }
    const live = inc.phase !== 'resolved';
    chip.hidden = !live;
    const elapsed = live ? performance.now() - inc.t0 : inc.result.ttm;
    if (live) chip.textContent = `INCIDENT · ${envById(inc.envId).name} · ${mmss(elapsed)}`;
    $$('.inc-timer').forEach((el) => { el.textContent = mmss(elapsed); });
    $$('.inc-burn').forEach((el) => { el.textContent = `${inc.burn.toFixed(2)}%`; });
    $$('.inc-err-val').forEach((el) => { el.textContent = `${inc.err.toFixed(1)}%`; });
    $$('.inc-lat-val').forEach((el) => { el.textContent = `${Math.round(inc.lat)} ms`; });
    $$('.inc-spark-err').forEach((el) => { el.setAttribute('points', sparkPoints(inc.errHist, 4)); });
    $$('.inc-spark-lat').forEach((el) => { el.setAttribute('points', sparkPoints(inc.latHist, 600)); });
    $$('.inc-log').forEach((el) => { el.innerHTML = incLogHTML(inc); });
  }

  const incLogHTML = (inc) => inc.log.slice(-6).map((l) => `<li class="inc-log-${l.level}"><span class="mono">${fmtClock(new Date(l.t))}</span> ${esc(l.text)}</li>`).join('');

  function incidentHTML() {
    const inc = App.incident;
    const def = inc.def;
    const env = envById(inc.envId);
    const title = fill(def.title, inc.ctx);
    if (inc.phase === 'resolved') {
      const r = inc.result;
      const fix = incAction(inc.action);
      return `<section class="card incident is-resolved" data-line="${env.line}" role="status">
        <div class="debrief"><span class="rating rating-lg rating-${r.rating}" aria-label="Rating ${r.rating}">${r.rating}</span>
          <div><p class="eyebrow">${esc(inc.id)} · resolved <span class="sim-tag">Chaos</span></p><h2 class="display text-[26px] leading-8">Service restored in ${fmtDur(r.ttm)}</h2>
            <p class="text-muted text-sm">${esc(title)} · ${esc(env.name)}</p></div></div>
        <dl class="kv mt-3"><dt>Fix applied</dt><dd>${esc(fix ? fix.label : '—')}</dd><dt>Wrong calls</dt><dd>${inc.wrong.length}</dd>
          <dt>Budget burned</dt><dd class="mono">${inc.burn.toFixed(2)}% of this month's error budget</dd><dt>Score</dt><dd class="mono">${r.score} / 100 (par ${App.chaosCfg.parSec}s)</dd></dl>
        <p class="eyebrow mt-3 mb-1">What happened</p><p>${esc(def.explanation)}</p>
        <p class="eyebrow mt-3 mb-1">Lesson</p><p class="font-semibold">${esc(def.lesson)}</p>
        <div class="flex flex-wrap gap-2 mt-4"><button class="btn btn-primary" data-action="inc-dismiss">${icon('check')}<span>Close</span></button>
          <button class="btn btn-outline" data-action="nav" data-view="metrics">${icon('chart')}<span>See it in DORA</span></button></div></section>`;
    }
    const busy = inc.phase !== 'active';
    const rt = rollbackTarget(inc.envId);
    return `<section class="card incident" data-line="${env.line}" role="alert" aria-label="Incident in progress">
      <div class="flex flex-wrap items-start justify-between gap-3"><div class="min-w-0">
        <p class="eyebrow">${esc(inc.id)} · ${esc(def.severity)} severity <span class="sim-tag">Chaos</span></p>
        <h2 class="display text-[26px] leading-8 mt-1">${esc(title)}</h2><p class="text-muted text-sm mt-1">${esc(env.name)} · detected just now · pick a mitigation</p></div>
        <div class="text-right"><span class="mono font-semibold text-[22px] inc-timer"></span><p class="text-muted text-[13px]">Error budget burned <b class="inc-burn"></b></p></div></div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
        <div><p class="eyebrow mb-1">Symptoms</p><ul class="inc-list">${def.symptoms.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
          <p class="eyebrow mt-3 mb-1">What the dashboards show</p><ul class="inc-list">${def.evidence.map((s) => `<li>${esc(fill(s, inc.ctx))}</li>`).join('')}</ul></div>
        <div class="grid grid-cols-1 gap-3">
          <div><div class="flex justify-between text-sm"><span class="eyebrow">Error rate</span><b class="mono inc-err-val"></b></div><svg class="ro-spark" viewBox="0 0 300 66" role="img" aria-label="Error rate"><polyline class="ro-line inc-spark-err" points=""/></svg></div>
          <div><div class="flex justify-between text-sm"><span class="eyebrow">p95 latency</span><b class="mono inc-lat-val"></b></div><svg class="ro-spark" viewBox="0 0 300 66" role="img" aria-label="Latency"><polyline class="ro-line inc-spark-lat" points=""/></svg></div></div></div>
      <p class="eyebrow mt-4 mb-2">${inc.phase === 'mitigating' ? 'Fix in progress…' : 'Your move'}</p>
      <div class="inc-actions">${App.chaosCfg.actions.map((a) => {
    const off = busy || (a.id === 'rollback' && (!rt || App.engine.isRunning));
    return `<button class="inc-act${inc.wrong.includes(a.id) ? ' is-wrong' : ''}${inc.action === a.id ? ' is-fix' : ''}" data-action="inc-act" data-id="${a.id}" ${off ? 'disabled' : ''}>${icon(a.icon)}<span><b>${esc(a.label)}</b><small>${esc(a.hint)}</small></span></button>`;
  }).join('')}</div>
      <ol class="inc-log mt-3" aria-label="Incident timeline"></ol></section>`;
  }

  function renderIncident() {
    const html = App.incident ? incidentHTML() : '';
    $$('.incident-slot').forEach((el) => { el.innerHTML = html; });
    updateIncidentLive();
  }

  function renderChaos() {
    const box = $('#chaos-view');
    if (!box) return;
    const list = Store.state.incidents;
    const avg = list.length ? list.reduce((a, i) => a + i.ttmMs, 0) / list.length : null;
    const wrong = list.reduce((a, i) => a + i.wrong, 0);
    const best = list.length ? ['S', 'A', 'B', 'C'].find((r) => list.some((i) => i.rating === r)) : null;
    const inten = prefs().chaosIntensity;
    box.innerHTML = `<section class="card chaos-card${chaos.armed ? ' is-armed' : ''}">
        <div class="flex flex-wrap items-start justify-between gap-4"><div class="min-w-0" style="max-width:60ch">
          <p class="eyebrow">Game day <span class="sim-tag">Simulated</span></p>
          <h2 class="display text-[30px] leading-8 mt-1">Chaos mode</h2>
          <p class="text-muted text-sm mt-2">While armed, a random incident strikes one of your live environments with no warning: a bad release, a memory leak, a traffic spike, a failing dependency or an expired certificate. Read the symptoms, pick the right mitigation, and be quick. Every call is scored, and your time to restore feeds the DORA board.</p></div>
          <div class="flex flex-col items-start gap-2 md:items-end"><span class="flap ${chaos.armed ? 'flap-failed' : 'flap-idle'}">${chaos.armed ? 'Armed' : 'Disarmed'}</span>
            <button class="btn ${chaos.armed ? 'btn-outline' : 'btn-danger'}" data-action="chaos-toggle">${icon(chaos.armed ? 'x' : 'bolt')}<span>${chaos.armed ? 'Disarm chaos' : 'Arm chaos mode'}</span></button>
            <button class="btn btn-outline btn-sm" data-action="chaos-strike" ${chaos.armed && !App.incident ? '' : 'disabled'}>${icon('alert')}<span>Strike now</span></button></div></div>
        <div class="field mt-4" style="margin-bottom:0"><span class="field-label">Intensity</span>
          <div class="seg" style="max-width:380px">${Object.entries(App.chaosCfg.intensity).map(([k, v]) => `<label><input type="radio" name="chaos-int" value="${k}" data-pref="chaosIntensity" ${k === inten ? 'checked' : ''}><span>${esc(v.label)} · ${v.minSec}–${v.maxSec}s</span></label>`).join('')}</div>
          <p class="field-hint">How long it usually takes between incidents. Chaos never interrupts a running pipeline, drill or tour; it waits.</p></div></section>
      <div class="incident-slot mt-4"></div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        ${[['Incidents handled', list.length, 'All time'], ['Avg time to restore', avg == null ? '—' : fmtSpan(avg), 'Fault to service restored'], ['Wrong calls', wrong, 'Mitigations that did not help'], ['Best rating', best || '—', 'Across all incidents']]
    .map(([l, v, n]) => `<div class="card stat"><span class="stat-value">${v}</span><span class="stat-label">${l}</span><span class="stat-note">${n}</span></div>`).join('')}</div>
      <section class="card mt-4">${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Incident</th><th>What happened</th><th>Environment</th><th>Fix</th><th>Time to restore</th><th>Wrong calls</th><th>Rating</th></tr></thead>
        <tbody>${list.slice(0, 12).map((i) => `<tr style="cursor:default"><td class="mono font-semibold">${esc(i.id)}</td><td>${esc(i.title)}</td><td>${envPill(i.env)}</td><td>${esc((incAction(i.action) || {}).label || '—')}</td>
          <td class="mono">${fmtSpan(i.ttmMs)}</td><td>${i.wrong}</td><td><span class="rating rating-${i.rating}">${i.rating}</span></td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty"><img src="assets/images/line-map.svg" alt=""><h3>No incidents yet</h3><p>Arm chaos mode and wait, or press Strike now. Resolved incidents are listed here.</p></div>`}</section>`;
    renderIncident();
  }

  /* --- ChatOps: a simulated chat workspace fed by pipeline events, driven by slash commands --- */
  const CHAT_MAX = 160;
  const chatUI = { open: false, ch: 'deployments', unread: { deployments: 0, incidents: 0 }, mention: false, runMsg: {}, lastText: {}, gateMsg: null, incMsg: null };
  const CHAT_COMMANDS = [
    ['/help', 'List the commands'], ['/status', 'Live builds and what is running'], ['/deploy <env>', 'Run the pipeline to an environment'],
    ['/rollback <env>', 'Return to the previous build'], ['/promote <from> <to>', 'Carry the live build to the next line'],
    ['/approve', 'Approve the waiting deployment'], ['/reject [reason]', 'Reject the waiting deployment'],
    ['/retry', 'Retry the last failed run'], ['/cancel', 'Cancel the running pipeline'], ['/dora', 'Delivery metrics, last 7 days']
  ];

  function chatPost(msg) {
    const m = { id: `m${Store.state.nextMsg++}`, t: Date.now(), who: 'bot', ch: 'deployments', ...msg };
    Store.state.chat.push(m);
    if (Store.state.chat.length > CHAT_MAX) Store.state.chat.splice(0, Store.state.chat.length - CHAT_MAX);
    if (m.who === 'bot' && !(chatUI.open && chatUI.ch === m.ch)) {
      chatUI.unread[m.ch] += 1;
      if (m.mention) chatUI.mention = true;
    }
    Store.save();
    renderChat();
    return m.id;
  }

  function chatUpdate(id, patch, save = true) {
    const m = Store.state.chat.find((x) => x.id === id);
    if (!m) return;
    const { card, ...rest } = patch;
    Object.assign(m, rest);
    if (card) m.card = { ...m.card, ...card };
    if (save) Store.save();
    renderChat();
  }

  const fmtChat = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*([^*]+)\*/g, '<b>$1</b>').replace(/@here/g, '<span class="chat-mention">@here</span>');

  function msgHTML(m) {
    const bot = m.who === 'bot';
    const c = m.card;
    return `<div class="msg ${bot ? 'is-bot' : 'is-you'}"><span class="msg-av" aria-hidden="true"${bot ? '' : ` style="${avatarStyle(profile().color)}"`}>${bot ? 'DX' : esc(initials(profile().name))}</span><div class="msg-body">
      <div class="msg-head"><b>${bot ? 'DeployX Bot' : esc(profile().name)}</b>${bot ? '<span class="msg-app">APP</span>' : ''}<time>${fmtClock(new Date(m.t)).slice(0, 5)}</time></div>
      ${m.text ? `<p class="msg-text">${fmtChat(m.text)}</p>` : ''}
      ${c ? `<div class="msg-card is-${c.color || 'grey'}"><p class="msg-card-title">${fmtChat(c.title)}</p>${c.sub ? `<p class="msg-card-sub">${esc(c.sub)}</p>` : ''}
        ${c.fields && c.fields.length ? `<dl class="msg-fields">${c.fields.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
        ${c.status ? `<p class="msg-status">${esc(c.status)}</p>` : ''}
        ${c.buttons && c.buttons.length ? `<div class="msg-btns">${c.buttons.map((b, i) => `<button type="button" class="msg-btn ${b.kind || ''}" data-action="chat-btn" data-msg="${m.id}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>` : ''}</div>` : ''}
    </div></div>`;
  }

  function renderChat() {
    const total = chatUI.unread.deployments + chatUI.unread.incidents;
    const badge = $('#chat-badge');
    if (badge) {
      badge.hidden = !total;
      badge.textContent = total > 9 ? '9+' : String(total);
      badge.classList.toggle('is-mention', chatUI.mention);
    }
    $$('.chat-tab').forEach((t) => {
      const n = chatUI.unread[t.dataset.ch];
      $('.chat-tab-n', t).textContent = n ? String(n) : '';
      t.setAttribute('aria-selected', String(t.dataset.ch === chatUI.ch));
    });
    if (!chatUI.open) return;
    const list = $('#chat-list');
    const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const msgs = Store.state.chat.filter((m) => m.ch === chatUI.ch);
    list.innerHTML = msgs.length ? msgs.map(msgHTML).join('') : '<p class="chat-empty">Nothing here yet.</p>';
    if (stick) list.scrollTop = list.scrollHeight;
  }

  function chatToggle() {
    chatUI.open = !chatUI.open;
    $('#chat').hidden = !chatUI.open;
    document.body.classList.toggle('chat-open', chatUI.open);
    if (chatUI.open) {
      chatUI.unread[chatUI.ch] = 0;
      chatUI.mention = chatUI.unread.deployments + chatUI.unread.incidents > 0 ? chatUI.mention : false;
      renderChat();
      const list = $('#chat-list');
      list.scrollTop = list.scrollHeight;
      $('#chat-input').focus();
    } else renderChat();
  }

  function chatChannel(ch) {
    chatUI.ch = ch;
    chatUI.unread[ch] = 0;
    chatUI.mention = chatUI.unread.deployments + chatUI.unread.incidents > 0 && chatUI.mention;
    renderChat();
    const list = $('#chat-list');
    list.scrollTop = list.scrollHeight;
  }

  /* One card per run. Seeded history records and live runs both go through here. */
  function finalCard(r) {
    const envId = r.envId || r.environment;
    const env = envById(envId);
    const kind = r.rollbackFrom ? 'Rollback' : r.promotedFrom ? 'Promotion' : r.retryOf ? 'Retry' : 'Deploy';
    const dur = fmtDur(r.durationMs);
    const passed = r.stages.filter((s) => s.status === 'success').length;
    const card = { sub: r.commit.message, fields: [['Branch', r.branch], ['Commit', short(r.commit.hash)], ['Author', r.commit.author]], buttons: [{ label: 'View details', act: 'detail', arg: r.id }] };
    if (r.status === 'success') {
      return { ...card, color: 'green', title: `${kind === 'Rollback' ? 'Rolled back' : 'Deployed'} ${r.id} to ${env.name}`, status: `Succeeded in ${dur} · ${passed} of ${r.stages.length} stages passed` };
    }
    if (r.status === 'failed') {
      const st = stageById(r.failedStage);
      return {
        ...card, color: 'red', title: `${kind} ${r.id} failed at ${st ? st.name : r.failedStage || 'a stage'}`,
        status: `${r.error ? `${r.error.code}: ${r.error.message}` : 'Failed'}${r.autoRollback ? ' Traffic was rolled back automatically.' : ''}`,
        buttons: [{ label: 'Retry', act: 'retry', kind: 'primary' }, { label: 'View details', act: 'detail', arg: r.id }]
      };
    }
    return {
      ...card, color: r.declined ? 'amber' : 'grey',
      title: r.declined === 'timeout' ? `${r.id} was not approved in time` : r.declined ? `${r.id} was rejected at the approval gate` : `${r.id} was cancelled`,
      status: `Nothing was deployed to ${env.name}.`, buttons: [{ label: 'Retry', act: 'retry', kind: 'primary' }, { label: 'View details', act: 'detail', arg: r.id }]
    };
  }

  function chatSeed() {
    const S = Store.state;
    if (S.chat.length) return;
    const add = (m) => S.chat.push({ id: `m${S.nextMsg++}`, who: 'bot', ch: 'deployments', t: Date.now(), ...m });
    add({ t: Date.now() - 7 * 3600e3, text: 'Welcome to the DeployX workspace. I post deploys, approvals, rollbacks and incidents here, and you can run them with slash commands. Type `/help` to see what I can do.' });
    S.history.filter((r) => !r.drill).slice(0, 5).reverse().forEach((r) => {
      const card = finalCard(r);
      add({ t: new Date(r.finishedAt || r.startedAt).getTime(), card: { ...card, buttons: card.buttons.filter((b) => b.act === 'detail') } });
    });
    Store.save();
  }

  /* --- events from the pipeline, approvals, rollouts and chaos --- */
  function chatRunStart({ id, env, branch, commit, kind }) {
    chatUI.runMsg[id] = chatPost({
      text: `${kind} started for *${env.name}*`,
      card: { color: 'blue', title: `${kind} ${id} to ${env.name}`, sub: commit.message, fields: [['Branch', branch], ['Commit', short(commit.hash)], ['Author', commit.author]], status: 'Starting' }
    });
  }

  function chatRunProgress(run) {
    const mid = chatUI.runMsg[run.id];
    if (!mid || run.status !== 'running') return;
    const done = run.stages.filter((s) => s.status === 'success' || s.status === 'skipped').length;
    const live = run.stages.filter((s) => s.status === 'running').map((s) => (stageById(s.id) || { name: s.id }).name);
    const R = App.engine.rollout;
    const text = R ? `Rolling out: ${R.traffic}% of traffic on ${R.commit}` : App.engine.gateState ? 'Waiting for approval' : live.length ? `Running ${live.join(' + ')} (${done} of ${run.stages.length} done)` : 'Starting';
    if (chatUI.lastText[run.id] === text) return;
    chatUI.lastText[run.id] = text;
    chatUpdate(mid, { card: { status: text } }, false);
  }

  function chatRunFinished(run) {
    const mid = chatUI.runMsg[run.id];
    if (!mid) return;
    const record = recordById(run.id) || run;
    chatUpdate(mid, { card: finalCard({ ...record, envId: run.envId, stages: run.stages, durationMs: run.durationMs }) });
    if (chatUI.gateMsg) {
      chatUpdate(chatUI.gateMsg, { card: { color: run.declined === 'timeout' ? 'grey' : 'red', title: run.declined === 'timeout' ? 'Approval timed out' : 'Deployment not approved', status: run.declined ? 'The run was stopped at the gate.' : 'The run ended before approval.', buttons: [] } });
      chatUI.gateMsg = null;
    }
    if (run.status === 'failed' && run.envId === 'production') {
      chatPost({ text: `@here *Production* deploy ${run.id} failed at ${(stageById(run.failedStage) || { name: run.failedStage }).name}.${run.autoRollback ? ' Traffic was rolled back automatically.' : ''}`, mention: true });
    }
    delete chatUI.runMsg[run.id];
    delete chatUI.lastText[run.id];
  }

  function chatGateEvent(ev) {
    const g = ev.g;
    if (ev.type === 'open') {
      const run = App.engine.run;
      chatUI.gateMsg = chatPost({
        text: `@here approval needed for *${g.envName}*`, mention: true,
        card: {
          color: 'amber', title: `Approval needed: ${g.envName}`, sub: `${run.id} · ${short(run.commit.hash)} ${run.commit.message}`,
          fields: [['Needs', `${g.required} approval${g.required > 1 ? 's' : ''}`], ['Author', g.author], ['Reviewers', g.approvers.join(', ')]],
          status: `0 of ${g.required} approvals · times out in ${Math.round(g.timeoutMs / 1000)}s`,
          buttons: [{ label: 'Approve', act: 'approve', kind: 'primary' }, { label: 'Reject', act: 'reject', kind: 'danger' }]
        }
      });
    } else if (ev.type === 'update' && chatUI.gateMsg) {
      chatUpdate(chatUI.gateMsg, { card: { status: `${g.approvals.length} of ${g.required} approvals · ${g.approvals.map((a) => a.name).join(', ')}` } });
    } else if (ev.type === 'close' && chatUI.gateMsg && ev.g && ev.g.approvals.length >= ev.g.required) {
      chatUpdate(chatUI.gateMsg, { card: { color: 'green', title: `Approved: ${ev.g.envName}`, status: `Approved by ${ev.g.approvals.map((a) => a.name).join(' and ')}`, buttons: [] } });
      chatUI.gateMsg = null;
    }
  }

  function chatRolloutEvent(ev) {
    const r = ev.r;
    if (ev.type === 'phase' && r.phase === 'rollback' && !r.chatted) {
      r.chatted = true;
      if (!r.abort) chatPost({ text: `*${r.kind === 'canary' ? 'Canary' : 'Release'} aborted*: error rate ${r.newPct.toFixed(1)}% is over the ${r.budgetPct}% budget at ${r.traffic}% traffic. Traffic is going back to the stable release.` });
    }
  }

  /* --- slash commands --- */
  const ENV_ALIASES = { dev: 'development', stg: 'staging', prod: 'production' };
  function envArg(a) {
    const s = String(a || '').toLowerCase();
    if (!s) return null;
    const id = ENV_ALIASES[s] || s;
    return App.envs.find((e) => e.id === id || e.name.toLowerCase() === s || (s.length >= 3 && e.id.startsWith(s))) || null;
  }
  const pipelineBusy = () => App.engine.isRunning || App.launching || !!App.tour || (App.drill && App.drill.phase !== 'done');

  async function chatCommand(raw) {
    const ch = chatUI.ch;
    bumpCounter('commands');
    chatPost({ who: 'you', ch, text: raw });
    const [cmd, ...args] = raw.trim().slice(1).split(/\s+/);
    await pause(350);
    const say = (text, card) => chatPost({ ch, text, ...(card ? { card } : {}) });
    const envNames = App.envs.map((e) => `\`${e.id}\``).join(', ');
    const needEnv = (usage) => { const e = envArg(args[0]); if (!e) say(`Which environment? Try \`${usage}\`. Options: ${envNames}.`); return e; };

    switch ((cmd || '').toLowerCase()) {
      case 'help':
        say('Here is what I can do:', { color: 'blue', title: 'Commands', fields: CHAT_COMMANDS.map(([c, d]) => [c, d]) });
        break;
      case 'status': {
        const run = App.engine.isRunning ? App.engine.run : null;
        say(run ? `A pipeline is running: *${run.id}* to ${envById(run.envId).name}.` : 'Nothing is running right now.', {
          color: App.incident && App.incident.phase !== 'resolved' ? 'red' : 'green', title: 'Environments',
          fields: App.envs.map((e) => {
            const live = liveBuild(e.id);
            const hit = App.incident && App.incident.envId === e.id && App.incident.phase !== 'resolved';
            return [e.name, `${live ? `${short(live.commit.hash)} · ${fmtAgo(live.startedAt)}` : 'no build yet'}${hit ? ' · INCIDENT' : ''}`];
          })
        });
        break;
      }
      case 'deploy': {
        const env = needEnv('/deploy staging');
        if (!env) break;
        if (pipelineBusy()) { say('A pipeline, drill or tour is already running. Try again when it finishes.'); break; }
        say(`Starting a deploy to *${env.name}*. I will post updates in #deployments.`);
        startRun({ environment: env.id, quiet: true });
        break;
      }
      case 'rollback': {
        const env = needEnv('/rollback production');
        if (!env) break;
        const rt = rollbackTarget(env.id);
        if (!rt) { say(`*${env.name}* has no earlier successful build to roll back to.`); break; }
        say(`Please confirm the rollback of *${env.name}*.`, {
          color: 'amber', title: `Roll ${env.name} back to ${short(rt.target.commit.hash)}?`, sub: rt.target.commit.message,
          fields: [['Live now', short(rt.live.commit.hash)], ['Return to', short(rt.target.commit.hash)]], status: 'Only the Deploy stage runs: the stored image is reused.',
          buttons: [{ label: 'Confirm rollback', act: 'rollback-confirm', arg: env.id, kind: 'danger' }, { label: 'Cancel', act: 'dismiss' }]
        });
        break;
      }
      case 'promote': {
        const from = envArg(args[0]);
        const to = envArg(args[1]);
        if (!from || !to) { say(`Which lines? Try \`/promote development staging\`. Options: ${envNames}.`); break; }
        const ps = promoState(from, to);
        if (ps.state === 'none') say(`*${from.name}* has no successful build to promote yet.`);
        else if (ps.state === 'synced') say(`*${to.name}* already runs build ${short(ps.record.commit.hash)}.`);
        else if (ps.state === 'busy' || pipelineBusy()) say('A pipeline is already running. Try again when it finishes.');
        else { say(`Promoting ${short(ps.record.commit.hash)} from *${from.name}* to *${to.name}*.`); startRun({ promote: { record: ps.record, to: to.id }, quiet: true }); }
        break;
      }
      case 'approve': {
        if (!App.engine.gateState) { say('Nothing is waiting for approval.'); break; }
        const r = App.engine.approve(App.approver);
        say(r.ok ? `Approved as *${App.approver}*.` : `I could not approve: ${r.reason}`);
        break;
      }
      case 'reject': {
        if (!App.engine.gateState) { say('Nothing is waiting for approval.'); break; }
        App.engine.reject(App.approver || 'A reviewer', args.join(' '));
        say(`Rejected as *${App.approver || 'a reviewer'}*.`);
        break;
      }
      case 'retry': {
        const last = lastRetryable();
        if (!last || App.engine.isRunning) { say(App.engine.isRunning ? 'A pipeline is running.' : 'Nothing to retry: the latest run did not fail.'); break; }
        say(`Retrying *${last.id}* on ${envById(last.environment).name}.`);
        startRun({ retryOf: last, quiet: true });
        break;
      }
      case 'cancel':
        if (!App.engine.isRunning) say('Nothing is running.');
        else { const id = App.engine.run.id; App.engine.cancel(); say(`Cancelling *${id}*.`); }
        break;
      case 'dora': {
        const d = computeDora(7, 'all');
        const v = d.values;
        const band = (i) => (d.bands[i] == null ? '' : ` (${BAND_NAMES[d.bands[i]]})`);
        say('Delivery metrics for the last 7 days:', {
          color: 'blue', title: d.overall == null ? 'DORA metrics: no data yet' : `DORA metrics: overall ${BAND_NAMES[d.overall]}`,
          fields: [
            ['Deployment frequency', v.frequencyPerDay == null ? '—' : `${v.frequencyPerDay >= 1 ? `${v.frequencyPerDay.toFixed(1)} per day` : `${(v.frequencyPerDay * 7).toFixed(1)} per week`}${band(0)}`],
            ['Lead time', v.leadTimeMs == null ? '—' : `${fmtSpan(v.leadTimeMs)}${band(1)}`],
            ['Change failure rate', v.changeFailureRatePct == null ? '—' : `${v.changeFailureRatePct.toFixed(0)}%${band(2)}`],
            ['Time to restore', v.restoreTimeMs == null ? '—' : `${fmtSpan(v.restoreTimeMs)}${band(3)}`]
          ],
          buttons: [{ label: 'Open DORA Metrics', act: 'nav', arg: 'metrics', kind: 'primary' }]
        });
        break;
      }
      default:
        say(`I do not know \`/${cmd}\`. Type \`/help\` for the list.`);
    }
  }

  function chatSubmit() {
    const input = $('#chat-input');
    const val = input.value.trim().slice(0, 120);
    input.value = '';
    chatHints();
    if (!val) return;
    if (val.startsWith('/')) { chatCommand(val); return; }
    chatPost({ who: 'you', ch: chatUI.ch, text: val });
    pause(350).then(() => chatPost({ ch: chatUI.ch, text: 'I only understand slash commands. Type `/help` to see them.' }));
  }

  function chatHints() {
    const box = $('#chat-hints');
    const v = $('#chat-input').value;
    const word = v.startsWith('/') && !v.includes(' ') ? v.toLowerCase() : null;
    const list = word ? CHAT_COMMANDS.filter(([c]) => c.startsWith(word)) : [];
    box.innerHTML = list.map(([c, d]) => `<button type="button" class="chat-hint" data-action="chat-hint" data-cmd="${esc(c.split(' ')[0])}"><b>${esc(c)}</b> <span>${esc(d)}</span></button>`).join('');
  }

  function chatButton(msgId, i) {
    const m = Store.state.chat.find((x) => x.id === msgId);
    const b = m && m.card && m.card.buttons && m.card.buttons[i];
    if (!b) return;
    const settle = (status, color) => chatUpdate(m.id, { card: { buttons: [], status, ...(color ? { color } : {}) } });
    switch (b.act) {
      case 'nav': navigate(b.arg); break;
      case 'detail': showRecord(b.arg); break;
      case 'approve': {
        const r = App.engine.approve(App.approver);
        if (!r.ok) toast('error', 'Cannot approve', r.reason);
        break;
      }
      case 'reject': {
        const r = App.engine.reject(App.approver || 'A reviewer', '');
        if (!r.ok) toast('error', 'Cannot reject', r.reason);
        break;
      }
      case 'retry': {
        const last = lastRetryable();
        if (!last || App.engine.isRunning) { toast('info', 'Cannot retry now', App.engine.isRunning ? 'A pipeline is running.' : 'The latest run did not fail.'); break; }
        settle('Retry requested.');
        startRun({ retryOf: last, quiet: true });
        break;
      }
      case 'rollback-confirm': {
        const rt = rollbackTarget(b.arg);
        if (!rt || pipelineBusy()) { toast('info', 'Cannot roll back now', pipelineBusy() ? 'A pipeline is running.' : 'No earlier build.'); break; }
        settle('Confirmed. Rolling back…');
        startRun({ rollback: rt, quiet: true });
        break;
      }
      case 'dismiss': settle('Cancelled.', 'grey'); break;
      default:
    }
  }

  /* --- profile: who you are in the app, what you have done, and a backup of everything --- */
  const profile = () => Store.state.profile;
  const initials = (name) => (String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?');
  const avatarStyle = (color) => { const c = PROFILE_COLORS[color] || PROFILE_COLORS.amber; return `background:${c[0]};color:${c[1]}`; };
  const allApprovers = () => [...new Set(App.envs.flatMap((e) => (e.gate ? e.gate.approvers : [])))];
  const realRuns = () => history().filter((r) => !r.seeded && !r.drill);
  const bumpCounter = (key) => { profile().counters[key] += 1; Store.save(); checkAchievements(); };

  const ACHIEVEMENTS = [
    { id: 'first-departure', icon: 'play', title: 'First departure', desc: 'Run the pipeline once.', test: () => ({ cur: Math.min(1, realRuns().length), max: 1 }) },
    {
      id: 'on-the-rails', icon: 'chevron', title: 'On the rails', desc: 'Five successful deploys in a row.',
      test: () => {
        let best = 0;
        let streak = 0;
        [...realRuns()].reverse().forEach((r) => { if (r.status === 'success') { streak += 1; best = Math.max(best, streak); } else if (r.status === 'failed') streak = 0; });
        return { cur: Math.min(5, best), max: 5 };
      }
    },
    { id: 'prod-pilot', icon: 'deploy', title: 'Production pilot', desc: 'Deploy to Production successfully.', test: () => ({ cur: realRuns().some((r) => r.environment === 'production' && r.status === 'success' && !r.rollbackFrom) ? 1 : 0, max: 1 }) },
    { id: 'safety-net', icon: 'rollback', title: 'Safety net', desc: 'Roll an environment back.', test: () => ({ cur: realRuns().some((r) => r.rollbackFrom && r.status === 'success') ? 1 : 0, max: 1 }) },
    { id: 'bounce-back', icon: 'retry', title: 'Bounce back', desc: 'Recover from a failed run with a retry.', test: () => ({ cur: realRuns().some((r) => r.retryOf && r.status === 'success') ? 1 : 0, max: 1 }) },
    { id: 'four-eyes', icon: 'check', title: 'Four eyes', desc: 'Approve a deployment as a reviewer.', test: () => ({ cur: Math.min(1, profile().counters.approvals), max: 1 }) },
    { id: 'gatekeeper', icon: 'x', title: 'Gatekeeper', desc: 'Reject a deployment at the approval gate.', test: () => ({ cur: Math.min(1, profile().counters.rejections), max: 1 }) },
    { id: 'canary-saved', icon: 'alert', title: 'Saved by the canary', desc: 'Let a canary roll itself back after an error spike.', test: () => ({ cur: realRuns().some((r) => r.autoRollback) ? 1 : 0, max: 1 }) },
    { id: 'troubleshooter', icon: 'drill', title: 'Troubleshooter', desc: 'Solve 3 incident drills.', test: () => ({ cur: Math.min(3, drillStats().done), max: 3 }) },
    {
      id: 'station-master', icon: 'chart', title: 'Station Master', desc: 'Reach the top drill rank.',
      test: () => { const s = drillStats(); const ranks = App.drillCfg.ranks; return { cur: s.rank === ranks[ranks.length - 1] ? 1 : 0, max: 1 }; }
    },
    { id: 'firefighter', icon: 'bolt', title: 'Firefighter', desc: 'Resolve 3 chaos incidents.', test: () => ({ cur: Math.min(3, Store.state.incidents.length), max: 3 }) },
    { id: 'cool-head', icon: 'bolt', title: 'Cool head', desc: 'Resolve a chaos incident with an S rating.', test: () => ({ cur: Store.state.incidents.some((i) => i.rating === 'S') ? 1 : 0, max: 1 }) },
    { id: 'architect', icon: 'settings', title: 'Pipeline architect', desc: 'Apply a customised pipeline.', test: () => ({ cur: Store.state.pipeline ? 1 : 0, max: 1 }) },
    { id: 'chat-operator', icon: 'chat', title: 'Chat operator', desc: 'Run 3 slash commands in ChatOps.', test: () => ({ cur: Math.min(3, profile().counters.commands), max: 3 }) },
    { id: 'tour-guide', icon: 'info', title: 'Tour guide', desc: 'Finish the guided tour.', test: () => ({ cur: profile().tourDone ? 1 : 0, max: 1 }) }
  ];

  const levelFor = (n) => (n >= 10 ? 'Principal' : n >= 6 ? 'Engineer' : n >= 3 ? 'Operator' : 'Trainee');
  const earnedCount = () => ACHIEVEMENTS.filter((a) => profile().earned[a.id]).length;

  /* Badges are earned from real activity. The first check after load is silent so existing progress never floods you with toasts. */
  function checkAchievements(silent = false) {
    const P = profile();
    let changed = false;
    ACHIEVEMENTS.forEach((a) => {
      if (P.earned[a.id]) return;
      const t = a.test();
      if (t.cur >= t.max) {
        P.earned[a.id] = Date.now();
        changed = true;
        if (!silent) toast('success', `Badge earned: ${a.title}`, a.desc, 6000);
      }
    });
    if (changed) {
      Store.save();
      renderProfileBits();
      if (prefs().view === 'profile') renderProfile();
    }
  }

  /* The sidebar card and the chat show your identity wherever you are. */
  function renderProfileBits() {
    const P = profile();
    const av = $('#user-av');
    if (!av) return;
    av.textContent = initials(P.name);
    av.setAttribute('style', avatarStyle(P.color));
    $('#user-name').textContent = P.name;
    $('#user-role').textContent = `${levelFor(earnedCount())} · ${P.role}`;
    renderChat();
  }

  function setProfile(key, val) {
    const P = profile();
    const v = String(val);
    const clean = (s, n) => s.replace(/[<>{}]/g, '').trim().slice(0, n);
    if (key === 'name') {
      const n = clean(v, 28);
      if (n) P.name = n; else toast('info', 'Name cannot be empty', 'Your previous name was kept.');
    } else if (key === 'role' && PROFILE_ROLES.includes(v)) P.role = v;
    else if (key === 'team') P.team = clean(v, 24);
    else if (key === 'color' && PROFILE_COLORS[v]) P.color = v;
    else if (key === 'reviewer') P.reviewer = v === 'auto' || allApprovers().includes(v) ? v : 'auto';
    else return;
    Store.save();
    renderProfileBits();
    if (prefs().view === 'profile') {
      renderProfile();
      const again = $(`[data-profile="${key}"]`);
      if (again && again.type !== 'radio') again.focus();
    }
    $('#view-sub').textContent = VIEWS.profile.sub();
  }

  function activityItems() {
    const items = [];
    realRuns().slice(0, 12).forEach((r) => {
      const verb = r.status === 'success' ? (r.rollbackFrom ? 'rolled back' : 'deployed') : r.status === 'failed' ? 'failed' : 'stopped';
      items.push({ t: new Date(r.startedAt).getTime(), icon: r.status === 'success' ? 'check' : r.status === 'failed' ? 'x' : 'info', text: `${r.id} ${verb} on ${envById(r.environment).name}`, sub: r.commit.message });
    });
    Object.entries(Store.state.drills).forEach(([id, s]) => {
      const d = drillById(id);
      if (d && s.lastAt) items.push({ t: new Date(s.lastAt).getTime(), icon: 'drill', text: `Drill solved: ${d.title}`, sub: `Best ${s.best} pts · rating ${s.rating}` });
    });
    Store.state.incidents.slice(0, 8).forEach((i) => items.push({ t: i.resolvedAt, icon: 'bolt', text: `${i.id} resolved in ${fmtSpan(i.ttmMs)}`, sub: i.title }));
    return items.sort((a, b) => b.t - a.t).slice(0, 10);
  }

  function renderProfile() {
    const box = $('#profile-view');
    if (!box) return;
    const P = profile();
    const runs = realRuns();
    const ok = runs.filter((r) => r.status === 'success').length;
    const finished = runs.filter((r) => r.status !== 'cancelled').length;
    const ds = drillStats();
    const incs = Store.state.incidents;
    const avg = incs.length ? incs.reduce((a, i) => a + i.ttmMs, 0) / incs.length : null;
    const earned = earnedCount();
    const tiles = [
      ['Runs triggered', runs.length, 'Not counting demo history'], ['Success rate', finished ? `${Math.round((ok / finished) * 100)}%` : '—', 'Finished runs only'],
      ['Rollbacks', runs.filter((r) => r.rollbackFrom).length, 'Environments returned'], ['Approvals given', P.counters.approvals, `${P.counters.rejections} rejected`],
      ['Drill points', ds.points, `${ds.rank.name} · ${ds.done} of ${App.drills.length} solved`], ['Incidents handled', incs.length, avg == null ? 'None yet' : `Avg ${fmtSpan(avg)} to restore`]
    ];
    const act = activityItems();
    box.innerHTML = `
      <section class="card profile-hero">
        <span class="profile-av" style="${avatarStyle(P.color)}" aria-hidden="true">${esc(initials(P.name))}</span>
        <div class="min-w-0 flex-1"><p class="eyebrow">Level · ${levelFor(earned)}</p><h2 class="display profile-name">${esc(P.name)}</h2>
          <p class="text-muted text-sm">${esc(P.role)}${P.team ? ` · ${esc(P.team)}` : ''} · member since ${new Date(P.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
          <div class="flex items-center gap-3 mt-2"><div class="bar bar-lg" role="progressbar" aria-label="Badges earned" aria-valuemin="0" aria-valuemax="${ACHIEVEMENTS.length}" aria-valuenow="${earned}"><span style="width:${(earned / ACHIEVEMENTS.length) * 100}%"></span></div>
            <span class="mono text-sm whitespace-nowrap">${earned} / ${ACHIEVEMENTS.length} badges</span></div></div>
      </section>
      <div class="grid grid-cols-1 xl:grid-cols-5 gap-4 mt-4">
        <section class="card p-5 xl:col-span-2"><p class="eyebrow mb-3">Your details</p>
          <div class="field"><label class="field-label" for="pf-name">Display name</label><input id="pf-name" class="input" type="text" maxlength="28" value="${esc(P.name)}" data-profile="name"></div>
          <div class="field"><label class="field-label" for="pf-role">Role</label><select id="pf-role" class="select" data-profile="role">${PROFILE_ROLES.map((r) => `<option ${r === P.role ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
          <div class="field"><label class="field-label" for="pf-team">Team</label><input id="pf-team" class="input" type="text" maxlength="24" value="${esc(P.team)}" data-profile="team"></div>
          <div class="field"><span class="field-label">Avatar colour</span><div class="swatches" role="radiogroup" aria-label="Avatar colour">${Object.keys(PROFILE_COLORS).map((c) =>
    `<label class="swatch"><input type="radio" name="pf-color" value="${c}" data-profile="color" ${c === P.color ? 'checked' : ''}><span style="${avatarStyle(c)}">${esc(initials(P.name))}</span><i class="sr-only">${c}</i></label>`).join('')}</div></div>
          <div class="field" style="margin-bottom:0"><label class="field-label" for="pf-reviewer">Approve as</label>
            <select id="pf-reviewer" class="select" data-profile="reviewer"><option value="auto" ${P.reviewer === 'auto' ? 'selected' : ''}>First eligible reviewer</option>${allApprovers().map((n) => `<option ${n === P.reviewer ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
            <p class="field-hint">The reviewer you act as by default when a deployment waits for approval. The author of a change can never approve it.</p></div></section>
        <section class="card p-5 xl:col-span-3"><p class="eyebrow mb-3">Your activity in numbers</p>
          <div class="grid grid-cols-2 md:grid-cols-3 gap-3">${tiles.map(([l, v, n]) => `<div class="stat stat-flat"><span class="stat-value">${v}</span><span class="stat-label">${l}</span><span class="stat-note">${esc(String(n))}</span></div>`).join('')}</div></section>
      </div>
      <section class="card p-5 mt-4"><p class="eyebrow">Achievements</p><h2 class="display text-[24px] leading-7 mt-1 mb-3">Badges you earn by doing real things</h2>
        <ul class="badges">${ACHIEVEMENTS.map((a) => {
    const t = a.test();
    const at = P.earned[a.id];
    return `<li class="badge${at ? ' is-earned' : ''}"><span class="badge-ic" aria-hidden="true">${icon(a.icon)}</span><div class="min-w-0"><b>${esc(a.title)}</b><small>${esc(a.desc)}</small>
          ${at ? `<em>Earned ${fmtAgo(new Date(at).toISOString())}</em>` : `<span class="bar mt-2" aria-hidden="true"><span style="width:${(t.cur / t.max) * 100}%"></span></span><em>${t.cur} / ${t.max}</em>`}</div></li>`;
  }).join('')}</ul></section>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
        <section class="card p-5"><p class="eyebrow mb-1">Recent activity</p>
          ${act.length ? `<div class="rows">${act.map((a) => `<div class="act-row"><span class="act-ic" aria-hidden="true">${icon(a.icon)}</span><div class="min-w-0 flex-1"><p class="font-semibold text-sm">${esc(a.text)}</p><p class="text-muted text-[13px] truncate">${esc(a.sub)}</p></div><span class="mono text-[12px] text-muted whitespace-nowrap">${fmtAgo(new Date(a.t).toISOString())}</span></div>`).join('')}</div>`
    : '<p class="text-muted text-sm">Nothing yet. Run the pipeline, solve a drill or handle an incident and it will show up here.</p>'}</section>
        <section class="card p-5"><p class="eyebrow mb-1">Your data</p>
          <p class="text-muted text-sm mb-3">Everything lives in this browser: runs, drill scores, incidents, chat, your custom pipeline, preferences and this profile. Download a backup to keep it or move it to another browser.</p>
          <div class="flex flex-wrap gap-2"><button class="btn btn-outline btn-sm" data-action="backup-export">${icon('download')}<span>Download backup</span></button>
            <button class="btn btn-outline btn-sm" data-action="backup-import">${icon('up')}<span>Restore backup</span></button>
            <button class="btn btn-outline btn-sm" data-action="tour-open">${icon('info')}<span>Replay the tour</span></button>
            <button class="btn btn-outline btn-sm" data-action="nav" data-view="settings">${icon('settings')}<span>Settings</span></button></div>
          <input id="backup-file" type="file" accept=".json,application/json" hidden aria-label="Choose a backup file to restore"></section>
      </div>`;
  }

  function exportBackup() {
    downloadFile(`deployx-backup-${stamp()}.json`, JSON.stringify({ app: 'deployx', version: 1, exportedAt: new Date().toISOString(), data: Store.state }, null, 2), 'application/json');
    toast('success', 'Backup downloaded', 'It contains everything stored in this browser.');
  }

  async function importBackup(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('error', 'File too large', 'A DeployX backup is well under 5 MB.'); return; }
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch { toast('error', 'Not a backup', 'That file is not valid JSON.'); return; }
    const data = parsed && parsed.app === 'deployx' ? parsed.data : null;
    if (!data || typeof data !== 'object' || !Array.isArray(data.history) || !data.prefs || typeof data.prefs !== 'object') {
      toast('error', 'Not a DeployX backup', 'The file does not look like a backup made by DeployX.');
      return;
    }
    if (App.engine.isRunning) { toast('info', 'Run in progress', 'Wait for the pipeline to finish first.'); return; }
    const ok = await confirmModal('Restore this backup?', `It replaces everything stored in this browser with ${data.history.length} runs and the saved profile, preferences and chat. This cannot be undone.`, 'Restore', 'primary');
    if (!ok) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { toast('error', 'Could not restore', 'LocalStorage is unavailable or full.'); return; }
    location.reload();
  }

  /* --- view switching and full refresh --- */
  const VIEW_RENDER = { pipelines: renderPipelinesView, deployments: renderDeployments, builds: renderBuilds, environment: renderEnvironments, metrics: renderMetrics, drills: renderDrills, chaos: renderChaos, profile: renderProfile, settings: renderSettings };

  function navigate(view) {
    if (!(view in VIEWS)) return;
    prefs().view = view;
    Store.save();
    $$('.view').forEach((v) => { v.hidden = v.dataset.view !== view; });
    $$('.nav-item, .user-card').forEach((b) => (b.dataset.view === view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    $('#view-title').textContent = VIEWS[view].title;
    $('#view-sub').textContent = VIEWS[view].sub();
    if (VIEW_RENDER[view]) VIEW_RENDER[view]();
    syncPrefs();
    renderControls();
    closeSidebar();
  }

  function renderAll() {
    renderStats();
    renderPipeline();
    renderAlert();
    renderApproval();
    renderRollout();
    renderIncident();
    renderTourInvite();
    checkAchievements();
    const view = prefs().view;
    $('#view-sub').textContent = VIEWS[view].sub();
    if (VIEW_RENDER[view]) VIEW_RENDER[view]();
    syncPrefs();
    renderControls();
  }

  /* ------------------------------------------------------------------ */
  /* 6. Overlays: modal, command palette, toasts                         */
  /* ------------------------------------------------------------------ */
  let modalState = null;

  function openModal({ title, eyebrow = '', body = '', actions = [], wide = false }) {
    closeModal(null);
    return new Promise((resolve) => {
      const root = $('#modal-root');
      root.innerHTML = `<div class="overlay" data-modal-overlay>
        <div class="modal ${wide ? 'is-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div class="modal-head"><h2 id="modal-title">${eyebrow ? `<span class="eyebrow block">${esc(eyebrow)}</span>` : ''}${esc(title)}</h2>
            <button class="btn-icon" data-modal-value="__close" aria-label="Close dialog">${icon('x')}</button></div>
          <div class="modal-body">${body}</div>
          ${actions.length ? `<div class="modal-foot">${actions.map((a, i) => `<button class="btn btn-${a.kind || 'outline'}" data-modal-value="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
        </div></div>`;
      modalState = { resolve, actions, restore: document.activeElement };
      const primary = $('.modal-foot .btn-primary, .modal-foot .btn-danger', root) || $('.modal .btn-icon', root);
      primary.focus();
    });
  }
  function closeModal(value) {
    if (!modalState) return;
    const { resolve, restore } = modalState;
    modalState = null;
    $('#modal-root').innerHTML = '';
    if (restore && document.contains(restore)) restore.focus();
    resolve(value);
  }
  const confirmModal = (title, text, label, kind = 'danger') => openModal({
    eyebrow: 'Please confirm', title, body: `<p>${text}</p>`,
    actions: [{ label: 'Keep', kind: 'outline', value: false }, { label, kind, value: true }]
  });

  function trapFocus(e, container) {
    const items = $$('button:not(:disabled), input, select, [tabindex="0"]', container).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function toast(type, title, message = '', ms = 4500) {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `<div class="toast-text"><strong>${esc(title)}</strong>${message ? `<p>${esc(message)}</p>` : ''}</div><button data-action="toast-close" aria-label="Dismiss notification">${icon('x')}</button>`;
    const box = $('#toasts');
    box.appendChild(el);
    while (box.childElementCount > 4) box.firstElementChild.remove();
    el.timer = setTimeout(() => dismissToast(el), ms);
  }
  function dismissToast(el) {
    clearTimeout(el.timer);
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 220);
  }

  /* command palette */
  const palette = { items: [], index: 0, restore: null };
  function commands() {
    const running = App.engine.isRunning;
    const list = [
      { icon: 'play', label: 'Run pipeline', hint: 'R', run: () => startRun(), off: running },
      { icon: 'stop', label: 'Cancel running pipeline', hint: 'X', run: () => ACTIONS.cancel(), off: !running },
      { icon: 'retry', label: 'Retry last failed run', hint: 'Shift R', run: () => ACTIONS.retry(), off: !canRetry() },
      ...Object.keys(VIEWS).map((v, i) => ({ icon: ['overview', 'pipeline', 'deploy', 'history', 'env', 'chart', 'drill', 'bolt', 'settings', 'user'][i], label: `Go to ${VIEWS[v].title}`, hint: String(i + 1), run: () => navigate(v) })),
      ...App.envs.map((e) => ({ icon: 'env', label: `Switch environment to ${e.name}`, hint: 'Env', run: () => { setPref('environment', e.id); toast('info', 'Environment selected', `${e.name} (simulated) is the next terminus.`); } })),
      { icon: 'chat', label: chatUI.open ? 'Close ChatOps' : 'Open ChatOps', hint: 'C', run: () => chatToggle() },
      { icon: 'bolt', label: chaos.armed ? 'Disarm chaos mode' : 'Arm chaos mode', hint: 'Chaos', run: () => ACTIONS['chaos-toggle']() },
      { icon: 'alert', label: 'Trigger an incident now', hint: 'Chaos', run: () => ACTIONS['chaos-strike'](), off: !chaos.armed || !!App.incident },
      { icon: 'info', label: 'Start the guided tour', hint: 'Learn', run: () => openTour(), off: running },
      { icon: 'chevron', label: 'Promote the rollout to the next step now', hint: 'Rollout', run: () => ACTIONS['ro-promote'](), off: !App.engine.rollout },
      { icon: 'rollback', label: 'Abort the rollout and roll back', hint: 'Rollout', run: () => ACTIONS['ro-abort'](), off: !App.engine.rollout },
      { icon: 'check', label: 'Approve the pending deployment', hint: 'Gate', run: () => ACTIONS['gate-approve'](), off: !App.engine.gateState },
      { icon: 'x', label: 'Reject the pending deployment', hint: 'Gate', run: () => ACTIONS['gate-reject'](), off: !App.engine.gateState },
      { icon: 'pipeline', label: 'Open the pipeline editor', hint: 'Editor', run: () => { App.editor.tab = 'editor'; App.editor.items = clone(currentItems()); navigate('pipelines'); } },
      ...App.envs.slice(0, -1).map((from, i) => ({ icon: 'deploy', label: `Promote ${from.name} build to ${App.envs[i + 1].name}`, hint: 'Promote', run: () => promote(from.id, App.envs[i + 1].id), off: promoState(from, App.envs[i + 1]).state !== 'ready' })),
      ...App.envs.map((e) => ({ icon: 'rollback', label: `Roll back ${e.name} to its previous build`, hint: 'Rollback', run: () => rollback(e.id), off: running || !rollbackTarget(e.id) })),
      { icon: 'alert', label: `${prefs().failure.enabled ? 'Disable' : 'Enable'} failure simulation`, hint: 'Sim', run: () => { setPref('failure.enabled', !prefs().failure.enabled); toast('info', 'Failure simulation', prefs().failure.enabled ? 'On for the next run.' : 'Off.'); } },
      { icon: 'moon', label: 'Toggle dark / light theme', hint: 'T', run: () => ACTIONS['toggle-theme']() },
      { icon: 'trash', label: 'Clear terminal', hint: 'Log', run: () => ACTIONS['term-clear']() },
      { icon: 'copy', label: 'Copy terminal logs', hint: 'Log', run: () => ACTIONS['term-copy']() },
      { icon: 'download', label: 'Download terminal logs (.txt)', hint: 'Log', run: () => ACTIONS['term-download']() },
      { icon: 'download', label: 'Export history as JSON', hint: 'Data', run: () => ACTIONS['export-json']() },
      { icon: 'download', label: 'Export history as CSV', hint: 'Data', run: () => ACTIONS['export-csv']() },
      { icon: 'keyboard', label: 'Show keyboard shortcuts', hint: '?', run: () => ACTIONS.shortcuts() }
    ];
    return list.filter((c) => !c.off);
  }
  function openPalette() {
    closeModal(null);
    palette.restore = document.activeElement;
    $('#palette').hidden = false;
    const q = $('#palette-q');
    q.value = '';
    renderPalette();
    q.focus();
  }
  function closePalette() {
    if ($('#palette').hidden) return;
    $('#palette').hidden = true;
    if (palette.restore && document.contains(palette.restore)) palette.restore.focus();
  }
  function renderPalette() {
    const words = $('#palette-q').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    palette.items = commands().filter((c) => words.every((w) => c.label.toLowerCase().includes(w)));
    palette.index = Math.min(palette.index, Math.max(0, palette.items.length - 1));
    $('#palette-list').innerHTML = palette.items.length
      ? palette.items.map((c, i) => `<li class="palette-item" role="option" data-index="${i}" aria-selected="${i === palette.index}">${icon(c.icon)}<span>${esc(c.label)}</span><small>${esc(c.hint)}</small></li>`).join('')
      : '<li class="palette-empty">No matching commands</li>';
    const sel = $('.palette-item[aria-selected="true"]');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  function runPaletteItem(i) {
    const cmd = palette.items[i];
    if (!cmd) return;
    closePalette();
    cmd.run();
  }

  /* ------------------------------------------------------------------ */
  /* 7. Actions and event wiring                                         */
  /* ------------------------------------------------------------------ */
  const openSidebar = () => { $('#app').classList.add('nav-open'); $('#sidebar-scrim').hidden = false; };
  function closeSidebar() { $('#app').classList.remove('nav-open'); $('#sidebar-scrim').hidden = true; }

  function exportCSV() {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Deployment ID', 'Commit hash', 'Commit message', 'Branch', 'Environment', 'Pipeline status', 'Execution duration (s)', 'Timestamp', 'Attempt', 'Failed stage', 'Drill'];
    const rows = history().map((r) => [r.id, r.commit.hash, r.commit.message, r.branch, r.environment, r.status, (r.durationMs / 1000).toFixed(1), r.startedAt, r.attempt, r.failedStage || '', r.drill || '']);
    return [head, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  const needHistory = () => {
    if (history().length) return true;
    toast('info', 'Nothing to export', 'Run the pipeline first to create some history.');
    return false;
  };

  function promote(fromId, toId) {
    const from = envById(fromId);
    const to = envById(toId);
    const ps = promoState(from, to);
    if (ps.state === 'none') toast('info', 'Nothing to promote', `${from.name} has no successful build yet. Run the pipeline on it first.`);
    else if (ps.state === 'synced') toast('info', 'Already in sync', `${to.name} is already running build ${short(ps.record.commit.hash)}.`);
    else if (ps.state === 'busy') toast('info', 'Line busy', 'Wait for the current run to finish before promoting.');
    else startRun({ promote: { record: ps.record, to: to.id } });
  }

  const ACTIONS = {
    nav: (el) => navigate(el.dataset.view),
    'open-sidebar': openSidebar,
    'close-sidebar': closeSidebar,
    'toggle-sidebar': () => setPref('sidebarCollapsed', !prefs().sidebarCollapsed),
    'toggle-theme': () => setPref('theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
    'open-palette': openPalette,
    run: () => startRun(),
    async cancel() {
      if (!App.engine.isRunning) { toast('info', 'Nothing to cancel', 'No pipeline is running right now.'); return; }
      const ok = await confirmModal('Cancel this run?', `Pipeline <strong>${esc(App.engine.run.id)}</strong> will stop at the current stage and the remaining stages will be skipped.`, 'Cancel run');
      if (ok && !App.engine.cancel()) toast('info', 'Already finished', 'The run completed before it could be cancelled.');
    },
    retry() {
      if (!canRetry()) { toast('info', 'Nothing to retry', 'Retry is available after a failed or cancelled run.'); return; }
      startRun({ retryOf: lastRetryable() });
    },
    'retry-run': (el) => { const r = recordById(el.dataset.id); if (r) startRun({ retryOf: r }); },
    'stage-info': (el) => showStage(el.dataset.stage),
    'fail-here': (el) => toggleFault(el.dataset.stage),
    'dep-detail': (el) => showRecord(el.dataset.id),
    'env-select': (el) => { if (setPref('environment', el.dataset.env)) toast('info', 'Environment selected', `${envById(el.dataset.env).name} (simulated) is the next terminus.`); },
    'env-deploy': (el) => { setPref('environment', el.dataset.env); startRun({ environment: el.dataset.env }); },
    promote: (el) => promote(el.dataset.from, el.dataset.to),
    rollback: (el) => rollback(el.dataset.env),
    'pl-tab'(el) {
      if (el.dataset.tab === 'editor' && !App.editor.items) App.editor.items = clone(currentItems());
      App.editor.tab = el.dataset.tab;
      renderPipelinesView();
    },
    'ed-up': (el) => editorMove(Number(el.dataset.i), -1),
    'ed-down': (el) => editorMove(Number(el.dataset.i), 1),
    'ed-remove'(el) {
      const items = App.editor.items;
      const it = items[Number(el.dataset.i)];
      if (!it || !it.def) return;
      items.splice(Number(el.dataset.i), 1);
      renderPipelinesView();
      toast('info', 'Stage removed', `${it.name || it.def.name} is back in the stage library.`);
    },
    'ed-add'(el) {
      const def = App.catalog.find((d) => d.id === el.dataset.id);
      const items = App.editor.items;
      if (!def || items.some((it) => it.id === def.id)) return;
      const at = items.findIndex((it) => it.id === 'deploy');
      items.splice(at < 0 ? items.length : at, 0, { id: def.id, enabled: true, par: false, name: null, def: clone(def) });
      renderPipelinesView();
      toast('success', 'Stage added', `${def.name} was added before Deployment. Move it where it belongs, then Apply.`);
    },
    'backup-export': exportBackup,
    'backup-import'() { const f = $('#backup-file'); if (f) f.click(); },
    'chat-toggle': chatToggle,
    'chat-ch': (el) => chatChannel(el.dataset.ch),
    'chat-btn': (el) => chatButton(el.dataset.msg, Number(el.dataset.i)),
    'chat-hint'(el) { const input = $('#chat-input'); input.value = `${el.dataset.cmd} `; chatHints(); input.focus(); },
    'chaos-toggle': () => (chaos.armed ? disarmChaos() : armChaos()),
    'chaos-strike'() {
      if (!chaos.armed) { toast('info', 'Chaos is disarmed', 'Arm chaos mode first.'); return; }
      if (chaosBusy()) { toast('info', 'Not now', 'Chaos waits for runs, drills and tours to finish.'); return; }
      strikeIncident(true);
    },
    'inc-act': (el) => incidentAct(el.dataset.id),
    'inc-dismiss': dismissIncident,
    'ro-promote'() {
      const r = App.engine.rolloutSkip();
      if (!r.ok) toast('info', 'Nothing to promote', r.reason);
    },
    'ro-abort'() {
      const r = App.engine.rolloutAbort();
      if (!r.ok) toast('info', 'Nothing to abort', r.reason);
    },
    'gate-approve'() {
      const r = App.engine.approve(App.approver);
      if (!r.ok) toast('error', 'Cannot approve', r.reason);
    },
    'gate-reject'() {
      const input = $('#gate-reason');
      const r = App.engine.reject(App.approver || 'A reviewer', input ? input.value : '');
      if (!r.ok) toast('error', 'Cannot reject', r.reason);
    },
    'tour-open': openTour,
    'tour-start': startTour,
    'tour-next': tourNext,
    'tour-break': (el) => tourBreak(el.dataset.stage),
    'tour-exit': exitTour,
    'tour-go'(el) { exitTour(); navigate(el.dataset.view); },
    'tour-dismiss'() { setPref('tourSeen', true); renderTourInvite(); },
    'ed-apply': commitPipeline,
    'ed-discard'() { App.editor.items = clone(currentItems()); renderPipelinesView(); },
    'ed-reset'() { App.editor.items = defaultItems(); renderPipelinesView(); toast('info', 'Draft reset', 'Press Apply to switch the running pipeline back to the default.'); },
    async 'ed-copy'() {
      const ok = await copyText(pipelineYAML(resolvePipeline(App.editor.items).stages));
      toast(ok ? 'success' : 'error', ok ? 'YAML copied' : 'Copy failed', ok ? 'Workflow is on the clipboard.' : 'Clipboard access was blocked by the browser.');
    },
    'ed-download'() {
      downloadFile('deployx-pipeline.yml', pipelineYAML(resolvePipeline(App.editor.items).stages), 'text/yaml');
      toast('success', 'Workflow downloaded', 'Saved as deployx-pipeline.yml.');
    },
    'metrics-export'() {
      const f = App.metricsFilter;
      const d = computeDora(f.days, f.env);
      downloadFile(`deployx-dora-${stamp()}.json`, JSON.stringify({
        exportedAt: new Date().toISOString(), simulated: true, window: f.days ? `last ${f.days} days` : 'all time', environment: f.env,
        metrics: d.values, bands: Object.fromEntries(['deploymentFrequency', 'leadTime', 'changeFailureRate', 'timeToRestore'].map((k, i) => [k, d.bands[i] == null ? null : BANDS[d.bands[i]]])),
        overall: d.overall == null ? null : BANDS[d.overall], openIncidents: d.open.map((o) => ({ environment: o.env.id, since: o.run.id })),
        restores: d.restores.map((x) => ({ from: x.from.id, to: x.to.id, environment: x.from.environment, restoreMs: x.ms }))
      }, null, 2), 'application/json');
      toast('success', 'Metrics exported', 'Saved as a .json snapshot.');
    },
    'drill-start': (el) => startDrill(el.dataset.id),
    'drill-choose': (el) => chooseFix(Number(el.dataset.choice)),
    'drill-hint'() { if (App.drill && App.drill.phase === 'diagnose') { App.drill.hint = true; renderDrills(); } },
    'drill-exit'() {
      if (App.engine.isRunning && App.drill && App.drill.phase !== 'done') return;
      stopDrillTimer();
      App.drill = null;
      renderDrills();
      renderControls();
      $('#view-sub').textContent = VIEWS.drills.sub();
    },
    'drill-next'() {
      const cur = App.drill ? App.drills.indexOf(App.drill.def) : -1;
      const order = App.drills.slice(cur + 1).concat(App.drills.slice(0, cur + 1));
      const next = order.find((d) => !(Store.state.drills[d.id] || {}).best && d !== (App.drill && App.drill.def)) || order[0];
      startDrill(next.id);
    },
    'term-clear': () => { termClear(); toast('info', 'Terminal cleared'); },
    async 'term-copy'() {
      if (!App.termLogs.length) { toast('info', 'Nothing to copy', 'The terminal is empty.'); return; }
      const ok = await copyText(App.termLogs.map(logText).join('\n'));
      toast(ok ? 'success' : 'error', ok ? 'Logs copied' : 'Copy failed', ok ? `${App.termLogs.length} lines on the clipboard.` : 'Clipboard access was blocked by the browser.');
    },
    'term-download'() {
      if (!App.termLogs.length) { toast('info', 'Nothing to download', 'The terminal is empty.'); return; }
      downloadFile(`deployx-logs-${stamp()}.txt`, App.termLogs.map(logText).join('\n') + '\n', 'text/plain');
      toast('success', 'Logs downloaded', 'Saved as a .txt file.');
    },
    async 'record-copy'(el) {
      const r = recordById(el.dataset.id);
      if (!r) return;
      const ok = await copyText(r.logs.map(logText).join('\n'));
      toast(ok ? 'success' : 'error', ok ? 'Logs copied' : 'Copy failed', ok ? `${r.id}: ${r.logs.length} lines.` : 'Clipboard access was blocked by the browser.');
    },
    'record-download'(el) {
      const r = recordById(el.dataset.id);
      if (r) downloadFile(`${r.id.toLowerCase()}-logs.txt`, r.logs.map(logText).join('\n') + '\n', 'text/plain');
    },
    'export-json'() {
      if (!needHistory()) return;
      downloadFile(`deployx-history-${stamp()}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), simulated: true, deployments: history() }, null, 2), 'application/json');
      toast('success', 'JSON exported', `${history().length} deployments.`);
    },
    'export-csv'() {
      if (!needHistory()) return;
      downloadFile(`deployx-history-${stamp()}.csv`, exportCSV(), 'text/csv');
      toast('success', 'CSV exported', `${history().length} deployments.`);
    },
    async 'clear-history'() {
      if (!history().length) { toast('info', 'History is already empty'); return; }
      if (App.engine.isRunning) { toast('info', 'Run in progress', 'Wait for the pipeline to finish first.'); return; }
      const ok = await confirmModal('Clear deployment history?', `All ${history().length} recorded runs will be removed from this browser. This cannot be undone.`, 'Clear history');
      if (!ok) return;
      Store.state.history = [];
      App.alert = null;
      Store.save();
      renderAll();
      toast('success', 'History cleared');
    },
    async 'restore-demo'() {
      if (App.engine.isRunning) { toast('info', 'Run in progress', 'Wait for the pipeline to finish first.'); return; }
      const ok = await confirmModal('Restore demo data?', 'Your recorded runs will be replaced by the eight seeded demo deployments.', 'Restore', 'primary');
      if (!ok) return;
      Store.state.nextRun = 1001;
      seedHistory();
      App.alert = null;
      Store.save();
      renderAll();
      toast('success', 'Demo data restored');
    },
    async 'reset-all'() {
      if (App.engine.isRunning) { toast('info', 'Run in progress', 'Wait for the pipeline to finish first.'); return; }
      const ok = await confirmModal('Reset everything?', 'Preferences and history return to their defaults. This cannot be undone.', 'Reset');
      if (!ok) return;
      disarmChaos();
      clearInterval(chaos.tick);
      App.incident = null;
      Store.wipe();
      seedHistory();
      chatSeed();
      checkAchievements(true);
      renderProfileBits();
      chatUI.unread = { deployments: 0, incidents: 0 };
      chatUI.mention = false;
      renderChat();
      Store.save();
      App.alert = null;
      App.engine.run = null;
      termClear();
      navigate('overview');
      renderAll();
      toast('success', 'DeployX reset', 'Defaults and demo data restored.');
    },
    'clear-filters'() {
      App.filters = { q: '', status: 'all', env: 'all' };
      $('#dep-search').value = '';
      $('#dep-status').value = 'all';
      $('#dep-env').value = 'all';
      renderDeployments();
    },
    shortcuts: () => openModal({ eyebrow: 'Help', title: 'Keyboard shortcuts', body: shortcutsHTML(), actions: [{ label: 'Close', kind: 'primary', value: null }] }),
    'toast-close': (el) => dismissToast(el.closest('.toast'))
  };

  function bindEvents() {
    /* one delegated click handler for every [data-action] control */
    document.addEventListener('click', (e) => {
      const mv = e.target.closest('[data-modal-value]');
      if (mv && modalState) {
        const a = modalState.actions[Number(mv.dataset.modalValue)];
        closeModal(a ? a.value : null);
        return;
      }
      if (e.target.matches('[data-modal-overlay]')) { closeModal(null); return; }
      if (e.target.id === 'palette') { closePalette(); return; }
      const item = e.target.closest('.palette-item');
      if (item) { runPaletteItem(Number(item.dataset.index)); return; }
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled) return;
      const fn = ACTIONS[el.dataset.action];
      if (fn) fn(el);
    });

    document.addEventListener('change', (e) => {
      if (e.target.id === 'backup-file') { importBackup(e.target.files[0]); e.target.value = ''; return; }
      const pf = e.target.closest('[data-profile]');
      if (pf) { setProfile(pf.dataset.profile, pf.value); return; }
      const ap = e.target.closest('[data-approver]');
      if (ap) { App.approver = ap.value; renderApproval(); return; }
      const edEl = e.target.closest('[data-ed]');
      if (edEl) { editorChange(edEl); return; }
      const mf = e.target.closest('[data-metric]');
      if (mf) {
        App.metricsFilter[mf.dataset.metric] = mf.dataset.metric === 'days' ? Number(mf.value) : mf.value;
        renderMetrics();
        $(`[data-metric="${mf.dataset.metric}"]`).focus();
        return;
      }
      const el = e.target.closest('[data-pref]');
      if (!el) return;
      let value = el.type === 'checkbox' ? el.checked : el.value;
      if (el.dataset.type === 'number') value = Number(value);
      if (!setPref(el.dataset.pref, value)) { syncPrefs(); toast('error', 'Invalid value', 'That setting was not accepted.'); return; }
      if (el.dataset.pref.startsWith('failure') && prefs().view === 'pipelines') renderPipelinesView();
    });
    document.addEventListener('submit', (e) => {
      if (e.target.id === 'chat-form') { e.preventDefault(); chatSubmit(); }
    });
    document.addEventListener('input', (e) => {
      if (e.target.id === 'chat-input') chatHints();
      if (e.target.matches('[data-pref="failure.chance"]')) $$('[data-chance]').forEach((el) => { el.textContent = `${e.target.value}%`; });
    });

    $('#dep-search').addEventListener('input', (e) => { App.filters.q = e.target.value.slice(0, 60); renderDeployments(); });
    $('#dep-status').addEventListener('change', (e) => { App.filters.status = e.target.value; renderDeployments(); });
    $('#dep-env').addEventListener('change', (e) => { App.filters.env = e.target.value; renderDeployments(); });
    $('#palette-q').addEventListener('input', () => { palette.index = 0; renderPalette(); });

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if ($('#palette').hidden) openPalette(); else closePalette();
        return;
      }
      if (!$('#palette').hidden) {
        if (e.key === 'Escape') closePalette();
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const n = palette.items.length;
          if (n) { palette.index = (palette.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; renderPalette(); }
        } else if (e.key === 'Enter') { e.preventDefault(); runPaletteItem(palette.index); }
        else if (e.key === 'Tab') trapFocus(e, $('.palette'));
        return;
      }
      if (modalState) {
        if (e.key === 'Escape') closeModal(null);
        else if (e.key === 'Tab') trapFocus(e, $('.modal'));
        return;
      }
      if (e.key === 'Escape') { if (App.tour) exitTour(); else if (chatUI.open) chatToggle(); else closeSidebar(); return; }
      /* Enter / Space activate non-button elements that act as buttons (table rows, map stations) */
      const t = e.target;
      if ((e.key === 'Enter' || e.key === ' ') && t.matches && t.matches('[role="button"]:not(button)')) {
        e.preventDefault();
        t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || (t.matches && t.matches('input, select, textarea, [contenteditable]'))) return;
      const views = Object.keys(VIEWS);
      if (e.key === 'R') ACTIONS.retry();
      else if (e.key === 'r') startRun();
      else if (e.key.toLowerCase() === 'x') ACTIONS.cancel();
      else if (e.key.toLowerCase() === 't') ACTIONS['toggle-theme']();
      else if (e.key.toLowerCase() === 'c') chatToggle();
      else if (e.key === '?') ACTIONS.shortcuts();
      else if (e.key === '/') { e.preventDefault(); navigate('deployments'); $('#dep-search').focus(); }
      else if (/^[1-9]$/.test(e.key)) navigate(views[Number(e.key) - 1]);
    });

    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  }

  /* ------------------------------------------------------------------ */
  /* 8. Boot                                                             */
  /* ------------------------------------------------------------------ */
  async function loadJSON(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
    return res.json();
  }

  function validateConfig(cfg, envs, demo) {
    if (!cfg || !Array.isArray(cfg.stages) || !cfg.stages.length) throw new Error('pipeline-config.json has no stages.');
    cfg.stages.forEach((s) => {
      if (!s.id || !s.name || !Array.isArray(s.steps) || s.steps.length < 2 || !s.duration || !s.failure) throw new Error(`Stage "${s.id || '?'}" is incomplete in pipeline-config.json.`);
    });
    /* Parallel groups must be contiguous and hold at most two stages (the map forks into two lanes). */
    const groups = {};
    buildWaves(cfg.stages).forEach((w) => {
      if (w.length > 2) throw new Error(`Parallel group "${w[0].parallel}" has ${w.length} stages; the maximum is 2.`);
      if (w[0].parallel) {
        if (groups[w[0].parallel]) throw new Error(`Parallel group "${w[0].parallel}" must be contiguous in pipeline-config.json.`);
        groups[w[0].parallel] = true;
      }
    });
    if (!envs || !Array.isArray(envs.environments) || !envs.environments.length) throw new Error('environments.json has no environments.');
    if (!demo || !demo.repository || !Array.isArray(demo.commits) || !demo.commits.length || !Array.isArray(demo.branches)) throw new Error('demo-data.json is incomplete.');
  }

  function validateDrills(cfg, stages) {
    if (!cfg || !cfg.difficulty || !Array.isArray(cfg.ranks) || !cfg.ranks.length || !Array.isArray(cfg.drills) || !cfg.drills.length) throw new Error('drills.json is incomplete.');
    cfg.drills.forEach((d) => {
      const bad = (why) => new Error(`Drill "${d.id || '?'}" in drills.json ${why}.`);
      if (!d.id || !d.title || !cfg.difficulty[d.difficulty]) throw bad('needs an id, a title and a valid difficulty');
      if (!stages.some((s) => s.id === d.stage)) throw bad(`names an unknown stage "${d.stage}"`);
      if (!d.failure || !d.failure.code || !d.failure.message) throw bad('needs a failure with a code and message');
      if (!Array.isArray(d.choices) || d.choices.length < 3 || d.choices.filter((c) => c.correct).length !== 1) throw bad('needs 3 or more choices with exactly one correct');
    });
  }

  function validateCatalog(cat, base) {
    if (!cat || !Array.isArray(cat.stages)) throw new Error('stage-catalog.json is incomplete.');
    const ids = new Set(base.map((s) => s.id));
    cat.stages.forEach((s) => {
      if (!validStageDef(s)) throw new Error(`Stage "${s.id || '?'}" in stage-catalog.json is incomplete.`);
      if (ids.has(s.id)) throw new Error(`Stage "${s.id}" in stage-catalog.json duplicates a stage in pipeline-config.json.`);
      ids.add(s.id);
    });
  }

  async function boot() {
    try {
      const [cfg, envs, demo, drills, catalog, tourData, chaosCfg] = await Promise.all([
        loadJSON('data/pipeline-config.json'), loadJSON('data/environments.json'), loadJSON('data/demo-data.json'),
        loadJSON('data/drills.json'), loadJSON('data/stage-catalog.json'), loadJSON('data/tour.json'), loadJSON('data/chaos.json')
      ]);
      if (!chaosCfg || !chaosCfg.intensity || !Array.isArray(chaosCfg.actions) || !Array.isArray(chaosCfg.incidents) || !chaosCfg.incidents.length) throw new Error('chaos.json is incomplete.');
      chaosCfg.incidents.forEach((d) => {
        if (!d.id || !d.title || !d.peak || !Array.isArray(d.fixes) || !d.fixes.every((f) => chaosCfg.actions.some((a) => a.id === f))) throw new Error(`Incident "${d.id || '?'}" in chaos.json is incomplete.`);
      });
      App.chaosCfg = chaosCfg;
      if (!tourData || !tourData.intro || !tourData.stages || !tourData.fallback || !tourData.done || !tourData.failed || !Array.isArray(tourData.next)) throw new Error('tour.json is incomplete.');
      App.tourData = tourData;
      App.rolloutCfg = normalizeRollout(envs.rollout);
      validateConfig(cfg, envs, demo);
      validateDrills(drills, cfg.stages);
      validateCatalog(catalog, cfg.stages);
      App.baseStages = cfg.stages;
      App.catalog = catalog.stages;
      App.drillCfg = drills;
      App.drills = drills.drills;
      App.pipeline = cfg.pipeline;
      App.stages = cfg.stages;
      App.waves = buildWaves(App.stages);
      App.envs = envs.environments;
      App.demo = demo;

      Store.load();
      applyPipelineToApp(); /* the saved pipeline (if any) replaces the default stage list */
      sanitizePrefs();
      if (!Store.state.seeded) { seedHistory(); Store.save(); }
      chatSeed();
      checkAchievements(true); /* silent: badges for existing progress are not announced */
      renderProfileBits();

      App.engine = new PipelineEngine(App.stages);
      App.engine.on('update', (run) => {
        renderPipeline(run);
        if (run.status !== 'running' || !run.durationMs) renderControls();
        else if (prefs().view === 'environment') updateNetwork();
        if (prefs().view === 'drills') updateDrillLive(run);
        if (App.engine.gateState) updateGateTimer();
        chatRunProgress(run);
      });
      App.engine.on('log', termAppend);
      App.engine.on('gate', onGateEvent);
      App.engine.on('rollout', onRolloutEvent);

      $('#map-line-name').textContent = App.pipeline.name;
      $('#palette-kbd').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
      $('#dep-env').innerHTML = `<option value="all">All environments</option>${App.envs.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}`;
      $('#dispatch').innerHTML = runControls('ov') + simControls('ov');
      buildMetro();
      buildStageCards();
      termEmpty();
      bindEvents();

      $('#app').hidden = false;
      navigate(prefs().view);
      renderAll();
      $('#app-loader').hidden = true;
    } catch (err) {
      console.error('DeployX failed to start:', err);
      $('#app-loader').hidden = true;
      $('#app-error-msg').textContent = err.message || String(err);
      $('#app-error').hidden = false;
    }
  }

  boot();
})();
