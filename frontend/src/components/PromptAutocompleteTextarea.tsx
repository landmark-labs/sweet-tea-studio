import React, { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api, TagSuggestion } from "@/lib/api";
import type { PromptItem, PromptRehydrationItemV1 } from "@/lib/types";
import { useUndoRedo } from "@/lib/undoRedo";
import { logClientFrameLatency } from "@/lib/clientDiagnostics";
import { cancelIdle, scheduleIdle, type IdleHandle } from "@/lib/idleScheduler";
import { buildSnippetIndex, findSnippetMatches, selectNonOverlappingMatches, type SnippetMatch } from "@/lib/snippetMatcher";

const AUTOCOMPLETE_STORAGE_KEY = "sts_autocomplete_enabled";
const AUTOCOMPLETE_EVENT_NAME = "sts-autocomplete-enabled-changed";
const AUTOCOMPLETE_CACHE_MAX = 200;
const AUTOCOMPLETE_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_HIGHLIGHT_LENGTH = 5000;
const MAX_HIGHLIGHT_MATCHES = 500;
const HIGHLIGHT_DEBOUNCE_MS = 250;
const HIGHLIGHT_IDLE_TIMEOUT_MS = 400;

interface PromptAutocompleteTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    value: string;
    onValueChange: (value: string) => void;
    isActive?: boolean;
    snippets?: PromptItem[];
    highlightSnippets?: boolean;
    externalValueSyncKey?: number;
    rehydrationItems?: PromptRehydrationItemV1[];
    rehydrationKey?: number;
    showAutocompleteToggle?: boolean;
}

function computeScore(query: string, candidate: string): number {
    // Normalize: treat spaces and underscores as equivalent
    const normalize = (s: string) => s.toLowerCase().replace(/[\s_]+/g, "_");
    const q = normalize(query);
    const c = normalize(candidate);
    if (!q) return 0;

    // Prioritize prefix, then substring, then loose subsequence matches.
    if (c.startsWith(q)) return 6 + Math.min(3, q.length);
    if (c.includes(q)) return 4;

    // Simple subsequence scoring for fuzzy-ish matching
    let qi = 0;
    for (let ci = 0; ci < c.length && qi < q.length; ci++) {
        if (c[ci] === q[qi]) qi++;
    }
    return qi === q.length ? 2 : 0;
}

function highlightMatch(label: string, term: string): React.ReactNode {
    if (!term) return <>{label}</>;
    const lower = label.toLowerCase();
    const t = term.toLowerCase();
    const idx = lower.indexOf(t);

    if (idx === -1) return <>{label}</>;

    return (
        <>
            {label.slice(0, idx)}
            <span className="bg-amber-100 text-amber-900 rounded px-0.5">{label.slice(idx, idx + term.length)}</span>
            {label.slice(idx + term.length)}
        </>
    );
}

function sourceBadgeClass(source: string): string {
    if (source === "danbooru") return "bg-pink-50 text-pink-700 border-pink-200";
    if (source === "e621") return "bg-amber-50 text-amber-700 border-amber-200";
    if (source === "rule34") return "bg-green-50 text-green-700 border-green-200";
    return "bg-indigo-50 text-indigo-700 border-indigo-200";
}

/**
 * Strips weight syntax from prompt text.
 * Handles: (text:1.2) → text, ((text)) → text, [text] → text
 */
function stripWeights(text: string): string {
    let result = text;
    // Remove explicit weights: (text:1.2) → text
    result = result.replace(/\(([^()]+):[\d.]+\)/g, "$1");
    // Remove nested parentheses emphasis: ((text)) → text, (((text))) → text
    // Apply repeatedly until no more nested parens
    let prev = "";
    while (prev !== result) {
        prev = result;
        result = result.replace(/\(\(([^()]*)\)\)/g, "$1");
    }
    // Remove single emphasis parens if they wrap the entire segment
    result = result.replace(/^\(([^()]+)\)$/g, "$1");
    // Remove bracket de-emphasis: [text] → text
    result = result.replace(/\[([^\x5B\x5D]+)\]/g, "$1");
    return result;
}

