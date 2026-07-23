# Security policy

Glacier EQ communicates with USB DACs over HID. It only makes network requests
when you use the optional online measurement database.

## Reporting a vulnerability

Please report security issues, especially those involving:

- HID command injection or malformed device responses
- Unsafe parsing of measurement CSV or TXT files
- Clipboard data leaks

Open a draft security advisory on GitHub or email the maintainer directly. Do
not open a public issue for a critical vulnerability.
