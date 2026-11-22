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
   * The window and "(no matches)" count the matches only; subclasses may show more
   * rows through visibleItems().
   */
  rebuild() {
    const term = this.filterTerm.toLowerCase();
    const matches = this.matchItems(term);
    const windowed = matches.slice(0, this.windowSize);
    const visible = this.visibleItems(windowed);
    const rows = visible.map((item) => this.toRow(item));
    //
    // "Load more" counts the matches actually shown, which visibleItems() may widen.
    const shown = new Set(visible);
    const shownMatches = matches.filter((item) => shown.has(item)).length;
    this.lastMatches = matches;
    this.shownItems = shown;
    this.shownMatchCount = shownMatches;
    if (shownMatches < matches.length) {
      const label = this.opt.formatLoadMore
        ? this.opt.formatLoadMore(shownMatches, matches.length)
        : `Load more (${shownMatches}/${matches.length})`;
      rows.push({ name: label, value: LOAD_MORE });
    }
    if (this.opt.source.length > 0 && matches.length === 0) {
      rows.push(new Separator(this.opt.noMatchesText ? this.opt.noMatchesText() : "(no matches)"));
    }
    for (const row of this.buildFooter()) {
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
   * Extension point: the source items that match the filter term, in source order.
   * @param {string} term - Filter term, lowercase.
   * @returns {Array} The matching items.
   */
  matchItems(term) {
    return term ? this.opt.source.filter((item) => item.search.includes(term)) : this.opt.source;
  }
  //
  /**
   * Extension point: the items shown, given the matches inside the window.
   * @param {Array} windowedMatches - Matching items inside the window.
   * @returns {Array} The items to show, in source order.
   */
  visibleItems(windowedMatches) {
    return windowedMatches;
  }
  //
  /**
   * Extension point: the choice row of a source item.
   * @param {{name: string, value: *}} item - Source item.
   * @returns {{name: string, value: *}} The row.
   */
  toRow(item) {
    return { name: item.name, value: item.value };
  }
  //
  /**
   * Extension point: the fixed rows under the list.
   * @returns {Array} Choices or separators.
   */
  buildFooter() {
    return this.opt.footer || [];
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
      this.loadMore();
      return;
    }
    this.finalize(choice.value);
  }
  //
  /**
   * Widens the window until pageStep more matches are shown, or all of them, and puts
   * the cursor on the first match that was hidden. Plain lists need one step, with the
   * cursor where "Load more" was; a subclass that shows rows outside the window may need
   * more, so a press is never wasted on rows already on screen.
   */
  loadMore() {
    const before = this.shownItems;
    const target = Math.min(this.lastMatches.length, this.shownMatchCount + this.pageStep);
    do {
      this.windowSize += this.pageStep;
      this.rebuild();
    } while (this.shownMatchCount < target);
    const firstNew = this.lastMatches.find((item) => !before.has(item));
    const index = firstNew ? this.opt.choices.realChoices.findIndex((choice) => choice.value === firstNew.value) : -1;
    if (index >= 0) {
      this.selected = index;
    }
    this.render();
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
    this.cancel();
  }
  //
  /**
   * Resolves with null, cleaning only the prompt off the screen, as inputWithEscape and
   * listWithEscape do: the cursor sits on the last line of the list, so moving up by the
   * screen height would erase the line above the prompt too. The cursor is left at the
   * start of the question line, so a caller can write its trail there. The lines under
   * the prompt are reset, otherwise releaseCursor() would move the cursor down again.
   */
  cancel() {
    this.rl.output.unmute();
    this.screen.clean(this.screen.extraLinesUnderPrompt);
    this.screen.extraLinesUnderPrompt = 0;
    this.rl.setPrompt("");
    this.teardown();
    this.done(null);
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
   * Resolves by wiping the prompt area (back and delete paths), with the same
   * escape sequences listWithEscape uses, so callers can rewrite the question
   * line above the cursor. The cursor moves to column 0 before clearing, so no
   * part of the question line survives.
   */
  finalizeWithClear(value, linesUp) {
    process.stdout.write(`\x1b[${linesUp}A\x1b[G\x1b[J`);
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
