package com.smartagriculture.security;

import com.smartagriculture.config.AppEnv;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.JwtBuilder;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * JWT 签发与校验，基于 JJWT（io.jsonwebtoken）实现，HS256 对称签名。
 *
 * <p>令牌结构遵循 RFC 7519：subject 存放用户标识，自定义声明携带 user_id / username / role，
 * 有效期由 {@link #EXPIRES_SECONDS} 决定。
 */
@Component
public class JwtUtil {

    /** 令牌有效期（秒）。 */
    public static final long EXPIRES_SECONDS = 3600;

    private static final Logger log = LoggerFactory.getLogger(JwtUtil.class);

    /** HS256 要求密钥长度不低于 256 位（32 字节）。 */
    private static final int MIN_KEY_BYTES = 32;

    private final SecretKey key;

    public JwtUtil() {
        this.key = Keys.hmacShaKeyFor(normalizeSecret(AppEnv.jwtSecret()));
    }

    /**
     * HS256 的密钥必须至少 32 字节。配置过短时用 SHA-256 派生出 32 字节密钥，
     * 避免应用因密钥强度不足直接启动失败；同时提示运维配置强密钥。
     */
    private static byte[] normalizeSecret(String raw) {
        byte[] bytes = raw == null ? new byte[0] : raw.getBytes(StandardCharsets.UTF_8);
        if (bytes.length >= MIN_KEY_BYTES) {
            return bytes;
        }
        try {
            byte[] derived = MessageDigest.getInstance("SHA-256").digest(bytes);
            log.warn("JWT_SECRET 长度不足 {} 字节（当前 {} 字节），已用 SHA-256 派生密钥。"
                    + "生产环境请配置至少 32 字节的随机密钥。", MIN_KEY_BYTES, bytes.length);
            return derived;
        } catch (Exception e) {
            throw new IllegalStateException("无法派生 JWT 密钥", e);
        }
    }

    /**
     * 签发令牌。
     *
     * @param identity    主体标识（当前为用户 id 的字符串形式）
     * @param extraClaims 附加声明，如 user_id、username、role
     */
    public String createToken(String identity, Map<String, Object> extraClaims) {
        Instant now = Instant.now();
        JwtBuilder builder = Jwts.builder()
                .subject(identity)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plusSeconds(EXPIRES_SECONDS)));
        if (extraClaims != null) {
            extraClaims.forEach(builder::claim);
        }
        return builder.signWith(key, Jwts.SIG.HS256).compact();
    }

    /**
     * 校验并解析令牌。
     *
     * @throws TokenException 签名无效、格式错误或已过期
     */
    public TokenPayload parse(String token) throws TokenException {
        if (token == null || token.isBlank()) {
            throw new TokenException(false);
        }
        Claims claims;
        try {
            claims = Jwts.parser()
                    .verifyWith(key)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
        } catch (ExpiredJwtException e) {
            throw new TokenException(true);
        } catch (JwtException | IllegalArgumentException e) {
            throw new TokenException(false);
        }

        TokenPayload payload = new TokenPayload();
        payload.claims = new LinkedHashMap<>(claims);
        payload.identity = claims.getSubject();
        payload.userId = parseInteger(claims.get("user_id"));
        payload.username = claims.get("username") != null ? String.valueOf(claims.get("username")) : null;
        payload.role = claims.get("role") != null ? String.valueOf(claims.get("role")) : null;
        if (payload.userId == null && payload.identity != null) {
            payload.userId = parseInteger(payload.identity);
        }
        return payload;
    }

    private static Integer parseInteger(Object value) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        if (value instanceof String s) {
            try {
                return Integer.parseInt(s);
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    /** 解析结果：主体、用户信息与原始声明。 */
    public static class TokenPayload {
        public String identity;
        public Integer userId;
        public String username;
        public String role;
        public Map<String, Object> claims;
    }

    /** 令牌异常，区分「已过期」与「无效」两种原因，便于返回不同的提示。 */
    public static class TokenException extends RuntimeException {
        private final boolean expired;

        public TokenException(boolean expired) {
            super(expired ? "Token已过期" : "Token无效");
            this.expired = expired;
        }

        public boolean isExpired() {
            return expired;
        }
    }
}
