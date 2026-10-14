---
title: Getting started with nRouter
audiences: [public]
---

# Getting started with nRouter

nRouter is a managed AI gateway for accessing supported models through one API and one account. The public support assistant can explain setup and documentation, but it cannot access private account data or change dashboard settings.

## Create an account

1. Open the [nRouter dashboard](https://app.nrouter.ai) and choose **Get started**.
2. Complete account verification and sign in.
3. Open your organization workspace and review the available models and plans.

## Create an API key

After signing in, open the organization’s **Keys** area in the dashboard. Create a virtual key with only the models, rate limits, and spend ceiling your application needs. Store the secret securely; if it is exposed, revoke it and create a replacement.

## Make your first request

Use the API base URL and model shown in the dashboard or API documentation. Keep the API key on your server and send it as a bearer credential. Never place a real key in browser code, public repositories, screenshots, or chat messages.

## Get help

Keep the request ID when a request fails. The support assistant can explain public nRouter documentation. For account-specific questions about keys, credits, billing, or usage, use the signed-in support channel or contact the nRouter team.
