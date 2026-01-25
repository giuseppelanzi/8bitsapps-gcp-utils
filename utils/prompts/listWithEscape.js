const ListPrompt = require("inquirer/lib/prompts/list");
const observe = require("inquirer/lib/utils/events");
const { takeUntil, filter } = require("rxjs/operators");
const chalk = require("chalk");
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
        const height = this.screen.height || 1;
        const moveUp = Math.max(1, height - 1);
        process.stdout.write(`\x1b[${moveUp}A\x1b[J\x1b[G`);
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
          const height = this.screen.height || 1;
          const moveUp = Math.max(1, height - 1);
          process.stdout.write(`\x1b[${moveUp}A\x1b[J\x1b[G`);
          this.screen.done();
          this.done({ action: "back" });
        });
    }
    //
    return super._run(cb);
  }
}
//
module.exports = ListWithEscapePrompt;
