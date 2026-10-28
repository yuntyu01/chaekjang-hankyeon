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
ENTRYPOINT ["java", "-jar", "/app.jar"]
