const InputPrompt = require("inquirer/lib/prompts/input");
const observe = require("inquirer/lib/utils/events");
const rxjs = require("rxjs");
const { map, takeUntil } = require("rxjs/operators");
//
/**
 * Input prompt with ESC support.
 * Returns null when ESC is pressed, skipping filter and validation.
 */
class InputWithEscapePrompt extends InputPrompt {
  /**
   * Starts the prompt. Deliberately does not call super._run(): there the keypress
   * stream lives until the first valid answer, so it would redraw the prompt right
   * after ESC cleared it. Every subscription completes through stop$, on a valid
   * answer as well as on ESC, so ESC keeps working after a validation error and no
   * submit can arrive once the prompt is gone.
   */
  _run(cb) {
    this.done = cb;
    this.stop$ = new rxjs.Subject();
    const events = observe(this.rl);
    const submit = events.line.pipe(takeUntil(this.stop$), map(this.filterInput.bind(this)));
    const validation = this.handleSubmitEvents(submit);
    validation.success.forEach(state => {
      this.stop();
      this.onEnd(state);
    });
    validation.error.forEach(this.onError.bind(this));
    events.keypress.pipe(takeUntil(this.stop$)).forEach(event => {
      if (event.key && event.key.name === "escape") {
        this.onEscape();
        return;
      }
      this.onKeypress(event);
    });
    this.render();
    return this;
  }
  //
  /**
   * Completes every subscription of the prompt.
   */
  stop() {
    this.stop$.next();
    this.stop$.complete();
  }
  //
  /**
   * Clears the prompt, and the validation error under it, then resolves with null.
   * render() leaves the output muted, so it is unmuted before cleaning. The lines
   * under the prompt are reset afterwards, otherwise releaseCursor() would move the
   * cursor down again when the UI closes. screen.done() is not called, since it
   * would print a newline where the prompt was.
   */
  onEscape() {
    this.rl.output.unmute();
    this.screen.clean(this.screen.extraLinesUnderPrompt);
    this.screen.extraLinesUnderPrompt = 0;
    this.rl.setPrompt("");
    this.stop();
    this.done(null);
  }
}
//
module.exports = InputWithEscapePrompt;
