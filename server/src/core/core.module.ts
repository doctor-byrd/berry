import { Module } from '@nestjs/common';
import { User, SystemConfig, CoreJobActions } from '@project/shared-types';
import { TypeOrmModule } from '@nestjs/typeorm'
import { SystemConfigService } from './system.config.service';
import { ConfigurationProcessor } from './configuration.processor';
import { NotificationGateway } from './notification.gateway';
import { NotificationProcessor } from './notification.processor';
import { EncryptionService } from './encryption.service';
import { BullModule } from '@nestjs/bullmq';
import { JetStreamService } from './jetsream.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, SystemConfig]),
    BullModule.registerQueue({ name: CoreJobActions.SET_CONFIGURATION}),
  ],
  providers: [
    EncryptionService,
    NotificationGateway,
    JetStreamService,
    SystemConfigService,
    ConfigurationProcessor,
    NotificationProcessor,
  ],
  exports: [
    EncryptionService,
    SystemConfigService,
    JetStreamService,
  ]
})
export class CoreModule {}