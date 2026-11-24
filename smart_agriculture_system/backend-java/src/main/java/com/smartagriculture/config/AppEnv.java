package com.smartagriculture.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 配置读取器：按 系统环境变量 → JVM 参数 → .env 文件 → 默认值 的顺序取值。
 *
 * <p>.env 位于 backend-java/.env，使用标准 KEY=VALUE 语法（已被 .gitignore 排除）。
 * 该文件只作为本地开发时的便捷配置来源，生产环境应通过环境变量注入。
 */
public final class AppEnv {

    private static final Map<String, String> FILE_VALUES = new LinkedHashMap<>();

    /** 未配置 JDBC_URL 时使用的本地默认连接串。 */
    private static final String DEFAULT_JDBC_URL =
            "jdbc:mysql://localhost:3306/smart_agriculture"
                    + "?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai"
                    + "&useSSL=false&allowPublicKeyRetrieval=true"
                    + "&zeroDateTimeBehavior=convertToNull&tinyInt1isBit=false";

    static {
        loadDotEnv();
    }

    private AppEnv() {
    }

    private static void loadDotEnv() {
        String userDir = System.getProperty("user.dir", ".");
        List<Path> candidates = List.of(
                Paths.get(userDir, ".env"),
                Paths.get(userDir, "backend-java", ".env"),
                Paths.get(userDir, "..", "backend-java", ".env")
        );
        for (Path candidate : candidates) {
            if (!Files.isRegularFile(candidate)) {
                continue;
            }
            try {
                for (String line : Files.readAllLines(candidate, StandardCharsets.UTF_8)) {
                    String trimmed = line.trim();
                    if (trimmed.isEmpty() || trimmed.startsWith("#")) {
                        continue;
                    }
                    int eq = trimmed.indexOf('=');
                    if (eq <= 0) {
                        continue;
                    }
                    String key = trimmed.substring(0, eq).trim();
                    String value = trimmed.substring(eq + 1).trim();
                    if ((value.startsWith("\"") && value.endsWith("\""))
                            || (value.startsWith("'") && value.endsWith("'"))) {
                        value = value.substring(1, value.length() - 1);
                    }
                    FILE_VALUES.putIfAbsent(key, value);
                }
            } catch (IOException ignored) {
                // 读取失败时忽略，继续使用默认值
            }
        }
    }

    public static String get(String key, String defaultValue) {
        String env = System.getenv(key);
        if (env != null && !env.isBlank()) {
            return env;
        }
        String property = System.getProperty(key);
        if (property != null && !property.isBlank()) {
            return property;
        }
        String fileValue = FILE_VALUES.get(key);
        if (fileValue != null && !fileValue.isBlank()) {
            return fileValue;
        }
        return defaultValue;
    }

    public static String jwtSecret() {
        return get("JWT_SECRET_KEY", "change-me-in-production-at-least-32-bytes-long");
    }

    public static JdbcSettings jdbc() {
        return new JdbcSettings(
                get("JDBC_URL", DEFAULT_JDBC_URL),
                get("DB_USERNAME", "root"),
                get("DB_PASSWORD", ""));
    }

    public record JdbcSettings(String url, String username, String password) {
    }
}
