import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DAILY_REFRESH_INTERVAL_MS,
  REFRESH_CHECK_INTERVAL_MS,
  STORAGE_LOCATION_HINTS,
  getAuthRuntimeConfig,
} from "@/lib/auth/config";
import { AuthSession } from "@/lib/auth/AuthSession";
import { EntitlementCache } from "@/lib/auth/EntitlementCache";
import { EntitlementRefresher } from "@/lib/auth/EntitlementRefresher";
import { FeatureGate } from "@/lib/auth/FeatureGate";
import { createAuthStorage, type RefreshTokenStorageStrategy } from "@/lib/auth/storage";
import type {
  EntitlementSnapshot,
  FeatureGateDecision,
  LoginRequest,
  PremiumFeatureId,
  SessionMetadata,
} from "@/lib/auth/types";

interface AuthContextValue {
  initialized: boolean;
  isAuthenticated: boolean;
  session: SessionMetadata | null;
  entitlement: EntitlementSnapshot;
  storageStrategy: RefreshTokenStorageStrategy;
  storageHints: typeof STORAGE_LOCATION_HINTS;
  canUseFeature: (
    featureId: PremiumFeatureId,
    options?: { invoked?: boolean },
  ) => FeatureGateDecision;
  login: (payload: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  refreshEntitlement: (force?: boolean) => Promise<boolean>;
}

const defaultEntitlementState: EntitlementSnapshot = {
  status: "no_entitlement",
  reason: "No entitlement found.",
  payload: null,
  signatureValid: false,
  daysUntilExpiry: null,
  daysUntilGraceExpiry: null,
  lastRefreshAt: null,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const runtimeConfig = useMemo(() => getAuthRuntimeConfig(), []);
  const storage = useMemo(() => createAuthStorage(), []);

  const authSession = useMemo(
    () =>
      new AuthSession({
        authApiBase: runtimeConfig.authApiBase,
        sessionStore: storage.sessionStore,
        refreshTokenStore: storage.refreshTokenStore,
      }),
    [runtimeConfig.authApiBase, storage],
  );

  const entitlementCache = useMemo(
    () =>
      new EntitlementCache({
        store: storage.entitlementStore,
        publicKeyPem: runtimeConfig.entitlementPublicKeyPem,
        gracePeriodDays: runtimeConfig.gracePeriodDays,
      }),
    [
      runtimeConfig.entitlementPublicKeyPem,
      runtimeConfig.gracePeriodDays,
      storage.entitlementStore,
    ],
  );

  const [initialized, setInitialized] = useState(false);
  const [session, setSession] = useState<SessionMetadata | null>(null);
  const [entitlement, setEntitlement] = useState<EntitlementSnapshot>(defaultEntitlementState);
  const [storageStrategy, setStorageStrategy] = useState<RefreshTokenStorageStrategy>(
    storage.refreshTokenStore.getStrategy(),
  );

  const syncState = useCallback(() => {
    setSession(authSession.getSession());
    setEntitlement(entitlementCache.getSnapshot());
    setStorageStrategy(storage.refreshTokenStore.getStrategy());
  }, [authSession, entitlementCache, storage.refreshTokenStore]);

  const refresher = useMemo(
    () =>
      new EntitlementRefresher({
        authSession,
        entitlementCache,
        dailyRefreshIntervalMs:
          runtimeConfig.dailyRefreshIntervalMs || DAILY_REFRESH_INTERVAL_MS,
        checkIntervalMs: REFRESH_CHECK_INTERVAL_MS,
        onRefreshed: syncState,
      }),
    [
      authSession,
      entitlementCache,
      runtimeConfig.dailyRefreshIntervalMs,
      syncState,
    ],
  );

  const featureGate = useMemo(
    () =>
      new FeatureGate({
        entitlementCache,
        nearExpiryRefreshDays: runtimeConfig.nearExpiryRefreshDays,
      }),
    [entitlementCache, runtimeConfig.nearExpiryRefreshDays],
  );

  useEffect(() => {
    let isActive = true;

    const initializeAuth = async () => {
      await authSession.hydrate();
      await entitlementCache.hydrate();
      if (!isActive) return;
      syncState();
      setInitialized(true);
      refresher.start();
      if (authSession.isAuthenticated()) {
        await refresher.requestRefresh("daily");
        if (isActive) {
          syncState();
        }
      }
    };

    void initializeAuth();

    const handleOnline = () => {
      void refresher.requestRefresh("daily", true).then(() => syncState());
    };
    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
    }

    return () => {
      isActive = false;
      refresher.stop();
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
      }
    };
  }, [authSession, entitlementCache, refresher, syncState]);

  const login = useCallback(
    async (payload: LoginRequest) => {
      const response = await authSession.login(payload);
      await refresher.onLoginSuccess(response.entitlement_jwt ?? null);
      syncState();
    },
    [authSession, refresher, syncState],
  );

  const logout = useCallback(async () => {
    await authSession.logout();
    await entitlementCache.clear();
    syncState();
  }, [authSession, entitlementCache, syncState]);

  const refreshEntitlement = useCallback(
    async (force = true) => {
      const refreshed = await refresher.requestRefresh("manual", force);
      syncState();
      return refreshed;
    },
    [refresher, syncState],
  );

  const canUseFeature = useCallback(
    (featureId: PremiumFeatureId, options?: { invoked?: boolean }) => {
      const decision = featureGate.canUse(featureId);
      if (options?.invoked) {
        const snapshot = entitlementCache.getSnapshot();
        const nearExpiry =
          (snapshot.daysUntilExpiry ?? Number.POSITIVE_INFINITY) <=
          runtimeConfig.nearExpiryRefreshDays;
        if (decision.status === "grace" || decision.status === "expired" || nearExpiry) {
          void refresher.requestRefresh("feature_invocation");
        }
      }
      return decision;
    },
    [entitlementCache, featureGate, refresher, runtimeConfig.nearExpiryRefreshDays],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      initialized,
      isAuthenticated: Boolean(session?.accessToken),
      session,
      entitlement,
      storageStrategy,
      storageHints: STORAGE_LOCATION_HINTS,
      canUseFeature,
      login,
      logout,
      refreshEntitlement,
    }),
    [
      initialized,
      session,
      entitlement,
      storageStrategy,
      canUseFeature,
      login,
      logout,
      refreshEntitlement,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
};
