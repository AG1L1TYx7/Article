import { describe, expect, test } from "vitest";
import { DEFAULT_THEME, THEMES, THEME_COLOR, isTheme, parseTheme, themeAttribute } from "@/theme/config";

describe("theme", () => {
  test("the three states, with system as the default", () => {
    expect(THEMES).toEqual(["system", "light", "dark"]);
    expect(DEFAULT_THEME).toBe("system");
  });

  test("only the known words are themes", () => {
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("light")).toBe(true);
    expect(isTheme("system")).toBe(true);
    expect(isTheme("Dark")).toBe(false);
    expect(isTheme("")).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(isTheme(1)).toBe(false);
  });

  test("a bad or missing cookie means follow the system", () => {
    expect(parseTheme(undefined)).toBe("system");
    expect(parseTheme("blue")).toBe("system");
    expect(parseTheme("dark")).toBe("dark");
  });

  test("only a forced theme is stamped on <html>", () => {
    expect(themeAttribute("system")).toBeUndefined();
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
  });

  test("the browser-chrome colours are the two paper tokens", () => {
    expect(THEME_COLOR.light).toBe("#fafaf7");
    expect(THEME_COLOR.dark).toBe("#111418");
  });
});
