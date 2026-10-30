---
title: Authentication
description: Authenticate API requests.
order: 1
tags: [security]
---

# Authentication

Send your token in the `Authorization` header.

```typescript
const res = await fetch("https://api.example.com/jobs", {
  headers: { Authorization: `Bearer ${process.env.ACME_TOKEN}` },
});
```

```python
import os, requests
requests.get("https://api.example.com/jobs",
             headers={"Authorization": f"Bearer {os.environ['ACME_TOKEN']}"})
```

![Auth flow](./images/auth-flow.svg)

See also the [API reference](../reference/api.md#create-a-job).
