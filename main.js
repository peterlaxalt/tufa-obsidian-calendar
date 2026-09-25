const { Plugin, ItemView } = require("obsidian");

const VIEW = "tufa-calendar";
const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const BATCH = 6;          // months added per lazy load
const EDGE = 2;           // load more when within this many months of an end
const RELEASE_DAY = 4;    // Thursday — release days get a dot
const IDLE_MS = 20000;
const NAV_MS = 5000;      // floating nav lingers this long after scrolling stops    // drift back to today after this long without input
const DAY_MS = 86400000;
const MODE_KEY = "tufa-calendar-mode";
const rand = (a, b) => a + Math.random() * (b - a);

const ICON_PREV = '<svg viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 16 16"><path d="M5 3.2v9.6L12.6 8z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 16 16"><rect x="4.2" y="3.5" width="2.4" height="9" rx="0.8"/><rect x="9.4" y="3.5" width="2.4" height="9" rx="0.8"/></svg>';
const ICON_DOTS = '<svg viewBox="0 0 16 16">' +
  [3, 8, 13].flatMap((y) => [3, 8, 13].map((x) => `<circle cx="${x}" cy="${y}" r="1.25"/>`)).join("") + "</svg>";

// ---------- date helpers ----------

const keyOf = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const monthName = (y, m) => new Date(y, m, 1).toLocaleString(undefined, { month: "long" });
const daysInYear = (y) => Math.round((new Date(y + 1, 0, 1) - new Date(y, 0, 1)) / DAY_MS);
const dayOfYear = (d) => Math.round((midnight(d) - new Date(d.getFullYear(), 0, 1)) / DAY_MS) + 1;

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY_MS + 1) / 7);
}

function ordinal(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return n + "th";
  return n + ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
}

// "September 18th, 2026"
const longDate = (d) => `${monthName(d.getFullYear(), d.getMonth())} ${ordinal(d.getDate())}, ${d.getFullYear()}`;

