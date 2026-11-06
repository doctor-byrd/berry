import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { TokenSet } from 'openid-client';
import { UsersService } from '../users/users.service';
import { OidcService } from './oidc.service';
import { AuthSessionDto, User } from '@project/shared-types';

/** Cookie used strictly during the temporary redirect handshake */
const OIDC_FLOW_COOKIE = 'idp_oidc_flow';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private readonly userService: UsersService, 
        private readonly oidcService: OidcService
    ) {}

    /**
     * Redirects the user agent to the identity provider's authorization endpoint.
     */
    async login(res: Response): Promise<void> {
        const { url, state, nonce, codeVerifier } = await this.oidcService.buildAuthorizationUrl();
        this.setFlowCookie(res, { state, nonce, codeVerifier });
        res.redirect(url);
    }

    /**
     * Handles the OAuth2/OIDC callback: validates state, exchanges code,
     * JIT-provisions the user, and returns tokens in the response body.
     */
    async handleCallback(req: Request, res: Response): Promise<AuthSessionDto> {
        const flow = this.readFlowCookie(req);
        if (!flow) {
            throw new UnauthorizedException('Missing OIDC flow state, please restart the login flow');
        }

        const params = req.query as Record<string, unknown>;
        const tokens: TokenSet = await this.oidcService.exchangeCode(params, {
            state: flow.state,
            nonce: flow.nonce,
            codeVerifier: flow.codeVerifier,
        });

        const claims = tokens.claims();
        const sub = claims?.sub;
        const email = claims?.email || (await this.fetchEmail(tokens));

        if (!sub || !email) {
            throw new UnauthorizedException('Identity provider did not return the expected claims');
        }

        const user = await this.provisionUser(sub, email);
        this.clearFlowCookie(res); // Clean up temp handshake cookie

        return {
            accessToken: tokens.access_token ?? '',
            refreshToken: tokens.refresh_token,
            expiresIn: tokens.expires_in ?? 3600,
            user,
        };
    }

    /**
     * Renews the session payload strictly through JSON parameters.
     */
    async refreshSession(refreshToken: string): Promise<Omit<AuthSessionDto, 'user'>> {
        const tokens = await this.oidcService.refreshTokens(refreshToken);
        return {
            accessToken: tokens.access_token ?? '',
            refreshToken: tokens.refresh_token,
            expiresIn: tokens.expires_in ?? 3600,
        };
    }

    /**
     * Logs out the user by pulling down the identity provider session.
     */
    async logout(idToken?: string): Promise<string> {
        return await this.oidcService.buildLogoutUrl(idToken);
    }

    private async provisionUser(idpSub: string, email: string): Promise<User> {
        try {
            const existing = await this.userService.findByIdpSubject(idpSub);
            if (existing.email !== email) {
                return await this.userService.update(existing.id, { email });
            }
            return existing;
        } catch {
            this.logger.log(`JIT-provisioning user ${email} (IDP Subject: ${idpSub})`);
            return await this.userService.create({ email, externalId: idpSub });
        }
    }

    private async fetchEmail(tokens: TokenSet): Promise<string | undefined> {
        if (!tokens.access_token) return undefined;
        try {
            const userinfo = await this.oidcService.verifyToken(tokens.access_token);
            return userinfo.email;
        } catch {
            return undefined;
        }
    }

    // ------------------------------------------------------------------
    // Flow Handling Cookies (Temporary browser redirect state tracking)
    // ------------------------------------------------------------------

    private setFlowCookie(res: Response, value: { state: string; nonce: string; codeVerifier: string }): void {
        res.cookie(OIDC_FLOW_COOKIE, JSON.stringify(value), {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 5 * 60 * 1000, 
        });
    }

    private readFlowCookie(req: Request): { state: string; nonce: string; codeVerifier: string } | null {
        const raw = req.cookies?.[OIDC_FLOW_COOKIE];
        if (!raw) return null;
        try {
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
            return null;
        }
    }

    private clearFlowCookie(res: Response): void {
        res.clearCookie(OIDC_FLOW_COOKIE);
    }
}
