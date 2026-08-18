# Agent Note: Production dsh excludes product subagent providers

Status: implemented

English | [中文](2026-08-12-production-dsh-excludes-product-subagent-providers.zh.md)

## Problem

`@deepseek-ai/dsh` receives the `@deepseek-ai/dsh-base` dependency closure. Including the Codex and Claude Code subagent providers there makes every production install download optional product integration code, including the Claude Agent SDK, even when neither integration is used.

## Decision

This decision supersedes the [shared-host placement](../architecture/2026-08-10-product-subagent-providers-in-shared-host.md): `@deepseek-ai/dsh-base` does not depend on or mount the Codex and Claude Code subagent providers. Their packages remain available for Profiles that install and mount them explicitly. Repository examples keep direct development dependencies so their explicit provider configurations continue to resolve.

## Verification

The base bundle test rejects both provider dependencies and configuration rows. Cordis configuration validation requires explicit examples to declare the provider packages they name.

## Alternatives considered

**Keep dormant providers in the base bundle.** Dormant providers start no product processes, but their packages still enter every production npm install.

## Consequences

Installing `@deepseek-ai/dsh` does not download either product provider through the base bundle. Using either integration requires explicit Profile configuration.
