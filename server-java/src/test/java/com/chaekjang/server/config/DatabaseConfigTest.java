package com.chaekjang.server.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class DatabaseConfigTest {

    @Test
    void convertsPostgresUrlLikeTheGoServerAccepted() {
        String url = "postgres://user:p%40ss@db.example:6543/chaekjang?sslmode=disable";
        assertThat(DatabaseConfig.toJdbcUrl(url)).isEqualTo("jdbc:postgresql://db.example:6543/chaekjang?sslmode=disable");
        assertThat(DatabaseConfig.userInfo(url)).containsExactly("user", "p@ss");
    }

    @Test
    void defaultsPortAndKeepsJdbcUrls() {
        assertThat(DatabaseConfig.toJdbcUrl("postgresql://h/db")).isEqualTo("jdbc:postgresql://h:5432/db");
        assertThat(DatabaseConfig.toJdbcUrl("jdbc:postgresql://h/db")).isEqualTo("jdbc:postgresql://h/db");
        assertThat(DatabaseConfig.userInfo("jdbc:postgresql://h/db")).isNull();
    }
}
