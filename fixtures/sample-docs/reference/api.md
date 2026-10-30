---
title: API Reference
description: HTTP endpoints exposed by Acme.
order: 1
---

# API Reference

## Create a job

```bash
curl -X POST https://api.example.com/jobs -d '{"name":"nightly"}'
```

## List jobs

`GET /jobs` returns a JSON array.

Raw HTML below must be sanitized in the rendered page:

<script>alert("xss")</script>

<img src="x" onerror="alert(1)">

[bad link](javascript:alert(1))
