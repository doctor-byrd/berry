import { Injectable, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Client } from 'openid-client'; 
import { OidcUser } from '@project/shared-types';
import { environment } from '../common/environment';

@Injectable()
export class OidcBearerStrategy extends PassportStrategy(Strategy, 'oidc-bearer') {
    constructor(@Inject('OIDC_CLIENT') client: Client) {
        super({
            client,
            params: {
                scope: environment.OIDC_SCOPES,
                response_type: 'code',
            },
        });
    }

    /**
     * Standard Passport Verification: Executed automatically after a 
     * successful authorization token check or network userinfo pull.
     */
    async validate(tokenset: any, userinfo: any): Promise<OidcUser> {
        const claims = userinfo || tokenset.claims();

        return {
            userId: claims.sub,
            email: claims.email,
            role: claims.role,
        };
    }
}
