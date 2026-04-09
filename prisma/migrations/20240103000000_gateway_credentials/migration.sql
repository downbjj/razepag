-- ============================================================
-- Migration: gateway_credentials
-- Adds: mercadoPagoAccessToken on User, ApiClient, GatewayRequestLog
-- ============================================================

-- 1. Add Mercado Pago token column to User (nullable, AES-encrypted at app layer)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mercadoPagoAccessToken" TEXT;

-- 2. Create ApiClient table
CREATE TABLE IF NOT EXISTS "ApiClient" (
    "id"           TEXT        NOT NULL,
    "clientId"     TEXT        NOT NULL,
    "clientSecret" TEXT        NOT NULL,
    "name"         TEXT        NOT NULL,
    "allowedIps"   TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
    "isActive"     BOOLEAN     NOT NULL DEFAULT TRUE,
    "userId"       TEXT        NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiClient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApiClient_clientId_key" ON "ApiClient"("clientId");
CREATE INDEX IF NOT EXISTS "ApiClient_userId_idx"    ON "ApiClient"("userId");
CREATE INDEX IF NOT EXISTS "ApiClient_clientId_idx"  ON "ApiClient"("clientId");

ALTER TABLE "ApiClient"
    ADD CONSTRAINT "ApiClient_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Create GatewayRequestLog table
CREATE TABLE IF NOT EXISTS "GatewayRequestLog" (
    "id"          TEXT         NOT NULL,
    "apiClientId" TEXT         NOT NULL,
    "endpoint"    TEXT         NOT NULL,
    "method"      TEXT         NOT NULL DEFAULT 'POST',
    "ip"          TEXT         NOT NULL,
    "statusCode"  INTEGER,
    "responseTime" INTEGER,
    "error"       TEXT,
    "requestBody" JSONB,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GatewayRequestLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GatewayRequestLog_apiClientId_idx" ON "GatewayRequestLog"("apiClientId");
CREATE INDEX IF NOT EXISTS "GatewayRequestLog_createdAt_idx"   ON "GatewayRequestLog"("createdAt");

ALTER TABLE "GatewayRequestLog"
    ADD CONSTRAINT "GatewayRequestLog_apiClientId_fkey"
    FOREIGN KEY ("apiClientId") REFERENCES "ApiClient"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
