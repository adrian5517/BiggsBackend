SSE EventSource example
=======================

Frontend example (vanilla JS) to subscribe to queue events:

```html
<script>
  const es = new EventSource('/api/queue/events?queue=importQueue');

  es.addEventListener('connected', (e) => console.log('connected', JSON.parse(e.data)));
  es.addEventListener('progress', (e) => console.log('progress', JSON.parse(e.data)));
  es.addEventListener('completed', (e) => console.log('completed', JSON.parse(e.data)));
  es.addEventListener('failed', (e) => console.error('failed', JSON.parse(e.data)));
  es.addEventListener('error', (e) => console.error('sse error', e));

  // fallback generic message
  es.onmessage = (e) => console.log('message', e.data);
</script>
```

Notes:
- Use `/api/queue/events?queue=importQueue` to subscribe to import queue events.
- In production, add authentication (e.g., JWT in query param or a cookie) and validate on the server-side.
