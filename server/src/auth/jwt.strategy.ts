import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthOptions } from '../common/general';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor() {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: AuthOptions.JWT_SECRET,
        });
    }

    async validate(payload: any) {
        return {
            email: payload.email,
            userId: payload.sub,
            role: payload.role,
        }
    }
}