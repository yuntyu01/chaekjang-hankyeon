package com.chaekjang.server.account;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableScheduling
public class GoogleConfig {
    public record Settings(String clientId, String clientSecret, String publicBaseUrl) {
        boolean enabled() { return !clientId.isBlank() && !clientSecret.isBlank(); }
    }

    @Bean
    Settings googleSettings(@Value("${GOOGLE_CLIENT_ID:}") String id,
            @Value("${GOOGLE_CLIENT_SECRET:}") String secret,
            @Value("${PUBLIC_BASE_URL:https://covebook.kodeploy.com}") String base) {
        return new Settings(id, secret, base.replaceAll("/+$", ""));
    }

    @Bean
    GoogleOAuth googleOAuth(Settings settings) { return new HttpGoogleOAuth(settings); }
}
