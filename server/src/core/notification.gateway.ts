import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: 'notifications'
})
export class NotificationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationGateway.name);

  @WebSocketServer()
  server: Server;

  /**
   * Handle incoming socket connection registration loops
   */
  handleConnection(client: Socket) {
    // Extract userId passed up via connection query parameters from your Expo/React clients
    const userId = client.handshake.query.userId as string;

    if (userId) {
      // Isolate the client socket inside a dedicated room matching their unique user profile UUID
      client.join(`user:${userId}`);
      this.logger.log(`Socket client ${client.id} joined secure channel room: [user:${userId}]`);
    } else {
      this.logger.warn(`Socket client connection rejected: Missing explicit userId handshake query parameter`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Socket client disconnected cleanly: [${client.id}]`);
  }

  /**
   * Universal Interface Helper: Forward targeted broadcast packets out over socket connections
   */
  sendToUser(userId: string, event: string, payload: any) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  /**
   * Global Administrative Broadcast Pipe (e.g., for compliance alerts or EOD balance logs)
   */
  broadcastToRoles(roleRoom: string, event: string, payload: any) {
    this.server.to(roleRoom).emit(event, payload);
  }
}