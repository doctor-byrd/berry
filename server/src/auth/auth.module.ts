import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { AuthOptions } from '../common/general';


@Module({
  imports: [
    // Auth setup
    JwtModule.register({
      secret: AuthOptions.JWT_SECRET,
      signOptions: {
        expiresIn: AuthOptions.ACCESS_TOKEN_EXPIRY,
      }
    }),
    // Application modules
    UsersModule
  ],
  exports: [AuthService],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
})
export class AuthModule {}