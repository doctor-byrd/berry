import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { NotificationGateway } from './notification.gateway';
import { CoreJobActions, NotificationPayload } from '@project/shared-types';

@Processor(CoreJobActions.SEND_NOTIFICATION)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly notificationGateway: NotificationGateway) {
    super();
  }

  /**
   * Core processing block: Consume real-time notification events asynchronously
   */
  async process(job: Job<NotificationPayload>): Promise<void> {
    const { recipientId, eventSignature, title, message, metadata } = job.data;
    this.logger.log(`Processing background notification broadcast for event: [${eventSignature}] targeting user: [${recipientId}]`);

    try {
      // Construct a generic payload package that React Web and Expo Mobile can map fluidly
      const clientPacket = {
        title,
        message,
        eventSignature,
        metadata: metadata || {},
        timestamp: new Date()
      };

      // Push the unified event payload downstream straight through Socket.io layout wires
      this.notificationGateway.sendToUser(recipientId, 'notification.incoming', clientPacket);
      
      this.logger.log(`Successfully dispatched real-time web-socket alert package for job ID: [${job.id}]`);
    } catch (error) {
      this.logger.error(`Failed to handle real-time background notification routing for job: ${job.id}`, error);
      throw error; // Backoff retry logic engine safe trigger step
    }
  }
}