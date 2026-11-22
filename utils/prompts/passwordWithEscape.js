const InputWithEscapePrompt = require("./inputWithEscape.js");
const ui = require("../ui.js");
//
const MASK_CHAR = "*";
//
/**
 * Masks a value with one character per character typed; an empty value stays empty.
 * @param {string} value - Typed value.
 * @returns {string} The mask.
 */
function mask(value) {
  return MASK_CHAR.repeat(String(value || "").length);
}
//
/**
 * Password prompt with ESC support: returns null on ESC, like inputWithEscape.
 * The mask goes through the transformer, so inquirer's own render() keeps the layout
 * and the validation error. Where inquirer's input prompt would show the value in
 * clear, these overrides mask it too: the spinner of async filters and validators,
 * and the line refilled after a validation error. No default is ever shown.
 */
class PasswordWithEscapePrompt extends InputWithEscapePrompt {
  constructor(question, rl, answers) {
    super(question, rl, answers);
    this.opt.default = null;
    this.opt.transformer = (value, _answers, { isFinal }) => {
      if (isFinal) {
        return value ? ui.formatGray("[hidden]") : "";
      }
      return mask(value);
    };
  }
  //
  /**
   * Masks the value shown next to the spinner of an async filter or validator.
   * @param {string} value - Typed value.
   * @returns {string} The mask.
   */
  getSpinningValue(value) {
    return mask(value);
  }
  //
  /**
   * Shows a validation error without putting the value back on the line, as
   * inquirer's password prompt does.
   * @param {{isValid: string}} state - Validation state.
   */
  onError({ isValid }) {
    this.render(isValid);
  }
}
//
module.exports = PasswordWithEscapePrompt;
