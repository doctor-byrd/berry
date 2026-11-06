import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Issuer, generators, TokenSet, Client } from 'openid-client';
import { AuthOptions } from '../common/general';

/**
 * Thin wrapper around the openid-client library that talks to the identity provider over OpenID Connect / OAuth2.
 */
@Injectable()
export class OidcService {
    private readonly logger = new Logger(OidcService.name);
    private issuer: Issuer | null = null;

    /**
     * Discovers the OpenID configuration (cached after first load).
     */
    async getIssuer(): Promise<Issuer> {
        if (!this.issuer) {
            try {
                this.issuer = await Issuer.discover(AuthOptions.ISSUER_URL);
            } catch (error) {
                this.logger.error(`Failed to discover OIDC issuer at ${AuthOptions.ISSUER_URL}`, error);
                throw error;
            }
        }
        return this.issuer;
    }

    /**
     * Returns a configured OAuth2/OIDC client for the "server" application registered in Identity Provider.
     */
    async getClient(): Promise<Client> { // 💡 Fixed the return type here
        const issuer = await this.getIssuer();
        return new issuer.Client({
            client_id: AuthOptions.CLIENT_ID,
            client_secret: AuthOptions.CLIENT_SECRET,
            redirect_uris: [AuthOptions.REDIRECT_URI],
            response_types: ['code'],
        });
    }

    /**
     * Builds the authorization URL (with PKCE + state/nonce) used to redirect unauthenticated users to the identity provider.
     */
    async buildAuthorizationUrl(): Promise<{ url: string; state: string; nonce: string; codeVerifier: string }> {
        const client = await this.getClient();
        const state = generators.state();
        const nonce = generators.nonce();
        const codeVerifier = generators.codeVerifier();
        const codeChallenge = generators.codeChallenge(codeVerifier);

        const url = client.authorizationUrl({
            scope: AuthOptions.SCOPES.join(' '),
            state,
            nonce,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
        });

        return { url, state, nonce, codeVerifier };
    }

    /**
     * Exchanges the authorization code returned by the Identity Provider on the callback route for a token set (ID token, access token, refresh token).
     */
    async exchangeCode(params: Record<string, unknown>, checks: { state?: string; nonce?: string; codeVerifier?: string }): Promise<TokenSet> {
        const client = await this.getClient();
        try {
            return await client.callback(AuthOptions.REDIRECT_URI, params, {
                state: checks.state,
                nonce: checks.nonce,
                code_verifier: checks.codeVerifier,
            });
        } catch (error) {
            this.logger.warn(`OIDC code exchange failed: ${(error as Error).message}`);
            throw new UnauthorizedException('Invalid or expired authorization code');
        }
    }

    /**
     * Uses the refresh token grant to obtain a fresh token set without user interaction.
     */
    async refreshTokens(refreshToken: string): Promise<TokenSet> {
        const client = await this.getClient();
        try {
            return await client.refresh(refreshToken); 
        } catch (error) {
            this.logger.warn(`OIDC refresh failed: ${(error as Error).message}`);
            throw new UnauthorizedException('Session expired, please log in again');
        }
    }

    /**
     * Validates an access token issued by Identity provider against the identity provider and returns the verified user claims.
     */
    async verifyToken(token: string): Promise<Record<string, any>> {
        const client = await this.getClient();
        try {
            return await client.userinfo(token);
        } catch (error) {
            this.logger.warn(`OIDC token verification failed: ${(error as Error).message}`);
            throw new UnauthorizedException('Invalid or expired access token');
        }
    }

    /**
     * Builds the end-session URL so the browser can terminate the SSO session after logging out of the application.
     */
    async buildLogoutUrl(idToken?: string): Promise<string> {
        const client = await this.getClient();
        return client.endSessionUrl({
            post_logout_redirect_uri: AuthOptions.POST_LOGOUT_REDIRECT_URI,
            id_token_hint: idToken,
        });
    }
}
