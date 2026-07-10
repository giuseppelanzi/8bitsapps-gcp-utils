const ListPrompt = require("inquirer/lib/prompts/list");
const Choices = require("inquirer/lib/objects/choices");
const Separator = require("inquirer/lib/objects/separator");
const observe = require("inquirer/lib/utils/events");
const rxjs = require("rxjs");
const { takeUntil } = require("rxjs/operators");
const ui = require("../ui.js");
//
// Sentinel for the "load more" row: a Symbol cannot collide with real values.
const LOAD_MORE = Symbol("loadMore");
//
/**
 * List prompt with incremental type-to-filter and "load more" pagination.
 *
 * Options:
 * - source: filterable items as [{name, value, search}], search already lowercase.
 * - footer: fixed rows (choices or separators), never filtered nor windowed.
 * - pageWindow / pageStep: initial window size and load-more increment.
 * - enableBack: left arrow returns { action: "back" } (only with empty filter).
 * - deleteFilter: DEL returns { action: "delete", value } when it accepts the
 *   selected value; unlike listWithEscape, DEL is ignored when it is absent.
 * - state: out-param object; receives state.filterTerm on every rebuild.
 * - formatLoadMore / noMatchesText: injected formatters for the meta rows.
 *
 * Returns null on ESC with empty filter (ESC with an active filter clears it),
 * { action: "back" }, { action: "delete", value }, or the chosen value.
 */
