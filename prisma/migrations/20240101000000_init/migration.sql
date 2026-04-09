-- ============================================================
-- RazePague — Migration Inicial v2
-- Schema completo com: User (balance), Pix, Log, ApiKey, etc.
-- ============================================================

-- Enums
CREATE TYPE "Role"              AS ENUM ('USER', 'ADMIN');
CREATE TYPE "UserStatus"        AS ENUM ('ACTIVE', 'PENDING', 'FROZEN', 'SUSPENDED');
CREATE TYPE "TransactionType"   AS ENUM ('DEPOSIT', 'WITHDRAW', 'TRANSFER', 'ADJUSTMENT');
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'PROCESSING', 'CANCELLED');
CREATE TYPE "LogType"           AS ENUM ('WEBHOOK', 'ERROR', 'SYSTEM');

-- ─── User (saldo embutido) ───────────────────────────────
CREATE TABLE "User" (
    "id"             TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "name"           TEXT         NOT NULL,
    "email"          TEXT         NOT NULL,
    "password"       TEXT         NOT NULL,
    "phone"          TEXT,
    "pixKey"         TEXT,
    "role"           "Role"       NOT NULL DEFAULT 'USER',
    "status"         "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "isBlocked"      BOOLEAN      NOT NULL DEFAULT false,
    "balance"        DECIMAL(20,2) NOT NULL DEFAULT 0,
    "pendingBalance" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "totalDeposited" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "totalWithdrawn" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key"  ON "User"("email");
CREATE UNIQUE INDEX "User_pixKey_key" ON "User"("pixKey");
CREATE INDEX "User_email_idx"         ON "User"("email");
CREATE INDEX "User_status_idx"        ON "User"("status");
CREATE INDEX "User_role_idx"          ON "User"("role");

-- ─── ApiKey ──────────────────────────────────────────────
CREATE TABLE "ApiKey" (
    "id"          TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
    "userId"      TEXT    NOT NULL,
    "apiKey"      TEXT    NOT NULL,
    "name"        TEXT    NOT NULL,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt"  TIMESTAMP(3),
    "permissions" TEXT[]  NOT NULL DEFAULT ARRAY['pix:create','pix:read'],
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiKey_pkey"       PRIMARY KEY ("id"),
    CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "ApiKey_apiKey_key" ON "ApiKey"("apiKey");
CREATE INDEX "ApiKey_userId_idx"        ON "ApiKey"("userId");
CREATE INDEX "ApiKey_apiKey_idx"        ON "ApiKey"("apiKey");

-- ─── Transaction ─────────────────────────────────────────
CREATE TABLE "Transaction" (
    "id"            TEXT                NOT NULL DEFAULT gen_random_uuid()::text,
    "userId"        TEXT                NOT NULL,
    "type"          "TransactionType"   NOT NULL,
    "status"        "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount"        DECIMAL(20,2)       NOT NULL,
    "fee"           DECIMAL(20,2)       NOT NULL DEFAULT 0,
    "netAmount"     DECIMAL(20,2)       NOT NULL,
    "description"   TEXT,
    "externalId"    TEXT,
    "pixKey"        TEXT,
    "relatedUserId" TEXT,
    "metadata"      JSONB,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_pkey"        PRIMARY KEY ("id"),
    CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id")
);
CREATE UNIQUE INDEX "Transaction_externalId_key" ON "Transaction"("externalId");
CREATE INDEX "Transaction_userId_idx"     ON "Transaction"("userId");
CREATE INDEX "Transaction_status_idx"     ON "Transaction"("status");
CREATE INDEX "Transaction_type_idx"       ON "Transaction"("type");
CREATE INDEX "Transaction_createdAt_idx"  ON "Transaction"("createdAt");
CREATE INDEX "Transaction_externalId_idx" ON "Transaction"("externalId");

-- ─── Pix (QR Code — 1:1 com Transaction) ────────────────
CREATE TABLE "Pix" (
    "id"            TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "transactionId" TEXT NOT NULL,
    "qrCode"        TEXT,
    "copyPaste"     TEXT,
    "expiresAt"     TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Pix_pkey"               PRIMARY KEY ("id"),
    CONSTRAINT "Pix_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "Pix_transactionId_key" ON "Pix"("transactionId");
CREATE INDEX "Pix_transactionId_idx"        ON "Pix"("transactionId");

-- ─── Log (Webhook / Error / System) ─────────────────────
CREATE TABLE "Log" (
    "id"        TEXT      NOT NULL DEFAULT gen_random_uuid()::text,
    "type"      "LogType" NOT NULL,
    "message"   TEXT      NOT NULL,
    "data"      JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Log_type_idx"      ON "Log"("type");
CREATE INDEX "Log_createdAt_idx" ON "Log"("createdAt");

-- ─── WebhookConfig ───────────────────────────────────────
CREATE TABLE "WebhookConfig" (
    "id"        TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
    "userId"    TEXT    NOT NULL,
    "url"       TEXT    NOT NULL,
    "events"    TEXT[]  NOT NULL,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "secret"    TEXT    NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookConfig_pkey"        PRIMARY KEY ("id"),
    CONSTRAINT "WebhookConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "WebhookConfig_userId_idx" ON "WebhookConfig"("userId");

-- ─── WebhookLog ──────────────────────────────────────────
CREATE TABLE "WebhookLog" (
    "id"             TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
    "userId"         TEXT    NOT NULL,
    "webhookId"      TEXT    NOT NULL,
    "event"          TEXT    NOT NULL,
    "payload"        JSONB   NOT NULL,
    "responseStatus" INTEGER,
    "responseBody"   TEXT,
    "attempts"       INTEGER NOT NULL DEFAULT 1,
    "success"        BOOLEAN NOT NULL DEFAULT false,
    "nextRetryAt"    TIMESTAMP(3),
    "transactionId"  TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookLog_pkey"        PRIMARY KEY ("id"),
    CONSTRAINT "WebhookLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id")
);
CREATE INDEX "WebhookLog_userId_idx"        ON "WebhookLog"("userId");
CREATE INDEX "WebhookLog_webhookId_idx"     ON "WebhookLog"("webhookId");
CREATE INDEX "WebhookLog_transactionId_idx" ON "WebhookLog"("transactionId");

-- ─── SystemConfig ────────────────────────────────────────
CREATE TABLE "SystemConfig" (
    "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "key"         TEXT NOT NULL,
    "value"       TEXT NOT NULL,
    "description" TEXT,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SystemConfig_key_key" ON "SystemConfig"("key");

-- ─── AuditLog ────────────────────────────────────────────
CREATE TABLE "AuditLog" (
    "id"        TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId"    TEXT,
    "action"    TEXT NOT NULL,
    "entity"    TEXT NOT NULL,
    "entityId"  TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey"        PRIMARY KEY ("id"),
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX "AuditLog_userId_idx"    ON "AuditLog"("userId");
CREATE INDEX "AuditLog_entity_idx"    ON "AuditLog"("entity");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- ─── RefreshToken ────────────────────────────────────────
CREATE TABLE "RefreshToken" (
    "id"        TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
    "userId"    TEXT    NOT NULL,
    "token"     TEXT    NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_pkey"        PRIMARY KEY ("id"),
    CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");
CREATE INDEX "RefreshToken_userId_idx"       ON "RefreshToken"("userId");
CREATE INDEX "RefreshToken_token_idx"        ON "RefreshToken"("token");
