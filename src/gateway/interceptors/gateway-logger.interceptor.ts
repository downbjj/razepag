import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { GatewayClientService } from '../../api-keys/gateway-client.service';

@Injectable()
export class GatewayLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger(GatewayLoggerInterceptor.name);

  constructor(private readonly gatewayClientService: GatewayClientService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request  = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const startTime = Date.now();

    const ip       = this.extractIp(request);
    const endpoint = request.url;
    const method   = request.method;

    return next.handle().pipe(
      tap({
        next: () => {
          const apiClient = request.apiClient;
          if (!apiClient?.id) return;

          const responseTime = Date.now() - startTime;
          this.gatewayClientService
            .logRequest({
              apiClientId:  apiClient.id,
              endpoint,
              method,
              ip,
              statusCode:   response.statusCode ?? 200,
              responseTime,
              error:        null,
              requestBody:  this.safeBody(request.body),
            })
            .catch(err => this.logger.error('Failed to write gateway log', err));
        },
        error: (err) => {
          const apiClient = request.apiClient;
          if (!apiClient?.id) return;

          const responseTime = Date.now() - startTime;
          this.gatewayClientService
            .logRequest({
              apiClientId:  apiClient.id,
              endpoint,
              method,
              ip,
              statusCode:   err?.status ?? 500,
              responseTime,
              error:        err?.message ?? 'Unknown error',
              requestBody:  this.safeBody(request.body),
            })
            .catch(logErr => this.logger.error('Failed to write gateway error log', logErr));
        },
      }),
    );
  }

  private extractIp(request: any): string {
    return (
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      (request.headers['x-real-ip'] as string) ??
      request.ip ??
      '0.0.0.0'
    );
  }

  /** Strip sensitive fields before logging the request body */
  private safeBody(body: any): any {
    if (!body || typeof body !== 'object') return null;
    const { cardNumber, cvv, card_number, security_code, token, ...safe } = body;
    return safe;
  }
}
