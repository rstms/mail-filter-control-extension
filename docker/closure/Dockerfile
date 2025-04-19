FROM debian:stable
RUN apt-get update && apt-get install -y closure-compiler make bash curl wget
ARG URL=https://repo1.maven.org/maven2/com/google/javascript/closure-compiler
ENV URL=${URL}
RUN \
    curl -Ls ${URL}/maven-metadata.xml | grep '<latest>' && \
    export VERSION=$(curl -Ls ${URL}/maven-metadata.xml | awk -F'[\t <>]*' '/<latest>/{print $3}') && \
    echo version=$VERSION && \
    wget ${URL}/${VERSION}/closure-compiler-${VERSION}.jar
RUN \
    mv closure-compiler-*.jar /opt/closure.jar && \
    chmod 0644 /opt/closure.jar && \
    ls -al /opt
COPY --chmod=0755 closure /usr/local/bin
ARG USER=user
ENV USER=${USER}
ARG UID=1000
ENV UID=${UID}
ARG GID=1000
ENV GID=${GID}
RUN \
    addgroup --gid ${GID} ${USER} && \
    adduser --uid ${UID} --gid ${GID} --disabled-password --home /app ${USER}
WORKDIR /app
USER ${USER}
COPY --chmod=0755 entrypoint /usr/bin/entrypoint
ENTRYPOINT ["/usr/bin/entrypoint"]
