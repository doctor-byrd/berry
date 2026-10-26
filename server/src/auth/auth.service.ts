import * as bcrypt from 'bcryptjs';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { LoginUserDto, User } from '@project/shared-types';


@Injectable()
export class AuthService {
    constructor(private userService: UsersService, private jwtService: JwtService) {}

  async login(loginData: LoginUserDto): Promise<{ accessToken: string; user: Omit<User, 'passwordHash' | 'resetToken' | 'resetTokenExpiresAt'> }> {
    const user = await this.userService.findByEmail(loginData.email);
    const passwordMatched = await bcrypt.compare(loginData.password, user.passwordHash);
    
    if (passwordMatched) {
      const payload = { email: user.email, sub: user.id, role: user.role };
      const { passwordHash, resetToken, resetTokenExpiresAt, ...safeUser } = user;

      return { 
        accessToken: this.jwtService.sign(payload),
        user: safeUser
      };
    } else {
      throw new UnauthorizedException('Provided password does not match');
    }
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    // Try to find the user. If not found, we catch the error and proceed silently.
    const user = await this.userService.findByEmail(email).catch(() => null);

    if (user) {
      // Generate a secure random token and set a 15-minute expiry
      const resetToken = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15);

      // Update the user record
      user.resetToken = resetToken;
      user.resetTokenExpiresAt = expiresAt;
      await this.userService.update(user.id, user);

      // TODO: Integrate email provider here (e.g., SendGrid, Resend, AWS SES) for now, log to console for development/testing.
      Logger.log(`\n[DEV] Password reset requested for: ${user.email}`);
      Logger.log(`[DEV] Reset Token: ${resetToken}`);
      Logger.log(`[DEV] Link: http://localhost:3000/auth/reset-password?token=${resetToken}\n`);
    }

    return { 
      message: 'If an account with that email exists, a password reset link has been sent.' 
    };
  }
}