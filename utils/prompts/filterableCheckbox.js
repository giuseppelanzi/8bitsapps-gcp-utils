const Separator = require("inquirer/lib/objects/separator");
const FilterableListPrompt = require("./filterableList.js");
//
// Names of the command rows, passed to opt.formatCommand().
const SELECT_ALL = "selectAll";
const INVERT = "invert";
//
// Values of the command rows: objects compared by identity, as filterableList does with
// its Symbol for "Load more", so no item value can be taken for a command.
const SELECT_ALL_ROW = Object.freeze({ command: SELECT_ALL });
const INVERT_ROW = Object.freeze({ command: INVERT });
//
// A space that follows another key within this time belongs to a paste: readline
// emits a pasted text one key at a time, all at once, and no one types that fast.
const PASTE_GAP_MS = 15;
//
// Past this many chosen items, the answered line gives their count instead of their names.
const MAX_ANSWER_NAMES = 3;
//
// Whitespace, ignored when searching: "provapippo" finds "prova pippo.txt".
const WHITESPACE_PATTERN = /\s+/g;
//
// Line between the list and the command rows.
const FOOTER_SEPARATOR = "─".repeat(13);
//
/**
 * Lowercases a text and drops its whitespace, for the search.
 * @param {string} text - Text.
 * @returns {string} The compacted text.
 */
function compact(text) {
  return String(text).toLowerCase().replace(WHITESPACE_PATTERN, "");
}
//
/**
 * Multiple choice built on filterableList: typing searches, ignoring whitespace; SPACE
 * selects the highlighted item, and the selection survives any later search.
 *
 * Options:
 * - source: items as [{name, value, short, search}], search lowercase; values unique.
 * - pageWindow / pageStep: as in filterableList; the window counts the matches only.
 * - formatMark(checked), formatCommand(command, filtered), formatAnswer(text),
 *   formatLoadMore, noMatchesText: injected formatters, so the prompt imports no chalk.
 *   command is "selectAll" or "invert"; filtered tells whether a filter is active.
 *
 * Rows: the matches inside the window, plus every selected item that does not match,
 * all in source order; then "Select all" and "Invert", which act on the matches only.
 * ENTER on an item returns the selected values in source order, or the highlighted one
 * when nothing is selected. ESC clears an active filter first, then returns null,
 * cleaning only this prompt, as filterableList does. The left arrow and DEL do nothing.
 */
