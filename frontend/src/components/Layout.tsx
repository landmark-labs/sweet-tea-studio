import { Outlet, NavLink } from "react-router-dom";
import { LayoutGrid, PlusCircle, Settings, Library, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Layout() {
  return (
    <div className="flex h-screen w-screen bg-slate-50 text-slate-900 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-200 bg-white flex flex-col">
        <div className="p-6 border-b border-slate-100">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            DiffusionStudio
          </h1>
          <p className="text-xs text-slate-500">ComfyUI Mission Control</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          <NavLink to="/" className={({ isActive }) => cn("flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100")}>
            <PlusCircle size={18} />
            New Generation
          </NavLink>
          <NavLink to="/gallery" className={({ isActive }) => cn("flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100")}>
            <ImageIcon size={18} />
            Gallery
          </NavLink>
          <NavLink to="/library" className={({ isActive }) => cn("flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100")}>
            <Library size={18} />
            Prompt Library
          </NavLink>
          <NavLink to="/engines" className={({ isActive }) => cn("flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100")}>
            <LayoutGrid size={18} />
            Engines
          </NavLink>
        </nav>
        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-3 px-3 py-2 text-sm text-slate-500 hover:text-slate-900 cursor-pointer">
            <Settings size={18} />
            Settings
          </div>
        </div>
      </aside>
      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-slate-50">
        <Outlet />
      </main>
    </div>
  );
}
