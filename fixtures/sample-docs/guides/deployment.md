---
title: Deployment
description: Run Acme in production.
order: 2
---

# Deployment

## Rolling back

Use `acme rollback <release>` to return to a previous release.

![Deploy pipeline](./images/deploy-pipeline.webp)

## Health checks

```sql
SELECT status, COUNT(*) FROM jobs GROUP BY status;
```

Café, naïve and 日本語 text should survive the build unchanged.
