const ListPrompt = require("inquirer/lib/prompts/list");
const observe = require("inquirer/lib/utils/events");
const { takeUntil, filter } = require("rxjs/operators");
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
    // Handle ESC key - exit completely (always enabled).
    events.keypress
      .pipe(
        takeUntil(events.line),
        filter(({ key }) => key && key.name === "escape")
      )
      .forEach(() => {
        process.stdout.write(`\x1b[${this.screen.height}A\x1b[J\x1b[G`);
        this.screen.done();
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
          process.stdout.write(`\x1b[${(this.screen.height || 1) - 1}A\x1b[J\x1b[G`);
          this.screen.done();
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
        process.stdout.write(`\x1b[${(this.screen.height || 1) - 1}A\x1b[J\x1b[G`);
        this.screen.done();
        this.done({ action: "delete", value: selectedValue });
      });
    //
    return super._run(cb);
  }
}
//
module.exports = ListWithEscapePrompt;
