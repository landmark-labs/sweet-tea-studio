import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

const formatLastRefresh = (iso: string | null): string => {
  if (!iso) {
    return "never";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return date.toLocaleString();
};

export function AuthAccountStatus() {
  const {
    initialized,
    isAuthenticated,
    entitlement,
    session,
    storageStrategy,
    login,
    logout,
    refreshEntitlement,
  } = useAuth();

  const [loginOpen, setLoginOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const statusBadgeText = useMemo(() => {
    if (!isAuthenticated) return "free";
    if (entitlement.status === "ok") return "premium";
    if (entitlement.status === "grace") return "premium (grace)";
    if (entitlement.status === "expired") return "premium expired";
    if (entitlement.status === "invalid_signature") return "entitlement invalid";
    return "premium setup";
  }, [entitlement.status, isAuthenticated]);

  const daysLabel = useMemo(() => {
    if (entitlement.status === "ok") {
      const days = Math.max(entitlement.daysUntilExpiry ?? 0, 0);
      return `${days} day${days === 1 ? "" : "s"} remaining`;
    }
    if (entitlement.status === "grace") {
      const days = Math.max(entitlement.daysUntilGraceExpiry ?? 0, 0);
      return `grace: ${days} day${days === 1 ? "" : "s"} left`;
    }
    if (entitlement.status === "expired") {
      return "refresh required";
    }
    return "free features active";
  }, [
    entitlement.daysUntilExpiry,
    entitlement.daysUntilGraceExpiry,
    entitlement.status,
  ]);

  const handleLogin = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await login({ email: email.trim(), password });
      setPassword("");
      setLoginOpen(false);
    } catch (loginError) {
      const message =
        loginError instanceof Error
          ? loginError.message
          : "Sign in failed. Please check your credentials.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshEntitlement(true);
    } finally {
      setRefreshing(false);
    }
  };

  if (!initialized) {
    return <div className="text-xs text-muted-foreground">auth initializing...</div>;
  }

  return (
    <>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs">
        <Badge variant={entitlement.status === "expired" ? "outline" : "default"}>
          {statusBadgeText}
        </Badge>
        <span className="text-muted-foreground">{daysLabel}</span>
        {isAuthenticated && (
          <span className="hidden text-muted-foreground lg:inline">
            last refresh: {formatLastRefresh(entitlement.lastRefreshAt)}
          </span>
        )}
        {isAuthenticated && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={handleManualRefresh}
            disabled={refreshing}
          >
            {refreshing ? "refreshing..." : "refresh"}
          </Button>
        )}
        {isAuthenticated ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => void logout()}
          >
            logout
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => setLoginOpen(true)}
          >
            login
          </Button>
        )}
      </div>

      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>sign in to sweet tea account</DialogTitle>
            <DialogDescription>
              Premium features require a signed entitlement refresh every 15 days.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="auth-email">email</Label>
              <Input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="auth-password">password</Label>
              <Input
                id="auth-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleLogin();
                  }
                }}
              />
            </div>
            {error && (
              <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
            <div className="text-[11px] text-muted-foreground">
              Session user: {session?.email || "not signed in"} | token store:{" "}
              {storageStrategy === "native_secure_store"
                ? "native secure store"
                : "encrypted local fallback"}
            </div>
            <Button
              className="w-full"
              onClick={() => void handleLogin()}
              disabled={submitting || !email.trim() || password.length === 0}
            >
              {submitting ? "signing in..." : "sign in"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