class FilterableListPrompt extends ListPrompt {
  constructor(questions, rl, answers) {
    super({ ...questions, choices: [] }, rl, answers);
    if (!this.opt.source) {
      this.throwParamError("source");
    }
    this.filterTerm = "";
    this.initialWindow = this.opt.pageWindow || 30;
    this.pageStep = this.opt.pageStep || this.initialWindow;
    this.windowSize = this.initialWindow;
    this.selected = 0;
    this.rebuild();
  }
  //
  /**
   * Recomputes choices from source: filter first, then window, then footer.
   */
  rebuild() {
    const term = this.filterTerm.toLowerCase();
    const matches = term ? this.opt.source.filter((item) => item.search.includes(term)) : this.opt.source;
    const windowed = matches.slice(0, this.windowSize);
    const rows = windowed.map((item) => ({ name: item.name, value: item.value }));
    if (matches.length > windowed.length) {
      const label = this.opt.formatLoadMore
        ? this.opt.formatLoadMore(windowed.length, matches.length)
        : `Load more (${windowed.length}/${matches.length})`;
      rows.push({ name: label, value: LOAD_MORE });
    }
    if (this.opt.source.length > 0 && windowed.length === 0) {
      rows.push(new Separator(this.opt.noMatchesText ? this.opt.noMatchesText() : "(no matches)"));
    }
    for (const row of this.opt.footer || []) {
      rows.push(row);
    }
    this.opt.choices = new Choices(rows, this.answers);
    if (this.selected >= this.opt.choices.realLength) {
      this.selected = Math.max(this.opt.choices.realLength - 1, 0);
    }
    this.opt.suffix = this.filterTerm ? ` [filter: ${this.filterTerm}]` : "";
    if (this.opt.state) {
      this.opt.state.filterTerm = this.filterTerm;
    }
  }
  //
  /**
   * Starts the prompt. Deliberately does not call super._run(): the base
   * subscribes line with take(1) (which would end the prompt on the first
   * Enter, breaking load-more) and numberKey (which would steal digits from
   * the filter). Every subscription completes through stop$ on any exit path
   * so no keypress listener survives into the next prompt of a loop.
   */
  _run(cb) {
    this.done = cb;
    this.stop$ = new rxjs.Subject();
    const events = observe(this.rl);
    events.keypress.pipe(takeUntil(this.stop$)).forEach(this.onKeypress.bind(this));
    events.line.pipe(takeUntil(this.stop$)).forEach(this.onLine.bind(this));
    ui.hideCursor();
    this.render();
    return this;
  }
  //
  /**
   * Single keypress dispatcher. Navigation reacts only to arrows and
   * Ctrl+P/Ctrl+N (not j/k as in the stock list prompt: those must filter);
   * digits filter too, so there is no jump-to-index here.
   */
  onKeypress({ value, key }) {
    // readline keeps accumulating typed characters: zero it so the screen
    // manager's rl.line.length subtraction stays a no-op and the shown term
    // remains fully under our control (via opt.suffix).
    this.rl.line = "";
    this.rl.cursor = 0;
    const name = key && key.name;
    if (name === "up" || (name === "p" && key.ctrl)) {
      this.moveSelection("up");
      return;
    }
    if (name === "down" || (name === "n" && key.ctrl)) {
      this.moveSelection("down");
      return;
    }
    if (name === "escape") {
      this.onEscape();
      return;
    }
    if (name === "left") {
      this.onBack();
      return;
    }
    if (name === "delete") {
      this.onDelete();
      return;
    }
    if (name === "backspace") {
      if (this.filterTerm.length > 0) {
        this.filterTerm = this.filterTerm.slice(0, -1);
        this.onFilterChanged();
      }
      return;
    }
    if (value && value.length === 1 && value >= " " && !(key && (key.ctrl || key.meta))) {
      this.filterTerm += value;
      this.onFilterChanged();
    }
  }
  //
  /**
   * A filter change resets the window and the selection.
   */
  onFilterChanged() {
    this.windowSize = this.initialWindow;
    this.selected = 0;
    this.rebuild();
    this.render();
  }
  //
  /**
   * Moves the selection, skipping when there is nothing selectable.
   */
  moveSelection(direction) {
    if (this.opt.choices.realLength === 0) {
      return;
    }
    if (direction === "up") {
      this.onUpKey();
    } else {
      this.onDownKey();
    }
  }
  //
  /**
   * Enter: intercepts the LOAD_MORE sentinel (widen and re-render, never
   * close), otherwise resolves with the selected value.
   */
  onLine() {
    const choice = this.opt.choices.getChoice(this.selected);
    if (!choice) {
      this.render();
      return;
    }
    if (choice.value === LOAD_MORE) {
      this.windowSize += this.pageStep;
      this.rebuild();
      this.render();
      return;
    }
    this.finalize(choice.value);
  }
  //
  /**
   * ESC in two steps: clears an active filter first, exits on empty filter.
   */
  onEscape() {
    if (this.filterTerm) {
      this.filterTerm = "";
      this.onFilterChanged();
      return;
    }
    this.finalizeWithClear(null, this.screen.height);
  }
  //
  /**
   * Left arrow: goes back one level, only with an empty filter.
   */
  onBack() {
    if (this.opt.enableBack === false || this.filterTerm) {
      return;
    }
    this.finalizeWithClear({ action: "back" }, (this.screen.height || 1) - 1);
  }
  //
  /**
   * DEL: resolves with a delete action when deleteFilter accepts the value.
   */
  onDelete() {
    const choice = this.opt.choices.getChoice(this.selected);
    if (!choice || choice.value === LOAD_MORE) {
      return;
    }
    if (!this.opt.deleteFilter || !this.opt.deleteFilter(choice.value)) {
      return;
    }
    this.finalizeWithClear({ action: "delete", value: choice.value }, (this.screen.height || 1) - 1);
  }
  //
  /**
   * Resolves through the answered render (Enter path).
   */
  finalize(value) {
    this.status = "answered";
    this.opt.suffix = "";
    this.render();
    this.screen.done();
    this.teardown();
    this.done(value);
  }
  //
  /**
   * Resolves by wiping the prompt area (ESC, back and delete paths), with
   * the same escape sequences listWithEscape uses so callers' line rewrites
   * keep working unchanged.
   */
  finalizeWithClear(value, linesUp) {
    process.stdout.write(`\x1b[${linesUp}A\x1b[J\x1b[G`);
    this.screen.done();
    this.teardown();
    this.done(value);
  }
  //
  /**
   * Restores the cursor and completes stop$ (idempotent).
   */
  teardown() {
    ui.showCursor();
    if (this.stop$) {
      this.stop$.next();
      this.stop$.complete();
    }
  }
  //
  /**
   * Force-close hook (Ctrl+C): same cleanup as a normal exit.
   */
  close() {
    this.teardown();
    super.close();
  }
}
//
module.exports = FilterableListPrompt;
