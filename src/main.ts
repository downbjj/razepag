import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  const configService = app.get(ConfigService);
  const port = Number(process.env.PORT) || configService.get<number>('PORT') || 3001;
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');

  // Security
  app.use(helmet({
    contentSecurityPolicy: nodeEnv === 'production',
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());

  // CORS
  app.enableCors({
    origin: [
      configService.get<string>('FRONTEND_URL', 'http://localhost:3000'),
      'http://localhost:3000',
      'https://razepag.com',
      'https://www.razepag.com',
      'https://razepague.com',
      'https://www.razepague.com',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 'Authorization',
      'client_id', 'client-id', 'client_secret', 'client-secret',
      'x-forwarded-for', 'x-real-ip',
    ],
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix('api');

  // Pipes, Filters, Interceptors
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new ResponseInterceptor());

  // Swagger API docs
  if (nodeEnv !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('RazePague API')
      .setDescription('Gateway de pagamentos PIX - API completa para cobranças, transferências e webhooks')
      .setVersion('1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'client_id',     in: 'header' }, 'client_id')
      .addApiKey({ type: 'apiKey', name: 'client_secret', in: 'header' }, 'client_secret')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    logger.log(`Swagger docs available at: http://localhost:${port}/api/docs`);
  }

  await app.listen(port, '0.0.0.0');
  logger.log(`RazePague running on port ${port} [${nodeEnv}]`);
}

bootstrap();
