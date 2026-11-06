import { ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class OidcAuthGuard extends AuthGuard('oidc-bearer') {
    
    override async canActivate(context: ExecutionContext): Promise<boolean> {
        const result = (await super.canActivate(context)) as boolean;
        
        const request = context.switchToHttp().getRequest();
        if (request.logIn) {
            await request.logIn(request.user);
        }
        
        return result;
    }

    override handleRequest<TUser = any>(err: any, user: any, info: any, context: ExecutionContext, status?: any): TUser {
        if (err || !user) {
            throw err || new UnauthorizedException('OIDC authentication failed or missing user context');
        }
        return user;
    }
}
