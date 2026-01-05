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
      <div className="w-96 pointer-events-auto">
        <Card className="shadow-xl border-blue-100 bg-blue-50/95 dark:border-border/60 dark:bg-card/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-2 border-b border-blue-100/80 dark:border-border/60 cursor-move">
          <div className="font-semibold text-foreground text-sm">prompt library</div>
          <Button variant="ghost" size="sm" className="h-7" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
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
          {loading && <div className="text-xs text-muted-foreground">Loading prompt library…</div>}

          <ScrollArea className="h-64 pr-2">
            <div className="space-y-2">
              {prompts.length === 0 && !loading && (
                <div className="text-xs text-muted-foreground">No prompts found. Save one from the form to start.</div>
              )}
              {prompts.map((prompt) => {
                const key =
                  prompt.prompt_id !== undefined && prompt.prompt_id !== null
                    ? `prompt-${prompt.prompt_id}`
                    : `img-${prompt.image_id}-${prompt.prompt_name || prompt.created_at || "local"}`;

                return (
                  <div
                    key={key}
                    className="p-2 border border-border/60 rounded-md bg-muted/20 hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => onApply(prompt)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                        <span className="font-semibold text-foreground truncate max-w-[12rem]">
                          {prompt.job_params?.project_name || prompt.prompt_name || `Image #${prompt.image_id}`}
                        </span>
                        {prompt.image_id && <span className="text-muted-foreground/80">Img {prompt.image_id}</span>}
                        {prompt.workflow_template_id && (
                          <span className="px-1.5 py-0.5 bg-muted/30 text-muted-foreground rounded-full text-[9px] font-medium">
                            Pipe {prompt.workflow_template_id}
                          </span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 text-blue-600 hover:text-blue-700 dark:text-primary dark:hover:text-primary/80 text-[10px] px-1.5"
                        onClick={(e) => {
                          e.stopPropagation();
                          onApply(prompt);
                        }}
                      >
                        Load
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-1.5">
                      {prompt.active_positive && (
                        <div className="min-w-0">
                          <div className="text-[8px] text-green-600 font-semibold uppercase mb-0.5">Positive</div>
                          <p className="text-[10px] text-foreground/80 line-clamp-2 leading-tight">{prompt.active_positive}</p>
                        </div>
                      )}
                      {prompt.active_negative && (
                        <div className="min-w-0">
                          <div className="text-[8px] text-red-600 font-semibold uppercase mb-0.5">Negative</div>
                          <p className="text-[10px] text-muted-foreground line-clamp-2 leading-tight">{prompt.active_negative}</p>
                        </div>
                      )}
                      {!prompt.active_positive && !prompt.active_negative && (
                        <div className="col-span-2 text-[10px] text-muted-foreground italic">No prompt text saved</div>
                      )}
                    </div>

                    {prompt.tags && prompt.tags.length > 0 && (
                      <div className="flex flex-wrap gap-0.5">
                        {prompt.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="px-1 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-100 dark:bg-primary/10 dark:text-primary dark:border-primary/20 rounded text-[8px]">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      </Card>
    </div>
  );
}
