const ListPrompt = require("inquirer/lib/prompts/list");
const observe = require("inquirer/lib/utils/events");
const { takeUntil, filter } = require("rxjs/operators");
const ui = require("../ui.js");
//
/**
 * Custom list prompt with ESC and left arrow support.
 * Returns null when ESC is pressed (exit completely).
 * Returns { action: "back" } when left arrow is pressed (go back one level).
 */
class ListWithEscapePrompt extends ListPrompt {
  _run(cb) {
    this.done = cb;
    const events = observe(this.rl);
    const enableBack = this.opt.enableBack !== false;
    //
    // Handle ESC key - exit completely (always enabled). Only the prompt is cleaned, as
    // inputWithEscape does: the cursor sits on the last line of the list, so moving up
    // by the screen height would erase the line above the prompt too. The lines under
    // the prompt are reset, otherwise releaseCursor() would move the cursor down again,
    // and the cursor the list hid is shown again.
    events.keypress
      .pipe(
        takeUntil(events.line),
        filter(({ key }) => key && key.name === "escape")
      )
      .forEach(() => {
        this.rl.output.unmute();
        this.screen.clean(this.screen.extraLinesUnderPrompt);
        this.screen.extraLinesUnderPrompt = 0;
        this.rl.setPrompt("");
        ui.showCursor();
        this.done(null);
      });
    //
    // Handle left arrow - go back one level (only if enabled).
    if (enableBack) {
      events.keypress
        .pipe(
          takeUntil(events.line),
          filter(({ key }) => key && key.name === "left")
        )
        .forEach(() => {
          process.stdout.write(`\x1b[${(this.screen.height || 1) - 1}A\x1b[G\x1b[J`);
          this.screen.done();
          ui.showCursor();
          this.done({ action: "back" });
        });
    }
    //
    // Handle delete key - delete selected item (only if deleteFilter allows).
    events.keypress
      .pipe(
        takeUntil(events.line),
        filter(({ key }) => key && key.name === "delete")
      )
      .forEach(() => {
        const selectedValue = this.opt.choices.getChoice(this.selected).value;
        // Check if delete is allowed for this item.
        const deleteFilter = this.opt.deleteFilter;
        if (deleteFilter && !deleteFilter(selectedValue)) {
          return; // Ignore delete key for this item.
        }
        process.stdout.write(`\x1b[${(this.screen.height || 1) - 1}A\x1b[G\x1b[J`);
        this.screen.done();
        ui.showCursor();
        this.done({ action: "delete", value: selectedValue });
      });
    //
    return super._run(cb);
  }
}
//
module.exports = ListWithEscapePrompt;
