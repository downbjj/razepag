import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts the authenticated API client from the request.
 * Populated by ClientAuthGuard.
 *
 * Usage:
 *   @ApiClient() client: { id: string; userId: string; name: string; ip: string }
 *   @ApiClient('userId') userId: string
 */
export const ApiClient = createParamDecorator(
  (field: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const client = request.apiClient;
    return field ? client?.[field] : client;
  },
);
