import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientIpsDto } from './dto/update-client-ips.dto';

const CLIENT_ID_PREFIX = 'client_';
const SECRET_PREFIX = 'secret_';

@Injectable()
export class GatewayClientService {
  private readonly logger = new Logger(GatewayClientService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // CREATE — generates clientId + plaintext secret (returned ONCE, then hashed)
  // ─────────────────────────────────────────────────────────────────────────
  async create(userId: string, dto: CreateClientDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const rawClientId = `${CLIENT_ID_PREFIX}${crypto.randomBytes(12).toString('hex')}`;
    const rawSecret   = `${SECRET_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
    const hashedSecret = await bcrypt.hash(rawSecret, 12);

    const client = await this.prisma.apiClient.create({
      data: {
        clientId:     rawClientId,
        clientSecret: hashedSecret,
        name:         dto.name,
        allowedIps:   dto.allowedIps ?? [],
        userId,
      },
    });

    this.logger.log(`ApiClient created: ${rawClientId} for user ${userId}`);

    // ⚠️  clientSecret is returned HERE only — never again
    return {
      id:          client.id,
      clientId:    rawClientId,
      clientSecret: rawSecret, // plaintext — shown ONCE
      name:        client.name,
      allowedIps:  client.allowedIps,
      isActive:    client.isActive,
      createdAt:   client.createdAt,
      warning: 'Save your clientSecret now — it will not be shown again.',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LIST — by userId (no secret returned)
  // ─────────────────────────────────────────────────────────────────────────
  async listByUser(userId: string) {
    const clients = await this.prisma.apiClient.findMany({
      where: { userId },
      select: {
        id:         true,
        clientId:   true,
        name:       true,
        allowedIps: true,
        isActive:   true,
        createdAt:  true,
        updatedAt:  true,
        _count: { select: { requestLogs: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return clients.map(c => ({
      ...c,
      requestCount: c._count.requestLogs,
      _count: undefined,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LIST ALL — admin only
  // ─────────────────────────────────────────────────────────────────────────
  async listAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [clients, total] = await Promise.all([
      this.prisma.apiClient.findMany({
        skip,
        take: limit,
        select: {
          id:        true,
          clientId:  true,
          name:      true,
          allowedIps: true,
          isActive:  true,
          userId:    true,
          createdAt: true,
          user: { select: { name: true, email: true } },
          _count: { select: { requestLogs: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.apiClient.count(),
    ]);

    return {
      data: clients.map(c => ({ ...c, requestCount: c._count.requestLogs, _count: undefined })),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RESET CREDENTIALS — generates new clientId + clientSecret
  // ─────────────────────────────────────────────────────────────────────────
  async resetCredentials(clientDbId: string, requestingUserId: string, isAdmin = false) {
    const client = await this.prisma.apiClient.findUnique({ where: { id: clientDbId } });
    if (!client) throw new NotFoundException('API client não encontrado');

    if (!isAdmin && client.userId !== requestingUserId) {
      throw new ForbiddenException('Acesso negado');
    }

    const newClientId = `${CLIENT_ID_PREFIX}${crypto.randomBytes(12).toString('hex')}`;
    const newRawSecret = `${SECRET_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
    const newHashedSecret = await bcrypt.hash(newRawSecret, 12);

    await this.prisma.apiClient.update({
      where: { id: clientDbId },
      data: {
        clientId:     newClientId,
        clientSecret: newHashedSecret,
        updatedAt:    new Date(),
      },
    });

    this.logger.log(`Credentials reset for ApiClient ${clientDbId}`);

    return {
      clientId:     newClientId,
      clientSecret: newRawSecret, // shown ONCE
      warning: 'Save your new clientSecret now — it will not be shown again.',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TOGGLE active/inactive
  // ─────────────────────────────────────────────────────────────────────────
  async toggleActive(clientDbId: string, requestingUserId: string, isAdmin = false) {
    const client = await this.prisma.apiClient.findUnique({ where: { id: clientDbId } });
    if (!client) throw new NotFoundException('API client não encontrado');

    if (!isAdmin && client.userId !== requestingUserId) {
      throw new ForbiddenException('Acesso negado');
    }

    const updated = await this.prisma.apiClient.update({
      where: { id: clientDbId },
      data:  { isActive: !client.isActive },
      select: { id: true, clientId: true, isActive: true },
    });

    return { ...updated, message: `Client ${updated.isActive ? 'ativado' : 'desativado'}` };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UPDATE ALLOWED IPs
  // ─────────────────────────────────────────────────────────────────────────
  async updateAllowedIps(clientDbId: string, dto: UpdateClientIpsDto, requestingUserId: string, isAdmin = false) {
    const client = await this.prisma.apiClient.findUnique({ where: { id: clientDbId } });
    if (!client) throw new NotFoundException('API client não encontrado');

    if (!isAdmin && client.userId !== requestingUserId) {
      throw new ForbiddenException('Acesso negado');
    }

    const updated = await this.prisma.apiClient.update({
      where: { id: clientDbId },
      data:  { allowedIps: dto.allowedIps },
      select: { id: true, clientId: true, allowedIps: true },
    });

    return { ...updated, message: 'IPs atualizados' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DELETE
  // ─────────────────────────────────────────────────────────────────────────
  async delete(clientDbId: string, requestingUserId: string, isAdmin = false) {
    const client = await this.prisma.apiClient.findUnique({ where: { id: clientDbId } });
    if (!client) throw new NotFoundException('API client não encontrado');

    if (!isAdmin && client.userId !== requestingUserId) {
      throw new ForbiddenException('Acesso negado');
    }

    await this.prisma.apiClient.delete({ where: { id: clientDbId } });
    return { message: 'API client excluído' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VALIDATE CREDENTIALS — used by ClientAuthGuard
  // ─────────────────────────────────────────────────────────────────────────
  async validateClient(
    clientId: string,
    clientSecret: string,
    requestIp: string,
  ): Promise<{ id: string; userId: string; name: string } | null> {
    const client = await this.prisma.apiClient.findUnique({
      where: { clientId },
      include: { user: { select: { id: true, status: true } } },
    });

    if (!client || !client.isActive) return null;
    if (client.user.status !== 'ACTIVE') return null;

    // Compare hashed secret
    const secretValid = await bcrypt.compare(clientSecret, client.clientSecret);
    if (!secretValid) return null;

    // IP whitelist check — if empty, allow all IPs
    if (client.allowedIps.length > 0) {
      const normalised = this.normaliseIp(requestIp);
      const allowed = client.allowedIps.some(ip => this.normaliseIp(ip) === normalised);
      if (!allowed) {
        this.logger.warn(`IP ${requestIp} not in whitelist for client ${clientId}`);
        return null;
      }
    }

    return { id: client.id, userId: client.userId, name: client.name };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REQUEST LOG — write after gateway request completes
  // ─────────────────────────────────────────────────────────────────────────
  async logRequest(data: {
    apiClientId: string;
    endpoint: string;
    method: string;
    ip: string;
    statusCode: number;
    responseTime: number;
    error?: string | null;
    requestBody?: any;
  }) {
    return this.prisma.gatewayRequestLog.create({
      data: {
        apiClientId:  data.apiClientId,
        endpoint:     data.endpoint,
        method:       data.method,
        ip:           data.ip,
        statusCode:   data.statusCode,
        responseTime: data.responseTime,
        error:        data.error ?? null,
        requestBody:  data.requestBody ?? null,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET LOGS — per client
  // ─────────────────────────────────────────────────────────────────────────
  async getLogs(clientDbId: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      this.prisma.gatewayRequestLog.findMany({
        where:   { apiClientId: clientDbId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.gatewayRequestLog.count({ where: { apiClientId: clientDbId } }),
    ]);

    return {
      data: logs,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  /** Strips IPv4-mapped IPv6 prefix (::ffff:1.2.3.4 → 1.2.3.4) */
  private normaliseIp(ip: string): string {
    if (ip.startsWith('::ffff:')) return ip.slice(7);
    return ip;
  }
}
