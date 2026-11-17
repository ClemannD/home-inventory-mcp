/**
 * Light, dark or system theme. index.html applies it before first paint; this
 * hook keeps React in sync and follows the system while "system" is chosen.
 */
import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";

const KEY = "theme";
const media = matchMedia("(prefers-color-scheme: dark)");

const stored = (): ThemeChoice => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
};

const apply = (choice: ThemeChoice) => {
  document.documentElement.dataset.theme = choice === "system" ? (media.matches ? "dark" : "light") : choice;
};

export const useTheme = () => {
  const [choice, setChoice] = useState<ThemeChoice>(stored);

  useEffect(() => {
    const onChange = () => {
      if (stored() === "system") apply("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const choose = useCallback((next: ThemeChoice) => {
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Private mode: the choice still applies to this page.
    }
    apply(next);
    setChoice(next);
  }, []);

  return { choice, choose };
};
