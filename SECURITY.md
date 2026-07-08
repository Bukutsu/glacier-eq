# Security Policy

Glacier EQ communicates with USB DACs over HID. It does not make network requests (outside of the optional online measurement database).

## Reporting a Vulnerability

If you find a security issue — particularly anything related to:

- HID command injection or malformed device responses
- Unsafe file parsing (measurement CSV/TXT imports)
- Clipboard data leakage

Please open a draft security advisory on GitHub or email the maintainer directly. Do not file a public issue for critical vulnerabilities.
