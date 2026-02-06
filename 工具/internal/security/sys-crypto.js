import crypto from 'crypto';

const _A = 'aes-256-cbc';
const _K = crypto.createHash('sha256').update('XYZW-SECRET-LICENSE-KEY-2026').digest();
const _L = 16;

/**
 * 内部转换-1
 */
export function encrypt(text) {
    const iv = crypto.randomBytes(_L);
    const cipher = crypto.createCipheriv(_A, Buffer.from(_K), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * 内部转换-2
 */
export function decrypt(text) {
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv(_A, Buffer.from(_K), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        return null;
    }
}

/**
 * 标识符生成
 */
export function generateLicenseString(data) {
    const uniqueString = JSON.stringify(data) + Date.now() + Math.random();
    const hash = crypto.createHash('sha256').update(uniqueString).digest('hex').toUpperCase();
    return hash.substring(0, 16);
}

/**
 * 标识符解析
 */
export function parseLicenseString(code) {
    try {
        if (!code || code.length !== 16 || !/^[0-9A-F]{16}$/.test(code)) {
            return null;
        }
        return { valid: true, code: code };
    } catch (e) {
        return null;
    }
}
