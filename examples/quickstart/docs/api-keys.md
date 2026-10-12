---
title: Create and manage nRouter API keys
audiences: [public]
---

# Create and manage nRouter API keys

## Create a virtual API key

1. Sign in to the [nRouter dashboard](https://app.nrouter.ai).
2. Open your organization workspace and go to [Virtual keys](https://app.nrouter.ai/[org]/keys).
3. Choose **Create key**.
4. Give the key a clear name and configure only the models, rate limits, and spend ceiling your application needs.
5. Create the key and copy the secret immediately. The full secret may be shown only once.

## Use the key

Keep the key on your server and send it as a bearer token:

```http
Authorization: Bearer sk-nrouter-...
```

Do not put a real key in browser code, public repositories, screenshots, logs, or support messages. If a key is exposed, revoke it from the dashboard and create a replacement.

## If the key option is unavailable

Only an authenticated organization member with the required permissions can create or manage keys. Ask a workspace owner or contact nRouter support if the **Create key** option is not visible.
