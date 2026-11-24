package com.smartagriculture.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * 一次性迁移工具：校验数据库中迁移前的历史密码格式。
 *
 * <p>本类只在账号尚未升级到 BCrypt 时被调用。用户首次用旧密码登录成功后，
 * {@code AuthService} 会立即把哈希重写为 BCrypt，之后所有校验都由
 * {@link PasswordHasher} 完成。全部账号完成升级后，本类可以整体删除。
 *
 * <p>支持的历史格式：
 * <ul>
 *   <li>{@code pbkdf2:sha256:<迭代次数>$<盐>$<十六进制摘要>}</li>
 *   <li>{@code pbkdf2:sha256$<盐>$<十六进制摘要>}（旧版默认迭代次数）</li>
 *   <li>明文密码（更早期的数据）</li>
 * </ul>
 */
@Deprecated
final class LegacyPasswordMigration {

    /** 旧版默认迭代次数。 */
    private static final int LEGACY_DEFAULT_ITERATIONS = 150_000;

    private LegacyPasswordMigration() {
    }

    /** 是否需要把该哈希升级为 BCrypt。 */
    static boolean needsUpgrade(String storedHash) {
        return storedHash != null && !storedHash.isEmpty() && !PasswordHasher.isBcrypt(storedHash);
    }

    /** 按历史格式校验密码。 */
    static boolean matches(String storedHash, String password) {
        if (!storedHash.startsWith("pbkdf2:")) {
            return storedHash.equals(password);
        }
        String[] parts = storedHash.split("\\$");
        if (parts.length < 3) {
            return false;
        }
        String method = parts[0];
        String salt = parts[1];
        String expected = parts[2];
        if (!method.startsWith("pbkdf2:sha256")) {
            return false;
        }
        int iterations = LEGACY_DEFAULT_ITERATIONS;
        String[] methodParts = method.split(":");
        if (methodParts.length >= 3) {
            try {
                iterations = Integer.parseInt(methodParts[2]);
            } catch (NumberFormatException ignored) {
                iterations = LEGACY_DEFAULT_ITERATIONS;
            }
        }
        String actual = pbkdf2Hex(password, salt, iterations);
        return MessageDigest.isEqual(
                actual.getBytes(StandardCharsets.UTF_8),
                expected.getBytes(StandardCharsets.UTF_8));
    }

    private static String pbkdf2Hex(String password, String salt, int iterations) {
        try {
            javax.crypto.SecretKeyFactory factory =
                    javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            javax.crypto.spec.PBEKeySpec spec =
                    new javax.crypto.spec.PBEKeySpec(password.toCharArray(),
                            salt.getBytes(StandardCharsets.UTF_8), iterations, 256);
            byte[] bytes = factory.generateSecret(spec).getEncoded();
            StringBuilder sb = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }
}
