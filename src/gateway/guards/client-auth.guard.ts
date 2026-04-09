import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { GatewayClientService } from '../../api-keys/gateway-client.service';

@Injectable()
export class ClientAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClientAuthGuard.name);

  constructor(private readonly gatewayClientService: GatewayClientService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Accept both header formats: client_id / client-id
    const clientId = request.headers['client_id'] ?? request.headers['client-id'];
    const clientSecret = request.headers['client_secret'] ?? request.headers['client-secret'];

    if (!clientId || !clientSecret) {
      throw new UnauthorizedException(
        'Credenciais ausentes. Envie os headers client_id e client_secret.',
      );
    }

    const requestIp = this.extractIp(request);

    const client = await this.gatewayClientService.validateClient(
      clientId as string,
      clientSecret as string,
      requestIp,
    );

    if (!client) {
      this.logger.warn(`Auth failed for clientId=${clientId} ip=${requestIp}`);
      // Use 403 for IP blocks to avoid revealing whether clientId exists
      throw new ForbiddenException(
        'Credenciais inválidas ou IP não autorizado.',
      );
    }

    // Attach to request — consumed by @ApiClient() decorator and GatewayLoggerInterceptor
    request.apiClient = { ...client, ip: requestIp };
    return true;
  }

  private extractIp(request: any): string {
    return (
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      (request.headers['x-real-ip'] as string) ??
      request.connection?.remoteAddress ??
      request.socket?.remoteAddress ??
      request.ip ??
      '0.0.0.0'
    );
  }
}
