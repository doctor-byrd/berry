/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { updateGlobalConfig } from 'nestjs-paginate';
import { PaginationOptions } from './common/general';
import { RedisIoAdapter } from './adapters/redis.adapter';

// Global pagination configurations
updateGlobalConfig({
  defaultOrigin: PaginationOptions.DEFAULT_ORIGIN as string,
  defaultLimit: PaginationOptions.DEFAULT_LIMIT as number,
  defaultMaxLimit: PaginationOptions.DEFAULT_MAX_LIMIT as number,
})

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // App route prefix
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  // Initialize and connect to Redis
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  // Additional configurations
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
  }));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
