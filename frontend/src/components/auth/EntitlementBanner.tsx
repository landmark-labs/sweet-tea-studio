import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export function EntitlementBanner() {
  const { entitlement, isAuthenticated, refreshEntitlement } = useAuth();

  if (!isAuthenticated) {
    return null;
  }

  if (entitlement.status === "ok" || entitlement.status === "no_entitlement") {
    return null;
  }

  if (entitlement.status === "expired") {
    return (
      <div className="px-5 py-2">
        <Alert variant="destructive">
          <AlertTitle>subscription refresh required</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>Premium features are disabled until entitlement refresh succeeds.</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => void refreshEntitlement(true)}
            >
              retry refresh
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="px-5 py-2">
      <Alert variant="destructive">
        <AlertTitle>invalid entitlement signature</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-3">
          <span>Premium features are blocked until a valid signed entitlement is fetched.</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 border-destructive/40 text-destructive hover:bg-destructive/10"
            onClick={() => void refreshEntitlement(true)}
          >
            refresh entitlement
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
