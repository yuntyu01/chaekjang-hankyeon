package com.chaekjang.server.file;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation;
import software.amazon.awssdk.core.checksums.ResponseChecksumValidation;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;

/**
 * 파일 내용 저장소. S3_BUCKET이 있으면 S3 호환 객체 저장소(KoDeploy가 넣어 주는 R2 S3_* 값), 없으면 디스크(FILE_DIR).
 * 컨테이너는 디스크가 재배포 때 사라지고 쓰기 권한도 없을 수 있어 운영은 객체 저장소를 쓴다.
 */
@Component
public class FileStore {

    private final Path root;
    private final S3Client s3;
    private final String bucket;

    public FileStore(@Value("${FILE_DIR:./data/files}") String dir, @Value("${S3_BUCKET:}") String bucket, @Value("${S3_ENDPOINT:}") String endpoint,
            @Value("${S3_REGION:auto}") String region, @Value("${S3_ACCESS_KEY:}") String accessKey, @Value("${S3_SECRET_KEY:}") String secretKey) {
        this.root = Path.of(dir).toAbsolutePath().normalize();
        this.bucket = bucket;
        this.s3 = bucket.isBlank() ? null : S3Client.builder()
                .endpointOverride(URI.create(endpoint))
                .region(Region.of(region.isBlank() ? "auto" : region))
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(accessKey, secretKey)))
                // R2는 버킷을 경로에 두는 방식이 늘 된다(가상 호스트 방식은 엔드포인트마다 다름).
                // 사진은 메모리에 다 있으니 aws-chunked 조각 서명 대신 본문 전체를 한 번에 서명한다(S3 호환 저장소마다 조각 지원이 다름)
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).chunkedEncodingEnabled(false).build())
                // 새 SDK가 기본으로 붙이는 체크섬 헤더는 S3 호환 저장소마다 지원이 달라 꼭 필요할 때만 쓴다
                .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
                .responseChecksumValidation(ResponseChecksumValidation.WHEN_REQUIRED)
                .build();
    }

    public void put(String key, byte[] bytes) throws IOException {
        if (s3 != null) {
            try {
                s3.putObject(b -> b.bucket(bucket).key(key), RequestBody.fromBytes(bytes));
            } catch (SdkException e) {
                throw new IOException("object put failed: " + key, e);
            }
            return;
        }
        Path target = resolve(key);
        Files.createDirectories(target.getParent());
        Path tmp = Files.createTempFile(target.getParent(), ".up", ".tmp");
        Files.write(tmp, bytes);
        Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    public InputStream open(String key) throws IOException {
        if (s3 != null) {
            try {
                return s3.getObject(b -> b.bucket(bucket).key(key));
            } catch (SdkException e) {
                throw new IOException("object get failed: " + key, e);
            }
        }
        return Files.newInputStream(resolve(key));
    }

    private Path resolve(String key) {
        Path p = root.resolve(key).normalize();
        if (!p.startsWith(root)) throw new IllegalArgumentException("bad key");
        return p;
    }
}
