---
title: Configuration
description: Configure Acme with a file or environment variables.
order: 2
tags: [setup, config]
---

# Configuration

Acme reads `acme.config.json` from the working directory.

![The configuration page of the docs site](./images/config-file.jpg)

```json
{
  "region": "eu-west-1",
  "concurrency": 4
}
```

## Environment variables

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `ACME_REGION` | `us-east-1` | Region to run in |
| `ACME_TOKEN` | none | API token |

## Environment variables

Duplicate heading on purpose, to test unique heading IDs.

```yaml
region: eu-west-1
concurrency: 4
```
