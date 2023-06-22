import { generateChallenge, parseJwt, randomToken, stringQuery } from "./utils";

export type action_hint = "login" | "signup";

export interface FirstlineClientOptions {
  domain: string;
  audience: string;
  issuer?: string;
  client_id: string;
  redirect_uri: string;
  logout_uri: string;
}

export interface AuthorizeQueryParams {
  grant_type: string;
  response_type: string;
  response_mode: string;
  audience: string;
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  action_hint?: action_hint;
}

export interface ExchangeCodeResponse {
  access_token: string;
  id_token: string;
  refresh_token: string;
}

export interface LoginRedirectOptions {
  redirect_uri?: string;
  state?: string;
  action_hint?: action_hint;
}

export class FirstlineClient {
  serverUrl: string;

  constructor(private options: FirstlineClientOptions) {
    this.serverUrl = options.domain.includes("localhost")
      ? `http://${options.domain}`
      : `https://${options.domain}`;
  }

  public async loginRedirect(options?: LoginRedirectOptions) {
    const code_verifier = randomToken(43);
    const authorizeQueryParams: AuthorizeQueryParams = {
      grant_type: "authorization_code",
      response_type: "code",
      response_mode: "query",
      audience: this.options.audience,
      client_id: this.options.client_id,
      redirect_uri: options?.redirect_uri ?? this.options.redirect_uri,
      state: options?.state ?? randomToken(64),
      code_challenge: await generateChallenge(code_verifier),
      action_hint: options?.action_hint ?? "login",
    };
    const query = stringQuery(authorizeQueryParams);

    window.localStorage.setItem("state", authorizeQueryParams.state);
    window.localStorage.setItem("code_verifier", code_verifier);

    window.location["assign"](`${this.serverUrl}/api/v3/authorize?${query}`);
  }

  public async verifyRedirect() {
    window.location["assign"](
      `${this.serverUrl}/ui/mail-confirmation?redirect_uri=${encodeURIComponent(
        this.options.redirect_uri
      )}`
    );
  }

  public async exchangeAuthorizationCode(
    authorizationCode: string,
    code_verifier: string,
    state: string
  ): Promise<ExchangeCodeResponse> {
    const exchangeTokenRequest = {
      grant_type: "authorization_code",
      code: authorizationCode,
      client_id: this.options.client_id,
      code_verifier: code_verifier,
      redirect_uri: this.options.redirect_uri,
      state: state,
    };
    const exchangeTokenParams = stringQuery(exchangeTokenRequest);
    const token_response = await fetch(
      `${this.serverUrl}/api/v3/oauth/token?${exchangeTokenParams}`,
      {
        method: "post",
      }
    ).then((response) => response.json());

    return token_response;
  }

  public async exchangeRefreshToken(
    refreshToken: string
  ): Promise<ExchangeCodeResponse> {
    const exchangeTokenRequest = {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.options.client_id,
    };
    const exchangeTokenParams = stringQuery(exchangeTokenRequest);
    const token_response = await fetch(
      `${this.serverUrl}/api/v3/oauth/token?${exchangeTokenParams}`,
      {
        method: "post",
      }
    ).then((response) => response.json());

    return token_response;
  }

  public async logout() {
    window.localStorage.removeItem("refresh_token");
    const logoutRequest = {
      client_id: this.options.client_id,
      logout_uri: this.options.logout_uri ?? this.options.redirect_uri,
    };
    const logoutParams = stringQuery(logoutRequest);
    window.location["assign"](
      `${this.serverUrl}/api/v3/logout?${logoutParams}`
    );
  }

  public async doExchangeCode(): Promise<ExchangeCodeResponse> {
    const params = new URLSearchParams(window.location.search);

    const codeParam = params.get("code");
    const stateParam = params.get("state");
    const storedState = window.localStorage.getItem("state");
    const storedCodeVerifier = window.localStorage.getItem("code_verifier");
    if (codeParam && stateParam && storedState && storedCodeVerifier) {
      if (stateParam === storedState) {
        const tokenResponse: ExchangeCodeResponse =
          await this.exchangeAuthorizationCode(
            codeParam,
            storedCodeVerifier,
            stateParam
          );
        window.localStorage.removeItem("state");
        window.localStorage.removeItem("code_verifier");
        window.localStorage.setItem(
          "refresh_token",
          tokenResponse.refresh_token
        );

        window.history.pushState(
          "object or string",
          "Title",
          "/" +
            window.location.href
              .substring(window.location.href.lastIndexOf("/") + 1)
              .split("?")[0]
        );
        return tokenResponse;
      }
    }
    return null;
  }

  public async doRefresh(): Promise<ExchangeCodeResponse> {
    const refresh_token = window.localStorage.getItem("refresh_token");
    if (refresh_token) {
      const tokenResponse: ExchangeCodeResponse =
        await this.exchangeRefreshToken(refresh_token);
      if (tokenResponse.refresh_token) {
        window.localStorage.setItem(
          "refresh_token",
          tokenResponse.refresh_token
        );
        return tokenResponse;
      } else {
        window.localStorage.removeItem("refresh_token");
      }
    }
    return null;
  }

  public async doExchangeOrRefresh(): Promise<ExchangeCodeResponse> {
    let tokens = await this.doRefresh();
    if (!tokens) tokens = await this.doExchangeCode();

    return tokens;
  }

  public getUser(tokens: ExchangeCodeResponse): any {
    if (tokens?.id_token) {
      return parseJwt(tokens.id_token);
    }
    return null;
  }

  public isEmailVerified(tokens: ExchangeCodeResponse): boolean {
    const userObject = this.getUser(tokens);
    return userObject.is_verified ? true : false;
  }
}
