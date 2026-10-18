package com.chaekjang.server.account;

import java.io.IOException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.sql.DataSource;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.chaekjang.server.file.FileStore;
import tools.jackson.databind.json.JsonMapper;

/** Minimal durable deletion journal is outside DB backups, in the existing private file store. */
@Service
public class AccountDeletionService implements SmartInitializingSingleton,DisposableBean {
    private static final String PREFIX="_account-deletions/";
    private static final JsonMapper JSON=JsonMapper.builder().build();
    record Entry(long userId,String createdAt,String requestedAt,String completedAt) {
        String key(){return PREFIX+userId+"-"+Instant.parse(createdAt).toEpochMilli()+".json";}
    }
    private final Map<String,Entry> entries=new ConcurrentHashMap<>();
    private final JdbcTemplate jdbc;
    private final FileStore files;
    private final TransactionTemplate transaction;
    private final KakaoConnectionManager kakao;
    private final ExecutorService worker=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"account-erasure");t.setDaemon(true);return t;});
    private final AtomicBoolean working=new AtomicBoolean();
    public AccountDeletionService(DataSource ds,FileStore files,PlatformTransactionManager manager,KakaoConnectionManager kakao) {
        this.jdbc=new JdbcTemplate(ds);this.files=files;this.transaction=new TransactionTemplate(manager);this.kakao=kakao;
    }
    @Override public void afterSingletonsInstantiated() {
        try {
            for(String key:files.list(PREFIX))try(var input=files.open(key)) {
                Entry e=JSON.readValue(input.readNBytes(4096),Entry.class);
                if(!e.key().equals(key)||e.requestedAt()==null)throw new IOException("invalid_erasure_entry");
                entries.put(key,e);
            }
            // Run before the web server starts, including after restoring a database snapshot.
            reconcile();
        }catch(IOException e){throw new IllegalStateException("account_deletion_journal_unavailable");}
    }
    public boolean blocked(long user,String createdAt) {
        return entries.values().stream().anyMatch(e->e.userId()==user&&e.createdAt().equals(createdAt));
    }
    public synchronized void request(long user) throws IOException {
        // Persist predecessor intents first. Removing the target must not orphan a previous device's cloud copy.
        for(Long predecessor:jdbc.queryForList("SELECT source_id FROM account_predecessors WHERE target_id=?",Long.class,user))accept(predecessor);
        accept(user);
        maintain();
    }
    private void accept(long user)throws IOException {
        var created=jdbc.queryForList("SELECT created_at FROM users WHERE id=?",Timestamp.class,user);
        if(created.isEmpty())return;
        Entry e=new Entry(user,created.get(0).toInstant().toString(),Instant.now().toString(),null);
        Entry previous=entries.get(e.key());if(previous!=null)e=previous;
        save(e); // Durable intent before DB changes; authentication checks this map.
    }
    private void save(Entry e)throws IOException {
        files.putJournal(e.key(),JSON.writeValueAsBytes(e));entries.put(e.key(),e);
    }
    private void erase(Entry e)throws IOException {
        transaction.executeWithoutResult(status->{
            var current=jdbc.queryForList("SELECT created_at FROM users WHERE id=? FOR UPDATE",Timestamp.class,e.userId());
            if(current.isEmpty()||!current.get(0).toInstant().toString().equals(e.createdAt()))return;
            jdbc.update("INSERT INTO account_file_deletions(storage_key) SELECT storage_key FROM files WHERE user_id=? ON CONFLICT DO NOTHING",e.userId());
            if(e.completedAt()==null)jdbc.update("INSERT INTO kakao_disconnect_jobs(subject,account_id) SELECT subject,user_id FROM auth_identities WHERE provider='kakao' AND user_id=? ON CONFLICT DO NOTHING",e.userId());
            jdbc.update("DELETE FROM users WHERE id=?",e.userId());
        });
        if(e.completedAt()==null)save(new Entry(e.userId(),e.createdAt(),e.requestedAt(),Instant.now().toString()));
    }
    public void reconcile()throws IOException {
        for(Entry e:entries.values()) {
            erase(e);
            if(e.completedAt()!=null&&Instant.parse(e.completedAt()).isBefore(Instant.now().minus(29,ChronoUnit.DAYS).minus(23,ChronoUnit.HOURS))) {
                files.delete(e.key());entries.remove(e.key());
            }
        }
    }
    @Scheduled(fixedDelay=60000,initialDelay=1000)
    public void maintain() {
        if(working.compareAndSet(false,true))worker.execute(()->{try{processJobs();}finally{working.set(false);}});
    }
    private void processJobs() {
        try {reconcile();}catch(Exception e){LoggerFactory.getLogger(getClass()).warn("account_erasure_retry_pending");}
        for(String key:jdbc.queryForList("SELECT storage_key FROM account_file_deletions ORDER BY requested_at LIMIT 50",String.class)) {
            try {files.delete(key);jdbc.update("DELETE FROM account_file_deletions WHERE storage_key=?",key);}
            catch(IOException e){jdbc.update("UPDATE account_file_deletions SET attempts=attempts+1 WHERE storage_key=?",key);LoggerFactory.getLogger(getClass()).warn("account_file_erasure_retry_pending");}
        }
        int expired=jdbc.update("DELETE FROM kakao_disconnect_jobs WHERE requested_at<now()-interval '6 days 23 hours'");
        if(expired>0)LoggerFactory.getLogger(getClass()).warn("kakao_unlink_deadline_exceeded");
        if(!kakao.ready())return;
        for(String subject:jdbc.queryForList("SELECT subject FROM kakao_disconnect_jobs ORDER BY requested_at LIMIT 50",String.class)) {
            try {
                boolean newer=Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM auth_identities WHERE provider='kakao' AND subject=?)",Boolean.class,subject));
                if(!newer)kakao.unlink(subject);
                jdbc.update("DELETE FROM kakao_disconnect_jobs WHERE subject=?",subject);
            }catch(InterruptedException e){Thread.currentThread().interrupt();return;}
            catch(IOException e){jdbc.update("UPDATE kakao_disconnect_jobs SET attempts=attempts+1 WHERE subject=?",subject);LoggerFactory.getLogger(getClass()).warn("kakao_unlink_retry_pending");}
        }
    }
    @Override public void destroy(){worker.shutdownNow();}
}
