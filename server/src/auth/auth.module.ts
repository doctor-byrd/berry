import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { OidcService } from './oidc.service';
import { OidcBearerStrategy } from './oidc.strategy';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'oidc-bearer' }),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService, 
    OidcService,
    {
      provide: 'OIDC_CLIENT',
      useFactory: async (oidcService: OidcService) => {
        return await oidcService.getClient();
      },
      inject: [OidcService],
    },
    OidcBearerStrategy,
  ],
  exports: [AuthService, PassportModule], 
})
export class AuthModule {}
