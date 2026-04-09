/**
 * ApiKeysService — legacy file kept as a pass-through.
 *
 * The old pgw_xxxx single-key system has been REMOVED.
 * All credential logic now lives in GatewayClientService:
 *   - client_id   (public identifier)
 *   - client_secret (bcrypt-hashed, shown ONCE on creation)
 *   - allowed_ips  (optional IP whitelist)
 *
 * This file re-exports GatewayClientService so that any
 * imports of ApiKeysService still compile without changes.
 */
export { GatewayClientService as ApiKeysService } from './gateway-client.service';
