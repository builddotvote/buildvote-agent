// Minimal base58 (Bitcoin alphabet) codec. Solana addresses and account data
// fields (like pubkeys) are base58 text / raw 32-byte values respectively —
// this is the only place we need to convert between them.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ALPHABET_MAP = new Map(Array.from(ALPHABET).map((char, i) => [char, i]));

export function base58Encode(bytes: Uint8Array): string {
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) {
    leadingZeros++;
  }

  // Treat the remaining bytes as a big-endian number and repeatedly divide by 58.
  const digits: number[] = [0];
  for (let i = leadingZeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  const leading = "1".repeat(leadingZeros);
  const body = digits
    .reverse()
    .map((d) => ALPHABET[d])
    .join("");
  // Trim a possible extra leading "1" produced by the initial [0] seed when
  // there were no non-zero bytes to encode.
  const trimmedBody = bytes.length > leadingZeros ? body : body.replace(/^1+/, "");
  return leading + trimmedBody;
}

export function base58Decode(text: string): Uint8Array {
  let leadingZeros = 0;
  while (leadingZeros < text.length && text[leadingZeros] === "1") {
    leadingZeros++;
  }

  // Nothing left to decode but leading zeros (e.g. the all-"1" system
  // program address, or ""): the loop below never runs, so the [0] seed
  // below would otherwise be emitted as a spurious extra byte on top of
  // the leading zeros already accounted for.
  if (leadingZeros === text.length) {
    return new Uint8Array(leadingZeros);
  }

  const bytes: number[] = [0];
  for (let i = leadingZeros; i < text.length; i++) {
    const value = ALPHABET_MAP.get(text[i]);
    if (value === undefined) {
      throw new Error(`invalid base58 character: ${text[i]}`);
    }
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  const leading = new Array(leadingZeros).fill(0);
  return Uint8Array.from([...leading, ...bytes.reverse()]);
}
