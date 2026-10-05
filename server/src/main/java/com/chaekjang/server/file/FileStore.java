package com.chaekjang.server.file;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** 파일 내용 저장소. 지금은 디스크(FILE_DIR). 객체 저장소로 바꿀 때는 이 클래스만 바꾼다. */
@Component
public class FileStore {

    private final Path root;

    public FileStore(@Value("${FILE_DIR:./data/files}") String dir) {
        this.root = Path.of(dir).toAbsolutePath().normalize();
    }

    public void put(String key, byte[] bytes) throws IOException {
        Path target = resolve(key);
        Files.createDirectories(target.getParent());
        Path tmp = Files.createTempFile(target.getParent(), ".up", ".tmp");
        Files.write(tmp, bytes);
        Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    public InputStream open(String key) throws IOException {
        return Files.newInputStream(resolve(key));
    }

    private Path resolve(String key) {
        Path p = root.resolve(key).normalize();
        if (!p.startsWith(root)) throw new IllegalArgumentException("bad key");
        return p;
    }
}
