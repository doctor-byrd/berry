import KeyvRedis from '@keyv/redis';
import { APP_GUARD } from '@nestjs/core';
import { Logger, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CacheModule } from '@nestjs/cache-manager';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import { getBullConfig } from '../common/bull.config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { environment } from '../common/environment';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { CoreModule } from '../core/core.module';
import { StorageModule } from '../storage/storage.module';
import { CacheTTLDefaultOptions, DatabaseOptions, RateLimitDefaultOptions } from '../common/general';
import { CoreJobActions } from '@project/shared-types';

@Module({
  imports: [
    ConfigModule.forRoot({isGlobal: true}),
    // Redis Cache Configurations
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = environment.REDIS_URL; 
        return {
          stores: [
            new KeyvRedis(redisUrl),
          ],
          ttl: CacheTTLDefaultOptions.ONE_MINUTE,
        };
      },
    }),
    // BullMQ Module & Configurations
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getBullConfig,
    }),
    BullModule.registerQueue({
      name: CoreJobActions.SEND_EMAIL,
    }),
    BullModule.registerQueue({
      name: CoreJobActions.SEND_NOTIFICATION,
    }),
    BullModule.registerQueue({
      name: CoreJobActions.SET_CONFIGURATION,
    }),
    // Database Module & Configurations
    TypeOrmModule.forRoot({
      type: DatabaseOptions.DATABASE_TYPE,
      url: environment.DATABASE_URL,
      autoLoadEntities: true,
      installExtensions: true,
      synchronize: environment.ENVIRONMENT === "development" ? true : false, 
    }),
    // General Server Modules & Configurations
    ThrottlerModule.forRoot([{
      name: 'default',
      ttl: RateLimitDefaultOptions.ONE_MINUTE,
      limit: RateLimitDefaultOptions.LIMIT,
    }]),
    // Feature Modules & Configurations
    UsersModule,
    AuthModule,
    CoreModule,
    StorageModule,
  ],
  controllers: [AppController],
  providers: [
    // Providers
    AppService, 
    // Rate Limit
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    }
  ],
})
export class AppModule implements NestModule {
  constructor(private dataSource: DataSource) {
    Logger.log(`Successfully connected to ${dataSource.driver.database} current environment is ${environment.ENVIRONMENT}`);
  }
  configure() {}
}