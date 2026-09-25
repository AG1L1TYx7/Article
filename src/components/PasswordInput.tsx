"use client";

import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from "react";
import { EyeIcon, EyeOffIcon } from "./icons";
import { useI18n } from "@/i18n/client";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /**
   * Width constraints go here, not on `className`. The button is
   * positioned against this wrapper, so an input narrowed on its own
   * (`sm:max-w-xs`) would leave the eye floating past its right edge.
   */
  wrapperClassName?: string;
};

/**
 * A password field with a button that shows what has been typed.
 *
 * Drop-in for `<input type="password">`: every other prop passes straight
 * through, including `value`/`onChange` for controlled forms and `name`
 * for ones read with FormData.
 *
 * Three details that are easy to get wrong:
 *
 * - It sits inside the `<label className="field">` the forms already use.
 *   A label with no `for` labels its first labelable descendant, so the
 *   input comes before the button in the markup; the other way round,
 *   clicking the field's caption would toggle visibility instead of
 *   focusing the field. A click on the button itself is not forwarded,
 *   because a label ignores clicks on interactive content inside it.
 *
 * - It hides the password again when its form is submitted, and does so
 *   synchronously, by setting the DOM property before React re-renders.
 *   Browsers and password managers decide whether to offer to save a
 *   password by looking for a password-type field at submit time; a
 *   field left showing as text is not saved. It also means a password
 *   shown to check a typo is not left on screen after signing in.
 *
 * - The button is `type="button"`, or pressing it would submit the form.
 *   It stays in the tab order: someone using a keyboard or a screen
 *   reader is the person most likely to want to hear what they typed.
 */
export function PasswordInput({ className = "input", wrapperClassName = "", id, ...rest }: Props) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    function hide() {
      if (inputRef.current) inputRef.current.type = "password";
      setVisible(false);
    }
    // Capture phase: runs before the form's own submit handler, so the
    // field is a password field by the time anything reads it.
    form.addEventListener("submit", hide, true);
    return () => form.removeEventListener("submit", hide, true);
  }, []);

  const label = visible ? t("common.hidePassword") : t("common.showPassword");

  return (
    <span className={`relative block ${wrapperClassName}`}>
      <input
        {...rest}
        ref={inputRef}
        id={inputId}
        type={visible ? "text" : "password"}
        // Shown as text, a phone would otherwise capitalise the first
        // letter and "correct" the rest, silently changing the password.
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={label}
        title={label}
        aria-pressed={visible}
        aria-controls={inputId}
        disabled={rest.disabled}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-ink-3 transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {visible ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
      </button>
    </span>
  );
}
