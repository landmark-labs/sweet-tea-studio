import type {
  EntitlementResponse,
  LoginRequest,
  LoginResponse,
  RefreshResponse,
  SessionMetadata,
} from "@/lib/auth/types";
import type { JsonStore, SecureSecretStore } from "@/lib/auth/storage";

interface AuthSessionOptions {
  authApiBase: string;
  sessionStore: JsonStore<SessionMetadata>;
  refreshTokenStore: SecureSecretStore;
  fetchImpl?: typeof fetch;
}

const ACCESS_TOKEN_REFRESH_SKEW_MS = 60 * 1000;

const parseJson = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => ({}));
  return data as T;
};

export class AuthSession {
  private readonly fetchImpl: typeof fetch;
  private session: SessionMetadata | null = null;

  constructor(private readonly options: AuthSessionOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private getEndpoint(path: string): string {
    const base = this.options.authApiBase.replace(/\/+$/, "");
    return `${base}${path}`;
  }

  private shouldRefreshAccessToken(): boolean {
    if (!this.session?.accessTokenExpiresAt) {
      return false;
    }
    const expiryMs = Date.parse(this.session.accessTokenExpiresAt);
    if (!Number.isFinite(expiryMs)) {
      return false;
    }
    return expiryMs - Date.now() <= ACCESS_TOKEN_REFRESH_SKEW_MS;
  }

  private async saveSession(session: SessionMetadata | null): Promise<void> {
    this.session = session;
    if (!session) {
      await this.options.sessionStore.clear();
      return;
    }
    await this.options.sessionStore.save(session);
  }

  private updateSession(
    data: {
      accessToken: string;
      accessTokenExpiresAt?: string | null;
      userId?: string | null;
      email?: string | null;
    },
    preserveLoginTimestamp = false,
  ): SessionMetadata {
    const next: SessionMetadata = {
      accessToken: data.accessToken,
      accessTokenExpiresAt: data.accessTokenExpiresAt ?? this.session?.accessTokenExpiresAt ?? null,
      userId: data.userId ?? this.session?.userId ?? null,
      email: data.email ?? this.session?.email ?? null,
      loggedInAt:
        preserveLoginTimestamp && this.session?.loggedInAt
          ? this.session.loggedInAt
          : new Date().toISOString(),
      lastEntitlementRefreshAt: this.session?.lastEntitlementRefreshAt ?? null,
    };
    this.session = next;
    return next;
  }

  async hydrate(): Promise<SessionMetadata | null> {
    const stored = await this.options.sessionStore.load();
    this.session = stored;
    return this.session;
  }

  getSession(): SessionMetadata | null {
    return this.session;
  }

  isAuthenticated(): boolean {
    return Boolean(this.session?.accessToken);
  }

  async login(payload: LoginRequest): Promise<LoginResponse> {
    const response = await this.fetchImpl(this.getEndpoint("/login"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await parseJson<LoginResponse>(response);

    if (!response.ok) {
      const errorMessage =
        (data as { detail?: string })?.detail || "Unable to sign in with provided credentials.";
      throw new Error(errorMessage);
    }

    if (!data.access_token || !data.refresh_token) {
      throw new Error("Invalid auth response.");
    }

    const nextSession = this.updateSession(
      {
        accessToken: data.access_token,
        accessTokenExpiresAt: data.access_token_expires_at ?? null,
        userId: data.user_id ?? null,
        email: payload.email,
      },
      false,
    );
    await this.options.refreshTokenStore.save(data.refresh_token);
    await this.saveSession(nextSession);
    return data;
  }

  async logout(): Promise<void> {
    this.session = null;
    await Promise.all([this.options.refreshTokenStore.clear(), this.options.sessionStore.clear()]);
  }

  async refreshAccessToken(): Promise<RefreshResponse> {
    const refreshToken = await this.options.refreshTokenStore.load();
    if (!refreshToken) {
      throw new Error("No refresh token available.");
    }

    const response = await this.fetchImpl(this.getEndpoint("/refresh"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const data = await parseJson<RefreshResponse>(response);

    if (!response.ok) {
      const errorMessage = (data as { detail?: string })?.detail || "Token refresh failed.";
      throw new Error(errorMessage);
    }
    if (!data.access_token) {
      throw new Error("Refresh response missing access token.");
    }

    const nextSession = this.updateSession(
      {
        accessToken: data.access_token,
        accessTokenExpiresAt: data.access_token_expires_at ?? this.session?.accessTokenExpiresAt ?? null,
      },
      true,
    );
    await this.saveSession(nextSession);

    if (data.refresh_token) {
      await this.options.refreshTokenStore.save(data.refresh_token);
    }

    return data;
  }

  async getValidAccessToken(): Promise<string | null> {
    if (!this.session?.accessToken) {
      return null;
    }
    if (!this.shouldRefreshAccessToken()) {
      return this.session.accessToken;
    }
    try {
      const refreshed = await this.refreshAccessToken();
      return refreshed.access_token;
    } catch {
      return this.session?.accessToken ?? null;
    }
  }

  async fetchEntitlementJwt(): Promise<string> {
    let accessToken = await this.getValidAccessToken();
    if (!accessToken) {
      throw new Error("You need to sign in before refreshing entitlement.");
    }

    const attemptFetch = async (token: string): Promise<Response> =>
      this.fetchImpl(this.getEndpoint("/entitlement"), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

    let response = await attemptFetch(accessToken);

    if (response.status === 401) {
      const refreshed = await this.refreshAccessToken();
      accessToken = refreshed.access_token;
      response = await attemptFetch(accessToken);
    }

    const data = await parseJson<EntitlementResponse & { detail?: string }>(response);
    if (!response.ok) {
      throw new Error(data.detail || "Failed to fetch entitlement.");
    }
    if (!data.entitlement_jwt) {
      throw new Error("Entitlement response missing signed payload.");
    }
    return data.entitlement_jwt;
  }

  async markEntitlementRefresh(refreshedAt: string): Promise<void> {
    if (!this.session) {
      return;
    }
    const next: SessionMetadata = {
      ...this.session,
      lastEntitlementRefreshAt: refreshedAt,
    };
    await this.saveSession(next);
  }
}
