package com.chaekjang.server.account;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import com.chaekjang.server.PostgresIntegrationTest;
import com.jayway.jsonpath.JsonPath;

/** 카카오 로그인 흐름(start → callback → claim)을 가짜 카카오로 끝까지 시험한다. */
@TestPropertySource(properties = {"KAKAO_ADMIN_KEY=test-admin", "KAKAO_APP_ID=test-app", "KAKAO_REST_KEY=test-rest-key", "KAKAO_CLIENT_SECRET=test-secret", "PUBLIC_BASE_URL=https://api.example.test/"})
class KakaoLoginApiTest extends PostgresIntegrationTest {

    static final Map<String, KakaoOAuth.Identity> CODES = new ConcurrentHashMap<>();

    @TestConfiguration
    static class Fake {
        @Bean
        @Primary
        KakaoOAuth fakeKakao() {
            return (code, redirectUri) -> {
                if (!redirectUri.equals("https://api.example.test/auth/kakao/callback")) throw new IOException("redirect mismatch");
                KakaoOAuth.Identity id = CODES.get(code);
                if (id == null) throw new IOException("bad code");
                return id;
            };
        }
    }

    @Autowired
    WebApplicationContext ctx;
    MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.webAppContextSetup(ctx).build();
        CODES.clear();
    }

    static final String RETURN = "chaekjang://auth/kakao";

    String newToken() throws Exception {
        MvcResult r = mvc.perform(post("/auth/device")).andExpect(status().isCreated()).andReturn();
        return JsonPath.read(r.getResponse().getContentAsString(), "$.token");
    }

    static String bearer(String t) {
        return "Bearer " + t;
    }

    /** start → 인가 주소의 state 반환 */
    String start(String token, String returnUrl) throws Exception {
        String body = mvc.perform(post("/auth/kakao/start").header("Authorization", bearer(token)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"accountLifecycle\":\"1\",\"returnUrl\":\"" + returnUrl + "\"}")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String url = JsonPath.read(body, "$.url");
        assertThat(url).startsWith("https://kauth.kakao.com/oauth/authorize?response_type=code&client_id=test-rest-key");
        assertThat(url).contains("redirect_uri=https%3A%2F%2Fapi.example.test%2Fauth%2Fkakao%2Fcallback");
        return URLDecoder.decode(url.substring(url.indexOf("state=") + 6), StandardCharsets.UTF_8);
    }

    String callbackLocation(String query) throws Exception {
        return mvc.perform(get("/auth/kakao/callback?" + query)).andExpect(status().isFound()).andReturn().getResponse().getHeader("Location");
    }

    String claim(String token, String ticket) throws Exception {
        return mvc.perform(post("/auth/kakao/claim").header("Authorization", bearer(token)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"ticket\":\"" + ticket + "\"}")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    }

    static String param(String location, String key) {
        for (String kv : URI.create(location).getQuery().split("&")) {
            if (kv.startsWith(key + "=")) return URLDecoder.decode(kv.substring(key.length() + 1), StandardCharsets.UTF_8);
        }
        return null;
    }

    @Test
    void firstLoginLinksKakaoToThisDeviceAccount() throws Exception {
        String token = newToken();
        long userId = ((Number) JsonPath.read(mvc.perform(get("/me").header("Authorization", bearer(token))).andReturn().getResponse().getContentAsString(), "$.userId")).longValue();
        CODES.put("c1", new KakaoOAuth.Identity("1001", "책벌레"));

        String state = start(token, RETURN);
        String loc = callbackLocation("code=c1&state=" + state);
        assertThat(loc).startsWith(RETURN + "?ticket=");
        String claimed = claim(token, param(loc, "ticket"));

        assertThat(((Number) JsonPath.read(claimed, "$.userId")).longValue()).isEqualTo(userId);
        assertThat((Boolean) JsonPath.read(claimed, "$.switched")).isFalse();
        assertThat((String) JsonPath.read(claimed, "$.nickname")).isEqualTo("책벌레");
        String fresh = JsonPath.read(claimed, "$.token");
        mvc.perform(get("/me").header("Authorization", bearer(fresh))).andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value(userId)).andExpect(jsonPath("$.kakao").value(true)).andExpect(jsonPath("$.nickname").value("책벌레"));
    }

    @Test
    void loginOnAnotherDeviceSwitchesToTheLinkedAccount() throws Exception {
        String tokenA = newToken();
        CODES.put("a", new KakaoOAuth.Identity("2002", null));
        String locA = callbackLocation("code=a&state=" + start(tokenA, RETURN));
        long userA = ((Number) JsonPath.read(claim(tokenA, param(locA, "ticket")), "$.userId")).longValue();

        String tokenB = newToken();
        CODES.put("b", new KakaoOAuth.Identity("2002", null));
        String claimedB = claim(tokenB, param(callbackLocation("code=b&state=" + start(tokenB, RETURN)), "ticket"));

        assertThat(((Number) JsonPath.read(claimedB, "$.userId")).longValue()).isEqualTo(userA);
        assertThat((Boolean) JsonPath.read(claimedB, "$.switched")).isTrue();
    }

    @Test
    void ticketIsOneTimeAndBoundToTheStartingDevice() throws Exception {
        String token = newToken();
        String other = newToken();
        CODES.put("c", new KakaoOAuth.Identity("3003", "x"));
        String ticket = param(callbackLocation("code=c&state=" + start(token, RETURN)), "ticket");

        mvc.perform(post("/auth/kakao/claim").header("Authorization", bearer(other)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"ticket\":\"" + ticket + "\"}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("login_expired"));
        claim(token, ticket);
        mvc.perform(post("/auth/kakao/claim").header("Authorization", bearer(token)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"ticket\":\"" + ticket + "\"}")).andExpect(status().isBadRequest());
    }

    @Test
    void deniedAndFailedLoginsGoBackToTheAppWithAnError() throws Exception {
        String token = newToken();
        String denied = callbackLocation("error=access_denied&state=" + start(token, RETURN));
        assertThat(denied).isEqualTo(RETURN + "?error=denied");

        String failed = callbackLocation("code=unknown&state=" + start(token, RETURN));
        assertThat(failed).isEqualTo(RETURN + "?error=failed");
    }

    @Test
    void rejectsUnknownStateAndForeignReturnUrls() throws Exception {
        mvc.perform(get("/auth/kakao/callback?code=c&state=nope")).andExpect(status().isBadRequest());
        String token = newToken();
        mvc.perform(post("/auth/kakao/start").header("Authorization", bearer(token)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"accountLifecycle\":\"1\",\"returnUrl\":\"https://evil.example/steal\"}")).andExpect(status().isBadRequest());
        mvc.perform(post("/auth/kakao/start").contentType(MediaType.APPLICATION_JSON).content("{\"accountLifecycle\":\"1\",\"returnUrl\":\"" + RETURN + "\"}"))
                .andExpect(status().isUnauthorized());
    }
}
