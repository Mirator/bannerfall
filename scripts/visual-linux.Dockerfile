# Reproduces CI's canvas text rendering on a developer machine, so the visual
# suite can be run locally without re-baselining against the host's fonts.
# Background: tests/README.md, "Visual baselines are captured on Linux, on purpose".
ARG PLAYWRIGHT_VERSION=1.62.1
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

# The Playwright image carries no Latin default sans, so fontconfig answers
# `system-ui` with WenQuanYi Zen Hei — a CJK face whose Latin metrics are
# nothing like CI's. ubuntu-latest resolves `system-ui` to DejaVu Sans, which
# is the face every committed baseline was captured with. Measured: without
# this package three text-heavy baselines miss by more than the 1.5% cap; with
# it all twenty pass unmodified.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
