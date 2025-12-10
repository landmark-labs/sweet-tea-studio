
import { useEffect, useMemo, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api, TagSuggestion } from "@/lib/api";

interface PromptAutocompleteTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    value: string;
    onValueChange: (value: string) => void;
    isActive?: boolean;
}

function computeScore(query: string, candidate: string): number {
    const q = query.toLowerCase();
    const c = candidate.toLowerCase();
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

function highlightMatch(label: string, term: string): JSX.Element {
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
    return "bg-indigo-50 text-indigo-700 border-indigo-200";
}

export function PromptAutocompleteTextarea({
    value,
    onValueChange,
    isActive,
    className,
    onKeyDown,
    ...props
}: PromptAutocompleteTextareaProps) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const cacheRef = useRef<Map<string, TagSuggestion[]>>(new Map());

    const [cursor, setCursor] = useState(0);
    const [activeToken, setActiveToken] = useState("");
    const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
    const [highlightIndex, setHighlightIndex] = useState(0);
    const [isOpen, setIsOpen] = useState(false);
    const [isFocused, setIsFocused] = useState(false);

    const updateCursor = () => {
        if (!textareaRef.current) return;
        setCursor(textareaRef.current.selectionStart || 0);
    };

    const currentToken = useMemo(() => {
        const before = value.slice(0, cursor);
        const match = before.match(/([a-zA-Z0-9:_-]+)$/);
        return match ? match[1] : "";
    }, [value, cursor]);

    useEffect(() => {
        setActiveToken(currentToken);
    }, [currentToken]);

    useEffect(() => {
        const token = activeToken.trim();
        if (!isFocused || token.length < 2) {
            setIsOpen(false);
            setSuggestions([]);
            return;
        }

        const load = async () => {
            if (cacheRef.current.has(token)) {
                setSuggestions(cacheRef.current.get(token) || []);
                setIsOpen(true);
                setHighlightIndex(0);
                return;
            }

            try {
                const data = await api.getTagSuggestions(token, 25);
                cacheRef.current.set(token, data);
                setSuggestions(data);
                setIsOpen(true);
                setHighlightIndex(0);
            } catch (e) {
                console.error("Failed to load tag suggestions", e);
                setSuggestions([]);
                setIsOpen(false);
            }
        };

        const handle = setTimeout(load, 160);
        return () => clearTimeout(handle);
    }, [activeToken, isFocused]);

    const rankedSuggestions = useMemo(() => {
        const token = activeToken.trim();
        if (!token) return [];
        return suggestions
            .map((s) => ({ suggestion: s, score: computeScore(token, s.name) }))
            .filter((item) => item.score > 0)
            .sort((a, b) => {
                // Sort by score first (descending), then by frequency, then alphabetically
                if (a.score !== b.score) {
                    return b.score - a.score;
                }
                if (a.suggestion.frequency !== b.suggestion.frequency) {
                    return b.suggestion.frequency - a.suggestion.frequency;
                }
                return a.suggestion.name.localeCompare(b.suggestion.name);
            })
            .slice(0, 15)
            .map((item) => item.suggestion);
    }, [suggestions, activeToken]);

    const insertSuggestion = (name: string) => {
        if (!textareaRef.current) return;
        const before = value.slice(0, cursor);
        const after = value.slice(cursor);

        // Use activeToken to determine exactly how much to replace
        // This ensures what we matched against is what gets replaced
        const start = cursor - activeToken.length;

        const newValue = `${before.slice(0, start)}${name}, ${after.replace(/^\s*/, "")} `;
        onValueChange(newValue);

        const newPos = start + name.length + 2;
        requestAnimationFrame(() => {
            textareaRef.current?.setSelectionRange(newPos, newPos);
            textareaRef.current?.focus();
        });
        setIsOpen(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (isOpen && rankedSuggestions.length > 0) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlightIndex((idx) => (idx + 1) % rankedSuggestions.length);
                return;
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlightIndex((idx) => (idx - 1 + rankedSuggestions.length) % rankedSuggestions.length);
                return;
            } else if (e.key === "Tab" || (e.key === "Enter" && !e.ctrlKey && !e.metaKey)) {
                e.preventDefault();
                insertSuggestion(rankedSuggestions[highlightIndex]?.name);
                return;
            } else if (e.key === "Escape") {
                setIsOpen(false);
                return;
            }
        }

        // Pass through to parent if not consumed
        onKeyDown?.(e);
    };

    const showDropdown = isOpen && rankedSuggestions.length > 0;

    return (
        <div className="relative">
            <Textarea
                {...props}
                ref={textareaRef}
                value={value}
                onChange={(e) => {
                    onValueChange(e.target.value);
                    setCursor(e.target.selectionStart || 0);
                    props.onChange?.(e);
                }}
                onFocus={(e) => {
                    setIsFocused(true);
                    updateCursor();
                    props.onFocus?.(e);
                }}
                onBlur={(e) => {
                    setIsFocused(false);
                    setTimeout(() => setIsOpen(false), 100);
                    props.onBlur?.(e);
                }}
                onClick={(e) => {
                    updateCursor();
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
                className={cn(
                    "text-xs font-mono transition-all min-h-[150px]",
                    isActive && "ring-2 ring-blue-400 border-blue-400 bg-blue-50/20",
                    className,
                )}
                onKeyDown={handleKeyDown}
            />

            {showDropdown && (
                <div className="absolute left-0 right-0 mt-1 z-20 rounded-lg border border-slate-200 bg-white shadow-xl max-h-60 overflow-y-auto text-sm">
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
                                <div className="font-semibold text-xs truncate">{highlightMatch(s.name, activeToken)}</div>
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
                </div>
            )}
        </div>
    );
}
