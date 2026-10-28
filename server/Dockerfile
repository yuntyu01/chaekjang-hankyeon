FROM eclipse-temurin:17-jdk AS build
WORKDIR /src
COPY gradle gradle
COPY gradlew build.gradle settings.gradle ./
COPY src src
RUN ./gradlew --no-daemon -x test bootJar && cp build/libs/server-*.jar /app.jar

FROM eclipse-temurin:17-jre
COPY --from=build /app.jar /app.jar
USER 1000
EXPOSE 8080
# 제한된 CPU에서 Spring 기동 시 JIT 컴파일 부담을 줄인다.
ENTRYPOINT ["java", "-XX:TieredStopAtLevel=1", "-jar", "/app.jar"]
