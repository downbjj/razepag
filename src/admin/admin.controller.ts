import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminAdjustBalanceDto } from './dto/adjust-balance.dto';
import { FreezeUserDto } from './dto/freeze-user.dto';
import { RejectWithdrawalDto } from './dto/reject-withdrawal.dto';
import { UpdateConfigDto } from './dto/update-config.dto';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { CreateProductDto, UpdateProductDto } from './dto/create-product.dto';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/create-category.dto';
import { CreatePopupDto, UpdatePopupDto } from './dto/create-popup.dto';
import { SendNotificationDto } from './dto/send-notification.dto';
import { SendEmailDto } from './dto/send-email.dto';
import { UpdateUserFeeDto } from './dto/update-user-fee.dto';
import { ReviewCryptoWithdrawalDto } from './dto/review-crypto-withdrawal.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── DASHBOARD ───────────────────────────────────────────────

  @Get('dashboard')
  @ApiOperation({ summary: 'Admin dashboard overview' })
  async getDashboard() {
    return this.adminService.getDashboard();
  }

  // ─── USERS ───────────────────────────────────────────────────

  @Get('users')
  @ApiQuery({ name: 'page',   required: false })
  @ApiQuery({ name: 'limit',  required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getUsers(
    @Query('page')   page   = 1,
    @Query('limit')  limit  = 20,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.adminService.getUsers(+page, +limit, search, status);
  }

  @Get('users/:id')
  async getUserDetail(@Param('id') id: string) {
    return this.adminService.getUserDetail(id);
  }

  @Patch('users/:id/freeze')
  async freezeUser(
    @CurrentUser('sub') adminId: string,
    @Param('id') userId: string,
    @Body() dto: FreezeUserDto,
  ) {
    return this.adminService.freezeUser(adminId, userId, dto.reason);
  }

  @Patch('users/:id/unfreeze')
  async unfreezeUser(@CurrentUser('sub') adminId: string, @Param('id') userId: string) {
    return this.adminService.unfreezeUser(adminId, userId);
  }

  @Post('users/:id/adjust-balance')
  async adjustBalance(
    @CurrentUser('sub') adminId: string,
    @Param('id') userId: string,
    @Body() dto: AdminAdjustBalanceDto,
  ) {
    return this.adminService.adjustBalance(adminId, userId, dto);
  }

  // ─── API BALANCES ─────────────────────────────────────────────

  @Get('api-balances')
  @ApiQuery({ name: 'page',  required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOperation({ summary: 'List user balances for API view' })
  async getApiBalances(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.adminService.getApiBalances(+page, +limit);
  }

  // ─── TRANSACTIONS ─────────────────────────────────────────────

  @Get('transactions')
  @ApiQuery({ name: 'page',   required: false })
  @ApiQuery({ name: 'limit',  required: false })
  @ApiQuery({ name: 'type',   required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'userId', required: false })
  async getAllTransactions(
    @Query('page')   page   = 1,
    @Query('limit')  limit  = 20,
    @Query('type')   type?: string,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
  ) {
    return this.adminService.getAllTransactions(+page, +limit, type, status, userId);
  }

  @Patch('transactions/:id/approve-withdrawal')
  @HttpCode(HttpStatus.OK)
  async approveWithdrawal(@CurrentUser('sub') adminId: string, @Param('id') id: string) {
    return this.adminService.approveWithdrawal(adminId, id);
  }

  @Patch('transactions/:id/reject-withdrawal')
  @HttpCode(HttpStatus.OK)
  async rejectWithdrawal(
    @CurrentUser('sub') adminId: string,
    @Param('id') id: string,
    @Body() dto: RejectWithdrawalDto,
  ) {
    return this.adminService.rejectWithdrawal(adminId, id, dto.reason);
  }

  // ─── KYC / DOCUMENTS ─────────────────────────────────────────

  @Get('documents')
  @ApiQuery({ name: 'page',   required: false })
  @ApiQuery({ name: 'limit',  required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiOperation({ summary: 'List KYC documents' })
  async getDocuments(
    @Query('page')   page   = 1,
    @Query('limit')  limit  = 20,
    @Query('status') status?: string,
  ) {
    return this.adminService.getDocuments(+page, +limit, status);
  }

  @Patch('documents/:id/review')
  @ApiOperation({ summary: 'Approve or reject a KYC document' })
  async reviewDocument(
    @CurrentUser('sub') adminId: string,
    @Param('id') docId: string,
    @Body() dto: ReviewDocumentDto,
  ) {
    return this.adminService.reviewDocument(adminId, docId, dto);
  }

  // ─── PRODUCTS ────────────────────────────────────────────────

  @Get('products')
  @ApiQuery({ name: 'page',       required: false })
  @ApiQuery({ name: 'limit',      required: false })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'status',     required: false })
  async getProducts(
    @Query('page')       page       = 1,
    @Query('limit')      limit      = 20,
    @Query('categoryId') categoryId?: string,
    @Query('status')     status?:    string,
  ) {
    return this.adminService.getProducts(+page, +limit, categoryId, status);
  }

  @Post('products')
  @UseGuards(OwnerGuard)
  async createProduct(@CurrentUser('sub') adminId: string, @Body() dto: CreateProductDto) {
    return this.adminService.createProduct(adminId, dto);
  }

  @Patch('products/:id')
  @UseGuards(OwnerGuard)
  async updateProduct(
    @CurrentUser('sub') adminId: string,
    @Param('id') productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.adminService.updateProduct(adminId, productId, dto);
  }

  @Delete('products/:id')
  @UseGuards(OwnerGuard)
  async deleteProduct(@CurrentUser('sub') adminId: string, @Param('id') productId: string) {
    return this.adminService.deleteProduct(adminId, productId);
  }

  // ─── CATEGORIES ───────────────────────────────────────────────

  @Get('categories')
  async getCategories() {
    return this.adminService.getCategories();
  }

  @Post('categories')
  @UseGuards(OwnerGuard)
  async createCategory(@CurrentUser('sub') adminId: string, @Body() dto: CreateCategoryDto) {
    return this.adminService.createCategory(adminId, dto);
  }

  @Patch('categories/:id')
  @UseGuards(OwnerGuard)
  async updateCategory(
    @CurrentUser('sub') adminId: string,
    @Param('id') categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.adminService.updateCategory(adminId, categoryId, dto);
  }

  // ─── PURCHASES ────────────────────────────────────────────────

  @Get('purchases')
  @ApiQuery({ name: 'page',   required: false })
  @ApiQuery({ name: 'limit',  required: false })
  @ApiQuery({ name: 'status', required: false })
  async getPurchases(
    @Query('page')   page   = 1,
    @Query('limit')  limit  = 20,
    @Query('status') status?: string,
  ) {
    return this.adminService.getPurchases(+page, +limit, status);
  }

  // ─── POPUPS ───────────────────────────────────────────────────

  @Get('popups')
  @ApiQuery({ name: 'page',  required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getPopups(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.adminService.getPopups(+page, +limit);
  }

  @Post('popups')
  @UseGuards(OwnerGuard)
  async createPopup(@CurrentUser('sub') adminId: string, @Body() dto: CreatePopupDto) {
    return this.adminService.createPopup(adminId, dto);
  }

  @Patch('popups/:id')
  @UseGuards(OwnerGuard)
  async updatePopup(
    @CurrentUser('sub') adminId: string,
    @Param('id') popupId: string,
    @Body() dto: UpdatePopupDto,
  ) {
    return this.adminService.updatePopup(adminId, popupId, dto);
  }

  @Delete('popups/:id')
  @UseGuards(OwnerGuard)
  async deletePopup(@CurrentUser('sub') adminId: string, @Param('id') popupId: string) {
    return this.adminService.deletePopup(adminId, popupId);
  }

  // ─── WEBHOOKS ─────────────────────────────────────────────────

  @Get('webhook-logs')
  async getWebhookLogs(@Query('page') page = 1, @Query('limit') limit = 50) {
    return this.adminService.getWebhookLogs(+page, +limit);
  }

  // ─── NOTIFICATIONS ────────────────────────────────────────────

  @Get('notifications')
  @ApiQuery({ name: 'page',  required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getNotifications(@Query('page') page = 1, @Query('limit') limit = 50) {
    return this.adminService.getNotifications(+page, +limit);
  }

  @Post('notifications/send')
  @UseGuards(OwnerGuard)
  @HttpCode(HttpStatus.OK)
  async sendNotification(@CurrentUser('sub') adminId: string, @Body() dto: SendNotificationDto) {
    return this.adminService.sendNotification(adminId, dto);
  }

  // ─── EMAILS ───────────────────────────────────────────────────

  @Get('emails')
  @ApiQuery({ name: 'page',  required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getEmailLogs(@Query('page') page = 1, @Query('limit') limit = 50) {
    return this.adminService.getEmailLogs(+page, +limit);
  }

  @Post('emails/send')
  @UseGuards(OwnerGuard)
  @HttpCode(HttpStatus.OK)
  async sendEmail(@CurrentUser('sub') adminId: string, @Body() dto: SendEmailDto) {
    return this.adminService.sendEmail(adminId, dto);
  }

  // ─── USER FEES ────────────────────────────────────────────────

  @Get('user-fees')
  @ApiQuery({ name: 'page',  required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOperation({ summary: 'List custom user fee configs' })
  async getUserFees(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.adminService.getUserFees(+page, +limit);
  }

  @Patch('user-fees/:userId')
  @UseGuards(OwnerGuard)
  @ApiOperation({ summary: 'Set custom fee for a user' })
  async updateUserFee(
    @CurrentUser('sub') adminId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserFeeDto,
  ) {
    return this.adminService.updateUserFee(adminId, userId, dto);
  }

  @Delete('user-fees/:userId')
  @UseGuards(OwnerGuard)
  @ApiOperation({ summary: 'Remove custom fee for a user (revert to default)' })
  async deleteUserFee(@CurrentUser('sub') adminId: string, @Param('userId') userId: string) {
    return this.adminService.deleteUserFee(adminId, userId);
  }

  // ─── CRYPTO WITHDRAWALS ───────────────────────────────────────

  @Get('crypto-withdrawals')
  @ApiQuery({ name: 'page',   required: false })
  @ApiQuery({ name: 'limit',  required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiOperation({ summary: 'List crypto withdrawal requests' })
  async getCryptoWithdrawals(
    @Query('page')   page   = 1,
    @Query('limit')  limit  = 20,
    @Query('status') status?: string,
  ) {
    return this.adminService.getCryptoWithdrawals(+page, +limit, status);
  }

  @Patch('crypto-withdrawals/:id/review')
  @UseGuards(OwnerGuard)
  @ApiOperation({ summary: 'Approve or reject a crypto withdrawal' })
  async reviewCryptoWithdrawal(
    @CurrentUser('sub') adminId: string,
    @Param('id') id: string,
    @Body() dto: ReviewCryptoWithdrawalDto,
  ) {
    return this.adminService.reviewCryptoWithdrawal(adminId, id, dto);
  }

  // ─── SYSTEM CONFIG ────────────────────────────────────────────

  @Get('configs')
  async getConfigs() {
    return this.adminService.getSystemConfigs();
  }

  @Patch('configs/:key')
  @UseGuards(OwnerGuard)
  async updateConfig(
    @CurrentUser('sub') adminId: string,
    @Param('key') key: string,
    @Body() dto: UpdateConfigDto,
  ) {
    return this.adminService.updateSystemConfig(adminId, key, dto.value);
  }

  @Delete('configs/:key')
  @UseGuards(OwnerGuard)
  async deleteConfig(@CurrentUser('sub') adminId: string, @Param('key') key: string) {
    return this.adminService.deleteSystemConfig(adminId, key);
  }

  // ─── AUDIT LOGS ───────────────────────────────────────────────

  @Get('audit-logs')
  @ApiQuery({ name: 'page',   required: false })
  @ApiQuery({ name: 'limit',  required: false })
  @ApiQuery({ name: 'action', required: false })
  async getAuditLogs(
    @Query('page')   page   = 1,
    @Query('limit')  limit  = 50,
    @Query('action') action?: string,
  ) {
    return this.adminService.getAuditLogs(+page, +limit, action);
  }
}
