-- RazePague — Admin Extension Migration v2
-- Adds: OWNER role, KYC, Products, Categories, Purchases,
--       Popups, UserFeeConfig, CryptoWithdrawals,
--       NotificationLog, EmailLog

-- 1. Extend Role enum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OWNER';

-- 2. Extend DocumentStatus enum
DO $$ BEGIN
  CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. ProductStatus enum
DO $$ BEGIN
  CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. PopupStatus enum
DO $$ BEGIN
  CREATE TYPE "PopupStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. CryptoWithdrawalStatus enum
DO $$ BEGIN
  CREATE TYPE "CryptoWithdrawalStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 6. Add group column to SystemConfig
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "group" TEXT DEFAULT 'general';

-- 7. KYC Documents
CREATE TABLE IF NOT EXISTS "Document" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"      TEXT NOT NULL,
  "type"        TEXT NOT NULL,
  "fileUrl"     TEXT NOT NULL,
  "fileName"    TEXT,
  "status"      "DocumentStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedBy"  TEXT,
  "reviewNote"  TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Document_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Document_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "Document_userId_idx" ON "Document"("userId");
CREATE INDEX IF NOT EXISTS "Document_status_idx" ON "Document"("status");

-- 8. Categories
CREATE TABLE IF NOT EXISTS "Category" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "slug"        TEXT NOT NULL,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Category_pkey"     PRIMARY KEY ("id"),
  CONSTRAINT "Category_name_key" UNIQUE ("name"),
  CONSTRAINT "Category_slug_key" UNIQUE ("slug")
);

-- 9. Products
CREATE TABLE IF NOT EXISTS "Product" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "price"       DECIMAL(20,2) NOT NULL,
  "status"      "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
  "categoryId"  TEXT,
  "imageUrl"    TEXT,
  "sku"         TEXT,
  "stock"       INTEGER,
  "metadata"    JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Product_pkey"    PRIMARY KEY ("id"),
  CONSTRAINT "Product_sku_key" UNIQUE ("sku"),
  CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX IF NOT EXISTS "Product_status_idx"     ON "Product"("status");

-- 10. Purchases
CREATE TABLE IF NOT EXISTS "Purchase" (
  "id"        TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"    TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity"  INTEGER NOT NULL DEFAULT 1,
  "amount"    DECIMAL(20,2) NOT NULL,
  "status"    TEXT NOT NULL DEFAULT 'PENDING',
  "notes"     TEXT,
  "metadata"  JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Purchase_pkey"           PRIMARY KEY ("id"),
  CONSTRAINT "Purchase_userId_fkey"    FOREIGN KEY ("userId")    REFERENCES "User"("id"),
  CONSTRAINT "Purchase_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id")
);
CREATE INDEX IF NOT EXISTS "Purchase_userId_idx"    ON "Purchase"("userId");
CREATE INDEX IF NOT EXISTS "Purchase_productId_idx" ON "Purchase"("productId");
CREATE INDEX IF NOT EXISTS "Purchase_status_idx"    ON "Purchase"("status");

-- 11. Popups
CREATE TABLE IF NOT EXISTS "Popup" (
  "id"        TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "title"     TEXT NOT NULL,
  "content"   TEXT NOT NULL,
  "imageUrl"  TEXT,
  "link"      TEXT,
  "status"    "PopupStatus" NOT NULL DEFAULT 'ACTIVE',
  "startAt"   TIMESTAMP(3),
  "endAt"     TIMESTAMP(3),
  "priority"  INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Popup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Popup_status_idx" ON "Popup"("status");

-- 12. UserFeeConfig
CREATE TABLE IF NOT EXISTS "UserFeeConfig" (
  "id"         TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"     TEXT NOT NULL,
  "feePercent" DECIMAL(5,2)  NOT NULL DEFAULT 3.00,
  "feeFixed"   DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  "notes"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserFeeConfig_pkey"        PRIMARY KEY ("id"),
  CONSTRAINT "UserFeeConfig_userId_key"  UNIQUE ("userId"),
  CONSTRAINT "UserFeeConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

-- 13. CryptoWithdrawal
CREATE TABLE IF NOT EXISTS "CryptoWithdrawal" (
  "id"         TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"     TEXT NOT NULL,
  "amount"     DECIMAL(20,8) NOT NULL,
  "currency"   TEXT NOT NULL,
  "address"    TEXT NOT NULL,
  "network"    TEXT,
  "status"     "CryptoWithdrawalStatus" NOT NULL DEFAULT 'PENDING',
  "txHash"     TEXT,
  "adminNote"  TEXT,
  "reviewedBy" TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CryptoWithdrawal_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "CryptoWithdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id")
);
CREATE INDEX IF NOT EXISTS "CryptoWithdrawal_userId_idx" ON "CryptoWithdrawal"("userId");
CREATE INDEX IF NOT EXISTS "CryptoWithdrawal_status_idx" ON "CryptoWithdrawal"("status");

-- 14. NotificationLog
CREATE TABLE IF NOT EXISTS "NotificationLog" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"      TEXT,
  "title"       TEXT NOT NULL,
  "message"     TEXT NOT NULL,
  "type"        TEXT NOT NULL DEFAULT 'INFO',
  "sentBy"      TEXT,
  "readAt"      TIMESTAMP(3),
  "isBroadcast" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationLog_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "NotificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "NotificationLog_userId_idx"    ON "NotificationLog"("userId");
CREATE INDEX IF NOT EXISTS "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");

-- 15. EmailLog
CREATE TABLE IF NOT EXISTS "EmailLog" (
  "id"        TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "to"        TEXT NOT NULL,
  "subject"   TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "status"    TEXT NOT NULL DEFAULT 'SENT',
  "sentBy"    TEXT,
  "errorMsg"  TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EmailLog_to_idx"        ON "EmailLog"("to");
CREATE INDEX IF NOT EXISTS "EmailLog_createdAt_idx" ON "EmailLog"("createdAt");
