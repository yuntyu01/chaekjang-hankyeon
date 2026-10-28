package com.chaekjang.server.account;

import static org.assertj.core.api.Assertions.*;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Date;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

class GoogleTokenTest {
    static final String ID="test-google", NONCE="operator-nonce";
    static JWTClaimsSet.Builder claims() {
        Instant now=Instant.now();
        return new JWTClaimsSet.Builder().issuer("https://accounts.google.com").audience(ID).subject("subject-123")
                .issueTime(Date.from(now)).expirationTime(Date.from(now.plusSeconds(300))).claim("nonce",NONCE).claim("name","Reader");
    }
    static String sign(JWTClaimsSet claims, RSAPrivateKey key) throws Exception {
        SignedJWT jwt=new SignedJWT(new JWSHeader(JWSAlgorithm.RS256),claims);jwt.sign(new RSASSASigner(key));return jwt.serialize();
    }
    @Test void realSignatureAndIdentityClaimsAreVerified() throws Exception {
        KeyPairGenerator generator=KeyPairGenerator.getInstance("RSA");generator.initialize(2048);var pair=generator.generateKeyPair();
        var decoder=NimbusJwtDecoder.withPublicKey((RSAPublicKey)pair.getPublic()).build();
        var verifier=new HttpGoogleOAuth(new GoogleConfig.Settings(ID,"secret","https://covebook.test"),HttpClient.newHttpClient(),decoder,URI.create("http://127.0.0.1/token"));
        String hash=AccountService.sha256(NONCE);
        assertThat(verifier.verify(sign(claims().build(),(RSAPrivateKey)pair.getPrivate()),hash).subject()).isEqualTo("subject-123");
        for(JWTClaimsSet bad:new JWTClaimsSet[]{
                claims().issuer("https://evil.test").build(),claims().audience("another-client").build(),
                claims().claim("azp","another-client").build(),claims().claim("nonce","different").build(),
                claims().expirationTime(Date.from(Instant.now().minusSeconds(120))).build(),
                claims().issueTime(Date.from(Instant.now().plusSeconds(300))).build(),
                claims().subject("").build(),claims().expirationTime(null).build(),claims().claim("nonce",null).build(),
                claims().audience(java.util.List.of(ID,"other")).build()}) {
            String token=sign(bad,(RSAPrivateKey)pair.getPrivate());
            assertThatThrownBy(()->verifier.verify(token,hash)).isInstanceOf(IOException.class);
        }
        var other=generator.generateKeyPair();String wrong=sign(claims().build(),(RSAPrivateKey)other.getPrivate());
        assertThatThrownBy(()->verifier.verify(wrong,hash)).isInstanceOf(IOException.class);
        String token=sign(claims().build(),(RSAPrivateKey)pair.getPrivate());
        assertThatThrownBy(()->verifier.verify(token,AccountService.sha256("other"))).isInstanceOf(IOException.class);
    }
}
