import { useState } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { PlusCircle, Settings, Library, Image as ImageIcon, Workflow, ChevronLeft, ChevronRight, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UndoRedoBar } from "@/components/UndoRedoBar";

const navItems = [
  { to: "/", label: "Generation", icon: PlusCircle },
  { to: "/gallery", label: "Gallery", icon: ImageIcon },
  { to: "/library", label: "Prompt Library", icon: Library },
  { to: "/workflows", label: "Workflows", icon: Workflow },
  { to: "/models", label: "Models", icon: HardDrive },
];

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-screen bg-gradient-to-br from-background via-surface to-muted text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "border-r border-border/70 bg-surface/95 backdrop-blur flex flex-col transition-all duration-300 shadow-sm",
          collapsed ? "w-16" : "w-72"
        )}
      >
        <div className={cn("p-4 border-b border-border/70 flex items-center", collapsed ? "justify-center" : "justify-between")}> 
          {!collapsed && (
            <div>
              <div className="flex items-baseline gap-2">
                <h1 className="text-xl font-semibold bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent whitespace-nowrap">
                  Sweet Tea
                </h1>
                <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">Studio</span>
              </div>
              <p className="text-xs text-muted-foreground whitespace-nowrap">Cohesive creative workspace</p>
            </div>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </Button>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-x-hidden">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all border border-transparent",
                  isActive
                    ? "bg-primary/10 text-primary border-primary/20 shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                  collapsed && "justify-center px-2"
                )
              }
            >
              <item.icon size={20} />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-border/70">
          <div
            className={cn(
              "flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/70 rounded-xl cursor-pointer",
              collapsed && "justify-center px-2"
            )}
          >
            <Settings size={20} />
            {!collapsed && <span>Settings</span>}
          </div>
        </div>
      </aside>
      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-gradient-to-b from-surface/50 to-background">
        <div className="mx-auto max-w-7xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Sweet Tea Studio</p>
              <h2 className="text-2xl font-semibold">Unified creation desk</h2>
            </div>
            <UndoRedoBar />
          </div>
          <div className="glass-card p-4">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
