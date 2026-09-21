"use client";

import { useEffect, useRef } from "react";

/**
 * Applies a filter the moment it is changed.
 *
 * The search form is a plain GET form so it works without JavaScript;
 * this is the enhancement on top. Choosing "Sport" in the dropdown and
 * then hunting for the Search button is the kind of extra step people
 * read as "the filter did nothing". With JavaScript off the button still
 * does the job.
 *
 * Only selects, never the text box: submitting on every keystroke would
 * reload the page mid-word.
 */
export function SubmitOnChange({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const form = root.closest("form");
    if (!form) return;

    function onChange(event: Event) {
      if (event.target instanceof HTMLSelectElement) form!.requestSubmit();
    }
    root.addEventListener("change", onChange);
    return () => root.removeEventListener("change", onChange);
  }, []);

  return (
    <div ref={ref} className="contents">
      {children}
    </div>
  );
}