function relative(d) {
  const n = Math.round((midnight(d) - midnight(new Date())) / DAY_MS);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

class CalendarView extends ItemView {
  getViewType() { return VIEW; }
  getDisplayText() { return "Calendar"; }
  getIcon() { return "calendar"; }

  async onOpen() {
    this.today = keyOf(new Date());
    this.mode = this.app.loadLocalStorage(MODE_KEY) === "dots" ? "dots" : "month";
    this.contentEl.empty();
    this.contentEl.addClass("uc-host");
    this.build();

    this.registerInterval(window.setInterval(() => {
      const k = keyOf(new Date());
      if (k === this.today) return;
      this.today = k;
      this.markToday();
      this.buildDots();
      this.showStats(null);
    }, 60 * 1000));
  }

  async onClose() {
    this.resizeObs?.disconnect();
    window.clearTimeout(this.idleTimer);
    window.clearTimeout(this.copyTimer);
    window.clearTimeout(this.navTimer);
    this.stopRipples();
  }

  // ---------- skeleton ----------

  build() {
    const root = this.root = this.contentEl.createDiv("uc");

    const head = root.createDiv("uc-head");
    const title = head.createDiv("uc-title");
    this.titleMonth = title.createSpan("uc-month");
    this.titleYear = title.createSpan("uc-year");

    const actions = head.createDiv("uc-actions");
    this.playBtn = actions.createEl("button", { cls: "uc-btn uc-play", attr: { "aria-label": "Play ripples" } });
    this.playBtn.innerHTML = ICON_PLAY;
    this.playBtn.onclick = () => (this.playing ? this.stopRipples() : this.playRipples());

    const toggle = actions.createEl("button", { cls: "uc-btn uc-mode", attr: { "aria-label": "Year of dots" } });
    toggle.innerHTML = ICON_DOTS;
    toggle.onclick = () => this.setMode(this.mode === "dots" ? "month" : "dots");

    // month mode
    const dow = root.createDiv("uc-dow-row");
    DAYS.forEach((d, i) => dow.createDiv({
      cls: "uc-dow" + (i === 0 || i === 6 ? " is-weekend" : "") + (i === RELEASE_DAY ? " is-release" : ""),
      text: d,
    }));

    this.scroller = root.createDiv("uc-scroll");
    this.track = this.scroller.createDiv("uc-track");

    const now = new Date();
    this.first = new Date(now.getFullYear(), now.getMonth() - BATCH, 1);
    this.last = new Date(now.getFullYear(), now.getMonth() + BATCH, 1);
    for (let d = new Date(this.first); d <= this.last; d.setMonth(d.getMonth() + 1)) {
      this.track.appendChild(this.monthEl(d.getFullYear(), d.getMonth()));
    }
    this.scroller.addEventListener("scroll", () => this.onScroll(), { passive: true });

    // dots mode
    this.dots = root.createDiv("uc-dots");
    this.buildDots();

    // floating footer
    const foot = this.foot = root.createDiv("uc-foot");
    this.footRel = foot.createSpan("uc-foot-rel");
    foot.createSpan("uc-foot-sep uc-foot-sep-rel");
    this.footWeek = foot.createSpan();
    foot.createSpan("uc-foot-sep");
    this.footDay = foot.createSpan();
    foot.createSpan("uc-foot-sep");
    this.footLeft = foot.createSpan();
    this.showStats(null);

    // floating nav above the footer — revealed only near the bottom edge
    const nav = root.createDiv("uc-nav");
    const prev = nav.createEl("button", { cls: "uc-btn uc-arrow", attr: { "aria-label": "Previous month" } });
    prev.innerHTML = ICON_PREV;
    this.todayBtn = nav.createEl("button", { cls: "uc-btn uc-today", text: "Today" });
    const next = nav.createEl("button", { cls: "uc-btn uc-arrow", attr: { "aria-label": "Next month" } });
    next.innerHTML = ICON_NEXT;
    prev.onclick = () => this.step(-1);
    next.onclick = () => this.step(1);
    this.todayBtn.onclick = () => this.goToday(true);

    // shown while scrolling; hides 5 s after the last scroll unless it is being hovered
    this.nav = nav;
    nav.addEventListener("mouseleave", () => this.scheduleNavHide());

    // hover + click, shared by both modes
    for (const host of [this.track, this.dots]) {
      host.addEventListener("mouseover", (e) => {
        const cell = e.target.closest?.("[data-t]");
        if (cell) this.showStats(new Date(+cell.dataset.t));
      });
      host.addEventListener("mouseleave", () => this.showStats(null));
      host.addEventListener("click", (e) => {
        const cell = e.target.closest?.("[data-t]");
        if (cell) this.copy(new Date(+cell.dataset.t));
      });
    }

    for (const ev of ["wheel", "touchmove", "keydown"]) {
      this.scroller.addEventListener(ev, () => { this.navArmed = true; }, { passive: true });
    }

    // any input resets the drift-back-to-today timer
    for (const ev of ["scroll", "wheel", "pointermove", "pointerdown", "keydown"]) {
      this.contentEl.addEventListener(ev, () => this.resetIdle(), { passive: true, capture: true });
    }

    // keep the same month in place / re-fit the dots when the pane is resized
    this.resizeObs = new ResizeObserver(() => {
      if (this.mode === "dots") this.layoutDots();
      else if (this.active) this.scrollToMonth(this.active, false);
    });
    this.resizeObs.observe(this.contentEl);

    this.setMode(this.mode);
  }

  setMode(mode) {
    this.mode = mode;
    this.app.saveLocalStorage(MODE_KEY, mode);
    this.root.toggleClass("is-dots", mode === "dots");
    this.showStats(null);
    if (mode !== "dots") this.stopRipples();
    if (mode === "dots") {
      window.clearTimeout(this.idleTimer);
      this.setTitle(new Date());
      requestAnimationFrame(() => this.layoutDots());
    } else {
      this.active = null;
      requestAnimationFrame(() => this.goToday(false));
    }
  }

  setTitle(d) {
    this.titleMonth.setText(monthName(d.getFullYear(), d.getMonth()));
    this.titleYear.setText(String(d.getFullYear()));
  }

  // ---------- month mode ----------

  monthEl(y, m) {
    const el = createDiv({ cls: "uc-m", attr: { "data-y": y, "data-m": m } });
    const now = new Date();
    if (y === now.getFullYear() && m === now.getMonth()) el.addClass("is-current");

    const label = el.createDiv("uc-m-label");
    label.createSpan({ text: monthName(y, m) });
    // shown for January always; for every month when the pane is too narrow for the header year
    label.createSpan({ cls: "uc-m-year" + (m === 0 ? " is-jan" : ""), text: String(y) });

    const lead = new Date(y, m, 1).getDay();
    const count = new Date(y, m + 1, 0).getDate();
    const weeks = Math.ceil((lead + count) / 7);
    const grid = el.createDiv("uc-m-grid");
    grid.style.setProperty("--uc-weeks", String(weeks));

    // spill days from the neighbouring months fill the first and last weeks, faded
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(y, m, 1 - lead + i);
      const out = d.getMonth() !== m;
      const cls = ["uc-day"];
      if (out) cls.push("is-out");
      if (d.getDay() === 0 || d.getDay() === 6) cls.push("is-weekend");
      if (d.getDay() === RELEASE_DAY) cls.push("is-release");
      // today is only marked in its own month, never in a neighbour's spill
      if (!out && keyOf(d) === this.today) cls.push("is-today");
      const cell = grid.createDiv({ cls: cls.join(" "), attr: { "data-t": d.getTime() } });
      if (!out) cell.setAttr("data-key", keyOf(d));
      cell.createSpan({ cls: "uc-num", text: String(d.getDate()) });
    }
    return el;
  }

  onScroll() {
    if (this.mode !== "month") return;
    const s = this.scroller;
    const h = this.track.firstElementChild?.offsetHeight || s.clientHeight;
    if (s.scrollTop < h * EDGE) this.prepend();
    if (s.scrollTop + s.clientHeight > s.scrollHeight - h * EDGE) this.append();
    this.updateActive();
    if (this.navArmed) this.showNav();
  }

  showNav() {
    this.root.addClass("is-nav-shown");
    this.scheduleNavHide();
  }

  scheduleNavHide() {
    window.clearTimeout(this.navTimer);
    this.navTimer = window.setTimeout(() => {
      if (!this.nav.matches(":hover")) this.root.removeClass("is-nav-shown");
    }, NAV_MS);
  }

  prepend() {
    const frag = document.createDocumentFragment();
    const start = new Date(this.first.getFullYear(), this.first.getMonth() - BATCH, 1);
    for (let i = 0; i < BATCH; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      frag.appendChild(this.monthEl(d.getFullYear(), d.getMonth()));
    }
    const before = this.scroller.scrollHeight;
    this.track.prepend(frag);
    // compensate exactly for the added height so nothing moves on screen
    this.scroller.scrollTop += this.scroller.scrollHeight - before;
    this.first = start;
  }

  append() {
    for (let i = 1; i <= BATCH; i++) {
      const d = new Date(this.last.getFullYear(), this.last.getMonth() + i, 1);
      this.track.appendChild(this.monthEl(d.getFullYear(), d.getMonth()));
    }
    this.last = new Date(this.last.getFullYear(), this.last.getMonth() + BATCH, 1);
  }

  updateActive() {
    const mid = this.scroller.scrollTop + this.scroller.clientHeight / 2;
    let hit = null;
    for (const el of this.track.children) {
      if (el.offsetTop <= mid && el.offsetTop + el.offsetHeight > mid) { hit = el; break; }
    }
    if (!hit || hit === this.active) return;
    this.active?.removeClass("is-active");
    hit.addClass("is-active");
    this.active = hit;
    this.setTitle(new Date(+hit.dataset.y, +hit.dataset.m, 1));
    this.todayBtn.toggleClass("is-away", !hit.hasClass("is-current"));
  }

  scrollToMonth(el, smooth) {
    this.navArmed = false; // programmatic scrolls don't reveal the floating nav
    // centre the month so a sliver of each neighbour peeks in
    const peek = (this.scroller.clientHeight - el.offsetHeight) / 2;
    this.scroller.scrollTo({ top: el.offsetTop - peek, behavior: smooth ? "smooth" : "auto" });
    if (!smooth) this.updateActive();
  }

  step(n) {
    const target = n < 0 ? this.active?.previousElementSibling : this.active?.nextElementSibling;
    if (target) this.scrollToMonth(target, true);
  }

  goToday(smooth) {
    const el = this.track.querySelector(".uc-m.is-current");
    if (el) this.scrollToMonth(el, smooth);
  }

  resetIdle() {
    window.clearTimeout(this.idleTimer);
    if (this.mode !== "month") return;
    this.idleTimer = window.setTimeout(() => {
      if (this.mode === "month" && this.active && !this.active.hasClass("is-current")) this.goToday(true);
    }, IDLE_MS);
  }

  markToday() {
    this.track.querySelectorAll(".is-today").forEach((e) => e.removeClass("is-today"));
    this.track.querySelector(`[data-key="${this.today}"]`)?.addClass("is-today");
    const now = new Date();
    this.track.querySelectorAll(".uc-m").forEach((m) =>
      m.toggleClass("is-current", +m.dataset.y === now.getFullYear() && +m.dataset.m === now.getMonth()));
  }

  // ---------- dots mode: one dot per day of the year ----------

  buildDots() {
    this.dots.empty();
    const now = midnight(new Date());
    const y = now.getFullYear();
    this.dotCount = daysInYear(y);
    this.dotGrid = this.dots.createDiv("uc-dots-grid");
    this.dotEls = [];
    for (let i = 0; i < this.dotCount; i++) {
      const d = new Date(y, 0, 1 + i);
      const cls = ["uc-dot"];
      if (d < now) cls.push("is-past");
      else if (d.getTime() === now.getTime()) cls.push("is-today");
      this.dotEls.push(this.dotGrid.createDiv({ cls: cls.join(" "), attr: { "data-t": d.getTime() } }));
    }
    this.dotW = new Float32Array(this.dotCount);
    if (this.mode === "dots") this.layoutDots();
  }

  // pick the column count whose cells come out closest to square for this pane
  layoutDots() {
    const w = this.dots.clientWidth, h = this.dots.clientHeight;
    if (!w || !h) return;
    const n = this.dotCount;
    let best = null;
    for (let cols = 7; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const cell = Math.min(w / cols, h / rows);
      if (!best || cell > best.cell) best = { cols, rows, cell };
    }
    this.cols = best.cols;
    this.rows = best.rows;
    const g = this.dotGrid.style;
    g.setProperty("--cols", String(best.cols));
    g.setProperty("--cell", `${Math.floor(best.cell * 100) / 100}px`);
  }

  // ---------- ambient ripples (dots mode) ----------
  // Ripples start at random dots and roll outward as soft rings. Each dot's
  // --w (0..1) is the sum of the rings passing over it; CSS maps it to scale + tint.

  playRipples() {
    if (this.playing || this.mode !== "dots") return;
    this.playing = true;
    this.ripples = [];
    this.nextSpawn = 0;
    this.root.removeClass("is-settling");
    this.root.addClass("is-playing");
    this.playBtn.innerHTML = ICON_PAUSE;
    this.playBtn.setAttr("aria-label", "Pause ripples");
    const frame = (t) => {
      if (!this.playing) return;
      this.tickRipples(t);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stopRipples() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.playBtn.innerHTML = ICON_PLAY;
    this.playBtn.setAttr("aria-label", "Play ripples");
    // let every dot ease back to rest
    this.root.removeClass("is-playing");
    this.root.addClass("is-settling");
    this.dotW.fill(0);
    for (const el of this.dotEls) el.style.removeProperty("--w");
    window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => this.root.removeClass("is-settling"), 1400);
  }

  spawnRipple(t) {
    const i = Math.floor(Math.random() * this.dotCount);
    const x = i % this.cols, y = Math.floor(i / this.cols);
    const far = Math.hypot(Math.max(x, this.cols - x), Math.max(y, this.rows - y));
    this.ripples.push({
      x, y, born: t, far,
      speed: rand(2.2, 4.2),   // cells per second — slow
      width: rand(0.9, 1.9),   // ring thickness in cells
      amp: rand(0.55, 1),
    });
  }

  tickRipples(t) {
    if (t >= this.nextSpawn) {
      this.spawnRipple(t);
      this.nextSpawn = t + rand(2000, 5200);
    }

    const w = this.dotW;
    w.fill(0);
    this.ripples = this.ripples.filter((r) => {
      const age = (t - r.born) / 1000;
      const radius = age * r.speed;
      if (radius > r.far + r.width * 3) return false;
      // swell in over the first second, fade as the ring travels outward
      const strength = r.amp * Math.min(1, age / 1.1) * Math.exp(-radius / (r.far * 0.75));
      const reach = r.width * 3;
      for (let i = 0; i < this.dotCount; i++) {
        const dx = (i % this.cols) - r.x, dy = Math.floor(i / this.cols) - r.y;
        const off = Math.hypot(dx, dy) - radius;
        if (off > reach || off < -reach) continue;
        w[i] += strength * Math.exp(-(off * off) / (2 * r.width * r.width));
      }
      return true;
    });

    for (let i = 0; i < this.dotCount; i++) {
      const v = Math.min(1, w[i]);
      const el = this.dotEls[i];
      const prev = el._w || 0;
      if (Math.abs(v - prev) < 0.004) continue;
      el._w = v;
      el.style.setProperty("--w", v.toFixed(3));
    }
  }

  // ---------- footer ----------

  showStats(d) {
    this.hovered = d;
    const hovering = !!d;
    d = d || new Date();
    const y = d.getFullYear();
    const doy = dayOfYear(d);
    this.footWeek.setText(`W${isoWeek(d)}`);
    this.footDay.setText(`D${doy}`);
    this.footLeft.setText(`${daysInYear(y) - doy}D → ${y + 1}`);
    this.footRel.setText(hovering ? relative(d) : "");
    this.foot.toggleClass("has-rel", hovering);
    if (this.mode === "dots") this.setTitle(d);
  }

  async copy(d) {
    try { await navigator.clipboard.writeText(longDate(d)); } catch (e) { return; }
    this.footRel.setText("Copied");
    this.foot.addClass("has-rel");
    this.foot.addClass("is-copied");
    window.clearTimeout(this.copyTimer);
    this.copyTimer = window.setTimeout(() => {
      this.foot.removeClass("is-copied");
      this.showStats(this.hovered);
    }, 1200);
  }
}

module.exports = class TufaCalendar extends Plugin {
  async onload() {
    this.registerView(VIEW, (leaf) => new CalendarView(leaf));
    this.addCommand({ id: "open", name: "Open calendar", callback: () => this.activate() });
    this.addRibbonIcon("calendar", "Calendar", () => this.activate());
    this.app.workspace.onLayoutReady(() => {
      if (!this.app.workspace.getLeavesOfType(VIEW).length) this.activate(false);
    });
  }

  async activate(reveal = true) {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(VIEW)[0];
    if (!leaf) {
      leaf = ws.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW, active: true });
    }
    if (reveal) ws.revealLeaf(leaf);
  }
};
