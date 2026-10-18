package com.chaekjang.server.account;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

import tools.jackson.databind.json.JsonMapper;

/** Server-side code exchange; neither upstream tokens nor profile pictures are stored. */
public class HttpGoogleOAuth implements GoogleOAuth {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final Set<String> ISSUERS = Set.of("https://accounts.google.com", "accounts.google.com");
    private final GoogleConfig.Settings settings;
    private final HttpClient http;
    private final JwtDecoder decoder;
    private final URI tokenUri;

    public HttpGoogleOAuth(GoogleConfig.Settings settings) {
        this(settings, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(6)).build(),
                NimbusJwtDecoder.withJwkSetUri("https://www.googleapis.com/oauth2/v3/certs")
                        .jwsAlgorithm(SignatureAlgorithm.RS256).build(),
                URI.create("https://oauth2.googleapis.com/token"));
    }

    HttpGoogleOAuth(GoogleConfig.Settings settings, HttpClient http, JwtDecoder decoder, URI tokenUri) {
        this.settings = settings; this.http = http; this.decoder = decoder; this.tokenUri = tokenUri;
    }

    @Override
    public Identity exchange(String code, String redirectUri, String verifier, String nonceHash) throws IOException, InterruptedException {
        Map<String, String> form = new LinkedHashMap<>();
        form.put("grant_type", "authorization_code");
        form.put("client_id", settings.clientId());
        form.put("client_secret", settings.clientSecret());
        form.put("code", code);
        form.put("redirect_uri", redirectUri);
        form.put("code_verifier", verifier);
        String body = form.entrySet().stream().map(e -> e.getKey() + "=" + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
        HttpResponse<String> response = http.send(HttpRequest.newBuilder(tokenUri).timeout(Duration.ofSeconds(8))
                .header("Content-Type", "application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(body)).build(),
                HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) throw new IOException("google_exchange_failed");
        String token = JSON.readTree(response.body()).path("id_token").asString("");
        if (token.isEmpty() || token.length() > 16000) throw new IOException("google_id_token_missing");
        return verify(token, nonceHash);
    }

    Identity verify(String token, String nonceHash) throws IOException {
        try {
            Jwt jwt = decoder.decode(token); // Cached official JWKS, RS256 signature, exp and nbf.
            String issuer = jwt.getClaimAsString("iss"), subject = jwt.getSubject();
            String azp = jwt.getClaimAsString("azp"), nonce = jwt.getClaimAsString("nonce");
            if (issuer == null || !ISSUERS.contains(issuer) || subject == null || subject.isBlank() || subject.length() > 255
                    || jwt.getAudience() == null || !jwt.getAudience().contains(settings.clientId())
                    || (jwt.getAudience().size() > 1 && azp == null)
                    || (azp != null && !azp.equals(settings.clientId()))
                    || jwt.getExpiresAt() == null || !jwt.getExpiresAt().isAfter(Instant.now())
                    || jwt.getIssuedAt() == null || jwt.getIssuedAt().isAfter(Instant.now().plusSeconds(60))
                    || nonce == null || !MessageDigest.isEqual(AccountService.sha256(nonce).getBytes(StandardCharsets.US_ASCII),
                            nonceHash.getBytes(StandardCharsets.US_ASCII))) throw new IOException("google_id_token_invalid");
            String name = jwt.getClaimAsString("name");
            return new Identity(subject, name == null ? null : name.substring(0, Math.min(name.length(), 200)));
        } catch (JwtException | IllegalArgumentException e) {
            throw new IOException("google_id_token_invalid"); // Never include tokens/claims/upstream error bodies.
        }
    }
}
