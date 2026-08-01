# Android TWA ビルド環境
#
# ホストへ JDK や Android SDK をインストールせずに Bubblewrap を実行するためのイメージ。
# Bubblewrap は JDK 17 固定であり、これより新しい JDK でも古い JDK でも動作しない。
#
# 使い方は android/README.md を参照。

FROM eclipse-temurin:17-jdk-noble

ARG NODE_MAJOR=24
ARG CMDLINE_TOOLS_VERSION=13114758
ARG BUBBLEWRAP_VERSION=1.25.0
# Bubblewrap 1.25.0 のテンプレートは compileSdk / targetSdk = 36。
# build-tools のバージョンは @bubblewrap/core の BUILD_TOOLS_VERSION 定数と
# 完全一致していなければならない（zipalign と apksigner を絶対パスで呼ぶため）。
ARG ANDROID_PLATFORM=android-36
ARG ANDROID_BUILD_TOOLS=36.1.0

ENV DEBIAN_FRONTEND=noninteractive \
    ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    HOME=/home/builder \
    GRADLE_USER_HOME=/home/builder/.gradle

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      curl ca-certificates unzip zip git python3 \
 && curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh \
 && bash /tmp/nodesource_setup.sh \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/* /tmp/nodesource_setup.sh

# Android command line tools
RUN mkdir -p "${ANDROID_HOME}/cmdline-tools" \
 && curl -fsSL -o /tmp/cmdline-tools.zip \
      "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip" \
 && unzip -q /tmp/cmdline-tools.zip -d /tmp/cmdline-tools \
 && mv /tmp/cmdline-tools/cmdline-tools "${ANDROID_HOME}/cmdline-tools/latest" \
 && rm -rf /tmp/cmdline-tools.zip /tmp/cmdline-tools

ENV PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/build-tools/${ANDROID_BUILD_TOOLS}:${PATH}"

RUN yes | sdkmanager --licenses > /dev/null \
 && sdkmanager --install \
      "platform-tools" \
      "platforms;${ANDROID_PLATFORM}" \
      "build-tools;${ANDROID_BUILD_TOOLS}" > /dev/null

# Bubblewrap は SDK の妥当性を「<sdk>/tools か <sdk>/bin が在るか」で判定し、
# sdkmanager も <sdk>/tools/bin/sdkmanager から探す（cmdline-tools 以前の配置を前提）。
# 現代の ANDROID_HOME 配置のままだと doctor が失敗するため、旧配置への入口を用意する。
# sdkmanager 本体は自身の位置から lib を辿るので、シンボリックリンクではなく exec で委譲する。
RUN mkdir -p "${ANDROID_HOME}/tools/bin" \
 && printf '#!/bin/sh\nexec "%s/cmdline-tools/latest/bin/sdkmanager" "$@"\n' "${ANDROID_HOME}" \
      > "${ANDROID_HOME}/tools/bin/sdkmanager" \
 && chmod +x "${ANDROID_HOME}/tools/bin/sdkmanager"

RUN npm install -g "@bubblewrap/cli@${BUBBLEWRAP_VERSION}"

# Bubblewrap は ~/.bubblewrap/config.json から JDK と SDK の場所を読む。
# 対話的な初期設定を避けるため、あらかじめ書き込んでおく。
RUN mkdir -p "${HOME}/.bubblewrap" "${GRADLE_USER_HOME}" \
 && printf '{\n  "jdkPath": "%s",\n  "androidSdkPath": "%s"\n}\n' \
      "${JAVA_HOME}" "${ANDROID_HOME}" > "${HOME}/.bubblewrap/config.json" \
 && chmod -R 777 "${HOME}" "${ANDROID_HOME}"

WORKDIR /work
