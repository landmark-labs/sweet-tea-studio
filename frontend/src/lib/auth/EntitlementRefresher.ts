import type { AuthSession } from "@/lib/auth/AuthSession";
import type { EntitlementCache } from "@/lib/auth/EntitlementCache";

type RefreshReason = "login_success" | "daily" | "feature_invocation" | "manual";

interface EntitlementRefresherOptions {
  authSession: AuthSession;
  entitlementCache: EntitlementCache;
  dailyRefreshIntervalMs: number;
  checkIntervalMs: number;
  now?: () => Date;
  isOnline?: () => boolean;
  onRefreshed?: () => void;
}

const ATTEMPT_COOLDOWN_MS = 5 * 60 * 1000;

export class EntitlementRefresher {
  private readonly now: () => Date;
  private readonly isOnline: () => boolean;
  private checkIntervalHandle: ReturnType<typeof setInterval> | null = null;
  private inFlightRefresh: Promise<boolean> | null = null;
  private lastAttemptMs = 0;

  constructor(private readonly options: EntitlementRefresherOptions) {
    this.now = options.now ?? (() => new Date());
    this.isOnline =
      options.isOnline ??
      (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  }

  private getLastRefreshMs(): number {
    const snapshot = this.options.entitlementCache.getSnapshot();
    if (!snapshot.lastRefreshAt) return 0;
    const parsed = Date.parse(snapshot.lastRefreshAt);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private needsDailyRefresh(): boolean {
    const lastRefreshMs = this.getLastRefreshMs();
    if (!lastRefreshMs) {
      return true;
    }
    return this.now().getTime() - lastRefreshMs >= this.options.dailyRefreshIntervalMs;
  }

  start(): void {
    if (this.checkIntervalHandle) {
      return;
    }
    this.checkIntervalHandle = setInterval(() => {
      void this.requestRefresh("daily");
    }, this.options.checkIntervalMs);
  }

  stop(): void {
    if (!this.checkIntervalHandle) return;
    clearInterval(this.checkIntervalHandle);
    this.checkIntervalHandle = null;
  }

  async onLoginSuccess(entitlementJwt?: string | null): Promise<void> {
    if (entitlementJwt) {
      const refreshedAt = this.now().toISOString();
      await this.options.entitlementCache.storeSignedEntitlement(entitlementJwt, refreshedAt);
      await this.options.authSession.markEntitlementRefresh(refreshedAt);
      this.options.onRefreshed?.();
      return;
    }
    await this.requestRefresh("login_success", true);
  }

  async requestRefresh(reason: RefreshReason, force = false): Promise<boolean> {
    if (!this.options.authSession.isAuthenticated()) {
      return false;
    }
    if (!this.isOnline()) {
      return false;
    }
    if (reason === "daily" && !this.needsDailyRefresh() && !force) {
      return false;
    }

    const nowMs = this.now().getTime();
    if (!force && reason !== "manual" && nowMs - this.lastAttemptMs < ATTEMPT_COOLDOWN_MS) {
      return false;
    }

    if (this.inFlightRefresh) {
      return this.inFlightRefresh;
    }

    this.lastAttemptMs = nowMs;
    this.inFlightRefresh = (async () => {
      try {
        const jwt = await this.options.authSession.fetchEntitlementJwt();
        const refreshedAt = this.now().toISOString();
        const snapshot = await this.options.entitlementCache.storeSignedEntitlement(jwt, refreshedAt);
        if (snapshot.status !== "invalid_signature") {
          await this.options.authSession.markEntitlementRefresh(refreshedAt);
          this.options.onRefreshed?.();
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        this.inFlightRefresh = null;
      }
    })();

    return this.inFlightRefresh;
  }
}
