import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { CoreJobActions } from '@project/shared-types';

@Processor(CoreJobActions.SET_CONFIGURATION)
export class ConfigurationProcessor extends WorkerHost {
  private readonly logger = new Logger(ConfigurationProcessor.name);
  private readonly cachePrefix = 'sys_config:';

  constructor(
    @InjectQueue(CoreJobActions.SET_CONFIGURATION) private readonly sharedQueue: Queue,
  ) {
    super();
  }

  /**
   * Core execution pipeline: Evict cluster configurations instantly across background loops
   */
  async process(job: Job<{ key: string }>): Promise<void> {
    const { key } = job.data;
    this.logger.log(`Processing cache eviction event for variable token key: [${key}]`);

    try {
      const backend = this.sharedQueue.getBackend() as any;
      const redis = await backend.client;
      const cacheKey = `${this.cachePrefix}${key}`;

      // Purge corresponding keys across multi-container layout structures instantly
      await redis.del(cacheKey);
      
      this.logger.log(`Cache line eviction completed successfully for system path: [${cacheKey}]`);
    } catch (error) {
      this.logger.error(`Failed to handle cluster configuration eviction sync event for key: ${key}`, error);
      throw error;
    }
  }
}