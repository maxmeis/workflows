The certificate and private key in this directory are **test-only** fixtures for a
loopback HTTPS server. They are public repository data and must never be used for
deployment or authentication. The E2E test gives the action process this
certificate as its sole extra trusted CA via `NODE_EXTRA_CA_CERTS`. Requests stay
on `127.0.0.1`; the test does not disable TLS verification.