class FilterableCheckboxPrompt extends FilterableListPrompt {
  constructor(questions, rl, answers) {
    super({
      formatMark: checked => (checked ? "(x)" : "( )"),
      formatCommand: (command, filtered) => `${command === SELECT_ALL ? "Select all" : "Invert"}${filtered ? " matching" : ""}`,
      formatAnswer: text => text,
      ...questions,
      enableBack: false,
      deleteFilter: undefined
    }, rl, answers);
    this.answer = "";
    this.lastKeyAt = 0;
  }
  //
  /**
   * Values of the selected items. Created on first use: the base constructor rebuilds
   * the rows before this constructor can assign fields.
   * @returns {Set} The selected values.
   */
  get checked() {
    if (!this.checkedValues) {
      this.checkedValues = new Set();
    }
    return this.checkedValues;
  }
  //
  /**
   * Values of the source items, so a selection never takes "Load more" or a command.
   * @returns {Set} The values of the source.
   */
  get itemValues() {
    if (!this.sourceValues) {
      this.sourceValues = new Set(this.opt.source.map(item => item.value));
    }
    return this.sourceValues;
  }
  //
  /**
   * The search text of every item, lowercase and without whitespace, computed once.
   * @returns {Map} Item to compacted search text.
   */
  get compactSearch() {
    if (!this.compactedSearch) {
      this.compactedSearch = new Map(this.opt.source.map(item => [item, compact(item.search)]));
    }
    return this.compactedSearch;
  }
  //
  /**
   * The items whose search matches the term, whitespace ignored on both sides.
   * @param {string} term - Filter term, lowercase.
   * @returns {Array} The matching items.
   */
  matchItems(term) {
    const needle = compact(term);
    return needle ? this.opt.source.filter(item => this.compactSearch.get(item).includes(needle)) : this.opt.source;
  }
  //
  /**
   * The matches inside the window, plus every selected item, in source order.
   * @param {Array} windowedMatches - Matching items inside the window.
   * @returns {Array} The items to show.
   */
  visibleItems(windowedMatches) {
    const shown = new Set(windowedMatches);
    return this.opt.source.filter(item => shown.has(item) || this.checked.has(item.value));
  }
  //
  /**
   * A row with its selection mark.
   * @param {{name: string, value: *, short: string}} item - Source item.
   * @returns {{name: string, value: *, short: string}} The row.
   */
  toRow(item) {
    return { name: `${this.opt.formatMark(this.checked.has(item.value))} ${item.name}`, value: item.value, short: item.short };
  }
  //
  /**
   * The command rows, labelled for the filter state.
   * @returns {Array} A separator and the two commands.
   */
  buildFooter() {
    const filtered = Boolean(this.filterTerm);
    return [
      new Separator(FOOTER_SEPARATOR),
      { name: this.opt.formatCommand(SELECT_ALL, filtered), value: SELECT_ALL_ROW },
      { name: this.opt.formatCommand(INVERT, filtered), value: INVERT_ROW }
    ];
  }
  //
  /**
   * Rebuilds the rows, and adds the count of the selection to the suffix.
   */
  rebuild() {
    super.rebuild();
    if (this.checked.size > 0) {
      this.opt.suffix += ` [${this.checked.size} selected]`;
    }
  }
  //
  /**
   * A filter change resets the window, as in the base, and moves the cursor to the first
   * match: the selected items stay in place, so with many of them the match could sit
   * out of view under the cursor at the top.
   */
  onFilterChanged() {
    this.windowSize = this.initialWindow;
    this.selected = 0;
    this.rebuild();
    if (this.filterTerm) {
      const matches = new Set(this.lastMatches.map(item => item.value));
      const index = this.opt.choices.realChoices.findIndex(choice => matches.has(choice.value));
      this.selected = Math.max(index, 0);
    }
    this.render();
  }
  //
  /**
   * SPACE selects; every other key goes to the base. readline's line is cleared first,
   * since a space would otherwise pile up in it. A space within PASTE_GAP_MS of the
   * previous key belongs to a pasted text: it is dropped, as the search ignores spaces.
   * @param {{value: string, key: object}} event - Keypress event.
   */
  onKeypress(event) {
    this.rl.line = "";
    this.rl.cursor = 0;
    const now = Date.now();
    const pasted = now - this.lastKeyAt < PASTE_GAP_MS;
    this.lastKeyAt = now;
    if (event.key && event.key.name === "space") {
      if (!pasted) {
        this.toggleHighlighted();
      }
      return;
    }
    super.onKeypress(event);
  }
  //
  /**
   * Selects or deselects the highlighted item; anything else is left alone.
   */
  toggleHighlighted() {
    const choice = this.opt.choices.getChoice(this.selected);
    if (!choice || !this.itemValues.has(choice.value)) {
      return;
    }
    if (this.checked.has(choice.value)) {
      this.checked.delete(choice.value);
    } else {
      this.checked.add(choice.value);
    }
    this.rebuildKeepingCursor(row => row.value === choice.value);
  }
  //
  /**
   * Applies a command row to the matches of the current filter only.
   * @param {string} command - "selectAll" or "invert".
   */
  applyCommand(command) {
    for (const item of this.lastMatches) {
      if (command === SELECT_ALL || !this.checked.has(item.value)) {
        this.checked.add(item.value);
      } else {
        this.checked.delete(item.value);
      }
    }
    this.rebuildKeepingCursor(row => row.value === (command === SELECT_ALL ? SELECT_ALL_ROW : INVERT_ROW));
  }
  //
  /**
   * Rebuilds the rows and puts the cursor back on the row it was on, since a selection
   * can add or drop rows above it; if that row is gone, the index is only clamped.
   * @param {function(object): boolean} isSameRow - Tells the row the cursor was on.
   */
  rebuildKeepingCursor(isSameRow) {
    this.rebuild();
    const index = this.opt.choices.realChoices.findIndex(isSameRow);
    if (index >= 0) {
      this.selected = index;
    }
    this.render();
  }
  //
  /**
   * ENTER: runs a command and stays open; on an item, answers with the selection, or
   * with the highlighted item when nothing is selected. The answer text is set first,
   * so the answered line never comes out empty. "Load more" goes to the base.
   */
  onLine() {
    const choice = this.opt.choices.getChoice(this.selected);
    const value = choice ? choice.value : undefined;
    if (choice && this.itemValues.has(value)) {
      const chosen = this.checked.size > 0
        ? this.opt.source.filter(item => this.checked.has(item.value))
        : this.opt.source.filter(item => item.value === value);
      this.answer = chosen.length > MAX_ANSWER_NAMES
        ? `${chosen.length} files`
        : chosen.map(item => item.short || item.name).join(", ");
      this.finalize(chosen.map(item => item.value));
      return;
    }
    if (value === SELECT_ALL_ROW || value === INVERT_ROW) {
      this.applyCommand(value.command);
      return;
    }
    super.onLine();
  }
  //
  /**
   * Renders the answered line with the chosen items; otherwise as the base.
   */
  render() {
    if (this.status === "answered") {
      this.screen.render(`${this.getQuestion()}${this.opt.formatAnswer(this.answer)}`);
      return;
    }
    super.render();
  }
}
//
module.exports = FilterableCheckboxPrompt;
