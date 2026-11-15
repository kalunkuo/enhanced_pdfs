// pdf.js's worker uses Uint8Array.prototype.toHex / Uint8Array.fromHex (ES2025). Bun has them; Node 24
// does not yet, which made eight markupTables tests fail under Node. Fill them in for tests only.
type HexArray = typeof Uint8Array & { fromHex?: (hex: string) => Uint8Array };
const proto = Uint8Array.prototype as Uint8Array & { toHex?: () => string };
if (typeof proto.toHex !== 'function') {
    Object.defineProperty(proto, 'toHex', {
        configurable: true, writable: true,
        value(this: Uint8Array) { return Array.from(this, (byte) => byte.toString(16).padStart(2, '0')).join(''); },
    });
}
if (typeof (Uint8Array as HexArray).fromHex !== 'function') {
    Object.defineProperty(Uint8Array, 'fromHex', {
        configurable: true, writable: true,
        value(hex: string) { return Uint8Array.from(hex.match(/.{1,2}/g) ?? [], (pair) => parseInt(pair, 16)); },
    });
}
