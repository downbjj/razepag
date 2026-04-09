/**
 * ApiKeyGuard — REMOVED.
 *
 * The old x-api-key / pgw_xxxx system no longer exists.
 * All public API endpoints now use ClientAuthGuard (client_id + client_secret).
 *
 * This file re-exports ClientAuthGuard under the old name so that
 * existing imports in PublicApiModule continue to compile.
 */
export { ClientAuthGuard as ApiKeyGuard } from '../../gateway/guards/client-auth.guard';
