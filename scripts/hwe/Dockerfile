FROM ubuntu:24.04
ARG HTTP_PROXY
ARG HTTPS_PROXY
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends build-essential python3 python3-venv python3-pip python3-yaml python3-pytest git ca-certificates zlib1g-dev && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends python3-psutil && rm -rf /var/lib/apt/lists/*
RUN (id 1000 || useradd -m -u 1000 agent) && mkdir /work && chown 1000:1000 /work
ENV PATH=/opt/oss/bin:/opt/xpack/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /work