export function PromptAutocompleteTextarea({
    value,
    onValueChange,
    isActive,
    className,
    onKeyDown,
    snippets = [],
    highlightSnippets,
    externalValueSyncKey,
    rehydrationItems,
    rehydrationKey,
    showAutocompleteToggle = true,
    ...props
}: PromptAutocompleteTextareaProps) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const backdropRef = useRef<HTMLDivElement | null>(null);

    // Segregated undo: notify global system when text input is focused
    const { setTextInputFocused } = useUndoRedo();
    const [autocompleteEnabled, setAutocompleteEnabled] = useState<boolean>(() => {
        if (typeof window === "undefined") return true;
        const raw = window.localStorage.getItem(AUTOCOMPLETE_STORAGE_KEY);
        if (raw === null) return true;
        return raw === "true";
    });
    const cacheRef = useRef<Map<string, { data: TagSuggestion[]; ts: number }>>(new Map());
    const abortControllerRef = useRef<AbortController | null>(null);
    // Track intended cursor position to restore after external value changes add delimiters
    const intendedCursorRef = useRef<number | null>(null);
    const [localValue, setLocalValue] = useState(value);
    const lastInputAtRef = useRef(0);
    const lastPropValueRef = useRef(value);
    const pendingExternalValueRef = useRef<string | null>(null);

    const [cursor, setCursor] = useState(0);
    const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
    const [highlightIndex, setHighlightIndex] = useState(0);
    const [isOpen, setIsOpen] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);

    useEffect(() => {
        if (value === lastPropValueRef.current) return;
        lastPropValueRef.current = value;

        const now = Date.now();
        const timeSinceInput = now - lastInputAtRef.current;
        const shouldSync = !isFocused || timeSinceInput > 350;

        if (shouldSync) {
            pendingExternalValueRef.current = null;
            if (value !== localValue) {
                intendedCursorRef.current = null;
                setLocalValue(value);
            }
        } else {
            pendingExternalValueRef.current = value;
        }
    }, [value, isFocused, localValue]);

    useEffect(() => {
        if (externalValueSyncKey === undefined) return;
        lastPropValueRef.current = value;
        pendingExternalValueRef.current = null;
        intendedCursorRef.current = null;
        setLocalValue(value);
    }, [externalValueSyncKey, value]);

    const pruneCache = (now: number) => {
        for (const [key, entry] of cacheRef.current) {
            if (now - entry.ts > AUTOCOMPLETE_CACHE_TTL_MS) {
                cacheRef.current.delete(key);
            }
        }

        while (cacheRef.current.size > AUTOCOMPLETE_CACHE_MAX) {
            const oldestKey = cacheRef.current.keys().next().value;
            if (oldestKey === undefined) break;
            cacheRef.current.delete(oldestKey);
        }
    };

    useEffect(() => {
        const onToggle = (event: Event) => {
            const custom = event as CustomEvent<{ enabled?: boolean }>;
            if (typeof custom.detail?.enabled === "boolean") {
                setAutocompleteEnabled(custom.detail.enabled);
            }
        };

        window.addEventListener(AUTOCOMPLETE_EVENT_NAME, onToggle as EventListener);
        return () => window.removeEventListener(AUTOCOMPLETE_EVENT_NAME, onToggle as EventListener);
    }, []);

    const toggleAutocomplete = () => {
        const next = !autocompleteEnabled;
        setAutocompleteEnabled(next);
        try {
            window.localStorage.setItem(AUTOCOMPLETE_STORAGE_KEY, String(next));
        } catch {
            // ignore (private mode / storage disabled)
        }
        window.dispatchEvent(new CustomEvent(AUTOCOMPLETE_EVENT_NAME, { detail: { enabled: next } }));

        if (!next) {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            setSuggestions([]);
            setIsOpen(false);
        }
    };

    const updateCursor = () => {
        if (!textareaRef.current) return;
        const next = textareaRef.current.selectionStart || 0;
        setCursor((prev) => (prev === next ? prev : next));
    };

    // Scroll Sync
    const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
        if (backdropRef.current) {
            backdropRef.current.scrollTop = e.currentTarget.scrollTop;
            backdropRef.current.scrollLeft = e.currentTarget.scrollLeft;
        }
    };

    // Restore cursor position after external value changes (e.g., when delimiters are auto-inserted)
    // Use useLayoutEffect to run synchronously before paint, preventing visible cursor flash
    useLayoutEffect(() => {
        if (intendedCursorRef.current !== null && textareaRef.current && document.activeElement === textareaRef.current) {
            const pos = Math.min(intendedCursorRef.current, localValue.length);
            textareaRef.current.setSelectionRange(pos, pos);
        }
    }, [localValue]);

    const currentToken = useMemo(() => {
        const before = localValue.slice(0, cursor);
        // Treat commas and parentheses as delimiters
        const lastDelimiter = Math.max(
            before.lastIndexOf(","),
            before.lastIndexOf("("),
            before.lastIndexOf(")")
        );
        const segment = lastDelimiter === -1 ? before : before.slice(lastDelimiter + 1);
        // Strip any remaining parentheses from the segment
        return segment.replace(/[()]/g, "").trim();
    }, [localValue, cursor]);

    // Defer token resolution to keep typing smooth under heavy render load
    const deferredToken = useDeferredValue(currentToken);

    useEffect(() => {
        if (!autocompleteEnabled) {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            setIsOpen(false);
            setSuggestions([]);
            return;
        }

        const token = deferredToken.trim();
        const normalizedToken = token.replace(/\s+/g, "_");

        // Require focus, active typing, and 3+ chars
        // Autocomplete only triggers on actual typing, not clicks or cursor moves
        if (!isFocused || !isTyping || normalizedToken.length < 3) {
            setIsOpen(false);
            setSuggestions([]);
            return;
        }

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;

        const load = async () => {
            const now = Date.now();
            pruneCache(now);
            const cached = cacheRef.current.get(normalizedToken);
            if (cached && now - cached.ts <= AUTOCOMPLETE_CACHE_TTL_MS) {
                cacheRef.current.delete(normalizedToken);
                cacheRef.current.set(normalizedToken, { data: cached.data, ts: now });
                setSuggestions(cached.data);
                setIsOpen(true);
                setHighlightIndex(0);
                return;
            }
            if (cached) {
                cacheRef.current.delete(normalizedToken);
            }

            try {
                const data = await api.getTagSuggestions(normalizedToken, 25, controller.signal);
                if (controller.signal.aborted) return;

                const writeTime = Date.now();
                cacheRef.current.set(normalizedToken, { data, ts: writeTime });
                pruneCache(writeTime);
                setSuggestions(data);
                setIsOpen(true);
                setHighlightIndex(0);
            } catch (e) {
                if (e instanceof Error && e.name === 'AbortError') return;
                console.error("Autocomplete suggestion fetch failed", e);
                setSuggestions([]);
                setIsOpen(false);
            }
        };

        // Increased debounce to 350ms to reduce API calls during active typing
        const handle = setTimeout(load, 350);
        return () => {
            clearTimeout(handle);
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, [deferredToken, autocompleteEnabled, isFocused, isTyping]);

    // Keep dropdown aligned without forcing layout thrash on every render
    useEffect(() => {
        const updateRect = () => {
            if (!textareaRef.current) return;
            const rect = textareaRef.current.getBoundingClientRect();
            setDropdownRect({
                top: rect.bottom + window.scrollY + 4,
                left: rect.left + window.scrollX,
                width: rect.width,
            });
        };

        updateRect();
        window.addEventListener("resize", updateRect, { passive: true });
        window.addEventListener("scroll", updateRect, { capture: true, passive: true });
        return () => {
            window.removeEventListener("resize", updateRect);
            window.removeEventListener("scroll", updateRect, true);
        };
    }, []);

    const rankedSuggestions = useMemo(() => {
        const token = deferredToken.trim();
        if (!token) return [];
        return suggestions
            .map((s) => ({ suggestion: s, score: computeScore(token, s.name) }))
            .filter((item) => item.score > 0)
            .sort((a, b) => {
                if (a.score !== b.score) return b.score - a.score;
                if (a.suggestion.frequency !== b.suggestion.frequency) return b.suggestion.frequency - a.suggestion.frequency;
                return a.suggestion.name.localeCompare(b.suggestion.name);
            })
            .slice(0, 15)
            .map((item) => item.suggestion);
    }, [suggestions, deferredToken]);

    const showDropdown = isOpen && rankedSuggestions.length > 0;

    useEffect(() => {
        if (!showDropdown || !textareaRef.current) return;
        const rect = textareaRef.current.getBoundingClientRect();
        setDropdownRect((prev) => {
            const next = {
                top: rect.bottom + window.scrollY + 4,
                left: rect.left + window.scrollX,
                width: rect.width,
            };
            return prev && prev.top === next.top && prev.left === next.left && prev.width === next.width ? prev : next;
        });
    }, [showDropdown, localValue, cursor]);

    const insertSuggestion = (name: string) => {
        if (!textareaRef.current) return;
        const before = localValue.slice(0, cursor);
        const after = localValue.slice(cursor);

        // Use same delimiter logic as currentToken: commas and parentheses
        const lastDelimiter = Math.max(
            before.lastIndexOf(","),
            before.lastIndexOf("("),
            before.lastIndexOf(")")
        );
        const segmentStart = lastDelimiter === -1 ? 0 : lastDelimiter + 1;
        const segmentText = before.slice(segmentStart);
        const leadingSpaces = segmentText.match(/^\s*/)?.[0] || "";
        const displayName = name.replace(/_/g, " ");

        const newValue = `${before.slice(0, segmentStart)}${leadingSpaces}${displayName}${after}`;
        lastInputAtRef.current = Date.now();
        pendingExternalValueRef.current = null;
        setLocalValue(newValue);
        onValueChange(newValue);

        const newPos = segmentStart + leadingSpaces.length + displayName.length;
        requestAnimationFrame(() => {
            textareaRef.current?.setSelectionRange(newPos, newPos);
            textareaRef.current?.focus();
        });
        setIsOpen(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Shift+W: Strip weights from selected text
        if (e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "w") {
            const textarea = textareaRef.current;
            if (!textarea) return;

            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            if (start === end) return; // No selection

            e.preventDefault();

            const selectedText = localValue.slice(start, end);
            const strippedText = stripWeights(selectedText);

            if (strippedText !== selectedText) {
                const newValue = localValue.slice(0, start) + strippedText + localValue.slice(end);
                lastInputAtRef.current = Date.now();
                pendingExternalValueRef.current = null;
                setLocalValue(newValue);
                onValueChange(newValue);

                // Position cursor at end of replaced text
                const newEnd = start + strippedText.length;
                intendedCursorRef.current = newEnd;
                requestAnimationFrame(() => {
                    textarea.setSelectionRange(start, newEnd);
                    textarea.focus();
                });
            }
            return;
        }

        if (isOpen && rankedSuggestions.length > 0) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                if (highlightIndex >= rankedSuggestions.length - 1) {
                    // At the bottom - close autocomplete to let arrow keys navigate textarea
                    setIsOpen(false);
                } else {
                    setHighlightIndex((idx) => idx + 1);
                }
                return;
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (highlightIndex <= 0) {
                    // At the top - close autocomplete to let arrow keys navigate textarea
                    setIsOpen(false);
                } else {
                    setHighlightIndex((idx) => idx - 1);
                }
                return;
            } else if (e.key === "Enter") {
                if (e.ctrlKey || e.metaKey) {
                    setIsOpen(false);
                } else {
                    e.preventDefault();
                    insertSuggestion(rankedSuggestions[highlightIndex]?.name);
                    return;
                }
            } else if (e.key === "Tab") {
                e.preventDefault();
                insertSuggestion(rankedSuggestions[highlightIndex]?.name);
                return;
            } else if (e.key === "Escape") {
                setIsOpen(false);
                return;
            }
        }
        onKeyDown?.(e);
    };

    // --- Highlighting Logic (debounced + idle to avoid blocking typing) ---
    const snippetsById = useMemo(() => new Map(snippets.map((s) => [s.id, s])), [snippets]);
    const snippetIndex = useMemo(() => buildSnippetIndex(snippets), [snippets]);
    // Ref to access snippetIndex in effects without adding it as a dependency (prevents infinite loops)
    const snippetIndexRef = useRef(snippetIndex);
    snippetIndexRef.current = snippetIndex;
    const rehydrationSnippets = useMemo(() => {
        if (!rehydrationItems || rehydrationItems.length === 0) return [];
        if (!snippets || snippets.length === 0) return [];

        const unique = new Map<string, PromptItem>();

        rehydrationItems.forEach((item) => {
            if (item?.type !== "block") return;
            const sourceId = typeof item?.sourceId === "string" ? item.sourceId : "";
            if (!sourceId) return;
            const frozenContent = typeof item?.content === "string" ? item.content : "";
            if (!frozenContent) return;

            const liveSnippet = snippetsById.get(sourceId);
            if (!liveSnippet || liveSnippet.type !== "block") return;

            // Only highlight "stale" segments (frozen content differs from the live snippet content).
            if (frozenContent === liveSnippet.content) return;

            const key = `${sourceId}::${frozenContent}`;
            if (unique.has(key)) return;

            unique.set(key, {
                id: `rehydrate-${sourceId}-${unique.size}`,
                sourceId,
                type: "block",
                content: frozenContent,
                label: liveSnippet.label || item.label,
                color: liveSnippet.color || item.color,
            });
        });

        return Array.from(unique.values());
    }, [rehydrationItems, rehydrationKey, snippets, snippetsById]);

    const rehydrationIndex = useMemo(() => buildSnippetIndex(rehydrationSnippets), [rehydrationSnippets]);
    const rehydrationIndexRef = useRef(rehydrationIndex);
    rehydrationIndexRef.current = rehydrationIndex;

    const [highlightState, setHighlightState] = useState<{ value: string; nodes: React.ReactNode[]; matches: SnippetMatch[] } | null>(null);
    const highlightHandleRef = useRef<IdleHandle | null>(null);
    const highlightDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const highlightTokenRef = useRef(0);
    const highlightBgClassCacheRef = useRef<Map<string, string>>(new Map());

    const buildHighlightBgClasses = useCallback((rawColor: string | null | undefined) => {
        const key = rawColor || "";
        const cached = highlightBgClassCacheRef.current.get(key);
        if (cached) return cached;

        // We intentionally ignore any `dark:*` snippet classes here so snippet colors
        // stay consistent across themes (matches light mode appearance).
        const fallback = "bg-slate-200";
        const tokens = (rawColor || "").split(/\s+/g).filter(Boolean);
        const bgTokens = tokens.filter((c) => c.startsWith("bg-"));
        const result = bgTokens.join(" ") || fallback;
        highlightBgClassCacheRef.current.set(key, result);
        return result;
    }, []);

    useEffect(() => {
        highlightTokenRef.current += 1;
        const token = highlightTokenRef.current;

        const currentIndex = snippetIndexRef.current;
        const currentRehydrationIndex = rehydrationIndexRef.current;
        if (highlightDebounceTimerRef.current) {
            clearTimeout(highlightDebounceTimerRef.current);
            highlightDebounceTimerRef.current = null;
        }

        cancelIdle(highlightHandleRef.current);
        highlightHandleRef.current = null;

        const hasHighlightCandidates = currentIndex.entries.length > 0 || currentRehydrationIndex.entries.length > 0;

        if (!highlightSnippets || !localValue || localValue.length > MAX_HIGHLIGHT_LENGTH || !hasHighlightCandidates) {
            // Only update state if it's not already null to prevent infinite loops
            setHighlightState((prev) => prev === null ? prev : null);
            return;
        }

        const valueToHighlight = localValue;
        highlightDebounceTimerRef.current = setTimeout(() => {
            highlightHandleRef.current = scheduleIdle(() => {
                if (token !== highlightTokenRef.current) return;

                const rehydrationMatches = currentRehydrationIndex.entries.length > 0
                    ? findSnippetMatches(valueToHighlight, currentRehydrationIndex, { maxMatches: MAX_HIGHLIGHT_MATCHES })
                    : [];
                if (rehydrationMatches === null) {
                    setHighlightState((prev) => prev === null ? prev : null);
                    highlightHandleRef.current = null;
                    return;
                }

                const liveMatches = currentIndex.entries.length > 0
                    ? findSnippetMatches(valueToHighlight, currentIndex, { maxMatches: MAX_HIGHLIGHT_MATCHES })
                    : [];
                if (liveMatches === null) {
                    setHighlightState((prev) => prev === null ? prev : null);
                    highlightHandleRef.current = null;
                    return;
                }

                const mergedMatches: SnippetMatch[] = [
                    ...(rehydrationMatches || []),
                    ...(liveMatches || []).map((m) => ({ ...m, order: m.order + currentRehydrationIndex.entries.length })),
                ];

                if (mergedMatches.length === 0) {
                    setHighlightState((prev) => prev === null ? prev : null);
                    highlightHandleRef.current = null;
                    return;
                }

                const selectedMatches = selectNonOverlappingMatches(mergedMatches, { preferLongest: true });
                if (selectedMatches.length === 0) {
                    setHighlightState((prev) => prev === null ? prev : null);
                    highlightHandleRef.current = null;
                    return;
                }

                const nodes: React.ReactNode[] = [];
                let cursor = 0;

                selectedMatches.forEach((m, idx) => {
                    if (m.start > cursor) {
                        // Non-highlighted text: inherits `text-transparent dark:text-slate-300` from the backdrop container.
                        nodes.push(valueToHighlight.slice(cursor, m.start));
                    }
                    const bgClasses = buildHighlightBgClasses(m.snippet.color);
                    const isRehydrationMatch = Boolean((m.snippet as PromptItem | undefined)?.sourceId);
                    nodes.push(
                        <span
                            key={`${m.start}-${idx}`}
                            className={cn(
                                bgClasses,
                                "rounded-sm opacity-80",
                                isRehydrationMatch && "ring-2 ring-black/40 dark:ring-red-500 ring-inset underline decoration-dashed decoration-black/60 dark:decoration-red-500 underline-offset-2",
                                // Dark mode: keep highlights bright and vibrant, render text in black
                                // for maximum readability contrast. The textarea text above will be
                                // made transparent so this black text shows through.
                                "dark:opacity-100 dark:text-black dark:font-medium",
                                // Light mode: keep text transparent so textarea text shows
                                "text-transparent"
                            )}
                        >
                            {valueToHighlight.slice(m.start, m.end)}
                        </span>
                    );
                    cursor = m.end;
                });

                if (cursor < valueToHighlight.length) {
                    // Trailing non-highlighted text: inherits `text-transparent dark:text-slate-300` from the backdrop container.
                    nodes.push(valueToHighlight.slice(cursor));
                }

                setHighlightState({ value: valueToHighlight, nodes, matches: selectedMatches });
                highlightHandleRef.current = null;
            }, { timeout: HIGHLIGHT_IDLE_TIMEOUT_MS });
        }, HIGHLIGHT_DEBOUNCE_MS);

        return () => {
            if (highlightDebounceTimerRef.current) {
                clearTimeout(highlightDebounceTimerRef.current);
                highlightDebounceTimerRef.current = null;
            }
            cancelIdle(highlightHandleRef.current);
            highlightHandleRef.current = null;
        };
        // Note: snippetIndex is included (via its entries.length check in body) so the effect
        // re-runs when snippets load on startup. Without this, highlighting won't work until
        // a snippet is added/removed after restart.
    }, [localValue, highlightSnippets, snippetIndex, rehydrationIndex, buildHighlightBgClasses]);


    const canHighlight =
        Boolean(highlightSnippets) &&
        Boolean(localValue) &&
        localValue.length <= MAX_HIGHLIGHT_LENGTH &&
        (snippetIndex.entries.length > 0 || rehydrationIndex.entries.length > 0);
    const showHighlightOverlay = Boolean(canHighlight && highlightState);
    const highlightedContent = showHighlightOverlay
        ? (highlightState?.value === localValue ? highlightState.nodes : [localValue])
        : null;

    const getTextareaIndexFromPoint = useCallback((
        textarea: HTMLTextAreaElement,
        clientX: number,
        clientY: number
    ): number | null => {
        if (typeof document === "undefined" || typeof window === "undefined") return null;

        const rect = textarea.getBoundingClientRect();
        if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;

        const style = window.getComputedStyle(textarea);
        const mirror = document.createElement("div");

        try {
            mirror.style.position = "fixed";
            mirror.style.left = `${rect.left}px`;
            mirror.style.top = `${rect.top}px`;
            mirror.style.width = `${rect.width}px`;
            mirror.style.height = `${rect.height}px`;
            mirror.style.overflow = "auto";
            mirror.style.boxSizing = style.boxSizing;
            mirror.style.border = style.border;
            mirror.style.padding = style.padding;
            mirror.style.font = style.font;
            mirror.style.letterSpacing = style.letterSpacing;
            mirror.style.lineHeight = style.lineHeight;
            mirror.style.textTransform = style.textTransform;
            // Match wrapping behavior of the textarea/highlight overlay.
            mirror.style.whiteSpace = "pre-wrap";
            mirror.style.wordBreak = "break-word";
            mirror.style.overflowWrap = "break-word";
            // Keep it in layout for hit-testing, but visually invisible.
            mirror.style.opacity = "0";
            mirror.style.pointerEvents = "auto";
            mirror.style.userSelect = "none";
            mirror.style.zIndex = "2147483647";

            const mirrorText = `${textarea.value}\u200b`;
            mirror.textContent = mirrorText;

            document.body.appendChild(mirror);
            mirror.scrollTop = textarea.scrollTop;
            mirror.scrollLeft = textarea.scrollLeft;

            let index: number | null = null;
            const docAny = document as unknown as {
                caretRangeFromPoint?: (x: number, y: number) => Range | null;
                caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
            };

            if (typeof docAny.caretRangeFromPoint === "function") {
                const range = docAny.caretRangeFromPoint(clientX, clientY);
                if (range && mirror.contains(range.startContainer)) {
                    const prefix = document.createRange();
                    prefix.setStart(mirror, 0);
                    prefix.setEnd(range.startContainer, range.startOffset);
                    index = prefix.toString().length;
                }
            } else if (typeof docAny.caretPositionFromPoint === "function") {
                const position = docAny.caretPositionFromPoint(clientX, clientY);
                if (position && mirror.contains(position.offsetNode)) {
                    const prefix = document.createRange();
                    prefix.setStart(mirror, 0);
                    prefix.setEnd(position.offsetNode, position.offset);
                    index = prefix.toString().length;
                }
            }

            if (index === null) return null;
            return Math.min(index, textarea.value.length);
        } finally {
            mirror.remove();
        }
    }, []);

    const [rehydrationMenu, setRehydrationMenu] = useState<{
        x: number;
        y: number;
        snippetId: string;
        snippetLabel: string;
        start: number;
        end: number;
        liveContent: string;
    } | null>(null);

    useEffect(() => {
        if (!rehydrationMenu) return;
        const handleMouseDown = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest?.('[data-rehydration-menu="true"]')) return;
            setRehydrationMenu(null);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setRehydrationMenu(null);
            }
        };
        window.addEventListener("mousedown", handleMouseDown, true);
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("mousedown", handleMouseDown, true);
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [rehydrationMenu]);

    return (
        <div className="flex flex-col gap-1 w-full group/container">
            {showAutocompleteToggle && (
                <div className="flex justify-end px-1">
                    <button
                        type="button"
                        className={cn(
                            "rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                            autocompleteEnabled
                                ? "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                                : "bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200",
                        )}
                        title={autocompleteEnabled ? "Disable autocomplete" : "Enable autocomplete"}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleAutocomplete();
                        }}
                    >
                        {autocompleteEnabled ? "Autocomplete" : "Autocomplete off"}
                    </button>
                </div>
            )}

            <div className="relative w-full">
                {/* Overlay for highlighting */}
                {showHighlightOverlay && (
                    <div
                        ref={backdropRef}
                        aria-hidden="true"
                        className={cn(
                            // Match Textarea base styles EXACTLY. Keep it behind the textarea so text stays responsive.
                            "absolute inset-0 z-0 p-3 text-xs font-mono whitespace-pre-wrap break-words overflow-auto bg-transparent border border-transparent pointer-events-none text-transparent dark:text-slate-300",
                            // Must match textarea sizing/resize
                            className?.includes("h-") ? "" : "h-auto" // If height is fixed in class, it inherits naturally via inset. If auto, we might drift.
                            // Actually, Scroll Sync handles offset.
                        )}
                        style={{
                            // Match resize behavior if possible, but Textarea resize handles are tricky.
                            // We rely on standard scroll sync.
                        }}
                    >
                        {highlightedContent}
                    </div>
                )}

                <Textarea
                    {...props}
                    ref={textareaRef}
                    value={localValue}
                    onChange={(e) => {
                        const inputStart = typeof performance !== "undefined" ? performance.now() : null;
                        const nextValue = e.target.value;
                        const newCursor = e.target.selectionStart || 0;
                        intendedCursorRef.current = newCursor;
                        lastInputAtRef.current = Date.now();
                        pendingExternalValueRef.current = null;
                        setLocalValue(nextValue);
                        setIsTyping(true); // Mark that user is actively typing
                        onValueChange(nextValue);
                        setCursor((prev) => (prev === newCursor ? prev : newCursor));
                        if (inputStart !== null) {
                            logClientFrameLatency(
                                "perf_prompt_input_latency",
                                "perf_prompt_input_latency",
                                inputStart,
                                {
                                    len: nextValue.length,
                                    autocomplete: autocompleteEnabled,
                                    highlight: Boolean(highlightSnippets),
                                },
                                { sampleRate: 0.1, throttleMs: 2000, minMs: 4 }
                            );
                        }
                        props.onChange?.(e);
                    }}
                    onFocus={(e) => {
                        updateCursor();
                        setIsFocused(true);
                        setTextInputFocused(true); // Segregated undo: let browser handle text undo
                        props.onFocus?.(e);
                    }}
                    onBlur={(e) => {
                        // Segregated undo: restore global undo handling
                        setTextInputFocused(false);
                        setIsFocused(false);
                        setIsTyping(false); // Reset typing flag on blur
                        const pendingExternal = pendingExternalValueRef.current;
                        if (pendingExternal !== null) {
                            pendingExternalValueRef.current = null;
                            intendedCursorRef.current = null;
                            setLocalValue(pendingExternal);
                        }
                        // Close dropdown after delay to allow clicking on dropdown items
                        setTimeout(() => {
                            // Only close if focus is truly outside (not on dropdown buttons either)
                            const active = document.activeElement;
                            if (active !== textareaRef.current) {
                                setIsOpen(false);
                            }
                        }, 150);
                        props.onBlur?.(e);
                    }}
                    onClick={(e) => {
                        updateCursor();
                        setIsTyping(false); // Clicking doesn't count as typing
                        props.onClick?.(e);
                    }}
                    onKeyUp={(e) => {
                        updateCursor();
                        props.onKeyUp?.(e);
                    }}
                    onSelect={(e) => {
                        updateCursor();
                        props.onSelect?.(e);
                    }}
                    onScroll={handleScroll}
                    onContextMenu={(e) => {
                        updateCursor();

                        // Only override the native context menu when the user right-clicks
                        // inside a "stale" rehydration match (old snippet text linked to a current snippet ID).
                        const matches = highlightState?.value === localValue ? (highlightState?.matches || []) : [];
                        const rehydrationMatches = matches.filter((m) => {
                            const sourceId = (m.snippet as PromptItem | undefined)?.sourceId;
                            if (!sourceId) return false;
                            return true;
                        });

                        if (rehydrationMatches.length === 0) {
                            props.onContextMenu?.(e);
                            return;
                        }

                        const clickedIndex =
                            getTextareaIndexFromPoint(e.currentTarget, e.clientX, e.clientY) ??
                            e.currentTarget.selectionStart ??
                            0;
                        const selectionStart = e.currentTarget.selectionStart ?? clickedIndex;
                        const selectionEnd = e.currentTarget.selectionEnd ?? selectionStart;

                        const match =
                            rehydrationMatches.find((m) => clickedIndex >= m.start && clickedIndex < m.end) ??
                            (selectionStart !== selectionEnd
                                ? rehydrationMatches.find((m) => selectionStart < m.end && selectionEnd > m.start)
                                : undefined);

                        if (!match) {
                            props.onContextMenu?.(e);
                            return;
                        }

                        const snippetId = (match.snippet as PromptItem).sourceId as string;
                        const liveSnippet = snippetsById.get(snippetId);
                        if (!liveSnippet) {
                            props.onContextMenu?.(e);
                            return;
                        }

                        const currentSegment = localValue.slice(match.start, match.end);
                        if (!currentSegment || currentSegment !== match.snippet.content) {
                            // Link broken (text changed) or stale render; fall back to native menu.
                            props.onContextMenu?.(e);
                            return;
                        }

                        if (currentSegment === liveSnippet.content) {
                            // Already up-to-date; allow native menu and rely on live snippet highlighting.
                            props.onContextMenu?.(e);
                            return;
                        }

                        e.preventDefault();
                        e.stopPropagation();

                        const menuWidth = 256; // w-64
                        const menuHeight = 64; // approx (1 header + 1 action)
                        const safeX = Math.min(e.clientX, Math.max(0, window.innerWidth - menuWidth));
                        const safeY = Math.min(e.clientY, Math.max(0, window.innerHeight - menuHeight));

                        setRehydrationMenu({
                            x: safeX,
                            y: safeY,
                            snippetId,
                            snippetLabel: liveSnippet.label || "Snippet",
                            start: match.start,
                            end: match.end,
                            liveContent: liveSnippet.content,
                        });
                    }}
                    className={cn(
                        "text-xs font-mono transition-all min-h-[150px] relative z-10",
                        isActive && "ring-2 ring-blue-400 border-blue-400",
                        highlightSnippets ? "bg-transparent focus:bg-transparent" : "",
                        highlightSnippets && isActive && "bg-blue-50/10", // slight tint if active but transparent
                        // Dark mode with highlighting: make text transparent so backdrop text shows through
                        showHighlightOverlay && "dark:text-transparent dark:caret-slate-300",
                        className,
                        // Ensure padding matches overlay
                        !className?.includes("p-") && "p-3"
                    )}
                    onKeyDown={handleKeyDown}
                />
            </div>

            {autocompleteEnabled && showDropdown && textareaRef.current && dropdownRect && createPortal(
                <div
                    className="fixed z-[9999] rounded-lg border border-slate-300 bg-white shadow-2xl max-h-60 overflow-y-auto text-sm ring-1 ring-black/5"
                    style={{
                        top: dropdownRect.top,
                        left: dropdownRect.left,
                        width: dropdownRect.width,
                    }}
                >
                    {rankedSuggestions.map((s, idx) => (
                        <button
                            key={`${s.source} -${s.name} `}
                            type="button"
                            className={cn(
                                "w-full px-3 py-2 text-left flex items-start gap-2 hover:bg-slate-50",
                                idx === highlightIndex && "bg-blue-50 text-blue-900",
                            )}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                insertSuggestion(s.name);
                            }}
                        >
                            <div className="flex-1 min-w-0">
                                <div className="font-semibold text-xs truncate">
                                    {highlightMatch(s.name.replace(/_/g, " "), deferredToken.replace(/_/g, " "))}
                                </div>
                                {s.description && (
                                    <div className="text-[11px] text-slate-500 truncate">{s.description}</div>
                                )}
                            </div>
                            <div
                                className={cn(
                                    "shrink-0 px-2 py-0.5 text-[11px] rounded-full border",
                                    sourceBadgeClass(s.source),
                                )}
                            >
                                {s.source}
                            </div>
                            {s.frequency > 0 && (
                                <span className="text-[11px] text-slate-500 tabular-nums">{s.frequency}</span>
                            )}
                        </button>
                    ))}
                </div>,
                document.body
            )}

            {rehydrationMenu && createPortal(
                <div
                    data-rehydration-menu="true"
                    className="fixed z-[9999] bg-popover border border-border/60 rounded-md shadow-lg py-1 w-64 text-sm text-popover-foreground font-medium"
                    style={{ top: rehydrationMenu.y, left: rehydrationMenu.x }}
                >
                    <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">
                        snippet: <span className="text-foreground">{rehydrationMenu.snippetLabel}</span>
                    </div>
                    <div className="h-px bg-border/50 my-1" />
                    <button
                        type="button"
                        className="w-full px-3 py-2 text-left hover:bg-muted/50 cursor-pointer text-xs"
                        onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }}
                        onClick={() => {
                            const { start, end, liveContent } = rehydrationMenu;
                            const nextValue = localValue.slice(0, start) + liveContent + localValue.slice(end);
                            const nextCursor = start + liveContent.length;

                            intendedCursorRef.current = nextCursor;
                            lastInputAtRef.current = Date.now();
                            pendingExternalValueRef.current = null;

                            setLocalValue(nextValue);
                            setCursor(nextCursor);
                            onValueChange(nextValue);
                            setRehydrationMenu(null);

                            queueMicrotask(() => {
                                textareaRef.current?.focus();
                                textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
                            });
                        }}
                    >
                        update to latest
                    </button>
                </div>,
                document.body
            )}
        </div>
    );
}
