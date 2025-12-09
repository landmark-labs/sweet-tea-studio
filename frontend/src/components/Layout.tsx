import { useState } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { PlusCircle, Settings, Library, Image as ImageIcon, Workflow, ChevronLeft, ChevronRight, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PerformanceHUD } from "@/components/PerformanceHUD";

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-screen bg-slate-50 text-slate-900 overflow-hidden">
      {/* Sidebar */}
      <aside className={cn(
        "border-r border-slate-200 bg-white flex flex-col transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}>
        <div className={cn("p-4 border-b border-slate-100 flex items-center", collapsed ? "justify-center" : "justify-between")}>
          {!collapsed && (
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent whitespace-nowrap">
                Sweet Tea
              </h1>
              <p className="text-xs text-slate-500 whitespace-nowrap">Studio</p>
            </div>
          )}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </Button>
        </div>
        <nav className="flex-1 p-2 space-y-1 overflow-x-hidden">
          <NavLink to="/" className={({ isActive }) => cn("flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100", collapsed && "justify-center px-2")}>
            <PlusCircle size={20} />
            {!collapsed && <span>Generation</span>}
          </NavLink>
          <NavLink to="/gallery" className={({ isActive }) => cn("flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100", collapsed && "justify-center px-2")}>
            <ImageIcon size={20} />
            {!collapsed && <span>Gallery</span>}
          </NavLink>
          <NavLink to="/library" className={({ isActive }) => cn("flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100", collapsed && "justify-center px-2")}>
            <Library size={20} />
            {!collapsed && <span>Prompt Library</span>}
          </NavLink>
          <NavLink to="/workflows" className={({ isActive }) => cn("flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100", collapsed && "justify-center px-2")}>
            <Workflow size={20} />
            {!collapsed && <span>Workflows</span>}
          </NavLink>
            <NavLink to="/models" className={({ isActive }) => cn("flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100", collapsed && "justify-center px-2") }>
            <HardDrive size={20} />
            {!collapsed && <span>Models</span>}
          </NavLink>
        </nav>
        <div className="p-2 border-t border-slate-100">
          <div className={cn("flex items-center gap-3 px-3 py-2 text-sm text-slate-500 hover:text-slate-900 cursor-pointer", collapsed && "justify-center px-2")}>
            <Settings size={20} />
            {!collapsed && <span>Settings</span>}
          </div>
        </div>
      </aside>
      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-slate-50">
        <Outlet />
      </main>
      <PerformanceHUD />
    </div>
  );
}
