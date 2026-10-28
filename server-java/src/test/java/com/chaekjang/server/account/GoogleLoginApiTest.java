package com.chaekjang.server.account;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.io.IOException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import com.chaekjang.server.PostgresIntegrationTest;
import com.jayway.jsonpath.JsonPath;

@TestPropertySource(properties={"GOOGLE_CLIENT_ID=test-google", "GOOGLE_CLIENT_SECRET=test-secret", "PUBLIC_BASE_URL=https://covebook.test"})
class GoogleLoginApiTest extends PostgresIntegrationTest {
    record Code(String nonceHash, String challenge, String subject) {}
    static final Map<String,Code> CODES = new ConcurrentHashMap<>();
    @TestConfiguration static class Fake {
        @Bean @Primary GoogleOAuth fakeGoogle() {
            return (code, redirect, verifier, nonceHash) -> {
                Code expected = CODES.remove(code);
                if (expected == null || !redirect.equals("https://covebook.test/auth/google/callback")
                        || !nonceHash.equals(expected.nonceHash()) || !challenge(verifier).equals(expected.challenge())) throw new IOException("invalid_code");
                return new GoogleOAuth.Identity(expected.subject(),"Test reader");
            };
        }
    }
    @Autowired WebApplicationContext context;
    @Autowired DataSource dataSource;
    MockMvc mvc;
    @BeforeEach void setup() { mvc=MockMvcBuilders.webAppContextSetup(context).build(); CODES.clear(); }
    String device() throws Exception {
        return JsonPath.read(mvc.perform(post("/auth/device")).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(),"$.token");
    }
    static String challenge(String verifier) {
        try { return Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII))); }
        catch(Exception e) {throw new IllegalStateException(e);}
    }
    static Map<String,String> query(String url) {
        Map<String,String> result=new HashMap<>();
        for(String part:URI.create(url).getRawQuery().split("&")){String[] pair=part.split("=",2);result.put(pair[0],URLDecoder.decode(pair[1],StandardCharsets.UTF_8));}
        return result;
    }
    Map<String,String> start(String token) throws Exception {
        String url=JsonPath.read(mvc.perform(post("/auth/google/start").header("Authorization","Bearer "+token)
                .contentType(MediaType.APPLICATION_JSON).content("{\"accountLifecycle\":\"1\",\"returnUrl\":\"chaekjang://auth/google\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(),"$.url");
        Map<String,String> request=query(url);
        assertThat(request.get("scope")).isEqualTo("openid profile");
        assertThat(request.get("code_challenge_method")).isEqualTo("S256");
        assertThat(request.get("code_challenge")).hasSize(43);
        return request;
    }
    String callback(Map<String,String> request,String subject) throws Exception {
        String code="code-"+java.util.UUID.randomUUID();
        CODES.put(code,new Code(AccountService.sha256(request.get("nonce")),request.get("code_challenge"),subject));
        return mvc.perform(get("/auth/google/callback").param("state",request.get("state")).param("code",code))
                .andExpect(status().isFound()).andExpect(header().string("Cache-Control","no-store"))
                .andReturn().getResponse().getHeader("Location");
    }
    @Test void loginIsBoundToStartingDeviceAndTicketIsSingleUse() throws Exception {
        String owner=device(), stranger=device();
        Map<String,String> request=start(owner);
        String ticket=query(callback(request,"google-"+java.util.UUID.randomUUID())).get("ticket");
        mvc.perform(post("/auth/google/claim").header("Authorization","Bearer "+stranger).contentType(MediaType.APPLICATION_JSON)
                .content("{\"ticket\":\""+ticket+"\"}")).andExpect(status().isBadRequest());
        String response=mvc.perform(post("/auth/google/claim").header("Authorization","Bearer "+owner).contentType(MediaType.APPLICATION_JSON)
                .content("{\"ticket\":\""+ticket+"\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.switched").value(false))
                .andReturn().getResponse().getContentAsString();
        String token=JsonPath.read(response,"$.token");
        mvc.perform(get("/me").header("Authorization","Bearer "+token)).andExpect(status().isOk())
                .andExpect(jsonPath("$.google").value(true)).andExpect(jsonPath("$.kakao").value(false));
        mvc.perform(post("/auth/google/claim").header("Authorization","Bearer "+owner).contentType(MediaType.APPLICATION_JSON)
                .content("{\"ticket\":\""+ticket+"\"}")).andExpect(status().isBadRequest());
        mvc.perform(get("/auth/google/callback").param("state",request.get("state")).param("code","replay")).andExpect(status().isBadRequest());
    }
    @Test void sameSubjectReturnsExistingAccountAndOtherProvidersDoNotMatch() throws Exception {
        String subject="same-"+java.util.UUID.randomUUID(), first=device(), second=device();
        String ticket=query(callback(start(first),subject)).get("ticket");
        mvc.perform(post("/auth/google/claim").header("Authorization","Bearer "+first).contentType(MediaType.APPLICATION_JSON)
                .content("{\"ticket\":\""+ticket+"\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.switched").value(false));
        ticket=query(callback(start(second),subject)).get("ticket");
        mvc.perform(post("/auth/google/claim").header("Authorization","Bearer "+second).contentType(MediaType.APPLICATION_JSON)
                .content("{\"ticket\":\""+ticket+"\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.switched").value(true));
        JdbcTemplate jdbc=new JdbcTemplate(dataSource);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM auth_identities WHERE provider='google' AND subject=?",Integer.class,subject)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM auth_identities WHERE provider='kakao' AND subject=?",Integer.class,subject)).isZero();
    }
    @Test void errorsAndExpiryCannotBeReplayedOrRedirectedElsewhere() throws Exception {
        String token=device();
        mvc.perform(post("/auth/google/start").contentType(MediaType.APPLICATION_JSON).content("{\"accountLifecycle\":\"1\",\"returnUrl\":\"chaekjang://auth/google\"}"))
                .andExpect(status().isUnauthorized());
        for(String target:new String[]{"https://evil.test","chaekjang://evil/google","chaekjang://auth/google?extra=1","exp://127.0.0.1/auth/google"}) {
            mvc.perform(post("/auth/google/start").header("Authorization","Bearer "+token).contentType(MediaType.APPLICATION_JSON)
                    .content("{\"accountLifecycle\":\"1\",\"returnUrl\":\""+target+"\"}")).andExpect(status().isBadRequest());
        }
        Map<String,String> request=start(token);
        mvc.perform(get("/auth/google/callback").param("state",request.get("state")).param("code","invalid"))
                .andExpect(status().isFound()).andExpect(header().string("Location","chaekjang://auth/google?error=failed"));
        mvc.perform(get("/auth/google/callback").param("state",request.get("state")).param("code","invalid"))
                .andExpect(status().isBadRequest());
        request=start(token);
        new JdbcTemplate(dataSource).update("UPDATE google_logins SET expires_at=now()-interval '1 second' WHERE state_hash=?",AccountService.sha256(request.get("state")));
        mvc.perform(get("/auth/google/callback").param("state",request.get("state")).param("code","expired")).andExpect(status().isBadRequest());
    }
}
