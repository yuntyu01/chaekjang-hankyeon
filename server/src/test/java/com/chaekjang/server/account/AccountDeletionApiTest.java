package com.chaekjang.server.account;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import com.chaekjang.server.PostgresIntegrationTest;
import com.chaekjang.server.file.FileStore;
import com.jayway.jsonpath.JsonPath;

class AccountDeletionApiTest extends PostgresIntegrationTest {
    static final Path DIR=temp();
    static final AtomicBoolean UNLINK_FAILS=new AtomicBoolean(true);
    static Path temp(){try{return Files.createTempDirectory("covebook-erasure-");}catch(Exception e){throw new IllegalStateException(e);}}
    @DynamicPropertySource static void storage(DynamicPropertyRegistry r){r.add("FILE_DIR",()->DIR.toString());}
    @TestConfiguration static class Fake {
        @Bean @Primary KakaoConnectionManager safeKakao(){return new KakaoConnectionManager("isolated-admin","isolated-app"){
            @Override public void unlink(String subject)throws java.io.IOException{if(UNLINK_FAILS.get())throw new java.io.IOException("isolated_retry");}
        };}
    }
    @Autowired WebApplicationContext context;
    @Autowired DataSource ds;
    @Autowired AccountDeletionService deletions;
    @Autowired AccountService accounts;
    @Autowired FileStore files;
    MockMvc mvc; JdbcTemplate jdbc;
    @BeforeEach void setup(){mvc=MockMvcBuilders.webAppContextSetup(context).build();jdbc=new JdbcTemplate(ds);UNLINK_FAILS.set(true);}
    void untilGone(long id)throws Exception {
        long deadline=System.nanoTime()+5_000_000_000L;
        while(jdbc.queryForObject("SELECT count(*) FROM users WHERE id=?",Integer.class,id)>0&&System.nanoTime()<deadline)Thread.sleep(20);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM users WHERE id=?",Integer.class,id)).isZero();
    }
    @Test void deletionBlocksImmediatelyErasesOwnedCopiesAndReappliesAfterRestore()throws Exception {
        var owner=accounts.createDeviceAccount(); var previous=accounts.createDeviceAccount(); var other=accounts.createDeviceAccount();
        Timestamp created=jdbc.queryForObject("SELECT created_at FROM users WHERE id=?",Timestamp.class,owner.userId());
        accounts.recordSwitch(previous.userId(),owner.userId());
        String key="test/"+UUID.randomUUID()+".jpg";
        files.put(key,new byte[]{1,2,3});
        jdbc.update("INSERT INTO files(user_id,id,content_type,size_bytes,sha256,storage_key) VALUES (?,?,'image/jpeg',3,'test',?)",owner.userId(),"photo",key);
        mvc.perform(delete("/me").header("Authorization","Bearer "+owner.token()).contentType(MediaType.APPLICATION_JSON).content("{\"confirmation\":\"wrong\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(delete("/me").header("Authorization","Bearer "+owner.token()).contentType(MediaType.APPLICATION_JSON).content("{\"confirmation\":\"DELETE\"}"))
                .andExpect(status().isAccepted());
        mvc.perform(get("/me").header("Authorization","Bearer "+owner.token())).andExpect(status().isUnauthorized());
        mvc.perform(get("/me").header("Authorization","Bearer "+other.token())).andExpect(status().isOk());
        untilGone(owner.userId()); untilGone(previous.userId());
        long deadline=System.nanoTime()+5_000_000_000L;
        while(Files.exists(DIR.resolve(key))&&System.nanoTime()<deadline)Thread.sleep(20);
        assertThat(Files.exists(DIR.resolve(key))).isFalse();
        // Simulate restoring the deleted account and token from an older database backup.
        jdbc.update("INSERT INTO users(id,created_at) VALUES (?,?)",owner.userId(),created);
        String restored=accounts.issueToken(owner.userId());
        mvc.perform(get("/me").header("Authorization","Bearer "+restored)).andExpect(status().isUnauthorized());
        deletions.reconcile(); untilGone(owner.userId());
        assertThat(files.list("_account-deletions/")).isNotEmpty();
        // A new account reusing a numeric id is not the old account.
        jdbc.update("INSERT INTO users(id,created_at) VALUES (?,?)",owner.userId(),Timestamp.from(Instant.now().plusSeconds(1)));
        String fresh=accounts.issueToken(owner.userId()); deletions.reconcile();
        mvc.perform(get("/me").header("Authorization","Bearer "+fresh)).andExpect(status().isOk());
    }
    @Test void onlyAuthenticatedKakaoWebhookCanEraseAnAccountAndFailuresAreQueued()throws Exception {
        var owner=accounts.createDeviceAccount(); var other=accounts.createDeviceAccount();
        String subject=Long.toString(Math.abs(UUID.randomUUID().getMostSignificantBits())+1);
        jdbc.update("INSERT INTO auth_identities(provider,subject,user_id) VALUES ('kakao',?,?)",subject,owner.userId());
        mvc.perform(post("/auth/kakao/unlink").header("Authorization","KakaoAK forged").param("app_id","isolated-app").param("user_id",subject)).andExpect(status().isUnauthorized());
        mvc.perform(get("/me").header("Authorization","Bearer "+owner.token())).andExpect(status().isOk());
        mvc.perform(post("/auth/kakao/unlink").header("Authorization","KakaoAK isolated-admin").param("app_id","isolated-app").param("user_id",subject)).andExpect(status().isOk());
        mvc.perform(get("/me").header("Authorization","Bearer "+owner.token())).andExpect(status().isUnauthorized());
        untilGone(owner.userId());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM kakao_disconnect_jobs WHERE subject=?",Integer.class,subject)).isEqualTo(1);
        mvc.perform(get("/me").header("Authorization","Bearer "+other.token())).andExpect(status().isOk());
        mvc.perform(post("/auth/kakao/unlink").header("Authorization","KakaoAK isolated-admin").param("app_id","isolated-app").param("user_id",subject)).andExpect(status().isOk());
    }
}
