import { PrismaClient, Role, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed do banco RazePague...');

  // ─── ADMIN PADRÃO ─────────────────────────────────────
  const adminEmail    = process.env.ADMIN_EMAIL    || 'admin@razepague.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';
  const adminName     = process.env.ADMIN_NAME     || 'Super Admin';

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existing) {
    const hash = await bcrypt.hash(adminPassword, 12);
    const admin = await prisma.user.create({
      data: {
        email:    adminEmail,
        password: hash,
        name:     adminName,
        role:     Role.ADMIN,
        status:   UserStatus.ACTIVE,
        isBlocked: false,
        pixKey:   'admin-pix-key-razepague',
      },
    });
    console.log(`✅ Admin criado: ${admin.email}`);
  } else {
    console.log(`ℹ️  Admin já existe: ${adminEmail}`);
  }

  // ─── CONFIGS DO SISTEMA ───────────────────────────────
  const configs = [
    {
      key:         'pix_fee_percentage',
      value:       process.env.PIX_FEE_PERCENTAGE || '3',
      description: 'Percentual da taxa PIX (ex: 3 = 3%)',
    },
    {
      key:         'pix_fee_flat',
      value:       process.env.PIX_FEE_FLAT || '1.00',
      description: 'Taxa fixa por transação PIX em R$',
    },
    {
      key:         'withdrawal_fee_percentage',
      value:       process.env.WITHDRAWAL_FEE_PERCENTAGE || '2.0',
      description: 'Percentual da taxa de saque',
    },
    {
      key:         'min_withdrawal_amount',
      value:       '10',
      description: 'Valor mínimo para saque em R$',
    },
    {
      key:         'max_daily_pix_out',
      value:       '50000',
      description: 'Limite diário de PIX enviado por usuário em R$',
    },
    {
      key:         'maintenance_mode',
      value:       'false',
      description: 'Modo de manutenção da plataforma',
    },
  ];

  for (const cfg of configs) {
    await prisma.systemConfig.upsert({
      where:  { key: cfg.key },
      update: {},
      create: cfg,
    });
  }
  console.log(`✅ ${configs.length} configurações do sistema inseridas`);

  // ─── LOG DE INICIALIZAÇÃO ─────────────────────────────
  await prisma.log.create({
    data: {
      type:    'SYSTEM',
      message: 'RazePague iniciado — banco de dados configurado',
      data:    { seededAt: new Date().toISOString(), version: '1.0.0' },
    },
  });

  console.log('\n──────────────────────────────────────');
  console.log('🚀 Seed concluído com sucesso!');
  console.log(`📧 Admin email:    ${adminEmail}`);
  console.log(`🔑 Admin senha:    ${adminPassword}`);
  console.log('──────────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed falhou:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
