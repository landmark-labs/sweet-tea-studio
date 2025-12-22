import { atom } from "jotai";
import { atomFamily } from "jotai/utils";

export type FormData = Record<string, unknown>;

export const formDataAtom = atom<FormData>({});

export const setFormDataAtom = atom(null, (_get, set, next: FormData) => {
  set(formDataAtom, next);
});

export const mergeFormDataAtom = atom(null, (get, set, updates: FormData) => {
  const prev = get(formDataAtom);
  let changed = false;
  const next = { ...prev };
  for (const [key, value] of Object.entries(updates)) {
    if (next[key] !== value) {
      next[key] = value;
      changed = true;
    }
  }
  if (changed) set(formDataAtom, next);
});

export const formFieldAtom = atomFamily((key: string) =>
  atom(
    (get) => get(formDataAtom)[key],
    (get, set, value: unknown) => {
      const prev = get(formDataAtom);
      if (prev[key] === value) return;
      set(formDataAtom, { ...prev, [key]: value });
    }
  )
);
