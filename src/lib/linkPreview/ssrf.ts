import { isIP } from "node:net";

/**
 * Deciding whether an IP address is safe for the server to connect to.
 *
 * This is the security core of link previews. Fetching a URL an author
 * typed means the *server* makes a request to an address of someone
 * else's choosing — the classic server-side request forgery setup. Without
 * these checks, `http://169.254.169.254/latest/meta-data/` in an article
 * link would hand back cloud instance credentials, and `http://127.0.0.1:6379`
 * would reach Redis.
 *
 * Deliberately an allowlist-shaped decision expressed as a denylist of
 * every non-public range, rather than "block 127.0.0.1 and 10.x": the
 * interesting attacks all live in the ranges people forget — carrier-grade
 * NAT, IPv4-mapped IPv6, 6to4, NAT64, the 0.0.0.0/8 block that still
 * reaches localhost on some stacks.
 *
 * Pure and exhaustively unit-tested, because it is not the kind of code
 * where a bug shows up in normal use.
 */

/** [first octet-or-prefix as a 32-bit int, prefix length] */
type V4Range = [number, number];

function v4(a: number, b: number, c: number, d: number): number {
  return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
}

const BLOCKED_V4: V4Range[] = [
  [v4(0, 0, 0, 0), 8], // "this network" — reaches localhost on some stacks
  [v4(10, 0, 0, 0), 8], // private
  [v4(100, 64, 0, 0), 10], // carrier-grade NAT
  [v4(127, 0, 0, 0), 8], // loopback
  [v4(169, 254, 0, 0), 16], // link-local, including cloud metadata at .169.254
  [v4(172, 16, 0, 0), 12], // private
  [v4(192, 0, 0, 0), 24], // IETF protocol assignments
  [v4(192, 0, 2, 0), 24], // TEST-NET-1
  [v4(192, 88, 99, 0), 24], // 6to4 relay anycast
  [v4(192, 168, 0, 0), 16], // private
  [v4(198, 18, 0, 0), 15], // benchmarking
  [v4(198, 51, 100, 0), 24], // TEST-NET-2
  [v4(203, 0, 113, 0), 24], // TEST-NET-3
  [v4(224, 0, 0, 0), 4], // multicast
  [v4(240, 0, 0, 0), 4], // reserved, including 255.255.255.255
];

function parseV4(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // Reject "01", "0x7f" and similar: they are accepted by some resolvers
    // with surprising results, so anything but a plain decimal octet is
    // simply not a v4 address as far as this code is concerned.
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function v4Blocked(value: number): boolean {
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (base & mask) >>> 0;
  });
}

/** Expands any valid IPv6 text form into eight 16-bit groups. */
function parseV6(address: string): number[] | null {
  let text = address;

  // A zone id ("fe80::1%eth0") is not part of the address.
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);

  // A trailing dotted quad ("::ffff:127.0.0.1") is just another way of
  // writing the last two groups. Rewrite it as hex and let the ordinary
  // parse below handle the whole thing, rather than carrying a special
  // case through the rest of this function.
  const lastColon = text.lastIndexOf(":");
  const suffix = text.slice(lastColon + 1);
  if (suffix.includes(".")) {
    const embedded = parseV4(suffix);
    if (embedded === null) return null;
    const high = (embedded >>> 16).toString(16);
    const low = (embedded & 0xffff).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      out.push(Number.parseInt(group, 16));
    }
    return out;
  };

  const head = toGroups(halves[0]);
  if (head === null) return null;

  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }

  const rest = toGroups(halves[1]);
  if (rest === null) return null;

  const known = head.length + rest.length;
  if (known > 8) return null;
  return [...head, ...new Array(8 - known).fill(0), ...rest];
}

function v6Blocked(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const allZeroThrough = (n: number) => groups.slice(0, n).every((g) => g === 0);

  // :: (unspecified) and ::1 (loopback)
  if (allZeroThrough(7) && (g7 === 0 || g7 === 1)) return true;

  // ::ffff:a.b.c.d — an IPv4 address wearing an IPv6 coat. Judge the IPv4.
  if (allZeroThrough(5) && g5 === 0xffff) return v4Blocked((g6 << 16) + g7);

  // 64:ff9b::/96 — NAT64. Same: the real destination is the embedded IPv4.
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return v4Blocked((g6 << 16) + g7);
  }

  // 2002::/16 — 6to4, with the IPv4 in the next two groups.
  if (g0 === 0x2002) return v4Blocked((g1 << 16) + g2);

  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // 100::/64 discard
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  return false;
}

/**
 * True when the server must not open a connection to this address.
 *
 * Fails closed: anything that doesn't parse as a public IPv4 or IPv6
 * address is treated as blocked, because an address this code can't
 * understand is not one it can vouch for.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = parseV4(address);
    return value === null || v4Blocked(value);
  }
  if (family === 6) {
    const groups = parseV6(address);
    return groups === null || v6Blocked(groups);
  }
  return true;
}
