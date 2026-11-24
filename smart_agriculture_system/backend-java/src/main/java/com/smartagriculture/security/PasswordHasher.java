package com.smartagriculture.security;

import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/**
 * 密码哈希组件：统一使用 BCrypt。
 *
 * <p>BCrypt 自带随机盐与可调工作因子，同一明文每次编码结果都不同，
 * 校验时由 {@link BCryptPasswordEncoder#matches} 从哈希串中还原盐与因子。
 *
 * <p>数据库中可能仍存在迁移前的旧格式哈希（PBKDF2 / 明文），
 * 这类记录只做一次校验，登录成功后由 {@code AuthService} 重写为 BCrypt，
 * 相关逻辑见 {@link LegacyPasswordMigration}。
 */
public final class PasswordHasher {

    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder();

    private PasswordHasher() {
    }

    /** 生成 BCrypt 哈希（形如 $2a$10$...）。 */
    public static String hash(String password) {
        return ENCODER.encode(password);
    }

    /** 校验密码：BCrypt 走标准校验，其余格式交给迁移类处理。 */
    public static boolean verify(String storedHash, String password) {
        if (storedHash == null || password == null || storedHash.isEmpty()) {
            return false;
        }
        if (isBcrypt(storedHash)) {
            return ENCODER.matches(password, storedHash);
        }
        return LegacyPasswordMigration.matches(storedHash, password);
    }

    /** 判断哈希串是否为 BCrypt 格式。 */
    public static boolean isBcrypt(String value) {
        return value != null && value.matches("^\\$2[aby]\\$\\d{2}\\$.*");
    }

    /** 是否仍是迁移前的历史格式，需要在登录成功后重写为 BCrypt。 */
    public static boolean needsUpgrade(String storedHash) {
        return LegacyPasswordMigration.needsUpgrade(storedHash);
    }

    /**
     * 判断是否为已哈希格式（BCrypt 或迁移前的 PBKDF2）。
     *
     * <p>用于区分「已哈希」与「明文」：只有明文才需要在启动时重置，
     * 历史 PBKDF2 哈希保持原样，交由登录流程升级。
     */
    public static boolean isHashed(String value) {
        return isBcrypt(value) || (value != null && value.startsWith("pbkdf2:"));
    }
}
