// Reply bytes from the user-supplied sakana3.txt, 2026-10-23, Windows HIDAPI,
// SNOWSKY Melody 2972:0126 (report ID and zero padding removed). Every User 1
// name read failed because the byte after the declared 9-byte payload was EE,
// not the NUL seen in sakana2. This is decoding evidence, not a hardware pass.
pub const NAME_STALE_END: &[u8] = &[
    0xbb, 0x0b, 0x02, 0x49, 0x30, 0x09, 0xa0, 0x46, 0x44, 0x31, 0x35, 0x00, 0x00, 0x00, 0x00, 0xee, 0xa2, 0xee,
];
