import type { NativeReceipt, NativeEstimate } from './native';
export function receiptLabel(receipt: NativeReceipt | NativeEstimate): string {
  const implementation = receipt.identity.implementation as { version?: string; player?: string; source_commit?: string } | undefined;
  const name = receipt.identity.player.name;
  if (receipt.response.zeb_result || name?.startsWith('zeb-')) return `Zeb · ${implementation?.version ?? name?.slice(4) ?? 'version not recorded'}`;
  if (name === 'l1-default') return `Walt L1 · ${implementation?.player ?? 'version not recorded'}`;
  return `Walt · ${implementation?.player ?? 'version not recorded'}`;
}
