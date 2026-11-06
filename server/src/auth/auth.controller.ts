import { Controller, Get, Req, Res, Post, Body, Query, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthSessionDto } from '@project/shared-types';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Get('login')
    async login(@Res() res: Response): Promise<void> {
        await this.authService.login(res);
    }

    @Get('callback')
    async callback(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthSessionDto> {
        return await this.authService.handleCallback(req, res);
    }

    @Post('refresh')
    async refresh(@Body('refreshToken') refreshToken: string): Promise<Omit<AuthSessionDto, 'user'>> {
        if (!refreshToken) {
            throw new UnauthorizedException('No refresh token provided');
        }
        return await this.authService.refreshSession(refreshToken);
    }

    @Get('logout')
    async logout(@Query('id_token_hint') idToken?: string): Promise<{ logoutUrl: string }> {
        const logoutUrl = await this.authService.logout(idToken);
        return { logoutUrl };
    }
}
