import { PromptLibraryItem } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";

interface PromptLibraryQuickPanelProps {
  open: boolean;
  prompts: PromptLibraryItem[];
  searchValue: string;
  loading?: boolean;
  error?: string | null;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onClose: () => void;
  onApply: (prompt: PromptLibraryItem) => void;
}

export function PromptLibraryQuickPanel({
  open,
  prompts,
  searchValue,
  loading,
  error,
  onSearchChange,
  onSearchSubmit,
  onClose,
  onApply,
}: PromptLibraryQuickPanelProps) {
  if (!open) return null;

  return (
    <div className="absolute top-4 right-4 z-30 w-96 pointer-events-auto">
      <Card className="shadow-xl border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200">
          <div className="font-semibold text-slate-800 text-sm">Prompt Library</div>
          <Button variant="ghost" size="sm" className="h-7" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
              <Input
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search or filter prompts"
                className="pl-9"
              />
            </div>
            <Button size="sm" variant="outline" onClick={onSearchSubmit}>
              Go
            </Button>
          </div>

          {error && <div className="text-xs text-red-600">{error}</div>}
          {loading && <div className="text-xs text-slate-500">Loading prompt library…</div>}

          <ScrollArea className="h-64 pr-2">
            <div className="space-y-2">
              {prompts.length === 0 && !loading && (
                <div className="text-xs text-slate-500">No prompts found. Save one from the form to start.</div>
              )}
              {prompts.map((prompt) => (
                <div key={`${prompt.image_id}-${prompt.prompt_id ?? ""}`} className="p-3 border border-slate-200 rounded-md bg-slate-50">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-slate-900 truncate">{prompt.prompt_name || `Image #${prompt.image_id}`}</p>
                      {prompt.active_positive && (
                        <p className="text-[11px] text-slate-600 line-clamp-2 mt-1">{prompt.active_positive}</p>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" className="text-blue-600 hover:text-blue-700" onClick={() => onApply(prompt)}>
                      Load
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2 text-[11px] text-slate-500">
                    {prompt.tags?.slice(0, 3).map((tag) => (
                      <span key={tag} className="px-1 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded">
                        #{tag}
                      </span>
                    ))}
                    {prompt.job_params?.steps && (
                      <span className="px-2 py-0.5 bg-white border border-slate-200 rounded">Steps: {prompt.job_params.steps}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </Card>
    </div>
  );
}
