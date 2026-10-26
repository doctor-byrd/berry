import { Body, Controller, Post, Get, Req, UseGuards } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt.guard';
import { CreateUserDto, LoginUserDto, ForgotPasswordDto, User } from '@project/shared-types';

@Controller('auth')
export class AuthController {
    constructor(private userService: UsersService, private authService: AuthService) {}
    
    @Post('signup')
    signup(@Body() userDTO: CreateUserDto): Promise<User> {
        return this.userService.create(userDTO)
    }

    @Post('login')
    login(@Body() userDTO: LoginUserDto): Promise<{ accessToken: string, user: Omit<User, 'passwordHash' | 'resetToken' | 'resetTokenExpiresAt'> }> {
        return this.authService.login(userDTO);
    }

    @Post('forgot-password')
    async forgotPassword(@Body() body: ForgotPasswordDto) {
        return this.authService.forgotPassword(body.email);
    }

    @Get('me')
    @UseGuards(JwtAuthGuard)
    getProfile(@Req() request: any) {
        return request.user;
    }
}