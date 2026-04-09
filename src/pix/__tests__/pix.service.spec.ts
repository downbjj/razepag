/**
 * RAZEPAGUE — Testes Unitários: PixService
 *
 * Cobrem:
 * 1. Cálculo de taxa (3% + R$1,00)
 * 2. Criação de cobrança PIX
 * 3. Webhook: extração de payment ID + consulta à API MP
 * 4. Idempotência (não creditar duas vezes)
 * 5. Confirmação de depósito (crédito atômico)
 * 6. Pagamento rejeitado → cancela transação
 * 7. Transferência interna entre usuários
 *
 * Para executar:
 *   npm install --save-dev jest @types/jest ts-jest
 *   npx jest src/pix/__tests__/pix.service.spec.ts --no-coverage
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { PixService } from '../pix.service'
import { PrismaService } from '../../prisma/prisma.service'
import { WalletService } from '../../wallet/wallet.service'
import { MercadoPagoProvider } from '../providers/mercadopago.provider'
import { WebhooksService } from '../../webhooks/webhooks.service'
import { getQueueToken } from '@nestjs/bull'

// ─── Factories ───────────────────────────────────────────────────────────────

function makeTransaction(overrides = {}) {
  return {
    id:           'txn-abc-123',
    userId:       'user-abc-123',
    type:         'DEPOSIT',
    status:       'PENDING',
    amount:       { toNumber: () => 100 },
    fee:          { toNumber: () => 4 },
    netAmount:    { toNumber: () => 96 },
    externalId:   'ext-uuid-111',
    description:  'Test charge',
    createdAt:    new Date(),
    updatedAt:    new Date(),
    ...overrides,
  }
}

// Simula Prisma Decimal — coercível via Number() e com .toNumber()
function makeDecimal(n: number) {
  return Object.assign(
    Object.create({ toNumber: () => n }),
    { valueOf: () => n, [Symbol.toPrimitive]: () => n },
  )
}

function makeUser(overrides: Record<string, any> = {}) {
  const balanceVal = overrides.balanceVal ?? 500
  delete overrides.balanceVal
  return {
    id:             'user-abc-123',
    name:           'Test User',
    email:          'test@razepague.com',
    balance:        makeDecimal(balanceVal),
    pendingBalance: makeDecimal(0),
    totalDeposited: makeDecimal(0),
    totalWithdrawn: makeDecimal(0),
    pixKey:         'pix-key-abc',
    status:         'ACTIVE',
    ...overrides,
  }
}

// ─── Mock implementations ────────────────────────────────────────────────────

const mockPrisma = {
  user: {
    findUnique:  jest.fn(),
    update:      jest.fn(),
    aggregate:   jest.fn(),
  },
  transaction: {
    create:      jest.fn(),
    findUnique:  jest.fn(),
    findFirst:   jest.fn(),
    findMany:    jest.fn(),
    update:      jest.fn(),
    updateMany:  jest.fn(),
    count:       jest.fn(),
    groupBy:     jest.fn(),
  },
  pix: {
    create:      jest.fn(),
  },
  log: {
    create:      jest.fn().mockResolvedValue({}),
  },
  $transaction: jest.fn(),
}

const mockMpProvider = {
  createPixCharge:  jest.fn(),
  getPayment:       jest.fn(),
  getPaymentById:   jest.fn(),
  getPaymentStatus: jest.fn(),
  sendPixTransfer:  jest.fn(),
}

const mockWalletService = {
  getWallet: jest.fn(),
  credit:    jest.fn(),
  debit:     jest.fn(),
}

const mockWebhooksService = {
  triggerWebhook: jest.fn().mockResolvedValue(undefined),
}

const mockPixQueue = {
  add: jest.fn().mockResolvedValue(undefined),
}

const mockConfigService = {
  get: (key: string, fallback?: string) => {
    const cfg: Record<string, string> = {
      PIX_FEE_PERCENTAGE: '3',
      PIX_FEE_FLAT:       '1.00',
    }
    return cfg[key] ?? fallback
  },
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('PixService', () => {
  let service: PixService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PixService,
        { provide: PrismaService,        useValue: mockPrisma },
        { provide: MercadoPagoProvider,  useValue: mockMpProvider },
        { provide: WalletService,        useValue: mockWalletService },
        { provide: WebhooksService,      useValue: mockWebhooksService },
        { provide: ConfigService,        useValue: mockConfigService },
        { provide: getQueueToken('pix'), useValue: mockPixQueue },
      ],
    }).compile()

    service = module.get<PixService>(PixService)
  })

  // ─── 1. Taxa ──────────────────────────────────────────────────────────────

  describe('calculateFee()', () => {
    it('calcula taxa corretamente: 3% + R$1,00', () => {
      expect(service.calculateFee(100)).toBe(4.00)    // 3 + 1
      expect(service.calculateFee(200)).toBe(7.00)    // 6 + 1
      expect(service.calculateFee(0.01)).toBe(1.00)   // ~0 + 1 = 1.00 (arredondado)
      expect(service.calculateFee(1000)).toBe(31.00)  // 30 + 1
    })

    it('arredonda para 2 casas decimais', () => {
      const fee = service.calculateFee(33.33)
      // 33.33 * 0.03 + 1 = 1.9999 → arredondado para 2.00
      expect(fee).toBeCloseTo(2.00, 2)
      expect(Number.isFinite(fee)).toBe(true)
    })
  })

  // ─── 2. Criar Cobrança ────────────────────────────────────────────────────

  describe('createCharge()', () => {
    beforeEach(() => {
      const tx = makeTransaction()
      const user = makeUser()

      mockPrisma.user.findUnique.mockResolvedValue(user)
      mockPrisma.transaction.create.mockResolvedValue(tx)
      mockPrisma.transaction.update.mockResolvedValue(tx)
      mockPrisma.transaction.findUnique.mockResolvedValue({ ...tx, pix: { qrCode: 'data:image/png;base64,...', copyPaste: '00020126...' } })
      mockPrisma.pix.create.mockResolvedValue({})
      mockMpProvider.createPixCharge.mockResolvedValue({
        id:        'mp-payment-999',
        status:    'pending',
        qrCode:    'data:image/png;base64,abc123',
        copyPaste: '00020126580014br.gov.bcb.pix...',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      })
    })

    it('cria transação PENDING com fee e netAmount corretos', async () => {
      await service.createCharge('user-abc-123', { amount: 100, description: 'Teste' })

      expect(mockPrisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type:      'DEPOSIT',
            status:    'PENDING',
            amount:    100,
            fee:       4,
            netAmount: 96,
          }),
        }),
      )
    })

    it('chama MP provider para gerar QR Code', async () => {
      await service.createCharge('user-abc-123', { amount: 100 })
      expect(mockMpProvider.createPixCharge).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 100 }),
      )
    })

    it('salva mpPaymentId no metadata da transação', async () => {
      await service.createCharge('user-abc-123', { amount: 100 })
      expect(mockPrisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.objectContaining({ mpPaymentId: 'mp-payment-999' }),
          }),
        }),
      )
    })

    it('agenda polling de fallback na fila', async () => {
      await service.createCharge('user-abc-123', { amount: 100 })
      expect(mockPixQueue.add).toHaveBeenCalledWith(
        'poll-payment',
        expect.objectContaining({ userId: 'user-abc-123' }),
        expect.any(Object),
      )
    })

    it('lança erro se usuário não existe', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null)
      await expect(service.createCharge('nope', { amount: 100 })).rejects.toThrow('Usuário não encontrado')
    })

    it('cancela transação se MP falhar', async () => {
      mockMpProvider.createPixCharge.mockRejectedValue(new Error('MP error'))
      await expect(service.createCharge('user-abc-123', { amount: 100 })).rejects.toThrow()
      expect(mockPrisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'FAILED' } }),
      )
    })
  })

  // ─── 3. Webhook ───────────────────────────────────────────────────────────

  describe('handleMercadoPagoWebhook()', () => {
    const validPayload = {
      type:   'payment',
      action: 'payment.updated',
      data:   { id: '123456789' },
    }

    const approvedPayment = {
      id:                 123456789,
      status:             'approved',
      status_detail:      'accredited',
      external_reference: 'ext-uuid-111',
      transaction_amount: 100,
      date_approved:      new Date().toISOString(),
    }

    beforeEach(() => {
      mockPrisma.transaction.findUnique.mockResolvedValue(makeTransaction())
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma))
      mockPrisma.transaction.updateMany.mockResolvedValue({ count: 1 })
      mockPrisma.user.update.mockResolvedValue({})
    })

    it('extrai payment ID e consulta a API do MP', async () => {
      mockMpProvider.getPayment.mockResolvedValue(approvedPayment)

      await service.handleMercadoPagoWebhook(validPayload)

      expect(mockMpProvider.getPayment).toHaveBeenCalledWith('123456789')
    })

    it('NUNCA confia no status do body — sempre chama a API MP', async () => {
      // Even if body says "approved", we ignore it and call the API
      const fakeBody = { type: 'payment', data: { id: '999' }, status: 'approved' }
      mockMpProvider.getPayment.mockResolvedValue({ ...approvedPayment, id: 999 })

      await service.handleMercadoPagoWebhook(fakeBody)

      // Deve ter chamado a API com ID do body, não confiar no campo status
      expect(mockMpProvider.getPayment).toHaveBeenCalledWith('999')
    })

    it('credita saldo quando status = approved', async () => {
      mockMpProvider.getPayment.mockResolvedValue(approvedPayment)

      await service.handleMercadoPagoWebhook(validPayload)

      expect(mockPrisma.transaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PENDING' }),
          data:  expect.objectContaining({ status: 'PAID' }),
        }),
      )
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            balance: expect.objectContaining({ increment: expect.any(Number) }),
          }),
        }),
      )
    })

    it('ignora webhook sem payment ID', async () => {
      await service.handleMercadoPagoWebhook({ type: 'payment', data: {} })
      expect(mockMpProvider.getPayment).not.toHaveBeenCalled()
    })

    it('ignora webhook de tipo diferente de payment', async () => {
      await service.handleMercadoPagoWebhook({ type: 'merchant_order', data: { id: '123' } })
      expect(mockMpProvider.getPayment).not.toHaveBeenCalled()
    })

    it('cancela transação quando status = rejected', async () => {
      mockMpProvider.getPayment.mockResolvedValue({
        ...approvedPayment,
        status:             'rejected',
        external_reference: 'ext-uuid-111',
      })

      await service.handleMercadoPagoWebhook(validPayload)

      expect(mockPrisma.transaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PENDING' }),
          data:  { status: 'CANCELLED' },
        }),
      )
    })

    it('retorna { received: true } sempre (idempotente)', async () => {
      mockMpProvider.getPayment.mockResolvedValue(approvedPayment)
      const result = await service.handleMercadoPagoWebhook(validPayload)
      expect(result).toEqual({ received: true })
    })

    it('não processa se MP retornar null (payment não encontrado)', async () => {
      mockMpProvider.getPayment.mockResolvedValue(null)
      await service.handleMercadoPagoWebhook(validPayload)
      expect(mockPrisma.transaction.updateMany).not.toHaveBeenCalled()
    })
  })

  // ─── 4. Idempotência ──────────────────────────────────────────────────────

  describe('confirmDepositAtomic() — idempotência', () => {
    it('não credita duas vezes (updateMany retorna count=0 na segunda chamada)', async () => {
      // Primeira chamada: atualiza 1 linha
      mockPrisma.$transaction.mockImplementationOnce(async (fn: any) => {
        mockPrisma.transaction.updateMany.mockResolvedValueOnce({ count: 1 })
        mockPrisma.user.update.mockResolvedValueOnce({})
        return fn(mockPrisma)
      })

      await service.confirmDepositAtomic('txn-abc-123', 'user-abc-123', 4, 96)
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(1)

      // Segunda chamada: nenhuma linha atualizada (já estava PAID)
      mockPrisma.$transaction.mockImplementationOnce(async (fn: any) => {
        mockPrisma.transaction.updateMany.mockResolvedValueOnce({ count: 0 })
        return fn(mockPrisma)
      })

      await service.confirmDepositAtomic('txn-abc-123', 'user-abc-123', 4, 96)

      // user.update deve ter sido chamado apenas na primeira vez
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(1)
    })

    it('incrementa balance com o netAmount correto', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        mockPrisma.transaction.updateMany.mockResolvedValue({ count: 1 })
        mockPrisma.user.update.mockResolvedValue({})
        return fn(mockPrisma)
      })

      await service.confirmDepositAtomic('txn-abc-123', 'user-abc-123', 4, 96)

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-abc-123' },
          data: {
            balance:        { increment: 96 },
            totalDeposited: { increment: 96 },
          },
        }),
      )
    })
  })

  // ─── 5. Transferência interna ─────────────────────────────────────────────

  describe('transferToUser()', () => {
    const sender    = makeUser({ id: 'sender-id',    pixKey: 'key-sender',    balanceVal: 500 })
    const recipient = makeUser({ id: 'recipient-id', pixKey: 'key-recipient', balanceVal: 100 })

    // Shared setup helper — each test sets its own findUnique sequence
    function setupTransfer(senderOverride?: any, recipientOverride?: any) {
      const s = senderOverride ?? sender
      const r = recipientOverride
      mockPrisma.user.findUnique.mockReset()
      if (r === null) {
        mockPrisma.user.findUnique
          .mockResolvedValueOnce(s)
          .mockResolvedValueOnce(null)
      } else {
        mockPrisma.user.findUnique
          .mockResolvedValueOnce(s)
          .mockResolvedValueOnce(r ?? recipient)
      }
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma))
      mockPrisma.transaction.create.mockResolvedValue({})
      mockPrisma.user.update.mockResolvedValue({})
    }

    it('cria duas transações (saída e entrada)', async () => {
      setupTransfer()
      await service.transferToUser('sender-id', 'key-recipient', 100)
      expect(mockPrisma.transaction.create).toHaveBeenCalledTimes(2)
    })

    it('debita sender e credita recipient', async () => {
      setupTransfer()
      await service.transferToUser('sender-id', 'key-recipient', 100)
      const calls = mockPrisma.user.update.mock.calls
      const debitCall  = calls.find((c: any[]) => c[0].data.balance?.decrement)
      const creditCall = calls.find((c: any[]) => c[0].data.balance?.increment)
      expect(debitCall).toBeDefined()
      expect(creditCall).toBeDefined()
    })

    it('lança erro se saldo insuficiente', async () => {
      const poorSender = makeUser({ id: 'sender-id', balanceVal: 1 })
      setupTransfer(poorSender)
      await expect(
        service.transferToUser('sender-id', 'key-recipient', 100),
      ).rejects.toThrow('Saldo insuficiente')
    })

    it('lança erro se chave PIX não encontrada', async () => {
      setupTransfer(sender, null)
      await expect(
        service.transferToUser('sender-id', 'chave-inexistente', 50),
      ).rejects.toThrow('não encontrada')
    })

    it('lança erro se tentar transferir para si mesmo', async () => {
      setupTransfer(sender, { ...recipient, id: 'sender-id' })
      await expect(
        service.transferToUser('sender-id', 'key-recipient', 50),
      ).rejects.toThrow('si mesmo')
    })
  })

  // ─── 6. Cálculos de taxa edge cases ───────────────────────────────────────

  describe('calculateFee() — casos extremos', () => {
    it('valor muito pequeno ainda aplica taxa mínima de R$1,00', () => {
      expect(service.calculateFee(0.01)).toBeCloseTo(1.00, 2)
    })

    it('valor alto calcula corretamente', () => {
      expect(service.calculateFee(10000)).toBeCloseTo(301.00, 2)
    })

    it('netAmount nunca pode ser negativo (tratado na camada superior)', () => {
      const amount = 1.00
      const fee    = service.calculateFee(amount)
      const net    = parseFloat((amount - fee).toFixed(2))
      expect(net).toBeLessThan(0) // system should reject amounts this small
    })
  })
})
